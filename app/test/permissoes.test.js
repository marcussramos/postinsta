// Permissões por pessoa da equipe e acesso só a alguns clientes.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './dev-server.js';

let S, base, owner = '', A, B;
async function call(path, { method = 'GET', body, cookie = owner } = {}) {
  const init = { method, headers: { ...(cookie ? { cookie } : {}) }, redirect: 'manual' };
  if (body) { init.body = JSON.stringify(body); init.headers['Content-Type'] = 'application/json'; }
  const r = await fetch(base + path, init);
  const t = await r.text(); let data; try { data = JSON.parse(t); } catch { data = t; }
  return { status: r.status, data, headers: r.headers };
}
const login = async (email) => (await call('/api/session', { method: 'POST', body: { email, password: 'senha-forte-1' }, cookie: '' })).headers.get('set-cookie').split(';')[0];
const at = () => new Date(Date.now() + 864e5).toISOString();
before(async () => {
  process.env.ANTHROPIC_API_KEY = 'sk-test';
  S = await startServer(4424); base = S.url;
  owner = (await call('/api/session', { method: 'POST', body: { password: 'senha-teste' }, cookie: '' })).headers.get('set-cookie').split(';')[0];
  A = (await call('/api/clients', { method: 'POST', body: { name: 'Cliente A' } })).data;
  B = (await call('/api/clients', { method: 'POST', body: { name: 'Cliente B' } })).data;
});
after(() => { S.server.close(); S.fakes.restore(); delete process.env.ANTHROPIC_API_KEY; });

test('designer: só conteúdo do Cliente A, sem enviar, apagar, IA, financeiro ou vendas', async () => {
  const u = (await call('/api/pasta?r=users', { method: 'POST', body: { name: 'Designer', email: 'design@mc.com', password: 'senha-forte-1', role: 'team',
    perms: { conteudo: true, enviar: false, apagar: false, ia: false, marca: true }, client_ids: [A.id] } })).data;
  assert.equal(u.perms.financeiro, false); assert.deepEqual(u.client_ids, [A.id]);
  const d = await login('design@mc.com');
  const s = (await call('/api/session', { cookie: d })).data;
  assert.equal(s.perms.enviar, false); assert.deepEqual(s.clients, [A.id]);
  const list = (await call('/api/clients', { cookie: d })).data;
  assert.deepEqual(list.map((c) => c.name), ['Cliente A']);
  assert.equal(list[0].monthly_fee_cents, undefined, 'sem financeiro não vê valores');
  // posts
  const pa = (await call('/api/posts', { method: 'POST', cookie: d, body: { client_id: A.id, title: 'Arte A', scheduled_at: at() } })).data;
  assert.equal(pa.status, 'draft');
  assert.equal((await call('/api/posts', { method: 'POST', cookie: d, body: { client_id: B.id, title: 'x' } })).status, 403);
  assert.equal((await call('/api/posts', { method: 'POST', cookie: d, body: { client_id: A.id, title: 'x', image_url: 'https://x/a.jpg', scheduled_at: at(), send: true } })).status, 403);
  assert.equal((await call(`/api/posts?id=${pa.id}`, { method: 'PATCH', cookie: d, body: { action: 'send' } })).status, 403);
  assert.equal((await call(`/api/posts?id=${pa.id}`, { method: 'PATCH', cookie: d, body: { title: 'Arte A v2' } })).status, 200);
  assert.equal((await call(`/api/posts?id=${pa.id}`, { method: 'DELETE', cookie: d })).status, 403);
  const pb = (await call('/api/posts', { method: 'POST', body: { client_id: B.id, title: 'do B', scheduled_at: at() } })).data;
  const posts = (await call(`/api/posts?from=${encodeURIComponent(new Date(0).toISOString())}`, { cookie: d })).data;
  assert.ok(posts.every((p) => p.client_id === A.id));
  assert.equal((await call(`/api/posts?id=${pb.id}`, { method: 'PATCH', cookie: d, body: { title: 'invadindo' } })).status, 403);
  // demais áreas
  assert.equal((await call('/api/pasta?r=payments', { cookie: d })).status, 403);
  assert.equal((await call('/api/pasta?r=leads', { cookie: d })).status, 403);
  assert.equal((await call('/api/pasta?r=proposals', { cookie: d })).status, 403);
  assert.equal((await call('/api/ai/caption', { method: 'POST', cookie: d, body: { client_id: A.id, brief: 'x' } })).status, 403);
  assert.equal((await call(`/api/pasta?r=brand&client=${A.id}`, { cookie: d })).status, 200);
  assert.equal((await call(`/api/pasta?r=brand&client=${B.id}`, { cookie: d })).status, 403);
  assert.equal((await call(`/api/pasta?r=files&client=${A.id}&category=contract`, { cookie: d })).status, 403);
  assert.equal((await call('/api/pasta?r=users', { cookie: d })).status, 403);
});

test('financeiro e vendas liberados para outra pessoa; mudança vale na hora', async () => {
  const u = (await call('/api/pasta?r=users', { method: 'POST', body: { name: 'Fin', email: 'fin@mc.com', password: 'senha-forte-1', role: 'team', perms: { conteudo: false, financeiro: true, vendas: true } } })).data;
  const f = await login('fin@mc.com');
  assert.equal((await call('/api/pasta?r=payments', { cookie: f })).status, 200);
  assert.equal((await call('/api/pasta?r=leads', { cookie: f })).status, 200);
  assert.equal((await call(`/api/pasta?r=files&client=${A.id}&category=contract`, { cookie: f })).status, 200);
  assert.ok('portal_url' in (await call('/api/clients', { cookie: f })).data[0]);
  assert.equal((await call('/api/posts', { method: 'POST', cookie: f, body: { client_id: A.id, title: 'x' } })).status, 403);
  assert.equal((await call(`/api/clients?id=${A.id}`, { method: 'PATCH', cookie: f, body: { name: 'Renomeado' } })).status, 403, 'financeiro não edita cadastro');
  assert.equal((await call(`/api/clients?id=${A.id}`, { method: 'PATCH', cookie: f, body: { monthly_fee: '900,00' } })).status, 200);
  await call('/api/pasta?r=users', { method: 'PATCH', body: { id: u.id, perms: { financeiro: false, vendas: false } } });
  assert.equal((await call('/api/pasta?r=payments', { cookie: f })).status, 403, 'tirou a permissão: bloqueia na hora');
  assert.equal((await call('/api/pasta?r=diagcfg', { cookie: f })).status, 403, 'Ajustes só administrador');
});
