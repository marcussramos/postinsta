// Publicação assistida: cliente sem Instagram (ou com a conexão caída) não vira "Falhou";
// a equipe recebe um aviso uma vez por post e marca "Postei" depois.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './dev-server.js';
import { runPublisher, ASSIST_MSG } from '../lib/publisher.js';
import { markDead } from '../lib/ighealth.js';

let S, base, cookie = '';
const call = async (path, { method = 'GET', body } = {}) => {
  const r = await fetch(base + path, { method, headers: { cookie, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); let data; try { data = JSON.parse(t); } catch { data = t; }
  return { status: r.status, data, headers: r.headers };
};
before(async () => {
  S = await startServer(4441); base = S.url;
  cookie = (await call('/api/session', { method: 'POST', body: { password: 'senha-teste' } })).headers.get('set-cookie').split(';')[0];
});
after(() => { S.server.close(); S.fakes.restore(); });

const post = async (client_id, ms, title) => (await call('/api/posts', { method: 'POST', body: { client_id, title, image_url: 'https://fake.supabase.co/a.jpg', caption: 'legenda', scheduled_at: new Date(Date.now() + ms).toISOString(), approved: true } })).data;
const row = (id) => S.fakes.tables.posts.find((x) => x.id === id);

test('sem Instagram: avisa a equipe uma vez, o post continua aprovado e "Postei" fecha', async () => {
  const c = (await call('/api/clients', { method: 'POST', body: { name: 'Mavix' } })).data;
  const now = await post(c.id, -60e3, 'Trend');
  const old = await post(c.id, -3 * 864e5, 'Antigo');
  let log = await runPublisher({ wait: async () => {} });
  assert.deepEqual(log.assisted.map((x) => x.id), [now.id], 'só avisa dos últimos 2 dias');
  assert.equal(row(now.id).status, 'approved');
  assert.equal(row(now.id).last_error, ASSIST_MSG);
  assert.equal(row(old.id).status, 'approved', 'antigo também não vira Falhou');
  log = await runPublisher({ wait: async () => {} });
  assert.deepEqual(log.assisted, [], 'não repete o aviso');
  assert.deepEqual(log.failed, []);
  const done = (await call(`/api/posts?id=${now.id}`, { method: 'PATCH', body: { action: 'mark_published' } })).data;
  assert.equal(done.status, 'published');
});

test('conexão caída também vai para a publicação assistida, sem tentar publicar', async () => {
  const c = (await call('/api/clients', { method: 'POST', body: { name: 'Lais' } })).data;
  Object.assign(S.fakes.tables.clients.find((x) => x.id === c.id), { ig_token: 'dead-tok', ig_user_id: 'u-lais', ig_token_expires_at: new Date(Date.now() + 50 * 864e5).toISOString(), ig_connected_at: new Date(Date.now() - 5 * 864e5).toISOString() });
  await markDead(c.id, 'senha trocada');
  const p = await post(c.id, -60e3, 'Antes e depois');
  const log = await runPublisher({ wait: async () => {} });
  assert.ok(log.assisted.some((x) => x.id === p.id));
  assert.equal(row(p.id).status, 'approved');
  assert.equal(row(p.id).attempts || 0, 0, 'nem tentou publicar');
});
