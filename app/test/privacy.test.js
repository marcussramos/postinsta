// "Fotos privadas": bucket fechado, links assinados na saída da API e para a Meta, e nada assinado gravado no banco.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './dev-server.js';
import { runPublisher } from '../lib/publisher.js';
import { resetMediaCache } from '../lib/media.js';

let S, base, cookie = '';
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 0xff, 0xd9]);
async function call(path, { method = 'GET', body, raw, auth = true } = {}) {
  const init = { method, headers: {}, redirect: 'manual' };
  if (auth && cookie) init.headers.cookie = cookie;
  if (raw) { init.body = raw; init.headers['Content-Type'] = 'application/octet-stream'; }
  else if (body) { init.body = JSON.stringify(body); init.headers['Content-Type'] = 'application/json'; }
  const r = await fetch(base + path, init);
  const t = await r.text(); let data; try { data = JSON.parse(t); } catch { data = t; }
  return { status: r.status, data };
}
before(async () => {
  resetMediaCache();
  S = await startServer(4431); base = S.url;
  cookie = (await fetch(`${base}/api/session`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'senha-teste' }) })).headers.get('set-cookie').split(';')[0];
});
after(() => { S.server.close(); S.fakes.restore(); resetMediaCache(); });

const PUB = /\/storage\/v1\/object\/public\/posts\//;
const SIGNED = /\/storage\/v1\/object\/sign\/posts\/.+\?token=/;

test('fotos privadas: assina na saída, guarda o endereço original e entrega link assinado à Meta', async () => {
  const c = (await call('/api/clients', { method: 'POST', body: { name: 'Clínica' } })).data;
  Object.assign(S.fakes.tables.clients.find((x) => x.id === c.id), { ig_user_id: '178400001', ig_token: 'tok', ig_username: 'clinica' });
  const up = (await call(`/api/upload?client=${c.id}`, { method: 'POST', raw: JPEG })).data;
  assert.match(up.image_url, PUB, 'desligado: continua igual');

  // só o dono liga
  assert.equal((await call('/api/pasta?r=privacy', { method: 'PUT', body: { media_private: true }, auth: false })).status, 401);
  assert.equal((await call('/api/pasta?r=privacy', { method: 'PUT', body: { media_private: true } })).data.media_private, true);
  assert.equal(S.fakes.state.bucketPublic, false, 'bucket fechado');

  const p = (await call('/api/posts', { method: 'POST', body: { client_id: c.id, image_url: up.image_url, caption: 'oi', scheduled_at: new Date(Date.now() + 864e5).toISOString() } })).data;
  assert.match(p.image_url, SIGNED, 'resposta com link assinado');
  assert.match(S.fakes.tables.posts.find((x) => x.id === p.id).image_url, PUB, 'banco guarda o endereço original');

  // o navegador devolve o link assinado ao salvar: volta ao original antes de gravar
  await call(`/api/posts?id=${p.id}`, { method: 'PATCH', body: { image_url: p.image_url, caption: 'oi de novo' } });
  assert.match(S.fakes.tables.posts.find((x) => x.id === p.id).image_url, PUB);

  // lista e página de aprovação também assinam
  const list = (await call('/api/posts?from=2000-01-01T00:00:00Z')).data;
  assert.match(list.find((x) => x.id === p.id).image_url, SIGNED);

  // a Meta recebe link assinado
  const due = (await call('/api/posts', { method: 'POST', body: { client_id: c.id, image_url: up.image_url, caption: 'agora', scheduled_at: new Date(Date.now() - 1000).toISOString(), approved: true } })).data;
  await runPublisher({ wait: async () => {} });
  const sent = [...S.fakes.ig.containers.values()].at(-1);
  assert.match(sent.image_url, SIGNED);
  assert.equal(S.fakes.tables.posts.find((x) => x.id === due.id).status, 'published');

  // desligar abre o bucket de novo e volta aos endereços normais
  assert.equal((await call('/api/pasta?r=privacy', { method: 'PUT', body: { media_private: false } })).data.media_private, false);
  assert.equal(S.fakes.state.bucketPublic, true);
  assert.match((await call('/api/posts?from=2000-01-01T00:00:00Z')).data.find((x) => x.id === p.id).image_url, PUB);
});
