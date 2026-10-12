// Pix automático (Asaas): Pix por parcela, baixa pelo aviso do Asaas, segurança do aviso e cancelamento.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './dev-server.js';
import { webhookToken, parseRef } from '../lib/asaas.js';

let S, base, owner = '', c;
async function call(path, { method = 'GET', body, cookie = owner, headers = {} } = {}) {
  const init = { method, headers: { ...(cookie ? { cookie } : {}), ...headers } };
  if (body) { init.body = JSON.stringify(body); init.headers['Content-Type'] = 'application/json'; }
  const r = await fetch(base + path, init);
  const t = await r.text(); let data; try { data = JSON.parse(t); } catch { data = t; }
  return { status: r.status, data, headers: r.headers };
}
const month = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Cuiaba' }).format(new Date()).slice(0, 7);
before(async () => {
  S = await startServer(4419); base = S.url;
  const r = await call('/api/session', { method: 'POST', body: { password: 'senha-teste' }, cookie: '' });
  owner = r.headers.get('set-cookie').split(';')[0];
  c = (await call('/api/clients', { method: 'POST', body: { name: 'MY PET', contact_whatsapp: '65999999999' } })).data;
  await call(`/api/clients?id=${c.id}`, { method: 'PATCH', body: { monthly_fee: '1.300,00', billing_start: `${month()}-01`,
    installments: [{ day: 4, cents: 43334 }, { day: 14, cents: 43333 }, { day: 24, cents: 43333 }], portal: 'enable' } });
});
after(() => { S.server.close(); S.fakes.restore(); delete process.env.ASAAS_API_KEY; });

test('sem chave: desligado e sem rota de Pix na área do cliente', async () => {
  delete process.env.ASAAS_API_KEY;
  assert.deepEqual((await call('/api/pasta?r=pix')).data, { ready: false });
  const t = S.fakes.tables.clients[0].portal_token;
  assert.equal((await call(`/api/pasta?r=portal&t=${t}`, { cookie: '' })).data.pix_enabled, false);
  assert.equal((await call(`/api/pasta?r=portal&t=${t}&pix=1`, { method: 'POST', cookie: '', body: { month: month(), n: 1 } })).status, 404);
});

test('gera Pix exclusivo por parcela (exige CPF/CNPJ) e reaproveita a cobrança', async () => {
  process.env.ASAAS_API_KEY = '$aact_hmlg_teste';
  const noDoc = await call('/api/pasta?r=pix', { method: 'POST', body: { client_id: c.id, month: month(), n: 2 } });
  assert.equal(noDoc.status, 400);
  assert.match(noDoc.data.error, /CPF\/CNPJ/);
  await call(`/api/clients?id=${c.id}`, { method: 'PATCH', body: { contract_data: { nome: 'MY PET Ltda', documento: '35.762.465/0001-64' } } });
  const r = (await call('/api/pasta?r=pix', { method: 'POST', body: { client_id: c.id, month: month(), n: 2 } })).data;
  assert.equal(r.value_cents, 43333);
  assert.match(r.payload, /^00020126PIX/);
  assert.match(r.image, /^data:image\/png;base64,/);
  const pay = S.fakes.asaas.payments[0];
  assert.equal(pay.billingType, 'PIX');
  assert.equal(pay.value, 433.33);
  assert.equal(pay.externalReference, `mc:${c.id}:${month()}:2`);
  assert.equal(S.fakes.asaas.customers[0].notificationDisabled, true);
  assert.equal(S.fakes.asaas.customers[0].cpfCnpj, '35762465000164');
  // pedir de novo não cria outra cobrança; área do cliente usa a mesma
  const t = S.fakes.tables.clients[0].portal_token;
  const viaPortal = (await call(`/api/pasta?r=portal&t=${t}&pix=1`, { method: 'POST', cookie: '', body: { month: month(), n: 2 } })).data;
  assert.equal(viaPortal.payload, r.payload);
  assert.equal(S.fakes.asaas.payments.length, 1);
  assert.equal(S.fakes.asaas.customers.length, 1);
});

