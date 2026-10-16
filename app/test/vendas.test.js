// Diagnóstico grátis, funil de vendas e revisor.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './dev-server.js';
import { reviewPost, applyFix, forbiddenTerms } from '../public/revisor.js';

let S, base, owner = '';
async function call(path, { method = 'GET', body, headers = {}, cookie = owner } = {}) {
  const init = { method, headers: { ...(cookie ? { cookie } : {}), ...headers }, redirect: 'manual' };
  if (body) { init.body = JSON.stringify(body); init.headers['Content-Type'] = 'application/json'; }
  const r = await fetch(base + path, init);
  const t = await r.text(); let data; try { data = JSON.parse(t); } catch { data = t; }
  return { status: r.status, data, headers: r.headers };
}
before(async () => {
  process.env.ANTHROPIC_API_KEY = 'sk-test';
  S = await startServer(4423); base = S.url;
  owner = (await call('/api/session', { method: 'POST', body: { password: 'senha-teste' }, cookie: '' })).headers.get('set-cookie').split(';')[0];
});
after(() => { S.server.close(); S.fakes.restore(); delete process.env.ANTHROPIC_API_KEY; });

const diag = (extra = {}) => call('/api/pasta?r=diagnostico', { method: 'POST', cookie: '', headers: { 'x-forwarded-for': extra.ip || '1.1.1.1' },
  body: { handle: '@PadariaDoBairro', name: 'João Silva', whatsapp: '(65) 99999-1111', company: 'Padaria do Bairro', answers: { nicho: 'Alimentação', objetivo: 'Vender mais', formatos: ['Fotos', 'Reels'] }, ...extra } });

test('diagnóstico: valida, analisa com IA, vira lead e marca "quer conversar"', async () => {
  assert.equal((await call('/api/pasta?r=diagnostico', { cookie: '' })).data.enabled, true);
  assert.equal((await diag({ handle: 'nome com espaço' })).status, 400);
  assert.equal((await diag({ whatsapp: '123' })).status, 400);
  assert.equal((await diag({ website: 'spam' })).status, 400, 'campo-isca');
  const r = (await diag()).data;
  assert.equal(r.result.score, 58);
  assert.equal(r.result.actions.length, 3);
  assert.equal(r.result.profile, null, 'sem perfil de consulta configurado');
  const lead = S.fakes.tables.leads[0];
  assert.equal(lead.instagram, 'padariadobairro'); assert.equal(lead.whatsapp, '5565999991111'); assert.equal(lead.source, 'diagnostico');
  assert.match(S.fakes.ig.aiCalls.at(-1).messages[0].content[0].text, /Formatos que mais usa: Fotos, Reels/);
  assert.equal((await call('/api/pasta?r=diagnostico&want=1', { method: 'POST', body: { id: r.id, key: 'errada' }, cookie: '' })).status, 404);
  await call('/api/pasta?r=diagnostico&want=1', { method: 'POST', body: { id: r.id, key: r.key }, cookie: '' });
  assert.equal(S.fakes.tables.leads[0].wants_contact, true);
  // mesmo @ de novo: atualiza o mesmo lead
  await diag({ ip: '2.2.2.2' });
  assert.equal(S.fakes.tables.leads.length, 1);
});

test('diagnóstico com dados públicos reais e limite por pessoa', async () => {
  const c = (await call('/api/clients', { method: 'POST', body: { name: 'MC Digital' } })).data;
  Object.assign(S.fakes.tables.clients.find((x) => x.id === c.id), { ig_user_id: '178400001', ig_token: 'tok' });
  await call('/api/pasta?r=diagcfg', { method: 'PUT', body: { lookup_client_id: c.id, whatsapp: '65 99999-0000' } });
  const r = (await diag({ ip: '3.3.3.3', handle: 'outroperfil' })).data;
  assert.equal(r.result.profile.followers, 2000);
  assert.equal(r.whatsapp, '5565999990000');
  assert.ok(r.result.profile.engagement_rate > 0);
  assert.match(S.fakes.ig.aiCalls.at(-1).messages[0].content[0].text, /Seguidores: 2000/);
  for (let i = 0; i < 5; i++) await diag({ ip: '9.9.9.9', handle: `perfil${i}` });
  assert.equal((await diag({ ip: '9.9.9.9', handle: 'perfil9' })).status, 429);
});

test('diagnóstico: teste de leitura no painel explica o motivo quando a Meta nega', async () => {
  assert.equal((await call('/api/pasta?r=diagcfg', { method: 'POST', body: { handle: 'x' }, cookie: '' })).status, 401);
  assert.equal((await call('/api/pasta?r=diagcfg', { method: 'POST', body: { handle: 'com espaço' } })).status, 400);
  const ok = (await call('/api/pasta?r=diagcfg', { method: 'POST', body: { handle: '@padariadobairro' } })).data;
  assert.equal(ok.ok, true); assert.equal(ok.followers, 2000);
  assert.equal((await call('/api/pasta?r=diagcfg')).data.lookup_status.ok, true);
  S.fakes.ig.discoveryDenied = true;
  const bad = (await call('/api/pasta?r=diagcfg', { method: 'POST', body: { handle: 'outro' } })).data;
  assert.equal(bad.ok, false); assert.match(bad.error, /permissão/);
  const st = (await call('/api/pasta?r=diagcfg')).data.lookup_status;
  assert.equal(st.ok, false); assert.equal(st.handle, 'outro');
  // sem dados reais, a IA é orientada a não dizer que "não conseguiu ver" o perfil
  await diag({ ip: '4.4.4.4', handle: 'semdados' });
  assert.match(S.fakes.ig.aiCalls.at(-1).messages[0].content[0].text, /Nunca escreva que "não conseguiu ver"/);
  S.fakes.ig.discoveryDenied = false;
});

