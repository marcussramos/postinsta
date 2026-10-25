// Teste diário das conexões do Instagram + link para o cliente conectar pelo celular.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './dev-server.js';
import { runPublisher } from '../lib/publisher.js';
import { checkConnections } from '../lib/ighealth.js';

let S, base, cookie = '';
const call = async (path, { method = 'GET', body, auth = true } = {}) => {
  const r = await fetch(base + path, { method, redirect: 'manual', headers: { ...(auth ? { cookie } : {}), 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); let data; try { data = JSON.parse(t); } catch { data = t; }
  return { status: r.status, data, headers: r.headers };
};
before(async () => {
  S = await startServer(4438); base = S.url;
  cookie = (await call('/api/session', { method: 'POST', body: { password: 'senha-teste' } })).headers.get('set-cookie').split(';')[0];
});
after(() => { S.server.close(); S.fakes.restore(); });

const connect = (id, tok) => Object.assign(S.fakes.tables.clients.find((c) => c.id === id), { ig_token: tok, ig_user_id: `u-${id}`, ig_username: `perfil_${tok}`, ig_token_expires_at: new Date(Date.now() + 50 * 864e5).toISOString(), ig_connected_at: new Date(Date.now() - 3 * 864e5).toISOString() });

test('detecta conexão que caiu, avisa no painel e o link de conexão funciona para o cliente', async () => {
  const ok = (await call('/api/clients', { method: 'POST', body: { name: 'Vitoria' } })).data;
  const dead = (await call('/api/clients', { method: 'POST', body: { name: 'Lais' } })).data;
  connect(ok.id, 'long-tok'); connect(dead.id, 'dead-tok');

  // botão "Testar conexões"
  const r = (await call('/api/clients', { method: 'PUT' })).data;
  assert.deepEqual(r.dead, ['Lais']);
  assert.deepEqual(r.newlyDead, ['Lais']);
  assert.ok(r.ok.includes('Vitoria'));
  let list = (await call('/api/clients')).data;
  assert.equal(list.find((c) => c.id === dead.id).ig_health.ok, false);
  assert.equal(list.find((c) => c.id === ok.id).ig_health.ok, true);
  const link = list.find((c) => c.id === dead.id).connect_url;
  assert.match(link, /\/conectar\?t=[a-f0-9]{32,}/);

  // segunda rodada não avisa de novo
  assert.deepEqual((await checkConnections({ force: true })).newlyDead, []);
  // no agendador de 5 min, só testa a cada 6 h
  assert.equal((await checkConnections({ force: false })).skipped, true);

  // o link abre a página e leva ao login do Instagram com o cliente certo
  const t = new URL(link).searchParams.get('t');
  const page = await call(`/conectar?t=${t}`, { auth: false });
  assert.equal(page.status, 200);
  assert.match(page.data, /Conecte seu Instagram · Lais/);
  const go = await call(`/api/ig/connect?t=${t}`, { auth: false });
  assert.equal(go.status, 302);
  assert.match(go.headers.get('location'), /instagram\.com\/oauth\/authorize/);

  // volta do Instagram: reconecta, limpa o alerta e devolve o cliente à página de conexão
  const state = new URL(go.headers.get('location')).searchParams.get('state');
  S.fakes.tables.clients.find((c) => c.id === ok.id).ig_user_id = 'outro'; // libera o ID que o fake devolve
  const back = await call(`/api/ig/callback?code=abc&state=${encodeURIComponent(state)}`, { auth: false });
  assert.equal(back.status, 302);
  assert.match(back.headers.get('location'), /^\/conectar\?t=.*ig=ok/);
  list = (await call('/api/clients')).data;
  const l = list.find((c) => c.id === dead.id);
  assert.equal(l.ig_connected, true);
  assert.equal(l.ig_health, null);
});

test('publicação com token morto marca a conexão como caída', async () => {
  const c = (await call('/api/clients', { method: 'POST', body: { name: 'Maison' } })).data;
  connect(c.id, 'dead-tok');
  S.fakes.tables.clients.find((x) => x.id === c.id).ig_user_id = 'u-maison';
  await call('/api/posts', { method: 'POST', body: { client_id: c.id, image_url: 'https://fake.supabase.co/m.jpg', caption: 'x', scheduled_at: new Date(Date.now() - 1000).toISOString(), approved: true } });
  await runPublisher({ wait: async () => {} });
  const me = (await call('/api/clients')).data.find((x) => x.id === c.id);
  assert.equal(me.ig_health?.ok, false);
});
