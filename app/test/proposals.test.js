// Propostas comerciais: rascunho, envio, aceite que cria o cliente completo, recusa e travas.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './dev-server.js';

let S, base, owner = '';
async function call(path, { method = 'GET', body, cookie = owner } = {}) {
  const init = { method, headers: cookie ? { cookie } : {} };
  if (body) { init.body = JSON.stringify(body); init.headers['Content-Type'] = 'application/json'; }
  const r = await fetch(base + path, init);
  const t = await r.text(); let data; try { data = JSON.parse(t); } catch { data = t; }
  return { status: r.status, data, headers: r.headers };
}
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Cuiaba' }).format(new Date());
before(async () => {
  S = await startServer(4417); base = S.url;
  const r = await call('/api/session', { method: 'POST', body: { password: 'senha-teste' }, cookie: '' });
  owner = r.headers.get('set-cookie').split(';')[0];
});
after(() => { S.server.close(); S.fakes.restore(); });

const accept = (t, extra = {}) => call(`/api/pasta?r=proposal&t=${t}`, { method: 'POST', cookie: '', body: {
  nome: 'Pet Feliz Ltda', documento: '12.345.678/0001-90', endereco: 'Rua A, 10, Centro, Cuiabá/MT', representante: 'Joana Silva', representante_cpf: '111.222.333-44',
  email: 'joana@petfeliz.com', whatsapp: '65 98888-7777', inicio: today(), aceite: true, ...extra } });

test('rascunho não abre para o público; enviada abre; aceite cria cliente completo', async () => {
  assert.equal((await call('/api/pasta?r=proposals', { method: 'POST', body: { client_name: 'X', monthly_fee: '' } })).status, 400);
  const p = (await call('/api/pasta?r=proposals', { method: 'POST', body: {
    client_name: 'Pet Feliz', contact: { name: 'Joana', whatsapp: '65988887777' }, monthly_fee: '1.300,00', quota_posts: 8, quota_reels: 4,
    entregas: '8 posts estáticos e 4 Reels', installments: [{ day: 4, cents: 43334 }, { day: 14, cents: 43333 }, { day: 24, cents: 43333 }],
    forma_pagamento: 'via Pix', items: [{ title: 'Planejamento', desc: 'mensal' }, { title: '' }], valid_until: '2099-01-01' } })).data;
  assert.equal(p.status, 'draft');
  assert.equal(p.items.length, 1);
  assert.match(p.url, /\/proposta\?t=[a-f0-9]{40}$/);
  const t = p.url.split('t=')[1];
  assert.equal((await call(`/api/pasta?r=proposal&t=${t}`, { cookie: '' })).status, 404, 'rascunho é privado');
  assert.equal((await call(`/api/pasta?r=proposal&t=${t}`)).data.preview, true, 'admin pré-visualiza');
  assert.equal((await accept(t)).status, 409, 'rascunho não aceita');
  await call('/api/pasta?r=proposals', { method: 'PATCH', body: { id: p.id, send: true } });
  const pub = (await call(`/api/pasta?r=proposal&t=${t}`, { cookie: '' })).data;
  assert.equal(pub.status, 'sent');
  assert.equal(pub.monthly_fee_cents, 130000);
  assert.equal(pub.accepted, undefined);
  // validações do aceite
  assert.equal((await accept(t, { documento: '123' })).status, 400);
  assert.equal((await accept(t, { aceite: false })).status, 400);
  assert.equal((await accept(t, { inicio: '2020-01-01' })).status, 400);
  const ok = await accept(t);
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.match(ok.data.portal_url, /\/cliente\?t=/);
  const c = S.fakes.tables.clients.find((x) => x.name === 'Pet Feliz');
  assert.equal(c.monthly_fee_cents, 130000);
  assert.equal(c.installments.length, 3);
  assert.equal(c.contact_whatsapp, '5565988887777');
  assert.equal(c.contract_data.documento, '12.345.678/0001-90');
  assert.equal(c.contract_data.quota_reels, 4);
  assert.equal(c.contract_data.total_conteudos, 12);
  assert.equal(c.billing_start, today());
  assert.ok(c.portal_token);
  // não aceita de novo; edição bloqueada; página mostra aceito com link
  assert.equal((await accept(t)).status, 409);
  assert.equal((await call('/api/pasta?r=proposals', { method: 'PATCH', body: { id: p.id, monthly_fee: '1' } })).status, 409);
  const after = (await call(`/api/pasta?r=proposal&t=${t}`, { cookie: '' })).data;
  assert.equal(after.status, 'accepted');
  assert.match(after.portal_url, /\/cliente\?t=/);
  const list = (await call('/api/pasta?r=proposals')).data;
  assert.equal(list[0].client_id, c.id);
});

test('recusa, validade vencida e acesso só para administrador', async () => {
  const p = (await call('/api/pasta?r=proposals', { method: 'POST', body: { client_name: 'Loja Y', monthly_fee: '900', send: true, valid_until: '2099-01-01' } })).data;
  const t = p.url.split('t=')[1];
  const d = await call(`/api/pasta?r=proposal&t=${t}`, { method: 'POST', cookie: '', body: { decline: true, reason: 'sem verba agora' } });
  assert.equal(d.data.status, 'declined');
  assert.equal(S.fakes.tables.proposals.find((x) => x.id === p.id).accepted.reason, 'sem verba agora');
  const old = (await call('/api/pasta?r=proposals', { method: 'POST', body: { client_name: 'Velha', monthly_fee: '900', send: true, valid_until: '2020-01-01' } })).data;
  const ot = old.url.split('t=')[1];
  assert.equal((await call(`/api/pasta?r=proposal&t=${ot}`, { cookie: '' })).data.status, 'expired');
  assert.equal((await accept(ot)).status, 409);
  assert.equal((await call('/api/pasta?r=proposals', { cookie: '' })).status, 401);
});
