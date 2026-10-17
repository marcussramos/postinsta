// Backup: gera, confere (abre o arquivo e valida) e restaura num banco vazio — o "teste de restauração".
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './dev-server.js';
import { runBackup, verifyLatestBackup, restoreBackup, checkBackup } from '../lib/backup.js';
import { docs } from '../lib/db.js';

let S, base, cookie = '';
const call = async (path, { method = 'GET', body, auth = true, headers = {} } = {}) => {
  const r = await fetch(base + path, { method, headers: { ...(auth ? { cookie } : {}), 'Content-Type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); let data; try { data = JSON.parse(t); } catch { data = t; }
  return { status: r.status, data, headers: r.headers };
};
before(async () => {
  S = await startServer(4436); base = S.url;
  cookie = (await call('/api/session', { method: 'POST', body: { password: 'senha-teste' } })).headers.get('set-cookie').split(';')[0];
});
after(() => { S.server.close(); S.fakes.restore(); });

test('backup confere e restaura tudo num banco vazio', async () => {
  const c = (await call('/api/clients', { method: 'POST', body: { name: 'Maison K.' } })).data;
  await call(`/api/clients?id=${c.id}`, { method: 'PATCH', body: { monthly_fee: '1500', due_day: 10, billing_start: '2026-09-01' } });
  await call('/api/posts', { method: 'POST', body: { client_id: c.id, title: 'Ideia', stage: 'idea' } });
  const b = await runBackup({ reason: 'manual' });
  const chk = await verifyLatestBackup();
  assert.equal(chk.ok, true, JSON.stringify(chk));
  assert.equal(chk.tables.clients, 1);
  assert.equal((await call('/api/pasta?r=backup&check=1')).data.ok, true, 'Ajustes mostra a conferência');

  const data = await docs.download(b.path);
  const before = { clients: structuredClone(S.fakes.tables.clients), posts: structuredClone(S.fakes.tables.posts) };
  // "desastre": apaga tudo
  S.fakes.tables.clients.length = 0; S.fakes.tables.posts.length = 0;
  const done = await restoreBackup(data);
  assert.equal(done.clients, 1); assert.equal(done.posts, 1);
  assert.deepEqual(S.fakes.tables.clients.map((x) => x.id), before.clients.map((x) => x.id));
  assert.equal(S.fakes.tables.clients[0].monthly_fee_cents, 150000);
  assert.deepEqual(S.fakes.tables.posts.map((x) => x.title), before.posts.map((x) => x.title));
  // restaurar de novo não duplica (regrava pelo id)
  await restoreBackup(data);
  assert.equal(S.fakes.tables.clients.length, 1);

  assert.equal(checkBackup({ foo: 1 }).ok, false);
  await assert.rejects(restoreBackup({ app: 'outro' }), /inválido/);
});

test('vigia: o cron diário avisa quando o agendador está parado', async () => {
  const secret = process.env.CRON_SECRET;
  S.fakes.tables.app_state = S.fakes.tables.app_state.filter((r) => r.key !== 'publisher');
  S.fakes.tables.app_state.push({ key: 'publisher', value: { at: new Date(Date.now() - 5 * 3600e3).toISOString() } });
  const r = await call('/api/cron', { auth: false, headers: { authorization: `Bearer ${secret}` } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.match(r.data.watchdog, /parado há 5 h/);
  // rodando em dia: sem aviso
  const r2 = await call('/api/cron', { auth: false, headers: { authorization: `Bearer ${secret}` } });
  assert.equal(r2.data.watchdog, undefined);
});
