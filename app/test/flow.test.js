// Teste do fluxo inteiro: login → cliente → Instagram → post → aprovação do cliente → publicação.
// Rode com: npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './dev-server.js';
import { sign } from '../lib/auth.js';
import { runPublisher } from '../lib/publisher.js';

let S, base, cookie = '';
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 0xff, 0xd9]);

async function call(path, { method = 'GET', body, raw, auth = true, headers = {} } = {}) {
  const init = { method, headers: { ...headers }, redirect: 'manual' };
  if (auth && cookie) init.headers.cookie = cookie;
  if (raw) { init.body = raw; init.headers['Content-Type'] = 'application/octet-stream'; }
  else if (body) { init.body = JSON.stringify(body); init.headers['Content-Type'] = 'application/json'; }
  const r = await fetch(base + path, init);
  const t = await r.text();
  let data; try { data = JSON.parse(t); } catch { data = t; }
  return { status: r.status, data, headers: r.headers };
}

before(async () => { S = await startServer(4400); base = S.url; });
after(() => { S.server.close(); S.fakes.restore(); });

test('fluxo completo', async () => {
  // sem login
  assert.equal((await call('/api/clients')).status, 401);
  assert.equal((await call('/api/session', { method: 'POST', body: { password: 'errada' } })).status, 401);
  const login = await call('/api/session', { method: 'POST', body: { password: 'senha-teste' } });
  assert.equal(login.status, 200);
  cookie = login.headers.get('set-cookie').split(';')[0];

  // cliente
  const c = (await call('/api/clients', { method: 'POST', body: { name: 'Frases de Funk', contact_whatsapp: '(65) 99994-9109' } })).data;
  assert.equal(c.contact_whatsapp, '5565999949109');
  assert.ok(c.approval_url.includes('/aprovar?t='));
  assert.equal(c.ig_token, undefined, 'token nunca vai para o navegador');

  // conectar Instagram (simula a volta do login da Meta)
  const go = await call(`/api/ig/connect?client=${c.id}`);
  assert.equal(go.status, 302);
  assert.match(go.headers.get('location'), /instagram\.com\/oauth\/authorize.*instagram_business_content_publish/);
  const state = new URL(go.headers.get('location')).searchParams.get('state');
  const cb = await call(`/api/ig/callback?code=abc%23_&state=${encodeURIComponent(state)}`, { auth: false });
  assert.equal(cb.status, 302);
  assert.match(cb.headers.get('location'), /ig=ok/);
  // conexão pelo link do cliente (sem login no painel)
  const viaClient = await call(`/api/ig/connect?t=${c.approval_url.split('t=')[1]}`, { auth: false });
  assert.equal(viaClient.status, 302);
  const st2 = new URL(viaClient.headers.get('location')).searchParams.get('state');
  const cb2 = await call(`/api/ig/callback?code=abc&state=${encodeURIComponent(st2)}`, { auth: false });
  assert.match(cb2.headers.get('location'), /^\/aprovar\?t=[0-9a-f]+&ig=ok/);
  assert.equal((await call(`/api/ig/connect?client=${c.id}`, { auth: false })).status, 401, 'sem login não conecta por id');
  const forged = await call(`/api/ig/callback?code=abc&state=${encodeURIComponent('x.y')}`, { auth: false });
  assert.match(forged.headers.get('location'), /ig=erro/);
  const clients = (await call('/api/clients')).data;
  assert.equal(clients[0].ig_username, 'frasesdefunkwow');
  assert.equal(clients[0].ig_connected, true);

  // upload + post enviado para aprovação
  assert.equal((await call('/api/upload', { method: 'POST', raw: Buffer.from('not a jpeg') })).status, 415);
  const up = (await call(`/api/upload?client=${c.id}`, { method: 'POST', raw: JPEG })).data;
  assert.match(up.image_url, /\/storage\/v1\/object\/public\/posts\/.+\.jpg$/);
  const soon = new Date(Date.now() + 60_000).toISOString();
  const p = (await call('/api/posts', { method: 'POST', body: { client_id: c.id, ...up, caption: 'Não é sorte, é corre. #funk', scheduled_at: soon, send: true } })).data;
  assert.equal(p.status, 'pending_approval');

  // publicador NÃO publica o que não foi aprovado
  let log = await runPublisher({ wait: async () => {} });
  assert.equal(log.published.length, 0);

  // página do cliente
  const token = c.approval_url.split('t=')[1];
  assert.equal((await call('/api/approval?t=deadbeef', { auth: false })).status, 404);
  const page = (await call(`/api/approval?t=${token}`, { auth: false })).data;
  assert.equal(page.posts.length, 1);
  assert.equal(page.posts[0].ig_token, undefined);
  // pedido de ajuste sem texto é recusado
  assert.equal((await call('/api/approval', { method: 'POST', auth: false, body: { t: token, post_id: p.id, decision: 'changes' } })).status, 400);
  // cliente pede ajuste, depois muda de ideia e aprova
  let d = (await call('/api/approval', { method: 'POST', auth: false, body: { t: token, post_id: p.id, decision: 'changes', feedback: 'Troca a cor' } })).data;
  assert.equal(d.status, 'changes_requested');
  d = (await call('/api/approval', { method: 'POST', auth: false, body: { t: token, post_id: p.id, decision: 'approve' } })).data;
  assert.equal(d.status, 'approved');

  // horário ainda não chegou → não publica
  log = await runPublisher({ wait: async () => {} });
  assert.equal(log.published.length, 0);
  // chegou o horário
  log = await runPublisher({ wait: async () => {}, now: () => Date.now() + 120_000 });
  assert.equal(log.published.length, 1);
  const pub = S.fakes.tables.posts[0];
  assert.equal(pub.status, 'published');
  assert.equal(pub.ig_permalink, 'https://www.instagram.com/p/M1/');
  assert.equal(S.fakes.ig.published[0].caption, 'Não é sorte, é corre. #funk');
  // não publica de novo
  log = await runPublisher({ wait: async () => {}, now: () => Date.now() + 600_000 });
  assert.equal(S.fakes.ig.published.length, 1);
  // cliente não consegue mais mudar post publicado
  assert.equal((await call('/api/approval', { method: 'POST', auth: false, body: { t: token, post_id: p.id, decision: 'changes', feedback: 'x' } })).status, 409);

  // cron protegido
  assert.equal((await call('/api/cron', { method: 'POST', auth: false })).status, 401);
  assert.equal((await call('/api/cron', { method: 'POST', auth: false, headers: { authorization: `Bearer ${'c'.repeat(40)}` } })).status, 200);
});

