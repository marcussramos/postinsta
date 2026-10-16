// Roteiros de Reels/Stories: IA, regras do nicho, banco de ganchos e aprovação do cliente pelo link.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './dev-server.js';
import { checkScript, cleanScript, publicScript } from '../public/roteiro.js';

let S, base, cookie = '';
async function call(path, { method = 'GET', body, auth = true } = {}) {
  const init = { method, headers: { ...(auth ? { cookie } : {}) }, redirect: 'manual' };
  if (body) { init.body = JSON.stringify(body); init.headers['Content-Type'] = 'application/json'; }
  const r = await fetch(base + path, init);
  const t = await r.text(); let data; try { data = JSON.parse(t); } catch { data = t; }
  return { status: r.status, data };
}
before(async () => {
  process.env.ANTHROPIC_API_KEY = 'sk-test';
  S = await startServer(4426); base = S.url;
  const r = await fetch(`${base}/api/session`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'senha-teste' }) });
  cookie = r.headers.get('set-cookie').split(';')[0];
});
const apToken = async (id) => [].concat((await call('/api/clients')).data).find((x) => x.id === id).approval_url.split('t=')[1];
after(() => { S.server.close(); S.fakes.restore(); delete process.env.ANTHROPIC_API_KEY; });

test('regras do nicho: CFO barra preço e superlativo; OAB barra captação; outros nichos não', () => {
  const s = { hooks: ['Clareamento com 20% de desconto!'], scenes: [{ say: 'Sou o melhor dentista da cidade', secs: 30 }], duration: 30 };
  const odonto = checkScript(s, 'odonto');
  assert.ok(odonto.some((i) => i.level === 'erro' && i.title === 'Preço ou promoção'));
  assert.ok(odonto.some((i) => i.level === 'erro' && i.title === 'Superlativo ou promessa'));
  assert.ok(odonto.some((i) => i.title === 'Identificação do profissional'), 'lembra do CRO');
  assert.ok(!checkScript({ ...s, scenes: [{ say: 'CRO-MT 1234', secs: 30 }] }, 'odonto').some((i) => i.title === 'Identificação do profissional'));
  assert.ok(!checkScript(s, 'moda').some((i) => i.level === 'erro'), 'loja de roupa pode falar de desconto');
  assert.ok(checkScript({ hooks: ['Ligue já e ganhe sua causa'], scenes: [] }, 'juridico').some((i) => i.title === 'Promessa ou captação'));
  const clean = cleanScript({ hooks: ['a', 'b', 'c', 'd'], hook: 9, scenes: [{ say: 'x', secs: 999 }, {}], duration: 33, template: 'nada' });
  assert.equal(clean.hooks.length, 3); assert.equal(clean.hook, 2); assert.equal(clean.scenes.length, 1); assert.equal(clean.scenes[0].secs, 120);
  assert.equal(clean.duration, 30); assert.equal(clean.template, 'livre');
  const pub = publicScript({ ...clean, status: 'sent', notes: 'interno' });
  assert.equal(pub.hook, 'c'); assert.ok(!('notes' in pub) && !('hooks' in pub));
});

