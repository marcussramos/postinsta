// Conta própria da agência: marcada no cadastro, fica fora das métricas (o painel usa o campo "own").
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './dev-server.js';

let S, base, cookie = '';
const call = async (path, { method = 'GET', body, auth = true } = {}) => {
  const r = await fetch(base + path, { method, headers: { ...(auth ? { cookie } : {}), 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); let data; try { data = JSON.parse(t); } catch { data = t; }
  return { status: r.status, data, headers: r.headers };
};
before(async () => {
  S = await startServer(4434); base = S.url;
  cookie = (await call('/api/session', { method: 'POST', body: { password: 'senha-teste' } })).headers.get('set-cookie').split(';')[0];
});
after(() => { S.server.close(); S.fakes.restore(); });

test('conta própria: liga e desliga pelo cadastro e aparece na lista', async () => {
  const c = (await call('/api/clients', { method: 'POST', body: { name: 'MC DIGITAL' } })).data;
  const x = (await call('/api/clients', { method: 'POST', body: { name: 'Cliente' } })).data;
  assert.equal((await call(`/api/clients?id=${c.id}`, { method: 'PATCH', body: { own_account: true } })).data.own, true);
  let list = (await call('/api/clients')).data;
  assert.equal(list.find((k) => k.id === c.id).own, true);
  assert.equal(list.find((k) => k.id === x.id).own, false);
  // salvar outros campos sem mandar own_account mantém a marcação
  await call(`/api/clients?id=${c.id}`, { method: 'PATCH', body: { name: 'MC DIGITAL Agência' } });
  assert.equal((await call('/api/clients')).data.find((k) => k.id === c.id).own, true);
  assert.equal((await call(`/api/clients?id=${c.id}`, { method: 'PATCH', body: { own_account: false } })).data.own, false);
  list = (await call('/api/clients')).data;
  assert.equal(list.some((k) => k.own), false);
});
