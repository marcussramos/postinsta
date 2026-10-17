// Missões da semana: calculadas do trabalho real, sem nada marcado à mão.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { weekMissions, weekLevel, isDone, missionXp } from '../public/missoes.js';

const posts = [
  { status: 'published', hasMedia: true },
  { status: 'approved', hasMedia: true },
  { status: 'pending_approval', hasMedia: true },
  { status: 'draft', hasMedia: false },
];

test('posts da semana viram missões de publicação, produção, arte e aprovação', () => {
  const m = Object.fromEntries(weekMissions({ weekPosts: posts }).map((x) => [x.id, x]));
  assert.deepEqual([m.pub.n, m.pub.total, m.pub.s], [1, 4, 'dir']);
  assert.deepEqual([m.prod.n, m.prod.total, m.prod.s], [3, 4, 'cont']);
  assert.deepEqual([m.arte.n, m.arte.total], [3, 4]);
  assert.deepEqual([m.aprov.n, m.aprov.total, m.aprov.s], [2, 3, 'atd']);
});

test('sem posts na semana, não aparecem missões de produção', () => {
  assert.equal(weekMissions({}).length, 0);
});

test('entregas do contrato, mensalidades e follow-ups', () => {
  const list = weekMissions({
    today: '2026-10-17', monthName: 'outubro',
    deliveries: [{ client: 'Annielly', planned: 5, quota: 12 }, { client: 'Sem cota', planned: 3, quota: null }, { client: 'Passou', planned: 14, quota: 12 }],
    billing: [{ client: 'A', status: 'paid' }, { client: 'B', status: 'late' }, { client: 'C', status: 'waived' }],
    leads: [{ stage: 'novo', wants_contact: true }, { stage: 'contato', next_action_at: '2026-10-20' }, { stage: 'fechado' }, { stage: 'proposta', next_action_at: '2026-10-10' }],
  });
  const by = Object.fromEntries(list.map((x) => [x.id, x]));
  assert.equal(by['entregas:Annielly'].t, 'Entregas de outubro · Annielly');
  assert.deepEqual([by['entregas:Annielly'].n, by['entregas:Annielly'].total], [5, 12]);
  assert.equal(by['entregas:Sem cota'], undefined);
  assert.deepEqual([by['entregas:Passou'].n, by['entregas:Passou'].total], [12, 12]);
  assert.ok(isDone(by['entregas:Passou']));
  assert.deepEqual([by.fin.n, by.fin.total, by.fin.s], [2, 3, 'fin']);
  assert.deepEqual([by.followups.n, by.followups.total, by.followups.s], [1, 3, 'ven']);
});

test('XP e nível da semana', () => {
  const ms = [{ n: 4, total: 4 }, { n: 1, total: 2 }, { n: 0, total: 3 }];
  assert.equal(missionXp(ms[0]), 30);
  assert.equal(missionXp(ms[1]), 15);
  const lv = weekLevel(ms);
  assert.deepEqual([lv.xp, lv.level, lv.done, lv.title], [45, 1, 1, 'Estúdio iniciante']);
  assert.equal(weekLevel(Array.from({ length: 6 }, () => ({ n: 1, total: 1 }))).level, 2);
});