test('roteiro: IA escreve, regra impede envio, cliente aprova e pede ajuste pelo link', async () => {
  const c = (await call('/api/clients', { method: 'POST', body: { name: 'Clínica Sorriso' } })).data;
  await call('/api/pasta?r=brand', { method: 'PUT', body: { client_id: c.id, brand_voice: 'acolhedor', brand_kit: { niche: 'odonto' } } });
  const p = (await call('/api/posts', { method: 'POST', body: { client_id: c.id, title: 'Escovação certa', stage: 'idea' } })).data;
  const id = (Array.isArray(p) ? p[0] : p).id;

  const g = await call('/api/pasta?r=script', { method: 'POST', body: { post_id: id, topic: 'Escovação certa', template: 'erro', duration: 30 } });
  assert.equal(g.status, 200, JSON.stringify(g.data));
  assert.equal(g.data.script.hooks.length, 3);
  assert.equal(g.data.script.scenes.length, 3);
  assert.equal(g.data.script.template, 'erro');
  assert.deepEqual(g.data.warnings, ['Tirei o preço da limpeza: o CFO não permite.']);
  const sent = S.fakes.ig.aiCalls.at(-1).messages[0].content[0].text;
  assert.match(sent, /CFO \(Odontologia\)/); assert.match(sent, /acolhedor/); assert.match(sent, /Erro comum/);

  // com preço não envia
  const bad = { ...g.data.script, cta: 'Limpeza por R$ 99 só esta semana' };
  const no = await call('/api/pasta?r=script', { method: 'PUT', body: { post_id: id, script: bad, send: true } });
  assert.equal(no.status, 400);
  const ok = await call('/api/pasta?r=script', { method: 'PUT', body: { post_id: id, script: { ...g.data.script, hook: 1, notes: 'gravar na recepção' }, send: true } });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.equal(ok.data.script.status, 'sent');

  // link de aprovação mostra só o gancho escolhido e nada interno
  const token = await apToken(c.id);
  const view = await call(`/api/approval?t=${token}`, { auth: false });
  assert.equal(view.status, 200);
  assert.equal(view.data.scripts.length, 1);
  const vs = view.data.scripts[0].script;
  assert.equal(vs.hook, 'Sangra quando passa fio dental?');
  assert.ok(!JSON.stringify(view.data.scripts).includes('recepção'), 'notas internas não vazam');

  // calendário do cliente marca como roteiro para aprovar
  await call(`/api/posts?id=${id}`, { method: 'PATCH', body: { scheduled_at: '2026-11-10T15:00:00Z' } });
  const pt = (await call(`/api/clients?id=${c.id}`, { method: 'PATCH', body: { portal: 'enable' } })).data.portal_url.split('t=')[1];
  const cal = await call(`/api/pasta?r=portal&t=${pt}&cal=2026-11`, { auth: false });
  assert.equal(cal.data.posts.find((x) => x.id === id)?.group, 'roteiro');
  const portal = await call(`/api/pasta?r=portal&t=${pt}`, { auth: false });
  assert.equal(portal.data.approval.scripts, 1);

  // cliente pede ajuste sem dizer nada → erro; com texto → ok; depois aprova
  assert.equal((await call('/api/approval', { method: 'POST', auth: false, body: { t: token, kind: 'script', post_id: id, decision: 'changes' } })).status, 400);
  const ch = await call('/api/approval', { method: 'POST', auth: false, body: { t: token, kind: 'script', post_id: id, decision: 'changes', feedback: 'Prefiro gravar no consultório' } });
  assert.equal(ch.data.script.status, 'changes');
  const ap2 = await call('/api/approval', { method: 'POST', auth: false, body: { t: token, kind: 'script', post_id: id, decision: 'approve' } });
  assert.equal(ap2.data.script.status, 'approved');
  const row = S.fakes.tables.posts.find((x) => x.id === id);
  assert.equal(row.status, 'idea', 'aprovar o roteiro não mexe no status do post');
  assert.ok(S.fakes.tables.post_events.some((e) => e.type === 'script_approved'));

  // mudar depois de aprovado volta para escrita
  const ed = await call('/api/pasta?r=script', { method: 'PUT', body: { post_id: id, script: { ...row.script, cta: 'Siga para mais dicas' } } });
  assert.equal(ed.data.script.status, 'draft');

  // outro cliente não decide este roteiro
  const o = (await call('/api/clients', { method: 'POST', body: { name: 'Outro' } })).data;
  const ot = await apToken(o.id);
  assert.equal((await call('/api/approval', { method: 'POST', auth: false, body: { t: ot, kind: 'script', post_id: id, decision: 'approve' } })).status, 409);
});

