// Prévia dos links (Open Graph): título, descrição e imagem prontos no HTML, por link.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './dev-server.js';

let S, base, owner = '';
const get = async (p) => { const r = await fetch(base + p); return { status: r.status, html: await r.text(), headers: r.headers }; };
const og = (html, prop) => html.match(new RegExp(`<meta property="og:${prop}" content="([^"]*)"`))?.[1];
before(async () => {
  S = await startServer(4418); base = S.url;
  const r = await fetch(`${base}/api/session`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'senha-teste' }) });
  owner = r.headers.get('set-cookie').split(';')[0];
});
after(() => { S.server.close(); S.fakes.restore(); });

test('aprovação: imagem da marca e título com o cliente e a quantidade', async () => {
  const c = await (await fetch(`${base}/api/clients`, { method: 'POST', headers: { 'Content-Type': 'application/json', cookie: owner }, body: JSON.stringify({ name: 'MY PET & Cia' }) })).json();
  await fetch(`${base}/api/posts`, { method: 'POST', headers: { 'Content-Type': 'application/json', cookie: owner }, body: JSON.stringify({ client_id: c.id, image_url: 'https://x/a.jpg', scheduled_at: new Date(Date.now() + 864e5).toISOString(), send: true }) });
  const t = S.fakes.tables.clients[0].approval_token;
  const r = await get(`/aprovar?t=${t}`);
  assert.equal(r.status, 200);
  assert.equal(og(r.html, 'title'), '1 post para aprovar · MY PET &amp; Cia');
  assert.equal(og(r.html, 'image'), 'http://localhost:4418/og/aprovacao.jpg');
  assert.match(r.html, /<title>1 post para aprovar/);
  assert.match(r.html, /<script type="module" src="\/aprovar.js">|aprovar\.js/);
  // link inválido: prévia genérica, sem erro
  const g = await get('/aprovar?t=zzz');
  assert.equal(og(g.html, 'title'), 'Posts para aprovar');
  // a imagem existe
  assert.equal((await fetch(`${base}/og/aprovacao.jpg`)).status, 200);
});

test('relatório, área do cliente e proposta têm prévia própria; rascunho não vaza', async () => {
  const c = S.fakes.tables.clients[0];
  c.portal_token = 'b'.repeat(48);
  assert.equal(og((await get(`/cliente?t=${c.portal_token}`)).html, 'title'), 'Área do cliente · MY PET &amp; Cia');
  S.fakes.tables.reports.push({ id: 'r', client_id: c.id, ref_month: '2026-09', share_token: 'c'.repeat(36), data: { client_name: 'MY PET', totals: { reach: { value: 28650 }, interactions: { value: 4506 }, followers_gained: { value: 355 } } } });
  const rep = (await get(`/relatorio?t=${'c'.repeat(36)}`)).html;
  assert.equal(og(rep, 'title'), 'Relatório de setembro de 2026 · MY PET');
  assert.equal(og(rep, 'description'), '28.650 de alcance · 4.506 interações · +355 seguidores. Veja os melhores posts do mês.');
  S.fakes.tables.proposals.push({ id: 'p1', token: 'd'.repeat(40), status: 'draft', client_name: 'Segredo', monthly_fee_cents: 100 });
  assert.equal(og((await get(`/proposta?t=${'d'.repeat(40)}`)).html, 'title'), 'Proposta comercial');
  S.fakes.tables.proposals[0].status = 'sent'; S.fakes.tables.proposals[0].quota_posts = 8; S.fakes.tables.proposals[0].quota_reels = 4;
  const pr = (await get(`/proposta?t=${'d'.repeat(40)}`)).html;
  assert.equal(og(pr, 'title'), 'Proposta para Segredo');
  assert.match(og(pr, 'description'), /8 posts \+ 4 Reels/);
  assert.equal((await fetch(`${base}/api/page?p=../../etc/passwd`)).status, 404);
});
