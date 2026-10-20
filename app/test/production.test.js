// Clientes "só produção": o app não publica por eles; o aprovado é entregue e o cliente baixa pelo link.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './dev-server.js';
import { runPublisher } from '../lib/publisher.js';

let S, base, cookie = '';
const call = async (path, { method = 'GET', body, auth = true } = {}) => {
  const r = await fetch(base + path, { method, headers: { ...(auth ? { cookie } : {}), 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); let data; try { data = JSON.parse(t); } catch { data = t; }
  return { status: r.status, data, headers: r.headers };
};
before(async () => {
  S = await startServer(4436); base = S.url;
  cookie = (await call('/api/session', { method: 'POST', body: { password: 'senha-teste' } })).headers.get('set-cookie').split(';')[0];
});
after(() => { S.server.close(); S.fakes.restore(); });

test('só produção: marca no cadastro, o publicador ignora, entrega fecha o post e o cliente baixa pelo link', async () => {
  const c = (await call('/api/clients', { method: 'POST', body: { name: 'Fernanda' } })).data;
  assert.ok(!c.production_only);
  assert.equal((await call(`/api/clients?id=${c.id}`, { method: 'PATCH', body: { production_only: true } })).data.production_only, true);
  // salvar outro campo sem mandar a marcação mantém
  await call(`/api/clients?id=${c.id}`, { method: 'PATCH', body: { name: 'Fernanda Solução' } });
  assert.equal((await call('/api/clients')).data.find((k) => k.id === c.id).production_only, true);

  const past = new Date(Date.now() - 60e3).toISOString();
  const media = [{ url: 'https://fake.supabase.co/v.mp4', kind: 'video' }];
  const p = (await call('/api/posts', { method: 'POST', body: { client_id: c.id, title: 'Bate & Bola', media_type: 'REELS', media, image_url: 'https://fake.supabase.co/capa.jpg', caption: 'legenda pronta', scheduled_at: past, approved: true } })).data;
  assert.equal(p.status, 'approved');

  // o publicador não toca: não falha por "Instagram não conectado"
  await runPublisher({ wait: async () => {} });
  const row = S.fakes.tables.posts.find((x) => x.id === p.id);
  assert.equal(row.status, 'approved');
  assert.equal(row.last_error ?? null, null);

  // área do cliente: material e legenda para baixar
  const t = (await call(`/api/clients?id=${c.id}`, { method: 'PATCH', body: { portal: 'enable' } })).data.portal_url.split('t=')[1];
  const month = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Cuiaba', year: 'numeric', month: '2-digit' }).format(new Date(past));
  const cal = (await call(`/api/pasta?r=portal&t=${t}&cal=${month}`, { auth: false })).data;
  assert.equal(cal.production_only, true);
  const item = cal.posts.find((x) => x.id === p.id);
  assert.equal(item.caption, 'legenda pronta');
  assert.deepEqual(item.files.map((f) => f.kind), ['video', 'image']);
  assert.equal(item.files[1].cover, true);

  // entregar
  const d = (await call(`/api/posts?id=${p.id}`, { method: 'PATCH', body: { action: 'deliver' } })).data;
  assert.equal(d.status, 'published');
  assert.ok(S.fakes.tables.post_events.some((e) => e.post_id === p.id && e.type === 'delivered'));

  // desmarcar volta ao normal: aprovado de novo entra na fila e acusa a falta do Instagram (comportamento padrão)
  await call(`/api/clients?id=${c.id}`, { method: 'PATCH', body: { production_only: false } });
  const p2 = (await call('/api/posts', { method: 'POST', body: { client_id: c.id, title: 'Outro', image_url: 'https://fake.supabase.co/a.jpg', caption: 'x', scheduled_at: past, approved: true } })).data;
  await runPublisher({ wait: async () => {} });
  assert.match(S.fakes.tables.posts.find((x) => x.id === p2.id).last_error || '', /não está conectado/);
});
