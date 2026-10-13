// Atualização 10: pedido de ajuste por áudio, cartão rápido do Fluxo e remarcar horário.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './dev-server.js';

let S, base, owner = '', c, other;
async function call(path, { method = 'GET', body, raw, headers = {}, cookie = owner } = {}) {
  const init = { method, headers: { ...(cookie ? { cookie } : {}), ...headers }, redirect: 'manual' };
  if (raw) init.body = raw;
  else if (body) { init.body = JSON.stringify(body); init.headers['Content-Type'] = 'application/json'; }
  const r = await fetch(base + path, init);
  const t = await r.text(); let data; try { data = JSON.parse(t); } catch { data = t; }
  return { status: r.status, data, headers: r.headers };
}
before(async () => {
  S = await startServer(4421); base = S.url;
  const r = await call('/api/session', { method: 'POST', body: { password: 'senha-teste' }, cookie: '' });
  owner = r.headers.get('set-cookie').split(';')[0];
  c = (await call('/api/clients', { method: 'POST', body: { name: 'MY PET' } })).data;
  other = (await call('/api/clients', { method: 'POST', body: { name: 'Outro' } })).data;
});
after(() => { S.server.close(); S.fakes.restore(); });

const tok = (cl) => cl.approval_url.split('t=')[1];

test('pedido de ajuste por áudio: grava, envia, agência ouve; só o áudio do próprio cliente vale', async () => {
  const post = (await call('/api/posts', { method: 'POST', body: { client_id: c.id, title: 'Banho', image_url: 'https://x/a.jpg', scheduled_at: new Date(Date.now() + 864e5).toISOString(), send: true } })).data;
  const audio = Buffer.alloc(5000, 7);
  assert.equal((await call(`/api/approval?t=${tok(c)}&audio=1`, { method: 'POST', raw: audio, headers: { 'Content-Type': 'text/plain' }, cookie: '' })).status, 415);
  assert.equal((await call(`/api/approval?t=${tok(c)}&audio=1`, { method: 'POST', raw: Buffer.alloc(10), headers: { 'Content-Type': 'audio/webm' }, cookie: '' })).status, 400);
  const up = await call(`/api/approval?t=${tok(c)}&audio=1`, { method: 'POST', raw: audio, headers: { 'Content-Type': 'audio/webm;codecs=opus' }, cookie: '' });
  assert.equal(up.status, 201);
  const f = S.fakes.tables.client_files.find((x) => x.id === up.data.audio_id);
  assert.equal(f.category, 'audio'); assert.equal(f.mime, 'audio/webm');
  // áudio de outro cliente não serve
  const otherUp = await call(`/api/approval?t=${tok(other)}&audio=1`, { method: 'POST', raw: audio, headers: { 'Content-Type': 'audio/mp4' }, cookie: '' });
  assert.equal((await call('/api/approval', { method: 'POST', body: { t: tok(c), post_id: post.id, decision: 'changes', audio_id: otherUp.data.audio_id }, cookie: '' })).status, 400);
  // só áudio, sem texto
  const r = (await call('/api/approval', { method: 'POST', body: { t: tok(c), post_id: post.id, decision: 'changes', feedback: '', audio_id: up.data.audio_id }, cookie: '' })).data;
  assert.equal(r.status, 'changes_requested');
  assert.equal(r.feedback_audio, up.data.audio_id);
  assert.equal(r.client_feedback, '🎤 Pedido por áudio');
  assert.match(S.fakes.tables.post_events.at(-1).note, /áudio/);
  // cliente ouve o próprio áudio; agência abre pela pasta
  assert.equal((await call(`/api/approval?t=${tok(c)}&audio=${up.data.audio_id}`, { cookie: '' })).status, 302);
  assert.equal((await call(`/api/approval?t=${tok(other)}&audio=${up.data.audio_id}`, { cookie: '' })).status, 404);
  assert.equal((await call(`/api/pasta?r=files&id=${up.data.audio_id}&open=1`)).status, 302);
  // listagem do cliente mostra o áudio no post
  const list = (await call(`/api/approval?t=${tok(c)}`, { cookie: '' })).data;
  assert.equal(list.posts[0].feedback_audio, up.data.audio_id);
  // sem texto e sem áudio continua bloqueado
  await call(`/api/posts?id=${post.id}`, { method: 'PATCH', body: { caption: 'nova', send: true } });
  assert.equal((await call('/api/approval', { method: 'POST', body: { t: tok(c), post_id: post.id, decision: 'changes' }, cookie: '' })).status, 400);
  // aprovar limpa o áudio antigo
  const ap = (await call('/api/approval', { method: 'POST', body: { t: tok(c), post_id: post.id, decision: 'approve' }, cookie: '' })).data;
  assert.equal(ap.feedback_audio, null);
});

test('cartão rápido do Fluxo e remarcar horário mantendo o status', async () => {
  const card = (await call('/api/posts', { method: 'POST', body: { client_id: c.id, title: 'Só a pauta', stage: 'draft' } })).data;
  assert.equal(card.status, 'draft'); assert.equal(card.scheduled_at, null);
  const p = (await call('/api/posts', { method: 'POST', body: { client_id: c.id, title: 'Aprovado', image_url: 'https://x/a.jpg', scheduled_at: new Date(Date.now() + 2 * 864e5).toISOString(), approved: true } })).data;
  const moved = (await call(`/api/posts?id=${p.id}`, { method: 'PATCH', body: { scheduled_at: new Date(Date.now() + 3 * 864e5).toISOString() } })).data;
  assert.equal(moved.status, 'approved', 'mudar só a data não tira da fila');
});