test('banco de ganchos: ordena pelo resultado dos relatórios e inclui Reels de fora do app', async () => {
  const c = (await call('/api/clients', { method: 'POST', body: { name: 'Banco Co' } })).data;
  const P = S.fakes.tables.posts;
  P.push({ id: crypto.randomUUID(), client_id: c.id, status: 'published', media_type: 'REELS', ig_media_id: 'm1', caption: 'Gancho fraco\nresto', script: null, scheduled_at: '2026-09-01T12:00:00Z' });
  P.push({ id: crypto.randomUUID(), client_id: c.id, status: 'published', media_type: 'REELS', ig_media_id: 'm2', caption: 'x', script: { status: 'approved', hooks: ['A', 'Gancho forte'], hook: 1 }, scheduled_at: '2026-09-02T12:00:00Z' });
  P.push({ id: crypto.randomUUID(), client_id: c.id, status: 'draft', media_type: 'REELS', script: { status: 'draft', hooks: ['Rascunho'], hook: 0 } });
  S.fakes.tables.reports.push({ id: 'r1', client_id: c.id, ref_month: '2026-09', data: { posts: [
    { id: 'm1', views: 300, reach: 200 }, { id: 'm2', views: 5000, reach: 3000, saved: 40 },
    { id: 'm3', type: 'Reels', views: 900, caption: '#dica Ninguém te conta isso #reels', permalink: 'https://instagram.com/reel/m3' },
  ] } });
  const r = await call(`/api/pasta?r=script&hooks=1&client=${c.id}`);
  assert.deepEqual(r.data.hooks.map((x) => x.hook), ['Gancho forte', 'Ninguém te conta isso', 'Gancho fraco']);
  assert.equal(r.data.hooks[0].views, 5000);
});

test('roteiro anexado (PDF): fica no post, cliente abre pelo link e aprova', async () => {
  const c = (await call('/api/clients', { method: 'POST', body: { name: 'Anexo Co' } })).data;
  const p = [].concat((await call('/api/posts', { method: 'POST', body: { client_id: c.id, title: 'Reels anexo', stage: 'draft' } })).data)[0];
  const pdf = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(30)]);
  const up = await fetch(`${base}/api/pasta?r=files&client=${c.id}&category=other`, { method: 'POST', headers: { cookie, 'Content-Type': 'application/octet-stream', 'x-file-name': encodeURIComponent('Roteiro - Reels anexo.pdf') }, body: pdf }).then((r) => r.json());
  const o = (await call('/api/clients', { method: 'POST', body: { name: 'Alheio' } })).data;
  const alien = await fetch(`${base}/api/pasta?r=files&client=${o.id}&category=other`, { method: 'POST', headers: { cookie, 'Content-Type': 'application/octet-stream', 'x-file-name': 'x.pdf' }, body: pdf }).then((r) => r.json());
  assert.equal((await call('/api/pasta?r=script', { method: 'PUT', body: { post_id: p.id, script: { file: { id: alien.id } } } })).status, 400, 'arquivo de outro cliente não');
  const att = await call('/api/pasta?r=script', { method: 'PUT', body: { post_id: p.id, script: { file: { id: up.id } } } });
  assert.equal(att.status, 200, JSON.stringify(att.data));
  assert.equal(att.data.script.file.name, 'Roteiro - Reels anexo.pdf');
  assert.equal(att.data.script.status, 'draft');
  const token = await apToken(c.id);
  assert.equal((await call(`/api/approval?t=${token}`, { auth: false })).data.scripts.length, 0, 'rascunho não aparece para o cliente');
  const sent = await call('/api/pasta?r=script', { method: 'PUT', body: { post_id: p.id, script: att.data.script, send: true } });
  assert.equal(sent.data.script.status, 'sent');
  const view = (await call(`/api/approval?t=${token}`, { auth: false })).data.scripts[0];
  assert.equal(view.script.file.name, 'Roteiro - Reels anexo.pdf');
  assert.ok(!('id' in view.script.file));
  const open = await fetch(`${base}/api/approval?t=${token}&script_file=${p.id}`, { redirect: 'manual' });
  assert.equal(open.status, 302);
  const ot = await apToken(o.id);
  assert.equal((await fetch(`${base}/api/approval?t=${ot}&script_file=${p.id}`, { redirect: 'manual' })).status, 404, 'outro cliente não abre');
  const ok = await call('/api/approval', { method: 'POST', auth: false, body: { t: token, kind: 'script', post_id: p.id, decision: 'approve' } });
  assert.equal(ok.data.script.status, 'approved');
});
