// Atualização 9: backup, notificações push, 2 etapas, datas comemorativas, planejamento com IA,
// modelos/hashtags, banco de mídia, duplicar semana, e-mails automáticos e nota fiscal.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { startServer } from './dev-server.js';
import { totp, base32, unbase32 } from '../lib/totp.js';
import { dateAlerts, datesOfYear } from '../public/dates.js';
import { zonedISO } from '../lib/planner.js';

let S, base, owner = '', c;
async function call(path, { method = 'GET', body, headers = {}, cookie = owner } = {}) {
  const init = { method, headers: { ...(cookie ? { cookie } : {}), ...headers }, redirect: 'manual' };
  if (body) { init.body = JSON.stringify(body); init.headers['Content-Type'] = 'application/json'; }
  const r = await fetch(base + path, init);
  const t = await r.text(); let data; try { data = JSON.parse(t); } catch { data = t; }
  return { status: r.status, data, headers: r.headers };
}
before(async () => {
  process.env.RESEND_API_KEY = 're_test';
  process.env.ASAAS_API_KEY = '$aact_hmlg_teste';
  S = await startServer(4420); base = S.url;
  const r = await call('/api/session', { method: 'POST', body: { password: 'senha-teste' }, cookie: '' });
  owner = r.headers.get('set-cookie').split(';')[0];
  c = (await call('/api/clients', { method: 'POST', body: { name: 'MY PET', contact_whatsapp: '65999999999', contact_email: 'cliente@mypet.com' } })).data;
});
after(() => { S.server.close(); S.fakes.restore(); delete process.env.RESEND_API_KEY; delete process.env.ASAAS_API_KEY; });

test('backup: copia as tabelas para o cofre e baixa por link temporário', async () => {
  const b = (await call('/api/pasta?r=backup', { method: 'POST' })).data;
  assert.match(b.path, /^_backups\/backup-.*\.json$/);
  const dump = JSON.parse(Buffer.from(S.fakes.files.get(`docs/${b.path}`)).toString());
  assert.equal(dump.tables.clients[0].name, 'MY PET');
  assert.ok(b.rows >= 1);
  const list = (await call('/api/pasta?r=backup')).data;
  assert.equal(list.length, 1);
  const dl = await call(`/api/pasta?r=backup&path=${encodeURIComponent(b.path)}`);
  assert.equal(dl.status, 302);
  assert.equal((await call(`/api/pasta?r=backup&path=${encodeURIComponent('_backups/outro.json')}`)).status, 404);
  assert.equal((await call('/api/pasta?r=backup', { cookie: '' })).status, 401);
  // semanal: não repete antes de 7 dias
  const { weeklyBackup } = await import('../lib/backup.js');
  assert.equal(await weeklyBackup(), null);
  assert.ok(await weeklyBackup({ now: Date.now() + 8 * 864e5 }));
});

function decrypt(body, ua, auth) {
  const salt = body.subarray(0, 16); const idlen = body[20]; const asPub = body.subarray(21, 21 + idlen); const data = body.subarray(21 + idlen);
  const shared = ua.computeSecret(asPub);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', shared, auth, Buffer.concat([Buffer.from('WebPush: info\0'), ua.getPublicKey(), asPub]), 32));
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const d = crypto.createDecipheriv('aes-128-gcm', cek, nonce); d.setAuthTag(data.subarray(-16));
  const plain = Buffer.concat([d.update(data.subarray(0, -16)), d.final()]);
  return JSON.parse(plain.subarray(0, plain.lastIndexOf(2)).toString());
}

