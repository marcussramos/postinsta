// Relatórios mensais do Instagram: geração, link público em português, comparação, permissões e automação.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './dev-server.js';
import { monthStart, shiftMonth, autoReports, snapshotFollowers } from '../lib/reports.js';

let S, base, cookie = '', client;
async function call(path, { method = 'GET', body, auth = true } = {}) {
  const init = { method, headers: auth ? { cookie } : {} };
  if (body) { init.body = JSON.stringify(body); init.headers['Content-Type'] = 'application/json'; }
  const r = await fetch(base + path, init);
  const t = await r.text(); let data; try { data = JSON.parse(t); } catch { data = t; }
  return { status: r.status, data };
}
const iso = (s) => new Date(s).toISOString();
before(async () => {
  S = await startServer(4413); base = S.url;
  const r = await fetch(`${base}/api/session`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'senha-teste' }) });
  cookie = r.headers.get('set-cookie').split(';')[0];
  client = (await call('/api/clients', { method: 'POST', body: { name: 'Frases de Funk' } })).data;
  Object.assign(S.fakes.tables.clients.find((c) => c.id === client.id), { ig_token: 'long-tok', ig_user_id: '178400001', ig_username: 'frasesdefunkwow', ig_connected_at: iso('2026-01-01T12:00:00Z') });
  // feed: 4 posts em setembro (fuso de Cuiabá), 1 em agosto, 1 em outubro
  S.fakes.ig.feed = [
    { id: 'A1', timestamp: '2026-10-02T15:00:00+0000', media_type: 'IMAGE', caption: 'outubro' },
    { id: 'S4', timestamp: '2026-09-30T23:30:00+0000', media_type: 'IMAGE', caption: 'fim de setembro (ainda dia 30 em Cuiabá)' },
    { id: 'S3', timestamp: '2026-09-20T15:00:00+0000', media_type: 'VIDEO', media_product_type: 'REELS', caption: 'reels' },
    { id: 'S2', timestamp: '2026-09-10T15:00:00+0000', media_type: 'CAROUSEL_ALBUM', caption: 'carrossel campeão' },
    { id: 'S1', timestamp: '2026-09-01T05:00:00+0000', media_type: 'IMAGE', caption: 'primeiro do mês' },
    { id: 'G1', timestamp: '2026-08-31T22:00:00+0000', media_type: 'IMAGE', caption: 'agosto' },
  ];
  const perf = { S1: 20, S2: 400, S3: 150, S4: 90, G1: 10, A1: 5 };
  S.fakes.ig.mediaInsights = (id) => ({ reach: perf[id] * 10, likes: perf[id], comments: 2, saved: 3, shares: 1, total_interactions: perf[id] + 6 });
});
after(() => { S.server.close(); S.fakes.restore(); });

test('início do mês respeita o fuso da agência', () => {
  assert.equal(new Date(monthStart('2026-09', 'America/Cuiaba')).toISOString(), '2026-09-01T04:00:00.000Z');
  assert.equal(shiftMonth('2026-01', -1), '2025-12');
});

