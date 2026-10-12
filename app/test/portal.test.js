// Área do cliente: link secreto que mostra só a pasta daquele cliente.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './dev-server.js';

let S, base, cookie = '';
async function call(path, { method = 'GET', body, raw, headers = {}, auth = true } = {}) {
  const init = { method, headers: { ...(auth ? { cookie } : {}), ...headers }, redirect: 'manual' };
  if (raw) { init.body = raw; init.headers['Content-Type'] = 'application/octet-stream'; }
  else if (body) { init.body = JSON.stringify(body); init.headers['Content-Type'] = 'application/json'; }
  const r = await fetch(base + path, init);
  const t = await r.text(); let data; try { data = JSON.parse(t); } catch { data = t; }
  return { status: r.status, data, headers: r.headers };
}
before(async () => {
  S = await startServer(4414); base = S.url;
  const r = await call('/api/session', { method: 'POST', body: { password: 'senha-teste' } });
  cookie = r.headers.get('set-cookie').split(';')[0];
});
after(() => { S.server.close(); S.fakes.restore(); });

test('link do cliente mostra só a pasta dele e só as seções liberadas', async () => {
  const a = (await call('/api/clients', { method: 'POST', body: { name: 'MY PET' } })).data;
  const b = (await call('/api/clients', { method: 'POST', body: { name: 'Outro Cliente' } })).data;
  assert.equal(a.portal_url, null);
  await call(`/api/clients?id=${a.id}`, { method: 'PATCH', body: { monthly_fee: '1300', due_day: 4, billing_start: '2026-08-01', contract_data: { nome: 'MY PET Ltda' } } });
  const pdf = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(20)]);
  const up = (c, cat, name) => call(`/api/pasta?r=files&client=${c.id}&category=${cat}`, { method: 'POST', raw: pdf, headers: { 'x-file-name': name } }).then((r) => r.data);
  const contrato = await up(a, 'contract', 'contrato-assinado.pdf');
  const interno = await up(a, 'other', 'nota-interna.pdf');
  const deOutro = await up(b, 'contract', 'contrato-outro.pdf');
  const comp = await up(a, 'receipt', 'pix-agosto.pdf');
  await call('/api/pasta?r=payments', { method: 'PUT', body: { client_id: a.id, ref_month: '2026-08', status: 'paid', amount_cents: 130000, paid_at: '2026-08-04', file_id: comp.id, note: 'anotação interna' } });
  await call('/api/pasta?r=settings', { method: 'PUT', body: { agency: { marca: 'MCAROLINA DIGITAL', pix: 'chave-pix@x.com', cnpj: '11.111.111/0001-11' } } });

  const on = (await call(`/api/clients?id=${a.id}`, { method: 'PATCH', body: { portal: 'enable' } })).data;
  assert.match(on.portal_url, /\/cliente\?t=[a-f0-9]{48}$/);
  const t = on.portal_url.split('t=')[1];
  const again = (await call(`/api/clients?id=${a.id}`, { method: 'PATCH', body: { portal: 'enable' } })).data;
  assert.equal(again.portal_url, on.portal_url, 'ativar de novo mantém o link');

  const p = await call(`/api/pasta?r=portal&t=${t}`, { auth: false });
  assert.equal(p.status, 200);
  assert.equal(p.data.client.name, 'MY PET Ltda');
  const names = p.data.files.map((f) => f.name).sort();
  assert.deepEqual(names, ['contrato-assinado.pdf', 'pix-agosto.pdf']);
  const txt = JSON.stringify(p.data);
  for (const leak of ['Outro Cliente', 'nota-interna', 'anotação interna', 'approval_token', 'ig_token', '11.111.111', 'contrato-outro']) {
    assert.ok(!txt.includes(leak), `não pode vazar: ${leak}`);
  }
  assert.equal(p.data.agency.pix, 'chave-pix@x.com');
  const aug = p.data.billing.months.find((m) => m.month === '2026-08');
  assert.equal(aug.status, 'paid');
  assert.equal(aug.parcels[0].receipt_id, comp.id);
  assert.ok(p.data.billing.months.some((m) => m.status === 'late'), 'setembro/outubro vencidos aparecem como atrasados');
  assert.match(p.data.approval.url, /\/aprovar\?t=/);

  // arquivos: abre os dele; recusa interno e de outro cliente
  assert.equal((await call(`/api/pasta?r=portal&t=${t}&file=${contrato.id}`, { auth: false })).status, 302);
  assert.equal((await call(`/api/pasta?r=portal&t=${t}&file=${interno.id}`, { auth: false })).status, 404);
  assert.equal((await call(`/api/pasta?r=portal&t=${t}&file=${deOutro.id}`, { auth: false })).status, 404);
  // as rotas da agência continuam fechadas para quem só tem o link
  assert.equal((await call(`/api/pasta?r=files&client=${b.id}`, { auth: false })).status, 401);
  assert.equal((await call('/api/clients', { auth: false })).status, 401);

  // gerar novo invalida o antigo; desativar fecha
  const nw = (await call(`/api/clients?id=${a.id}`, { method: 'PATCH', body: { portal: 'regenerate' } })).data;
  assert.notEqual(nw.portal_url, on.portal_url);
  assert.equal((await call(`/api/pasta?r=portal&t=${t}`, { auth: false })).status, 404);
  await call(`/api/clients?id=${a.id}`, { method: 'PATCH', body: { portal: 'disable' } });
  assert.equal((await call(`/api/pasta?r=portal&t=${nw.portal_url.split('t=')[1]}`, { auth: false })).status, 404);
  assert.equal((await call('/api/pasta?r=portal&t=xyz', { auth: false })).status, 404);
});