test('aviso do Asaas: sem o código secreto é recusado; com ele dá baixa na parcela certa (uma vez só)', async () => {
  const evt = { id: 'evt_1', event: 'PAYMENT_RECEIVED', payment: { id: 'pay_1', externalReference: `mc:${c.id}:${month()}:2`, value: 433.33, paymentDate: `${month()}-13`, transactionReceiptUrl: 'https://sandbox.asaas.com/comprovante/1' } };
  assert.equal((await call('/api/pasta?r=asaas', { method: 'POST', cookie: '', body: evt })).status, 401);
  assert.equal((await call('/api/pasta?r=asaas', { method: 'POST', cookie: '', body: evt, headers: { 'asaas-access-token': 'x'.repeat(48) } })).status, 401);
  const ok = await call('/api/pasta?r=asaas', { method: 'POST', cookie: '', body: evt, headers: { 'asaas-access-token': webhookToken() } });
  assert.equal(ok.status, 200);
  const row = S.fakes.tables.payments.find((p) => p.client_id === c.id && p.installment === 2);
  assert.equal(row.status, 'paid');
  assert.equal(row.paid_at, `${month()}-13`);
  assert.equal(row.receipt_url, 'https://sandbox.asaas.com/comprovante/1');
  const again = await call('/api/pasta?r=asaas', { method: 'POST', cookie: '', body: evt, headers: { 'asaas-access-token': webhookToken() } });
  assert.equal(again.data.already, true);
  // área do cliente mostra pago com comprovante
  const t = S.fakes.tables.clients[0].portal_token;
  const m = (await call(`/api/pasta?r=portal&t=${t}`, { cookie: '' })).data.billing.months.find((x) => x.month === month());
  assert.equal(m.parcels[1].status, 'paid');
  assert.equal(m.parcels[1].receipt_url, 'https://sandbox.asaas.com/comprovante/1');
  // parcela já paga não gera outro Pix
  assert.equal((await call('/api/pasta?r=pix', { method: 'POST', body: { client_id: c.id, month: month(), n: 2 } })).status, 409);
  // referência estranha é ignorada
  assert.equal(parseRef('mc:xx:2026-10:1'), null);
});

test('baixa manual com Pix em aberto cancela a cobrança no Asaas; ligar aviso automático', async () => {
  await call('/api/pasta?r=pix', { method: 'POST', body: { client_id: c.id, month: month(), n: 3 } });
  const pay = S.fakes.asaas.payments.at(-1);
  await call('/api/pasta?r=payments', { method: 'PUT', body: { client_id: c.id, ref_month: month(), installment: 3, status: 'paid', amount_cents: 43333 } });
  assert.equal(pay.deleted, true);
  await call('/api/pasta?r=settings', { method: 'PUT', body: { agency: { email: 'contato@agencia.com' } } });
  assert.equal((await call('/api/pasta?r=pix&setup=1', { method: 'POST', body: {} })).status, 200);
  const w = S.fakes.asaas.webhooks[0];
  assert.equal(w.url, 'http://localhost:4419/api/pasta?r=asaas');
  assert.equal(w.authToken, webhookToken());
  assert.deepEqual(w.events, ['PAYMENT_RECEIVED', 'PAYMENT_CONFIRMED', 'PAYMENT_DELETED']);
  await call('/api/pasta?r=pix&setup=1', { method: 'POST', body: {} });
  assert.equal(S.fakes.asaas.webhooks.length, 1, 'não duplica');
  const st = (await call('/api/pasta?r=pix')).data;
  assert.equal(st.ready, true); assert.equal(st.env, 'sandbox'); assert.equal(st.webhook.enabled, true);
  const s = (await call('/api/session')).data.setup;
  assert.equal(s.asaas.env, 'sandbox');
});
