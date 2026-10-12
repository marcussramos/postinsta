// Reels e carrossel: validação, publicação e histórico de aprovação.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './dev-server.js';
import { runPublisher } from '../lib/publisher.js';

let S, base, cookie = '', c;
async function call(path, { method = 'GET', body, auth = true } = {}) {
  const init = { method, headers: auth ? { cookie } : {} };
  if (body) { init.body = JSON.stringify(body); init.headers['Content-Type'] = 'application/json'; }
  const r = await fetch(base + path, init);
  const t = await r.text(); let data; try { data = JSON.parse(t); } catch { data = t; }
  return { status: r.status, data };
}
const soon = () => new Date(Date.now() - 1000).toISOString();
before(async () => {
  S = await startServer(4415); base = S.url;
  const r = await fetch(`${base}/api/session`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'senha-teste' }) });
  cookie = r.headers.get('set-cookie').split(';')[0];
  c = (await call('/api/clients', { method: 'POST', body: { name: 'MY PET' } })).data;
  Object.assign(S.fakes.tables.clients[0], { ig_token: 'long-tok', ig_user_id: '178400001', ig_username: 'mypet', ig_token_expires_at: new Date(Date.now() + 50 * 864e5).toISOString(), ig_connected_at: new Date().toISOString() });
});
after(() => { S.server.close(); S.fakes.restore(); });

test('carrossel precisa de 2+ imagens e publica com os itens', async () => {
  const bad = await call('/api/posts', { method: 'POST', body: { client_id: c.id, media_type: 'CAROUSEL', media: [{ url: 'https://x/1.jpg', kind: 'image' }], image_url: 'https://x/1.jpg', scheduled_at: soon(), approved: true } });
  assert.equal(bad.status, 400);
  assert.match(bad.data.error, /2 imagens/);
  const media = [1, 2, 3].map((i) => ({ url: `https://x/${i}.jpg`, path: `p/${i}.jpg`, kind: 'image' }));
  const p = (await call('/api/posts', { method: 'POST', body: { client_id: c.id, media_type: 'CAROUSEL', media, image_url: media[0].url, image_path: media[0].path, caption: 'carrossel', scheduled_at: soon(), approved: true } })).data;
  assert.equal(p.status, 'approved');
  const log = await runPublisher({ wait: async () => {} });
  assert.equal(log.published.length, 1, JSON.stringify(log));
  const parent = [...S.fakes.ig.containers.values()].find((x) => x.media_type === 'CAROUSEL');
  assert.equal(parent.children.split(',').length, 3);
  assert.equal([...S.fakes.ig.containers.values()].filter((x) => x.media_type === 'ITEM').length, 3);
});

test('Reels: exige vídeo, publica com capa e espera o processamento', async () => {
  const noVideo = await call('/api/posts', { method: 'POST', body: { client_id: c.id, media_type: 'REELS', image_url: 'https://x/capa.jpg', scheduled_at: soon(), send: true } });
  assert.equal(noVideo.status, 400);
  assert.match(noVideo.data.error, /vídeo/);
  S.fakes.ig.videoInProgress = true;
  const p = (await call('/api/posts', { method: 'POST', body: { client_id: c.id, media_type: 'REELS', media: [{ url: 'https://x/v.mp4', path: 'p/v.mp4', kind: 'video' }], image_url: 'https://x/capa.jpg', image_path: 'p/capa.jpg', caption: 'reels', scheduled_at: soon(), approved: true } })).data;
  let log = await runPublisher({ wait: async () => {} });
  assert.deepEqual(log.waiting, [p.id], 'vídeo ainda processando: espera a próxima rodada');
  const ct = [...S.fakes.ig.containers.values()].find((x) => x.media_type === 'REELS');
  assert.equal(ct.video_url, 'https://x/v.mp4');
  assert.equal(ct.cover_url, 'https://x/capa.jpg');
  for (const v of S.fakes.ig.containers.values()) if (v.status === 'IN_PROGRESS') v.status = 'FINISHED';
  log = await runPublisher({ wait: async () => {} });
  assert.equal(log.published.length, 1);
  S.fakes.ig.videoInProgress = false;
});

test('editar a mídia de um post aprovado volta para produção; histórico guarda envio e aprovação', async () => {
  const media = [1, 2].map((i) => ({ url: `https://x/e${i}.jpg`, path: `e/${i}.jpg`, kind: 'image' }));
  const p = (await call('/api/posts', { method: 'POST', body: { client_id: c.id, media_type: 'CAROUSEL', media, image_url: media[0].url, scheduled_at: new Date(Date.now() + 864e5).toISOString(), send: true } })).data;
  const tok = S.fakes.tables.clients[0].approval_token;
  const ap = await call('/api/approval', { method: 'POST', auth: false, body: { t: tok, post_id: p.id, decision: 'approve' } });
  assert.equal(ap.status, 200);
  const view = (await call(`/api/approval?t=${tok}`, { auth: false })).data;
  const seen = view.posts.find((x) => x.id === p.id);
  assert.equal(seen.media.length, 2);
  assert.equal(seen.notes, undefined, 'notas internas não vão ao cliente');
  const ed = (await call(`/api/posts?id=${p.id}`, { method: 'PATCH', body: { media: media.reverse(), media_type: 'CAROUSEL', image_url: media[0].url } })).data;
  assert.equal(ed.status, 'draft');
  const hist = (await call(`/api/pasta?r=history&client=${c.id}`)).data;
  const types = hist.filter((e) => e.post_id === p.id).map((e) => e.type).sort();
  assert.deepEqual(types, ['approved', 'sent']);
  assert.ok(hist.some((e) => e.type === 'published'));
  // lembrete registra para os pendentes
  await call(`/api/posts?id=${p.id}`, { method: 'PATCH', body: { action: 'send' } });
  const r = (await call('/api/posts', { method: 'POST', body: { remind_client: c.id, channel: 'whatsapp' } })).data;
  assert.equal(r.reminded, 1);
});