test('funil: lead manual, proposta ligada ao lead e fechamento automático no aceite', async () => {
  const l = (await call('/api/pasta?r=leads', { method: 'POST', body: { name: 'Ana', instagram: 'https://instagram.com/ana.doces/', whatsapp: '65988887777', value: '1.200,00' } })).data;
  assert.equal(l.instagram, 'ana.doces'); assert.equal(l.value_cents, 120000);
  assert.equal((await call('/api/pasta?r=leads', { method: 'PATCH', body: { id: l.id, stage: 'xx' } })).status, 400);
  await call('/api/pasta?r=leads', { method: 'PATCH', body: { id: l.id, stage: 'reuniao', next_action_at: '2026-10-20' } });
  const p = (await call('/api/pasta?r=proposals', { method: 'POST', body: { client_name: 'Ana Doces', monthly_fee: '1.300,00', send: true, lead_id: l.id } })).data;
  let row = S.fakes.tables.leads.find((x) => x.id === l.id);
  assert.equal(row.stage, 'proposta'); assert.equal(row.proposal_id, p.id); assert.equal(row.value_cents, 130000);
  const acc = await call(`/api/pasta?r=proposal&t=${p.token}`, { method: 'POST', cookie: '', body: { nome: 'Ana Doces LTDA', documento: '12.345.678/0001-90', endereco: 'Rua A, 1', representante: 'Ana', email: 'ana@x.com', whatsapp: '65988887777', inicio: '2099-01-01', aceite: true } });
  assert.equal(acc.status, 200);
  row = S.fakes.tables.leads.find((x) => x.id === l.id);
  assert.equal(row.stage, 'fechado'); assert.ok(row.client_id);
  assert.equal((await call('/api/pasta?r=leads', { cookie: '' })).status, 401);
});

test('revisor: regras rápidas e correções', () => {
  const now = Date.parse('2026-10-13T12:00:00Z');
  const tags = Array.from({ length: 32 }, (_, i) => `#t${i}`).join(' ');
  let r = reviewPost({ media_type: 'IMAGE', caption: `Olha  isso .\n\n${tags}`, scheduled_at: '2026-10-12T12:00:00Z', image: { w: 800, h: 1200 } }, { now, brand_kit: { donts: 'barato, promoção relâmpago' } });
  const t = r.map((i) => i.title);
  assert.ok(t.includes('Hashtags demais')); assert.ok(t.includes('Horário já passou')); assert.ok(t.includes('Imagem em baixa resolução'));
  assert.ok(t.includes('Imagem alta demais para o feed')); assert.ok(t.includes('Sem chamada para ação')); assert.ok(t.includes('Espaços sobrando'));
  assert.equal(r[0].level, 'erro');
  r = reviewPost({ media_type: 'IMAGE', caption: 'Pão quentinho e barato! Comente aqui 👇 #pao', scheduled_at: '2026-10-14T23:00:00Z', image: { w: 1080, h: 1350 } }, { now, brand_kit: { donts: 'barato, promoção relâmpago' } });
  assert.deepEqual(r.map((i) => i.title), ['Palavra que a marca evita']);
  assert.deepEqual(forbiddenTerms({ donts: 'barato, promoção relâmpago', avoid: 'memes\npolítica' }), ['barato', 'promoção relâmpago', 'memes', 'política']);
  assert.equal(applyFix('a  b , c', 'fix_spaces'), 'a b, c');
  assert.equal((applyFix(tags, 'trim_tags').match(/#/g) || []).length, 10);
  assert.equal(applyFix('#a #b #a', 'dedupe_tags'), '#a #b');
  r = reviewPost({ media_type: 'CAROUSEL', caption: 'Salve!', scheduled_at: '2026-10-14T23:00:00Z', items: [{ w: 1080, h: 1350 }, { w: 1080, h: 1080 }] }, { now, sameDay: 1 });
  assert.ok(r.some((i) => i.title === 'Imagens com formatos diferentes')); assert.ok(r.some((i) => i.title === 'Outro post no mesmo dia'));
  r = reviewPost({ media_type: 'STORY', caption: '', scheduled_at: '2026-10-14T23:00:00Z', image: { w: 1080, h: 1350 } }, { now });
  assert.ok(r.some((i) => i.title === 'Story fora do 9:16'));
});

test('revisor com IA: corrige o português e aponta problemas da arte', async () => {
  const r = (await call('/api/pasta?r=review', { method: 'POST', body: { caption: 'voce vai amar!', media_type: 'IMAGE', image_url: 'https://x/a.jpg' } })).data;
  assert.equal(r.corrected_caption, 'Você vai amar!');
  assert.equal(r.issues[0].title, 'Erro de digitação');
  const sent = S.fakes.ig.aiCalls.at(-1).messages[0].content;
  assert.equal(sent[0].type, 'image');
  assert.equal((await call('/api/pasta?r=review', { method: 'POST', body: {} })).status, 400);
});
