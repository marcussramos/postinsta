// Parcelas, cobrança, contador de entregas, equipe, marca, pedidos e melhores horários.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './dev-server.js';
import { billingMonths, dueSoon, splitCents } from '../public/billing.js';
import { rankSlots } from '../lib/besttime.js';

let S, base, owner = '', c;
async function call(path, { method = 'GET', body, raw, headers = {}, cookie = owner } = {}) {
  const init = { method, headers: { ...(cookie ? { cookie } : {}), ...headers }, redirect: 'manual' };
  if (raw) { init.body = raw; init.headers['Content-Type'] = 'application/octet-stream'; }
  else if (body) { init.body = JSON.stringify(body); init.headers['Content-Type'] = 'application/json'; }
  const r = await fetch(base + path, init);
  const t = await r.text(); let data; try { data = JSON.parse(t); } catch { data = t; }
  return { status: r.status, data, headers: r.headers };
}
before(async () => {
  S = await startServer(4416); base = S.url;
  const r = await call('/api/session', { method: 'POST', body: { password: 'senha-teste' }, cookie: '' });
  owner = r.headers.get('set-cookie').split(';')[0];
  c = (await call('/api/clients', { method: 'POST', body: { name: 'MY PET', contact_whatsapp: '65999999999' } })).data;
});
after(() => { S.server.close(); S.fakes.restore(); });

test('parcelas: 3 por mês, status por parcela e cobrança 2 dias antes', async () => {
  assert.deepEqual(splitCents(130000, 3), [43334, 43333, 43333]);
  const bad = await call(`/api/clients?id=${c.id}`, { method: 'PATCH', body: { installments: [{ day: 40, cents: 1 }, { day: 2, cents: 1 }] } });
  assert.equal(bad.status, 400);
  const saved = (await call(`/api/clients?id=${c.id}`, { method: 'PATCH', body: { monthly_fee: '1.300,00', billing_start: '2026-09-01', installments: [{ day: 4, cents: 43334 }, { day: 14, cents: 43333 }, { day: 24, cents: 43333 }] } })).data;
  assert.equal(saved.installments.length, 3);
  await call('/api/pasta?r=payments', { method: 'PUT', body: { client_id: c.id, ref_month: '2026-09', installment: 1, status: 'paid', amount_cents: 43334 } });
  await call('/api/pasta?r=payments', { method: 'PUT', body: { client_id: c.id, ref_month: '2026-09', installment: 2, status: 'paid', amount_cents: 43333 } });
  const pays = (await call(`/api/pasta?r=payments&client=${c.id}`)).data;
  assert.equal(pays.length, 2, 'uma linha por parcela');
  const months = billingMonths({ ...saved, id: c.id }, pays, '2026-10-12');
  const sep = months.find((m) => m.month === '2026-09');
  assert.equal(sep.status, 'late'); // 3ª parcela de setembro venceu
  assert.equal(sep.paid_count, 2);
  const oct = months.find((m) => m.month === '2026-10');
  assert.deepEqual(oct.parcels.map((p) => p.status), ['late', 'open', 'open']);
  const due = dueSoon(months, '2026-10-12').map((p) => `${p.month}#${p.n}`);
  assert.deepEqual(due, ['2026-09#3', '2026-10#1', '2026-10#2']); // 14/10 está a 2 dias; 24/10 ainda não
  // desfazer só a parcela 2
  await call(`/api/pasta?r=payments&client=${c.id}&month=2026-09&n=2`, { method: 'DELETE' });
  assert.equal((await call(`/api/pasta?r=payments&client=${c.id}`)).data.length, 1);
  // área do cliente mostra as parcelas
  const on = (await call(`/api/clients?id=${c.id}`, { method: 'PATCH', body: { portal: 'enable' } })).data;
  const t = on.portal_url.split('t=')[1];
  const p = (await call(`/api/pasta?r=portal&t=${t}`, { cookie: '' })).data;
  assert.equal(p.billing.months.find((m) => m.month === '2026-09').parcels.length, 3);
});

test('contador de entregas: feed x Reels contra a cota do contrato', async () => {
  await call(`/api/clients?id=${c.id}`, { method: 'PATCH', body: { contract_data: { nome: 'MY PET', quota_posts: 8, quota_reels: 4 } } });
  const month = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Cuiaba' }).format(new Date()).slice(0, 7);
  const at = new Date(Date.now() + 3600e3).toISOString();
  await call('/api/posts', { method: 'POST', body: { client_id: c.id, image_url: 'https://x/a.jpg', scheduled_at: at, approved: true } });
  await call('/api/posts', { method: 'POST', body: { client_id: c.id, media_type: 'REELS', media: [{ url: 'https://x/v.mp4', kind: 'video' }], image_url: 'https://x/c.jpg', scheduled_at: at, approved: true } });
  await call('/api/posts', { method: 'POST', body: { client_id: c.id, title: 'ideia', stage: 'idea', scheduled_at: at } });
  const d = (await call(`/api/pasta?r=deliveries&month=${month}`)).data[c.id];
  assert.deepEqual(d.posts, { published: 0, planned: 1, quota: 8 });
  assert.deepEqual(d.reels, { published: 0, planned: 1, quota: 4 });
});