test('gera relatório do mês com totais, melhores posts e link público', async () => {
  const r = await call('/api/pasta?r=reports', { method: 'POST', body: { client_id: client.id, ref_month: '2026-09' } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const s = r.data.summary;
  assert.equal(s.posts, 4);
  assert.equal(s.reach, 4321); // da conta
  assert.equal(s.saves, 55);
  assert.equal(s.followers_gained, 26); // 30 novos - 4 saíram
  assert.equal(s.engagement, +(100 * 415 / 4321).toFixed(2));
  assert.match(r.data.share_url, /\/relatorio\?t=[a-f0-9]{36}$/);
  // link público: sem login, sem dados internos
  const t = r.data.share_url.split('t=')[1];
  const pub = await call(`/api/pasta?r=report&t=${t}`, { auth: false });
  assert.equal(pub.status, 200);
  assert.deepEqual(pub.data.data.top, ['S2', 'S3', 'S4']);
  assert.deepEqual(pub.data.data.posts.map((p) => p.id), ['S1', 'S2', 'S3', 'S4']);
  assert.equal(pub.data.data.posts.find((p) => p.id === 'S3').type, 'Reels');
  assert.equal(pub.data.data.totals.followers_gained.new, 30);
  assert.ok(!JSON.stringify(pub.data).includes('long-tok'), 'token não vaza');
  assert.equal((await call('/api/pasta?r=report&t=abc', { auth: false })).status, 404);
  assert.equal((await call(`/api/pasta?r=reports&client=${client.id}`, { auth: false })).status, 401);
});

test('mês seguinte compara com o anterior; atualizar mantém link e comentário', async () => {
  const sep = (await call(`/api/pasta?r=reports&client=${client.id}`)).data[0];
  await call('/api/pasta?r=reports', { method: 'PATCH', body: { id: sep.id, note: 'Ótimo mês!' } });
  S.fakes.ig.account.reach = 5000;
  const again = (await call('/api/pasta?r=reports', { method: 'POST', body: { client_id: client.id, ref_month: '2026-09' } })).data;
  assert.equal(again.id, sep.id);
  assert.equal(again.share_url, sep.share_url);
  assert.equal(again.note, 'Ótimo mês!');
  assert.equal(again.summary.reach, 5000);
  const oct = (await call('/api/pasta?r=reports', { method: 'POST', body: { client_id: client.id, ref_month: '2026-10' } })).data;
  assert.equal(oct.summary.posts, 1);
  assert.equal(oct.partial, true);
  const pub = (await call(`/api/pasta?r=report&t=${oct.share_url.split('t=')[1]}`, { auth: false })).data;
  assert.equal(pub.data.previous.reach, 5000);
  assert.equal((await call('/api/pasta?r=reports', { method: 'POST', body: { client_id: client.id, ref_month: '2030-01' } })).status, 400);
});

test('sem a permissão de métricas pede para reconectar; sem 100 seguidores usa os retratos diários', async () => {
  S.fakes.ig.insightsDenied = true;
  const r = await call('/api/pasta?r=reports', { method: 'POST', body: { client_id: client.id, ref_month: '2026-08' } });
  assert.equal(r.status, 409);
  assert.match(r.data.error, /reconecte o Instagram/i);
  S.fakes.ig.insightsDenied = false;
  // perfil pequeno: API não devolve follows_and_unfollows
  S.fakes.ig.follows = null;
  S.fakes.tables.ig_daily.push({ client_id: client.id, day: '2026-07-31', followers: 80 }, { client_id: client.id, day: '2026-08-31', followers: 95 });
  const aug = (await call('/api/pasta?r=reports', { method: 'POST', body: { client_id: client.id, ref_month: '2026-08' } })).data;
  assert.equal(aug.summary.followers_gained, 15);
  assert.equal(aug.summary.posts, 1);
  S.fakes.ig.follows = { FOLLOWER: 30, NON_FOLLOWER: 4 };
});

test('automático: dia 3 gera o mês anterior (um por vez) e guarda seguidores 1x por dia', async () => {
  const now = Date.parse('2026-11-01T15:00:00Z');
  assert.equal(await autoReports({ now, tz: 'America/Cuiaba' }), null, 'antes do dia 3 não gera');
  const day3 = Date.parse('2026-11-03T15:00:00Z');
  const before = S.fakes.tables.reports.filter((r) => r.ref_month === '2026-10').length;
  const res = await autoReports({ now: day3, tz: 'America/Cuiaba' });
  assert.equal(res, null, 'outubro já existia (gerado no teste anterior)');
  S.fakes.tables.reports = S.fakes.tables.reports.filter((r) => r.ref_month !== '2026-10');
  const res2 = await autoReports({ now: day3, tz: 'America/Cuiaba' });
  assert.deepEqual(res2, { generated: 'Frases de Funk', month: '2026-10' });
  assert.ok(before >= 1);
  const n = await snapshotFollowers({ now: day3, tz: 'America/Cuiaba' });
  assert.equal(n, 1);
  assert.equal(await snapshotFollowers({ now: day3 + 3600e3, tz: 'America/Cuiaba' }), null, 'só uma vez por dia');
  assert.ok(S.fakes.tables.ig_daily.some((x) => x.day === '2026-11-03' && x.followers === 250));
});
