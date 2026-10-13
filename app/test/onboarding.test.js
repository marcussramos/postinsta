// Boas-vindas (onboarding) + questionário que alimenta a Marca do cliente.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './dev-server.js';
import { QUESTIONS } from '../public/onboarding-perguntas.js';

let S, base, owner = '', c, t;
async function call(path, { method = 'GET', body, raw, headers = {}, cookie = owner } = {}) {
  const init = { method, headers: { ...(cookie ? { cookie } : {}), ...headers }, redirect: 'manual' };
  if (raw) { init.body = raw; init.headers['Content-Type'] = 'application/octet-stream'; }
  else if (body) { init.body = JSON.stringify(body); init.headers['Content-Type'] = 'application/json'; }
  const r = await fetch(base + path, init);
  const tx = await r.text(); let data; try { data = JSON.parse(tx); } catch { data = tx; }
  return { status: r.status, data, headers: r.headers };
}
before(async () => {
  S = await startServer(4422); base = S.url;
  owner = (await call('/api/session', { method: 'POST', body: { password: 'senha-teste' }, cookie: '' })).headers.get('set-cookie').split(';')[0];
  c = (await call('/api/clients', { method: 'POST', body: { name: 'Studio Angela' } })).data;
  await call(`/api/clients?id=${c.id}`, { method: 'PATCH', body: { contract_data: { nome: 'Studio Angela LTDA', representante: 'Angela Souza' } } });
  c = (await call(`/api/clients?id=${c.id}`, { method: 'PATCH', body: { portal: 'enable' } })).data;
  t = c.portal_url.split('t=')[1];
});
after(() => { S.server.close(); S.fakes.restore(); });

const full = () => Object.fromEntries(QUESTIONS.map((q) => [q.id, q.type === 'choice' ? q.options[0] : `resposta ${q.id}`]));

test('página de boas-vindas: saudação com o nome, textos do manual e checklist', async () => {
  const r = (await call(`/api/pasta?r=onboarding&t=${t}`, { cookie: '' })).data;
  assert.equal(r.client.first_name, 'Angela');
  assert.equal(r.content.founder_name, 'Maria Carolina');
  assert.match(r.content.mission, /\*\*visibilidade\*\*/);
  assert.equal(r.questions.length, 21);
  assert.equal(r.checklist.find((x) => x.text === 'Onboarding').done, false);
  assert.equal(r.checklist.find((x) => x.text === 'Contrato + pagamento').done, true);
  const page = await call(`/boasvindas?t=${t}`, { cookie: '' });
  assert.match(page.data, /og:title" content="Oi, Angela! Bem-vindo à MC Digital"/);
  assert.equal((await call('/api/pasta?r=onboarding&t=abc', { cookie: '' })).status, 404);
});

test('questionário: valida, salva na Marca, preserva ao editar a marca e entra no prompt da IA', async () => {
  const partial = { ...full() }; delete partial.percepcao;
  const bad = await call(`/api/pasta?r=onboarding&t=${t}`, { method: 'POST', body: { answers: partial }, cookie: '' });
  assert.equal(bad.status, 400); assert.match(bad.data.error, /primeiro contato/);
  const wrongChoice = { ...full(), sexo: 'Outro valor' };
  assert.equal((await call(`/api/pasta?r=onboarding&t=${t}`, { method: 'POST', body: { answers: wrongChoice }, cookie: '' })).status, 400);
  assert.equal((await call(`/api/pasta?r=onboarding&t=${t}`, { method: 'POST', body: { answers: full() }, cookie: '' })).status, 200);
  let kit = S.fakes.tables.clients.find((x) => x.id === c.id).brand_kit;
  assert.equal(kit.inspirations, 'resposta inspiracoes');
  assert.equal(kit.perception, 'resposta percepcao');
  assert.equal(kit.onboarding.answers.sexo, 'Feminino');
  // a agência edita a marca: as respostas do cliente continuam lá
  await call('/api/pasta?r=brand', { method: 'PUT', body: { client_id: c.id, brand_kit: { niche: 'beleza', avoid: 'nada de memes' } } });
  kit = S.fakes.tables.clients.find((x) => x.id === c.id).brand_kit;
  assert.equal(kit.onboarding.answers.diferencial, 'resposta diferencial');
  assert.equal(kit.avoid, 'nada de memes');
  // checklist marca o onboarding e a IA recebe o resumo
  assert.equal((await call(`/api/pasta?r=onboarding&t=${t}`, { cookie: '' })).data.checklist.find((x) => x.text === 'Onboarding').done, true);
  process.env.ANTHROPIC_API_KEY = 'sk-test';
  await call('/api/ai/caption', { method: 'POST', body: { client_id: c.id, brief: 'promo' } });
  const prompt = S.fakes.ig.aiCalls.at(-1).messages[0].content.at(-1).text;
  assert.match(prompt, /Qual o seu diferencial\? resposta diferencial/);
  assert.match(prompt, /Não associar à marca: nada de memes/);
  delete process.env.ANTHROPIC_API_KEY;
  // portal mostra o atalho
  assert.equal((await call(`/api/pasta?r=portal&t=${t}`, { cookie: '' })).data.onboarding.done, true);
});

test('Ajustes: textos e foto da fundadora', async () => {
  const r = (await call('/api/pasta?r=onbcfg', { method: 'PUT', body: { founder_name: 'Maria Carolina Ramos', mission: '', steps: 'Um\nDois\n\nTrês' } })).data;
  assert.equal(r.founder_name, 'Maria Carolina Ramos');
  assert.match(r.mission, /visibilidade/, 'vazio volta ao padrão');
  assert.deepEqual(r.steps, ['Um', 'Dois', 'Três']);
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(100)]);
  const p = (await call('/api/pasta?r=onbcfg&photo=1', { method: 'POST', raw: jpeg })).data;
  assert.match(p.founder_photo, /\/storage\/v1\/object\/public\/posts\/agency\/fundadora-/);
  assert.equal((await call('/api/pasta?r=onbcfg', { cookie: '' })).status, 401);
});
