// MC DIGITAL — missões da semana da equipe, calculadas a partir do trabalho real do app.
// Nada é marcado à mão: cada post produzido, aprovado ou publicado, cada mensalidade paga
// e cada follow-up em dia avança a missão do setor responsável. Funções puras (testadas em test/missoes.test.js).

export const PRODUCED = ['internal_review', 'pending_approval', 'approved', 'publishing', 'published'];
export const SENT = ['pending_approval', 'changes_requested', 'approved', 'publishing', 'published'];
export const APPROVED = ['approved', 'publishing', 'published'];
export const XP_FULL = 30;
export const XP_LEVEL = 150;
export const TITLES = ['Estúdio iniciante', 'Estúdio em ritmo', 'Agência em crescimento', 'Agência de referência', 'Agência premiada', 'Agência lendária'];

// weekPosts: posts da semana (sem ideias) → [{ status, hasMedia }]
// deliveries: [{ client, planned, quota }] · billing: [{ client, status: paid|waived|open|late }]
// leads: [{ stage, next_action_at, wants_contact }] · today: 'AAAA-MM-DD' · monthName: 'outubro'
export function weekMissions({ weekPosts = [], deliveries = [], billing = [], leads = [], today = '', monthName = '' } = {}) {
  const list = [];
  const count = (arr, fn) => arr.filter(fn).length;
  if (weekPosts.length) {
    const total = weekPosts.length;
    list.push({ id: 'pub', s: 'dir', t: 'Publicar os posts da semana', n: count(weekPosts, (p) => p.status === 'published'), total });
    list.push({ id: 'prod', s: 'cont', t: 'Produzir os posts da semana', n: count(weekPosts, (p) => PRODUCED.includes(p.status)), total });
    list.push({ id: 'arte', s: 'des', t: 'Arte pronta nos posts da semana', n: count(weekPosts, (p) => p.hasMedia), total });
    const sent = weekPosts.filter((p) => SENT.includes(p.status));
    if (sent.length) list.push({ id: 'aprov', s: 'atd', t: 'Aprovações da semana', n: count(sent, (p) => APPROVED.includes(p.status)), total: sent.length });
  }
  // entregas do contrato: uma missão só, somando os clientes (o detalhe por cliente vai em parts)
  const parts = deliveries.filter((d) => d.quota).map((d) => ({ client: d.client, n: Math.min(d.planned || 0, d.quota), total: d.quota }));
  if (parts.length) list.push({ id: 'entregas', s: 'plan', t: `Entregas de ${monthName}`, n: parts.reduce((x, d) => x + d.n, 0), total: parts.reduce((x, d) => x + d.total, 0), parts });
  if (billing.length) list.push({ id: 'fin', s: 'fin', t: `Receber as mensalidades de ${monthName}`, n: count(billing, (b) => b.status === 'paid' || b.status === 'waived'), total: billing.length });
  const active = leads.filter((l) => !['fechado', 'perdido'].includes(l.stage));
  if (active.length) {
    const overdue = (l) => (l.wants_contact && l.stage === 'novo') || (l.next_action_at && l.next_action_at <= today);
    list.push({ id: 'followups', s: 'ven', t: 'Follow-ups de vendas em dia', n: count(active, (l) => !overdue(l)), total: active.length });
  }
  return list;
}

export const missionXp = (m) => (m.total ? Math.round(XP_FULL * Math.min(1, m.n / m.total)) : 0);
export const isDone = (m) => m.total > 0 && m.n >= m.total;

export function weekLevel(missions) {
  const xp = missions.reduce((s, m) => s + missionXp(m), 0);
  const level = Math.floor(xp / XP_LEVEL) + 1;
  return { xp, level, title: TITLES[Math.min(level - 1, TITLES.length - 1)], into: xp % XP_LEVEL, next: XP_LEVEL, done: missions.filter(isDone).length };
}
