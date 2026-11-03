// Estúdio: a IA escreve a peça (ganchos, lâminas, CTA, legenda) e o painel cria o post no Fluxo.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './dev-server.js';
import { cleanPiece } from '../lib/pasta/studio.js';

let S, base, cookie = '';
const call = async (path, { method = 'GET', body } = {}) => {
  const r = await fetch(base + path, { method, headers: { cookie, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); let data; try { data = JSON.parse(t); } catch { data = t; }
  return { status: r.status, data, headers: r.headers };
};
before(async () => {
  S = await startServer(4442); base = S.url;
  cookie = (await call('/api/session', { method: 'POST', body: { password: 'senha-teste' } })).headers.get('set-cookie').split(';')[0];
});
after(() => { S.server.close(); S.fakes.restore(); delete process.env.ANTHROPIC_API_KEY; });

test('carrossel: 3 ganchos, capa recebe o gancho, CTA pelo objetivo e regras do nicho no pedido', async () => {
  process.env.ANTHROPIC_API_KEY = 'sk-test';
  const c = (await call('/api/clients', { method: 'POST', body: { name: 'Annielly' } })).data;
  await call('/api/pasta?r=brand', { method: 'PUT', body: { client_id: c.id, brand_voice: 'acolhedor', brand_kit: { niche: 'odonto' } } });
  assert.equal((await call('/api/pasta?r=studio', { method: 'POST', body: { client_id: c.id, topic: '' } })).status, 400);
  const r = await call('/api/pasta?r=studio', { method: 'POST', body: { client_id: c.id, format: 'CAROUSEL', goal: 'vender', topic: 'Clareamento dental', slides: 4 } });
  assert.equal(r.status, 200);
  const p = r.data.piece;
  assert.equal(p.hooks.length, 3);
  assert.equal(p.slides.length, 4);
  assert.equal(p.slides[0].title, '', 'a capa fica para o gancho escolhido');
  assert.deepEqual(p.hashtags, ['#clareamento', '#odontocuiaba']);
  const prompt = S.fakes.ig.aiCalls.at(-1).messages[0].content[0].text;
  assert.match(prompt, /^ESTÚDIO/);
  assert.match(prompt, /CARROSSEL de 4 lâminas/);
  assert.match(prompt, /chamar no direct/);
  assert.match(prompt, /CFO/);
  assert.match(prompt, /Tom de voz: acolhedor/);
  assert.deepEqual(r.data.voice, { described: true, samples: 0 });
});

test('usa as legendas aprovadas do cliente como exemplo de voz', async () => {
  process.env.ANTHROPIC_API_KEY = 'sk-test';
  const c = (await call('/api/clients', { method: 'POST', body: { name: 'Videomaker' } })).data;
  const cap = 'Bora gravar? Aqui a gente não complica: você chega, a gente organiza e o vídeo sai com a sua cara. 🎬 Me chama que eu te explico tudo direitinho. #video #cuiaba';
  await call('/api/posts', { method: 'POST', body: { client_id: c.id, image_url: 'https://fake.supabase.co/v.jpg', caption: cap, scheduled_at: new Date(Date.now() + 864e5).toISOString(), approved: true } });
  const r = await call('/api/pasta?r=studio', { method: 'POST', body: { client_id: c.id, topic: 'Por que o vídeo não sai' } });
  assert.deepEqual(r.data.voice, { described: false, samples: 1 });
  const prompt = S.fakes.ig.aiCalls.at(-1).messages[0].content[0].text;
  assert.match(prompt, /COMO ESTE CLIENTE ESCREVE/);
  assert.match(prompt, /Bora gravar\? Aqui a gente não complica/);
  assert.doesNotMatch(prompt, /#cuiaba/, 'exemplos vão sem hashtags');
});

test('sem a chave da IA avisa; formato inválido vira carrossel; Reels normaliza o roteiro', async () => {
  delete process.env.ANTHROPIC_API_KEY;
  const c = S.fakes.tables.clients[0];
  assert.equal((await call('/api/pasta?r=studio', { method: 'POST', body: { client_id: c.id, topic: 'Tema' } })).status, 503);
  const reels = cleanPiece({ hooks: ['a', 'b'], scenes: [{ show: 'x', say: 'y', secs: 5 }], cta: 'c', caption: 'd', cover: 'e' }, 'REELS');
  assert.equal(reels.scenes.length, 1);
  assert.equal(reels.cover, 'e');
});

test('cliente avulso e capa de vídeo: gera sem cliente cadastrado', async () => {
  process.env.ANTHROPIC_API_KEY = 'sk-test';
  const r = await call('/api/pasta?r=studio', { method: 'POST', body: { client_id: 'avulso', client: { name: 'Pet Shop do Zé', ig_username: '@petze', brand_voice: 'divertido' }, format: 'COVER', topic: 'Banho e tosa em 30 minutos' } });
  assert.equal(r.status, 200);
  assert.equal(r.data.piece.format, 'COVER');
  const prompt = S.fakes.ig.aiCalls.at(-1).messages[0].content[0].text;
  assert.match(prompt, /Cliente: Pet Shop do Zé \(@petze\)/);
  assert.match(prompt, /CAPA DE VÍDEO/);
  assert.match(prompt, /Tom de voz: divertido/);
  assert.equal((await call('/api/pasta?r=studio', { method: 'POST', body: { client_id: 'qualquer', topic: 'x y z' } })).status, 400);
});

