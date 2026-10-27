// Lembretes recorrentes: stories (semanal) e relatórios (mensal), uma vez por período.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './dev-server.js';
import { runReminders } from '../lib/reminders.js';

let S, base, cookie = '';
const call = async (path, { method = 'GET', body } = {}) => {
  const r = await fetch(base + path, { method, headers: { cookie, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); let data; try { data = JSON.parse(t); } catch { data = t; }
  return { status: r.status, data, headers: r.headers };
};
before(async () => {
  S = await startServer(4439); base = S.url;
  cookie = (await call('/api/session', { method: 'POST', body: { password: 'senha-teste' } })).headers.get('set-cookie').split(';')[0];
});
after(() => { S.server.close(); S.fakes.restore(); });

test('stories: sexta 9h avisa quem está sem stories na semana seguinte, só uma vez', async () => {
  const a = (await call('/api/clients', { method: 'POST', body: { name: 'Vitoria' } })).data;
  const b = (await call('/api/clients', { method: 'POST', body: { name: 'Lais' } })).data;
  const prod = (await call('/api/clients', { method: 'POST', body: { name: 'Fernanda' } })).data;
  await call(`/api/clients?id=${prod.id}`, { method: 'PATCH', body: { production_only: true } });
  // sexta, 30/10/2026, 09:10 em Cuiabá (UTC-4) → semana seguinte: 02/11 a 08/11
  const fri = Date.parse('2026-10-30T13:10:00Z');
  await call('/api/posts', { method: 'POST', body: { client_id: a.id, media_type: 'STORY', image_url: 'https://fake.supabase.co/s.jpg', scheduled_at: '2026-11-03T15:00:00Z', caption: '' } });
  const r = await runReminders({ now: fri });
  assert.deepEqual(r.stories.missing, ['Lais']);
  assert.equal(r.stories.total, 1);
  assert.equal(await runReminders({ now: fri + 3600e3 }), null, 'não repete no mesmo dia');
  assert.equal(await runReminders({ now: Date.parse('2026-10-30T11:00:00Z') + 7 * 864e5 }), null, 'antes das 9h não avisa');
});

test('relatórios: no dia configurado lista prontos e pendentes; configurável em Ajustes', async () => {
  const cfg = (await call('/api/pasta?r=reminders', { method: 'PUT', body: { reports: { day: 2, hour: 9 }, stories: { on: false } } })).data;
  assert.equal(cfg.reports.day, 2); assert.equal(cfg.stories.on, false);
  const c = S.fakes.tables.clients[0];
  Object.assign(c, { ig_token: 'long-tok' });
  const r = await runReminders({ now: Date.parse('2026-11-02T13:05:00Z') });
  assert.equal(r.reports.month, '2026-10');
  assert.deepEqual(r.reports.pending, [c.name]);
  assert.equal(await runReminders({ now: Date.parse('2026-11-02T20:00:00Z') }), null);
});