test('notificações: inscreve o aparelho e avisa quando o cliente aprova (mensagem criptografada)', async () => {
  const key = (await call('/api/pasta?r=push')).data.public_key;
  assert.equal(Buffer.from(key, 'base64url').length, 65);
  const ua = crypto.createECDH('prime256v1'); ua.generateKeys();
  const auth = crypto.randomBytes(16);
  const sub = { endpoint: 'https://push.example.com/send/abc', keys: { p256dh: ua.getPublicKey().toString('base64url'), auth: auth.toString('base64url') } };
  assert.equal((await call('/api/pasta?r=push', { method: 'POST', body: { subscription: sub, device: 'iPhone' } })).status, 201);
  assert.equal((await call('/api/pasta?r=push')).data.devices, 1);
  const post = (await call('/api/posts', { method: 'POST', body: { client_id: c.id, title: 'Dia dos Animais', image_url: 'https://x/a.jpg', scheduled_at: new Date(Date.now() + 864e5).toISOString(), send: true } })).data;
  const t = c.approval_url.split('t=')[1];
  S.fakes.push.sent.length = 0;
  await call('/api/approval', { method: 'POST', body: { t, post_id: post.id, decision: 'approve' }, cookie: '' });
  assert.equal(S.fakes.push.sent.length, 1);
  const sent = S.fakes.push.sent[0];
  assert.match(sent.headers.Authorization, /^vapid t=.+\..+\..+, k=/);
  assert.equal(sent.headers['Content-Encoding'], 'aes128gcm');
  const msg = decrypt(sent.body, ua, auth);
  assert.equal(msg.title, '✅ MY PET aprovou');
  assert.match(msg.body, /Dia dos Animais/);
  // aparelho que saiu (410) é removido sozinho
  S.fakes.push.status = 410;
  await call('/api/pasta?r=push&test=1', { method: 'POST' });
  assert.equal(S.fakes.tables.push_subs.length, 0);
  S.fakes.push.status = 201;
});

test('verificação em duas etapas: ativa, pede o código no login e desativa', async () => {
  const st = (await call('/api/pasta?r=security', { method: 'POST', body: { start: 1 } })).data;
  assert.match(st.otpauth, /^otpauth:\/\/totp\/MC%20DIGITAL/);
  assert.equal(base32(unbase32(st.secret)), st.secret);
  assert.equal((await call('/api/pasta?r=security', { method: 'POST', body: { code: '000000' } })).status, 400);
  await call('/api/pasta?r=security', { method: 'POST', body: { code: totp(st.secret) } });
  assert.equal((await call('/api/pasta?r=security')).data.enabled, true);
  const step1 = await call('/api/session', { method: 'POST', body: { password: 'senha-teste' }, cookie: '' });
  assert.equal(step1.data.need_code, true);
  assert.equal(step1.headers.get('set-cookie'), null, 'sem código não entra');
  assert.equal((await call('/api/session', { method: 'POST', body: { password: 'senha-teste', code: '123456' }, cookie: '' })).status, 401);
  assert.equal((await call('/api/session', { method: 'POST', body: { password: 'errada', code: totp(st.secret) }, cookie: '' })).status, 401);
  const ok = await call('/api/session', { method: 'POST', body: { password: 'senha-teste', code: totp(st.secret) }, cookie: '' });
  assert.ok(ok.headers.get('set-cookie'));
  assert.equal((await call('/api/pasta?r=security', { method: 'DELETE', body: { code: '111111' } })).status, 400);
  await call('/api/pasta?r=security', { method: 'DELETE', body: { code: totp(st.secret) } });
  assert.equal((await call('/api/session', { method: 'POST', body: { password: 'senha-teste' }, cookie: '' })).data.admin, true);
});

test('datas comemorativas: alerta 2 semanas antes quando não há post', () => {
  const y = datesOfYear(2026);
  assert.equal(y.find((d) => d.name === 'Dia das Crianças').date, '2026-10-12');
  const clients = [{ id: 'a', name: 'MY PET', niche: 'pet' }, { id: 'b', name: 'Padaria', niche: 'alimentacao' }];
  const posts = { a: ['2026-10-11'], b: [] };
  const alerts = dateAlerts(clients, (id) => posts[id], '2026-09-30');
  assert.ok(alerts.some((a) => a.client === 'MY PET' && a.name === 'Dia dos Animais' && a.in_days === 4));
  assert.ok(!alerts.some((a) => a.client === 'MY PET' && a.name === 'Dia das Crianças'), 'post no dia 11 cobre o dia 12');
  assert.ok(alerts.some((a) => a.client === 'Padaria' && a.name === 'Dia das Crianças' && a.in_days === 12));
  assert.ok(!alerts.some((a) => a.client === 'Padaria' && a.name === 'Dia dos Animais'), 'data de nicho só para o nicho');
});

