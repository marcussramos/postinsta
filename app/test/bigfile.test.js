// Pasta do cliente: arquivos acima de 4 MB vão direto ao armazenamento (link assinado) e depois são registrados.
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
  S = await startServer(4435); base = S.url;
  cookie = (await call('/api/session', { method: 'POST', body: { password: 'senha-teste' } })).headers.get('set-cookie').split(';')[0];
});
after(() => { S.server.close(); S.fakes.restore(); });

test('arquivo grande: pede o link, envia direto e registra; recusa tamanho, tipo e caminho de outro cliente', async () => {
  const c = (await call('/api/clients', { method: 'POST', body: { name: 'Maison K.' } })).data;
  const o = (await call('/api/clients', { method: 'POST', body: { name: 'Outro' } })).data;
  const q = `/api/pasta?r=files&client=${c.id}&category=other`;
  assert.equal((await call(`${q}&big=1`, { method: 'POST', auth: false, body: { name: 'catalogo.pdf', size: 11e6 } })).status, 401);
  assert.equal((await call(`${q}&big=1`, { method: 'POST', body: { name: 'catalogo.pdf', size: 60e6 } })).status, 413);
  assert.equal((await call(`${q}&big=1`, { method: 'POST', body: { name: 'virus.exe', size: 5e6 } })).status, 415);
  const sig = (await call(`${q}&big=1`, { method: 'POST', body: { name: 'Catálogo MAISON.pdf', size: 11e6 } })).data;
  assert.match(sig.path, new RegExp(`^${c.id}/other/`));
  assert.match(sig.upload_url, /\/storage\/v1\/object\/upload\/sign\/docs\//);
  // confirmar antes de enviar: recusa
  assert.equal((await call(`${q}&confirm=1`, { method: 'POST', body: { path: sig.path, name: 'Catálogo MAISON.pdf' } })).status, 400);
  // o navegador envia (PUT no link assinado)
  const put = await fetch(sig.upload_url, { method: 'PUT', body: Buffer.alloc(1234) });
  assert.equal(put.status, 200);
  // caminho de outro cliente: recusa
  assert.equal((await call(`/api/pasta?r=files&client=${o.id}&category=other&confirm=1`, { method: 'POST', body: { path: sig.path, name: 'Catálogo MAISON.pdf' } })).status, 400);
  const row = await call(`${q}&confirm=1`, { method: 'POST', body: { path: sig.path, name: 'Catálogo MAISON.pdf', size: 11e6 } });
  assert.equal(row.status, 201);
  assert.equal(row.data.name, 'Catálogo MAISON.pdf');
  assert.equal(row.data.size, 1234, 'tamanho vem do armazenamento');
  assert.equal(row.data.path, undefined);
  const list = (await call(`/api/pasta?r=files&client=${c.id}`)).data;
  assert.ok(list.some((f) => f.id === row.data.id));
});