test('equipe: entra com e-mail, não vê financeiro/contrato/ajustes; desativar corta o acesso', async () => {
  const fail = await call('/api/pasta?r=users', { method: 'POST', body: { name: 'Ana', email: 'ana@x.com', password: '123' } });
  assert.equal(fail.status, 400);
  const u = (await call('/api/pasta?r=users', { method: 'POST', body: { name: 'Ana Designer', email: 'Ana@X.com', password: 'senha-forte-1' } })).data;
  assert.equal(u.email, 'ana@x.com');
  assert.equal(u.pass_hash, undefined);
  assert.ok(S.fakes.tables.users[0].pass_hash.startsWith('scrypt$'));
  assert.equal((await call('/api/session', { method: 'POST', body: { email: 'ana@x.com', password: 'errada' }, cookie: '' })).status, 401);
  const lg = await call('/api/session', { method: 'POST', body: { email: 'ana@x.com', password: 'senha-forte-1' }, cookie: '' });
  assert.equal(lg.status, 200);
  assert.equal(lg.data.role, 'team');
  const team = lg.headers.get('set-cookie').split(';')[0];
  const sess = (await call('/api/session', { cookie: team })).data;
  assert.equal(sess.role, 'team'); assert.equal(sess.setup, undefined);
  // pode: posts, clientes (sem dados financeiros), marca, pedidos, entregas
  assert.equal((await call('/api/posts', { cookie: team })).status, 200);
  const cl = (await call('/api/clients', { cookie: team })).data[0];
  for (const k of ['monthly_fee_cents', 'installments', 'contract_data', 'portal_url', 'billing_start']) assert.equal(cl[k], undefined, k);
  assert.equal((await call(`/api/pasta?r=brand&client=${c.id}`, { cookie: team })).status, 200);
  // não pode: financeiro, contrato, relatórios, ajustes, equipe, pasta interna, área do cliente
  for (const r of ['payments', `contract&client=${c.id}`, `reports&client=${c.id}`, 'settings', 'users', `history&client=${c.id}`]) {
    assert.equal((await call(`/api/pasta?r=${r}`, { cookie: team })).status, 403, r);
  }
  assert.equal((await call(`/api/pasta?r=files&client=${c.id}&category=contract`, { cookie: team })).status, 403);
  assert.equal((await call(`/api/clients?id=${c.id}`, { method: 'PATCH', body: { name: 'hack' }, cookie: team })).status, 403);
  // anexos de marca: pode
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
  assert.equal((await call(`/api/pasta?r=files&client=${c.id}&category=brand`, { method: 'POST', raw: png, headers: { 'x-file-name': 'logo.png' }, cookie: team })).status, 201);
  // desativar: a sessão para de valer na hora
  await call('/api/pasta?r=users', { method: 'PATCH', body: { id: u.id, active: false } });
  assert.equal((await call('/api/posts', { cookie: team })).status, 401);
});

test('marca: kit validado e usado pela IA; pedidos do cliente com anexo viram tarefa', async () => {
  const r = (await call('/api/pasta?r=brand', { method: 'PUT', body: { client_id: c.id, brand_voice: 'carinhoso', brand_kit: { colors: ['#FF7A00', 'azul', '#123456'], donts: 'nunca dizer barato', notes: 'x'.repeat(5000) } } })).data;
  assert.deepEqual(r.brand_kit.colors, ['#FF7A00', '#123456']);
  assert.equal(r.brand_kit.notes.length, 2000);
  process.env.ANTHROPIC_API_KEY = 'teste';
  await call('/api/ai/caption', { method: 'POST', body: { client_id: c.id, brief: 'banho e tosa', media_type: 'REELS' } });
  const prompt = S.fakes.ig.aiCalls.at(-1).messages[0].content.at(-1).text;
  assert.match(prompt, /nunca dizer barato/);
  assert.match(prompt, /Reels/);
  delete process.env.ANTHROPIC_API_KEY;

  const t = S.fakes.tables.clients.find((x) => x.id === c.id).portal_token;
  const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2]);
  const exe = await call(`/api/pasta?r=portal&t=${t}&upload=1`, { method: 'POST', raw: jpg, headers: { 'x-file-name': 'virus.exe' }, cookie: '' });
  assert.equal(exe.status, 415);
  const f = (await call(`/api/pasta?r=portal&t=${t}&upload=1`, { method: 'POST', raw: jpg, headers: { 'x-file-name': encodeURIComponent('foto loja.jpg') }, cookie: '' })).data;
  const other = (await call('/api/clients', { method: 'POST', body: { name: 'Outro' } })).data;
  const foreign = S.fakes.tables.client_files.find((x) => x.client_id !== c.id) || { id: '00000000-0000-0000-0000-000000000000' };
  assert.equal((await call(`/api/pasta?r=portal&t=${t}`, { method: 'POST', body: { text: 'oi', file_ids: [foreign.id] }, cookie: '' })).status, 400);
  const rq = await call(`/api/pasta?r=portal&t=${t}`, { method: 'POST', body: { text: 'Promoção de sábado: 20% no banho', wanted_date: '2026-10-17', file_ids: [f.id] }, cookie: '' });
  assert.equal(rq.status, 201);
  const list = (await call(`/api/pasta?r=requests&open=1`)).data;
  assert.equal(list.length, 1);
  assert.equal(list[0].files[0].name, 'foto loja.jpg');
  assert.equal((await call(`/api/pasta?r=requests&client=${other.id}`)).data.length, 0);
  const done = (await call('/api/pasta?r=requests', { method: 'PATCH', body: { id: list[0].id, status: 'done' } })).data;
  assert.equal(done.status, 'done');
  const portal = (await call(`/api/pasta?r=portal&t=${t}`, { cookie: '' })).data;
  assert.equal(portal.requests[0].status, 'done');
  // anexo do pedido abre pelo link do cliente; o logo da marca não
  assert.equal((await call(`/api/pasta?r=portal&t=${t}&file=${f.id}`, { cookie: '' })).status, 302);
  const logo = S.fakes.tables.client_files.find((x) => x.category === 'brand');
  assert.equal((await call(`/api/pasta?r=portal&t=${t}&file=${logo.id}`, { cookie: '' })).status, 404);
});

