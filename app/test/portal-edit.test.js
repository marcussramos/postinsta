// Área do cliente: o cliente reorganiza o calendário (quando a agência libera), com trava de 48h.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './dev-server.js';

let S, base, cookie = '';
async function call(path, { method = 'GET', body, auth = true } = {}) {
  const init = { method, headers: auth ? { cookie } : {}, redirect: 'manual' };
  if (body) { init.body = JSON.stringify(body); init.headers['Content-Type'] = 'application/json'; }
  const r = await fetch(base + path, init);
  const t = await r.text(); let data; try { data = JSON.parse(t); } catch { data = t; }
  return { status: r.status, data, headers: r.headers };
}
before(async () => {
  S = await startServer(4433); base = S.url;
  cookie = (await call('/api/session', { method: 'POST', body: { password: 'senha-teste' } })).headers.get('set-cookie').split(';')[0];
});
after(() => { S.server.close(); S.fakes.restore(); });

// dia local (Cuiabá, UTC-4) daqui a n dias
const dayIn = (n) => new Date(Date.now() + n * 864e5 - 4 * 3600e3).toISOString().slice(0, 10);
const at = (day, hhmm) => new Date(`${day}T${hhmm}:00-04:00`).toISOString();

test('calendário editável: liga por cliente, move com 48h, ideias do cliente e apagar só as dele', async () => {
  const c = (await call('/api/clients', { method: 'POST', body: { name: 'Maison' } })).data;
  const t = (await call(`/api/clients?id=${c.id}`, { method: 'PATCH', body: { portal: 'enable' } })).data.portal_url.split('t=')[1];
  const far = dayIn(6), near = dayIn(1);
  const mk = (body) => call('/api/posts', { method: 'POST', body: { client_id: c.id, caption: 'x', ...body } }).then((r) => r.data);
  const aprovado = await mk({ title: 'Aprovado', scheduled_at: at(far, '18:30') });
  S.fakes.tables.posts.find((p) => p.id === aprovado.id).status = 'approved';
  const perto = await mk({ title: 'Perto', scheduled_at: at(near, '10:00') });
  const agenciaIdeia = (await call('/api/posts', { method: 'POST', body: { client_id: c.id, title: 'Ideia da agência', stage: 'idea', scheduled_at: at(far, '19:00') } })).data;
  const month = far.slice(0, 7);
  const cal = async (m = month) => (await call(`/api/pasta?r=portal&t=${t}&cal=${m}`, { auth: false })).data;

  // desligado: só leitura e nada de editar
  assert.equal((await cal()).editable, false);
  assert.equal((await call(`/api/pasta?r=portal&t=${t}&move=1`, { method: 'POST', auth: false, body: { id: aprovado.id, day: dayIn(8) } })).status, 403);

  // só a equipe liga
  assert.equal((await call('/api/pasta?r=portaledit', { method: 'PUT', auth: false, body: { client_id: c.id, enabled: true } })).status, 401);
  assert.equal((await call('/api/pasta?r=portaledit', { method: 'PUT', body: { client_id: c.id, enabled: true } })).data.enabled, true);
  assert.deepEqual((await call('/api/pasta?r=portaledit')).data.clients, [c.id]);
  const on = await cal();
  assert.equal(on.editable, true);
  const byId = (id, list) => (list.posts || []).find((p) => p.id === id);
  if (near.slice(0, 7) === month) assert.equal(byId(perto.id, on).can_move, false, 'menos de 48h: travado');
  assert.equal(byId(aprovado.id, on).can_move, true);

  // move post aprovado: mantém a hora e o status, registra e avisa
  const novo = dayIn(9);
  const mv = await call(`/api/pasta?r=portal&t=${t}&move=1`, { method: 'POST', auth: false, body: { id: aprovado.id, day: novo } });
  assert.equal(mv.status, 200);
  const row = S.fakes.tables.posts.find((p) => p.id === aprovado.id);
  assert.equal(row.scheduled_at, at(novo, '18:30'));
  assert.equal(row.status, 'approved');
  assert.ok(S.fakes.tables.post_events.some((e) => e.post_id === aprovado.id && e.type === 'client_moved'));

  // travas: post a menos de 48h, dia de destino perto demais, post de outro cliente
  assert.equal((await call(`/api/pasta?r=portal&t=${t}&move=1`, { method: 'POST', auth: false, body: { id: perto.id, day: dayIn(10) } })).status, 409);
  assert.equal((await call(`/api/pasta?r=portal&t=${t}&move=1`, { method: 'POST', auth: false, body: { id: aprovado.id, day: dayIn(1) } })).status, 409);
  const outro = (await call('/api/clients', { method: 'POST', body: { name: 'Outro' } })).data;
  const dele = await mk({ client_id: outro.id, title: 'De outro', scheduled_at: at(far, '12:00') });
  assert.equal((await call(`/api/pasta?r=portal&t=${t}&move=1`, { method: 'POST', auth: false, body: { id: dele.id, day: dayIn(10) } })).status, 404);

  // ideia do cliente: entra como ideia, marcada, fora da cota; dia perto demais é recusado
  assert.equal((await call(`/api/pasta?r=portal&t=${t}&idea=1`, { method: 'POST', auth: false, body: { day: dayIn(1), title: 'Cedo demais' } })).status, 409);
  assert.equal((await call(`/api/pasta?r=portal&t=${t}&idea=1`, { method: 'POST', auth: false, body: { day: far, title: '' } })).status, 400);
  const idea = await call(`/api/pasta?r=portal&t=${t}&idea=1`, { method: 'POST', auth: false, body: { day: far, title: 'Coleção de cetim', media_type: 'REELS', details: 'Mostrar a renda' } });
  assert.equal(idea.status, 201);
  const ir = S.fakes.tables.posts.find((p) => p.id === idea.data.id);
  assert.equal(ir.status, 'idea'); assert.equal(ir.media_type, 'REELS'); assert.match(ir.notes, /^💡 Ideia sugerida pelo cliente/); assert.match(ir.notes, /Mostrar a renda/);
  const cal2 = await cal();
  assert.equal(byId(idea.data.id, cal2).mine, true); assert.equal(byId(idea.data.id, cal2).group, 'sugestao');
  assert.equal(byId(agenciaIdeia.id, cal2).mine, false);
  const del = (await call(`/api/pasta?r=deliveries&month=${month}`)).data[c.id];
  assert.equal(del.reels.planned, 0, 'ideia não conta na cota');

  // apagar: só a ideia dele
  assert.equal((await call(`/api/pasta?r=portal&t=${t}&idea=${agenciaIdeia.id}`, { method: 'DELETE', auth: false })).status, 404);
  assert.equal((await call(`/api/pasta?r=portal&t=${t}&idea=${aprovado.id}`, { method: 'DELETE', auth: false })).status, 404);
  assert.equal((await call(`/api/pasta?r=portal&t=${t}&idea=${idea.data.id}`, { method: 'DELETE', auth: false })).status, 200);
  assert.equal(S.fakes.tables.posts.some((p) => p.id === idea.data.id), false);

  // desligar volta a só leitura
  await call('/api/pasta?r=portaledit', { method: 'PUT', body: { client_id: c.id, enabled: false } });
  assert.equal((await cal()).editable, false);
  assert.equal(byId(aprovado.id, await cal(novo.slice(0, 7))).can_move, undefined);
});
