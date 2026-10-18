// Relatório: desempenho por formato e próximos passos sugeridos a partir dos números.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatBreakdown, nextSteps } from '../lib/insights.js';

const posts = [
  { id: '1', type: 'Reels', interactions: 300, reach: 4000, timestamp: '2026-10-03T22:00:00Z' },
  { id: '2', type: 'Reels', interactions: 200, reach: 3000, timestamp: '2026-10-10T22:00:00Z' },
  { id: '3', type: 'Foto', interactions: 80, reach: 900, timestamp: '2026-10-12T15:00:00Z' },
  { id: '4', type: 'Carrossel', interactions: 120, reach: 1500, timestamp: '2026-10-20T15:00:00Z' },
];

test('formatos: média por tipo, do melhor para o pior', () => {
  const f = formatBreakdown(posts);
  assert.deepEqual(f.map((x) => x.type), ['Reels', 'Carrossel', 'Foto']);
  assert.equal(f[0].avg_interactions, 250); assert.equal(f[0].avg_reach, 3500); assert.equal(f[0].posts, 2);
});

test('próximos passos: formato, post campeão, salvamentos, seguidores, frequência e horários', () => {
  const d = {
    posts, top: ['1'], formats: formatBreakdown(posts), period: { partial: false },
    totals: { posts: { value: 4 }, interactions: { value: 700 }, saves: { value: 10 }, shares: { value: 5 }, followers_gained: { value: -3 } },
    previous: { posts: 8 },
    best_times: { source: 'perfil', based_on: 30, slots: [{ label: 'qua 19h', weekday: 3, hour: 19 }, { label: 'sex 12h', weekday: 5, hour: 12 }, { label: 'dom 10h' }] },
  };
  const s = nextSteps(d);
  assert.equal(s.length, 5, 'no máximo 5');
  assert.match(s[0], /Reels tiveram em média 250 interações por post, 108% a mais que os carrosséis/);
  assert.match(s[1], /post de 03\/10 \(Reels\).*300 interações/);
  assert.match(s[2], /Salvamentos e compartilhamentos ainda são poucos \(15 de 700/);
  assert.match(s[3], /não ganhou seguidores/);
  assert.match(s[4], /4 posts, contra 8/);
  // com menos motivos, entram os horários
  const s2 = nextSteps({ ...d, totals: { ...d.totals, saves: { value: 200 }, followers_gained: { value: 10 } }, previous: {} });
  assert.match(s2.at(-1), /quarta às 19h, sexta às 12h e dom 10h/);
  // sem posts
  assert.match(nextSteps({ posts: [], totals: { posts: { value: 0 } } })[0], /retomar a frequência/);
  // horários genéricos: fala em testar
  assert.match(nextSteps({ posts: [], totals: { posts: { value: 0 } }, best_times: { source: 'geral', slots: [{ label: 'ter 19h' }] } }).at(-1), /Teste ter 19h/);
});