test('melhores horários: ranking pelo desempenho relativo; poucos posts → sugestão geral', async () => {
  const mk = (iso, likes) => ({ timestamp: iso, like_count: likes, comments_count: 0 });
  const media = [
    mk('2026-10-06T23:00:00Z', 300), mk('2026-09-29T23:00:00Z', 280), mk('2026-09-22T23:00:00Z', 310), // ter 19h Cuiabá
    mk('2026-10-08T16:00:00Z', 90), mk('2026-10-01T16:00:00Z', 100), mk('2026-09-24T16:00:00Z', 95),   // qui 12h
    mk('2026-10-04T13:00:00Z', 60), mk('2026-09-27T13:00:00Z', 50),                                     // dom 9h
  ];
  const r = rankSlots(media, 'America/Cuiaba');
  assert.equal(r[0].label, 'ter 19h');
  assert.equal(rankSlots(media.slice(0, 3)), null);
  Object.assign(S.fakes.tables.clients.find((x) => x.id === c.id), { ig_token: 'long-tok', ig_user_id: '178400001' });
  S.fakes.ig.feed = media.map((m, i) => ({ id: `B${i}`, media_type: 'IMAGE', ...m }));
  const bt = (await call(`/api/pasta?r=besttime&client=${c.id}`)).data;
  assert.equal(bt.source, 'perfil');
  assert.equal(bt.slots[0].label, 'ter 19h');
  const cached = (await call(`/api/pasta?r=besttime&client=${c.id}`)).data;
  assert.equal(cached.at, bt.at, 'usa o cache do dia');
});

test('lote: marcar parcelas antigas como pagas de uma vez', async () => {
  const x = (await call('/api/clients', { method: 'POST', body: { name: 'Antigo' } })).data;
  const r = (await call('/api/pasta?r=payments', { method: 'PUT', body: { client_id: x.id, status: 'paid', items: [{ ref_month: '2025-01', installment: 1, amount_cents: 100 }, { ref_month: '2025-02', installment: 2 }, { ref_month: 'xx' }] } })).data;
  assert.equal(r.length, 2);
  assert.equal((await call(`/api/pasta?r=payments&client=${x.id}`)).data.length, 2);
});

test('cobrança: parcela que venceria antes do início do contrato vence no dia do início', async () => {
  const { billingMonths } = await import('../public/billing.js');
  const c = { id: 'x', billing_start: '2026-10-16', due_day: 15, monthly_fee_cents: 150000 };
  const [oct] = billingMonths(c, [], '2026-10-16');
  assert.equal(oct.due, '2026-10-16'); assert.equal(oct.status, 'open', 'não está atrasada no dia do início');
  assert.equal(billingMonths(c, [], '2026-10-17')[0].status, 'late', 'no dia seguinte, sim');
  const nov = billingMonths(c, [], '2026-11-10')[0];
  assert.equal(nov.due, '2026-11-15', 'meses seguintes no dia normal');
});

test('pauta com título "REELS - …" ou "Carrossel - …" já nasce no formato certo', async () => {
  const c = (await call('/api/clients', { method: 'POST', body: { name: 'Formato' } })).data;
  const r = (await call('/api/posts', { method: 'POST', body: { client_id: c.id, title: 'REELS - bate e bola', stage: 'draft' } })).data;
  assert.equal(r.media_type, 'REELS');
  const k = (await call('/api/posts', { method: 'POST', body: { client_id: c.id, title: 'Carrossel - primeira consulta', stage: 'draft' } })).data;
  assert.equal(k.media_type, 'CAROUSEL');
  const f = (await call('/api/posts', { method: 'POST', body: { client_id: c.id, title: 'Antes e depois', stage: 'draft' } })).data;
  assert.equal(f.media_type, 'IMAGE');
});