test('planejamento com IA: prévia do mês e criação das ideias no Fluxo', async () => {
  process.env.ANTHROPIC_API_KEY = 'sk-test';
  await call('/api/pasta?r=brand', { method: 'PUT', body: { client_id: c.id, brand_voice: 'carinhoso', brand_kit: { niche: 'pet', style: 'fotos reais' } } });
  await call(`/api/clients?id=${c.id}`, { method: 'PATCH', body: { contract_data: { nome: 'MY PET', quota_posts: 8, quota_reels: 4 } } });
  const plan = (await call('/api/pasta?r=plan', { method: 'POST', body: { client_id: c.id, month: '2026-11', extra: 'foco em banho e tosa' } })).data;
  assert.equal(plan.items.length, 2, 'descarta item com data fora do mês');
  assert.equal(plan.items[0].format, 'REELS');
  assert.deepEqual(plan.items[0].hashtags, ['#diadosanimais', '#pet']);
  const prompt = S.fakes.ig.aiCalls.at(-1).messages[0].content[0].text;
  assert.match(prompt, /Nicho: Pet/);
  assert.match(prompt, /8 posts de feed/);
  assert.match(prompt, /foco em banho e tosa/);
  assert.match(prompt, /Black Friday/);
  const rows = (await call('/api/pasta?r=plan', { method: 'POST', body: { client_id: c.id, create: true, items: plan.items } })).data;
  assert.equal(rows.length, 2);
  assert.equal(rows[0].status, 'idea');
  assert.equal(rows[0].media_type, 'REELS');
  assert.equal(rows[0].scheduled_at, zonedISO('2026-11-04', '19:00'));
  assert.match(rows[0].notes, /Planejado com IA/);
  assert.match(rows[0].caption, /#pet/);
  delete process.env.ANTHROPIC_API_KEY;
});

test('modelos de legenda, grupos de hashtags e banco de mídia', async () => {
  const g = (await call('/api/pasta?r=snippets', { method: 'POST', body: { kind: 'hashtags', name: 'Pet geral', text: 'pet, #cachorro gato #pet', client_id: c.id } })).data;
  assert.equal(g.text, '#pet #cachorro #gato');
  await call('/api/pasta?r=snippets', { method: 'POST', body: { kind: 'caption', name: 'CTA agenda', text: 'Agende pelo link da bio! 🐾' } });
  const outro = (await call('/api/clients', { method: 'POST', body: { name: 'Outro' } })).data;
  await call('/api/pasta?r=snippets', { method: 'POST', body: { kind: 'caption', name: 'Só do outro', text: 'x', client_id: outro.id } });
  const mine = (await call(`/api/pasta?r=snippets&client=${c.id}`)).data;
  assert.deepEqual(mine.map((x) => x.name).sort(), ['CTA agenda', 'Pet geral']);
  assert.equal((await call('/api/pasta?r=snippets', { method: 'POST', body: { kind: 'caption', name: '', text: 'x' } })).status, 400);
  await call(`/api/pasta?r=snippets&id=${g.id}`, { method: 'DELETE' });

  const url = 'https://fake.supabase.co/storage/v1/object/public/posts/abc/2026-10/foto.jpg';
  const m = (await call('/api/pasta?r=media', { method: 'POST', body: { client_id: c.id, url, name: 'foto.jpg' } })).data;
  assert.equal(m.path, 'abc/2026-10/foto.jpg');
  assert.equal((await call('/api/pasta?r=media', { method: 'POST', body: { client_id: c.id, url: 'https://outro.site/x.jpg' } })).status, 400);
  assert.equal((await call(`/api/pasta?r=media&client=${c.id}`)).data.length, 1);
  S.fakes.files.set('abc/2026-10/foto.jpg', Buffer.from('x'));
  await call(`/api/pasta?r=media&id=${m.id}`, { method: 'DELETE' });
  assert.equal(S.fakes.files.has('abc/2026-10/foto.jpg'), false, 'arquivo sem uso é apagado');
});

test('duplicar semana: copia os posts 7 dias depois como rascunho', async () => {
  const at = zonedISO('2026-12-01', '19:00');
  await call('/api/posts', { method: 'POST', body: { client_id: c.id, title: 'Terça', caption: 'oi', image_url: 'https://x/a.jpg', scheduled_at: at, approved: true } });
  await call('/api/posts', { method: 'POST', body: { client_id: c.id, title: 'Sexta', scheduled_at: zonedISO('2026-12-04', '11:00') } });
  await call('/api/posts', { method: 'POST', body: { client_id: c.id, title: 'Fora', scheduled_at: zonedISO('2026-12-08', '11:00') } });
  const rows = (await call('/api/pasta?r=duplicate', { method: 'POST', body: { from: '2026-11-29', days: 7, shift: 7, client_id: c.id } })).data;
  assert.deepEqual(rows.map((r) => r.title), ['Terça', 'Sexta']);
  assert.equal(rows[0].status, 'draft');
  assert.equal(rows[0].scheduled_at, zonedISO('2026-12-08', '19:00'));
  assert.equal(rows[0].image_url, 'https://x/a.jpg');
  assert.equal((await call('/api/pasta?r=duplicate', { method: 'POST', body: { from: '2027-03-01' } })).status, 404);
});

test('e-mails automáticos: aprovação agrupada, sem repetir, e teste', async () => {
  const { runMailer } = await import('../lib/mail.js');
  S.fakes.tables.posts.filter((p) => p.client_id === c.id && p.status !== 'pending_approval').forEach(() => {});
  const p = (await call('/api/posts', { method: 'POST', body: { client_id: c.id, title: 'Novo', image_url: 'https://x/b.jpg', scheduled_at: new Date(Date.now() + 5 * 864e5).toISOString(), send: true } })).data;
  S.fakes.mail.sent.length = 0;
  let r = await runMailer();
  assert.equal(r.sent.length, 0, 'espera 3 minutos para juntar os envios');
  S.fakes.tables.posts.find((x) => x.id === p.id).sent_for_approval_at = new Date(Date.now() - 10 * 60e3).toISOString();
  r = await runMailer();
  assert.equal(r.sent.length, 1);
  const m = S.fakes.mail.sent[0];
  assert.deepEqual(m.to, ['cliente@mypet.com']);
  assert.match(m.subject, /para aprovação/);
  assert.match(m.html, /\/aprovar\?t=/);
  assert.equal((await runMailer()).sent.length, 0, 'não repete');
  await call('/api/pasta?r=mailcfg', { method: 'PUT', body: { approval: false } });
  assert.equal((await call('/api/pasta?r=mailcfg')).data.settings.approval, false);
  assert.equal((await call('/api/pasta?r=mailcfg', { method: 'POST', body: { to: 'eu@agencia.com' } })).status, 200);
  assert.equal(S.fakes.mail.sent.at(-1).subject, 'Teste de e-mail do MC DIGITAL');
});

test('nota fiscal: Pix pago agenda a NFS-e e o PDF autorizado vai para a pasta e para a área do cliente', async () => {
  const { webhookToken } = await import('../lib/asaas.js');
  assert.equal((await call('/api/pasta?r=nf', { method: 'PUT', body: { enabled: true } })).status, 400, 'pede o código do serviço');
  await call('/api/pasta?r=nf', { method: 'PUT', body: { enabled: true, service_description: 'Gestão de redes sociais', municipal_service_code: '17.06', iss: '2' } });
  const hook = (body) => call('/api/pasta?r=asaas', { method: 'POST', body, headers: { 'asaas-access-token': webhookToken() }, cookie: '' });
  const ref = `mc:${c.id}:2026-10:1`;
  const r = (await hook({ event: 'PAYMENT_RECEIVED', payment: { id: 'pay_9', value: 433.34, externalReference: ref, paymentDate: '2026-10-10' } })).data;
  assert.equal(r.nf.scheduled, 'inv_1');
  const inv = S.fakes.asaas.invoices[0];
  assert.equal(inv.payment, 'pay_9');
  assert.equal(inv.municipalServiceCode, '17.06');
  assert.equal(inv.taxes.iss, 2);
  assert.equal(inv.externalReference, ref);
  const a = (await hook({ event: 'INVOICE_AUTHORIZED', invoice: { id: 'inv_1', number: '123', externalReference: ref, pdfUrl: 'https://files.asaas.example/nf.pdf' } })).data;
  assert.equal(a.invoice, 'authorized');
  const f = S.fakes.tables.client_files.find((x) => x.category === 'invoice');
  assert.match(f.name, /Nota fiscal 123/);
  const pay = S.fakes.tables.payments.find((x) => x.client_id === c.id && x.ref_month === '2026-10');
  assert.equal(pay.nf_status, 'authorized');
  const on = (await call(`/api/clients?id=${c.id}`, { method: 'PATCH', body: { portal: 'enable' } })).data;
  const portal = (await call(`/api/pasta?r=portal&t=${on.portal_url.split('t=')[1]}`, { cookie: '' })).data;
  assert.ok(portal.files.some((x) => x.category === 'invoice'));
  // aviso repetido não duplica
  await hook({ event: 'INVOICE_AUTHORIZED', invoice: { id: 'inv_1', externalReference: ref, pdfUrl: 'https://files.asaas.example/nf.pdf' } });
  assert.equal(S.fakes.tables.client_files.filter((x) => x.category === 'invoice').length, 1);
});
