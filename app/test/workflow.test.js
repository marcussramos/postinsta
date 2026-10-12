// Workflow (ideia → produção → revisão → cliente), vários clientes de uma vez e IA de legendas.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './dev-server.js';

let S, base, cookie = '';
async function call(path, { method = 'GET', body } = {}) {
  const init = { method, headers: { cookie } };
  if (body) { init.body = JSON.stringify(body); init.headers['Content-Type'] = 'application/json'; }
  const r = await fetch(base + path, init);
  const t = await r.text(); let data; try { data = JSON.parse(t); } catch { data = t; }
  return { status: r.status, data, headers: r.headers };
}
before(async () => {
  S = await startServer(4411); base = S.url;
  const r = await call('/api/session', { method: 'POST', body: { password: 'senha-teste' } });
  cookie = r.headers.get('set-cookie').split(';')[0];
});
after(() => { S.server.close(); S.fakes.restore(); });

test('ideia sem imagem/data percorre o fluxo e só vai ao cliente quando completa', async () => {
  const c = (await call('/api/clients', { method: 'POST', body: { name: 'Cliente A', brand_voice: 'jovem e direto' } })).data;
  assert.equal(c.brand_voice, 'jovem e direto');
  const idea = (await call('/api/posts', { method: 'POST', body: { client_id: c.id, title: 'Frase de segunda', stage: 'idea' } })).data;
  assert.equal(idea.status, 'idea');
  assert.equal(idea.scheduled_at, null);
  // ideia aparece na listagem mesmo sem data
  const list = (await call(`/api/posts?from=${encodeURIComponent(new Date().toISOString())}`)).data;
  assert.ok(list.some((p) => p.id === idea.id));
  let r = (await call(`/api/posts?id=${idea.id}`, { method: 'PATCH', body: { action: 'to_production' } })).data;
  assert.equal(r.status, 'draft');
  r = (await call(`/api/posts?id=${idea.id}`, { method: 'PATCH', body: { action: 'to_review' } })).data;
  assert.equal(r.status, 'internal_review');
  // enviar sem imagem/data é bloqueado com explicação
  const blocked = await call(`/api/posts?id=${idea.id}`, { method: 'PATCH', body: { action: 'send' } });
  assert.equal(blocked.status, 400);
  assert.match(blocked.data.error, /imagem/);
  // edição em revisão interna mantém a etapa
  r = (await call(`/api/posts?id=${idea.id}`, { method: 'PATCH', body: { image_url: 'https://x/y.jpg', scheduled_at: new Date(Date.now() + 864e5).toISOString(), caption: 'oi' } })).data;
  assert.equal(r.status, 'internal_review');
  r = (await call(`/api/posts?id=${idea.id}`, { method: 'PATCH', body: { action: 'send' } })).data;
  assert.equal(r.status, 'pending_approval');
  // não dá para tirar a data de um post enviado
  const noDate = await call(`/api/posts?id=${idea.id}`, { method: 'PATCH', body: { scheduled_at: '' } });
  assert.equal(noDate.status, 400);
});

test('mesmo post para vários clientes; imagem compartilhada só some quando ninguém usa', async () => {
  const a = (await call('/api/clients', { method: 'POST', body: { name: 'Cliente B' } })).data;
  const b = (await call('/api/clients', { method: 'POST', body: { name: 'Cliente C' } })).data;
  S.fakes.files.set('x/shared.jpg', Buffer.from([1]));
  const rows = (await call('/api/posts', { method: 'POST', body: { client_ids: [a.id, b.id], image_url: 'https://fake/x.jpg', image_path: 'x/shared.jpg', scheduled_at: new Date(Date.now() + 864e5).toISOString(), send: true } })).data;
  assert.equal(rows.length, 2);
  assert.ok(rows.every((p) => p.status === 'pending_approval'));
  await call(`/api/posts?id=${rows[0].id}`, { method: 'DELETE' });
  assert.ok(S.fakes.files.has('x/shared.jpg'), 'ainda usada pelo outro cliente');
  await call(`/api/posts?id=${rows[1].id}`, { method: 'DELETE' });
  assert.ok(!S.fakes.files.has('x/shared.jpg'), 'apagada quando ninguém mais usa');
  // enviar direto sem imagem é recusado
  const bad = await call('/api/posts', { method: 'POST', body: { client_ids: [a.id], scheduled_at: new Date().toISOString(), send: true } });
  assert.equal(bad.status, 400);
});

test('IA: exige a chave e devolve opções com hashtags normalizadas', async () => {
  const c = S.fakes.tables.clients[0];
  delete process.env.ANTHROPIC_API_KEY;
  assert.equal((await call('/api/ai/caption', { method: 'POST', body: { client_id: c.id, brief: 'x' } })).status, 503);
  process.env.ANTHROPIC_API_KEY = 'teste';
  const r = await call('/api/ai/caption', { method: 'POST', body: { client_id: c.id, image_url: 'https://fake/img.jpg', brief: 'motivação' } });
  assert.equal(r.status, 200);
  assert.equal(r.data.options.length, 2);
  assert.deepEqual(r.data.options[0].hashtags, ['#funk', '#corre', '#foconocorre']);
  const sent = S.fakes.ig.aiCalls.at(-1);
  assert.equal(sent.messages[0].content[0].type, 'image', 'imagem vai antes do texto');
  assert.match(sent.messages[0].content[1].text, /jovem e direto/, 'usa o tom de voz do cliente');
  assert.equal((await call('/api/ai/caption', { method: 'POST', body: {} })).status, 400);
});