test('edição volta para rascunho só quando o conteúdo muda', async () => {
  const c = S.fakes.tables.clients[0];
  const p = (await call('/api/posts', { method: 'POST', body: { client_id: c.id, image_url: 'https://fake.supabase.co/x.jpg', caption: 'a', scheduled_at: new Date(Date.now() + 864e5).toISOString(), approved: true } })).data;
  assert.equal(p.status, 'approved');
  let r = (await call(`/api/posts?id=${p.id}`, { method: 'PATCH', body: { scheduled_at: new Date(Date.now() + 2 * 864e5).toISOString() } })).data;
  assert.equal(r.status, 'approved', 'mudar só o horário mantém aprovado');
  r = (await call(`/api/posts?id=${p.id}`, { method: 'PATCH', body: { caption: 'b' } })).data;
  assert.equal(r.status, 'draft', 'mudar a legenda pede nova aprovação');
  r = (await call(`/api/posts?id=${p.id}`, { method: 'PATCH', body: { action: 'retry' } }));
  assert.equal(r.status, 409, 'ação fora de hora é recusada');
});

test('falha temporária do Instagram tenta de novo; falha definitiva vira "Falhou"', async () => {
  const c = S.fakes.tables.clients[0];
  const due = new Date(Date.now() - 1000).toISOString();
  const p = (await call('/api/posts', { method: 'POST', body: { client_id: c.id, image_url: 'https://fake.supabase.co/y.jpg', caption: 'z', scheduled_at: due, approved: true } })).data;
  S.fakes.ig.failNext = { status: 500, message: 'instável', code: 2 };
  await runPublisher({ wait: async () => {} });
  let row = S.fakes.tables.posts.find((x) => x.id === p.id);
  assert.equal(row.status, 'approved'); assert.match(row.last_error, /instável/);
  S.fakes.ig.failNext = { status: 400, message: 'Imagem com proporção inválida', code: 36003 };
  await runPublisher({ wait: async () => {} });
  row = S.fakes.tables.posts.find((x) => x.id === p.id);
  assert.equal(row.status, 'failed'); assert.match(row.last_error, /proporção/);
  // "tentar de novo" pelo painel
  const r = (await call(`/api/posts?id=${p.id}`, { method: 'PATCH', body: { action: 'retry' } })).data;
  assert.equal(r.status, 'approved');
  await runPublisher({ wait: async () => {} });
  assert.equal(S.fakes.tables.posts.find((x) => x.id === p.id).status, 'published');
});

test('renova token perto de vencer', async () => {
  const c = S.fakes.tables.clients[0];
  c.ig_token_expires_at = new Date(Date.now() + 3 * 864e5).toISOString();
  c.ig_connected_at = new Date(Date.now() - 50 * 864e5).toISOString();
  const log = await runPublisher({ wait: async () => {} });
  assert.deepEqual(log.refreshed, ['Frases de Funk']);
  assert.equal(c.ig_token, 'long-tok-2');
});
