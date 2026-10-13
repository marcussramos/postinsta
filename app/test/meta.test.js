// Revisão da Meta: páginas legais preenchidas com os dados da agência e os avisos de remoção/exclusão do Instagram.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { startServer } from './dev-server.js';
import { parseSignedRequest } from '../lib/pasta/meta.js';

let S, base, owner = '';
const sign = (data, secret = 'segredo') => {
  const payload = Buffer.from(JSON.stringify(data)).toString('base64url');
  return `${crypto.createHmac('sha256', secret).update(payload).digest('base64url')}.${payload}`;
};
const form = (path, sr) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ signed_request: sr }).toString() });
before(async () => {
  S = await startServer(4425); base = S.url;
  owner = (await fetch(`${base}/api/session`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'senha-teste' }) })).headers.get('set-cookie').split(';')[0];
});
after(() => { S.server.close(); S.fakes.restore(); });

test('signed_request: aceita só com a assinatura certa', () => {
  assert.equal(parseSignedRequest(sign({ user_id: '1' }), 'segredo').user_id, '1');
  assert.equal(parseSignedRequest(sign({ user_id: '1' }, 'outro'), 'segredo'), null);
  assert.equal(parseSignedRequest('lixo', 'segredo'), null);
});

test('páginas legais: dados da agência, inglês incluído e nada de colchetes', async () => {
  await fetch(`${base}/api/pasta?r=settings`, { method: 'PUT', headers: { 'Content-Type': 'application/json', cookie: owner }, body: JSON.stringify({ agency: { razao_social: 'MC Digital Marketing LTDA', cnpj: '12.345.678/0001-90', email: 'contato@mc.com', cidade: 'Cuiabá – MT', marca: 'MC DIGITAL' } }) });
  for (const p of ['/privacidade', '/privacy', '/termos', '/exclusao-de-dados', '/data-deletion']) {
    const r = await fetch(base + p); const html = await r.text();
    assert.equal(r.status, 200, p);
    assert.match(html, /MC Digital Marketing LTDA/, p);
    assert.doesNotMatch(html, /\{\{|\[RAZÃO|\[CNPJ/, p);
    assert.equal(r.headers.get('x-robots-tag'), null, `${p} indexável`);
  }
  const pv = await (await fetch(`${base}/privacidade`)).text();
  assert.match(pv, /instagram_business_manage_insights/);
  assert.match(pv, /Privacy Policy/);
  assert.match(pv, /12\.345\.678\/0001-90/);
});

test('remover o app no Instagram apaga o token; pedido de exclusão devolve código consultável', async () => {
  const c = await (await fetch(`${base}/api/clients`, { method: 'POST', headers: { 'Content-Type': 'application/json', cookie: owner }, body: JSON.stringify({ name: 'Padaria' }) })).json();
  const row = S.fakes.tables.clients.find((x) => x.id === c.id);
  Object.assign(row, { ig_user_id: '1784', ig_token: 'tok', ig_username: 'padaria' });
  S.fakes.tables.app_state.push({ key: 'ig_ids', value: { 'scoped-9': c.id } });
  assert.equal((await form('/api/pasta?r=igdeauth', sign({ user_id: 'x' }, 'errado'))).status, 400);
  assert.equal((await form('/api/pasta?r=igdeauth', sign({ user_id: 'scoped-9' }))).status, 200);
  assert.equal(row.ig_token, null); assert.equal(row.ig_user_id, null);

  Object.assign(row, { ig_user_id: '1784', ig_token: 'tok2' });
  const d = await (await form('/api/pasta?r=igdelete', sign({ user_id: '1784' }))).json();
  assert.match(d.confirmation_code, /^[a-f0-9]{16}$/);
  assert.equal(d.url, `${base}/exclusao-de-dados?code=${d.confirmation_code}`);
  assert.equal(row.ig_token, null);
  const st = await (await fetch(d.url)).text();
  assert.match(st, /Concluído em/);
  assert.match(await (await fetch(`${base}/exclusao-de-dados?code=naoexiste`)).text(), /Não encontramos esse código/);
});
