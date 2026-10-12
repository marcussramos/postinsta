// Contador de entregas do mês: quantos posts de feed (foto + carrossel) e Reels saíram/estão programados
// em comparação com a cota do contrato (contract_data.quota_posts / quota_reels).
import { db } from './db.js';
import { TIMEZONE } from './env.js';
import { monthStart, shiftMonth, currentMonth } from './reports.js';

export async function deliveries(month = currentMonth(), { clientId, tz = TIMEZONE() } = {}) {
  const from = new Date(monthStart(month, tz)).toISOString(), to = new Date(monthStart(shiftMonth(month, 1), tz)).toISOString();
  const params = { select: '*', and: `(scheduled_at.gte.${from},scheduled_at.lt.${to})`, status: 'neq.idea', limit: 2000 };
  if (clientId) params.client_id = `eq.${clientId}`;
  const [posts, clients] = await Promise.all([
    db.select('posts', params),
    db.select('clients', clientId ? { select: 'id,contract_data', id: `eq.${clientId}` } : { select: 'id,contract_data' }),
  ]);
  const out = {};
  for (const c of clients) {
    out[c.id] = { month, posts: { published: 0, planned: 0, quota: c.contract_data?.quota_posts ?? null }, reels: { published: 0, planned: 0, quota: c.contract_data?.quota_reels ?? null }, stories: { published: 0, planned: 0, quota: c.contract_data?.quota_stories ?? null } };
  }
  for (const p of posts) {
    const o = out[p.client_id]; if (!o) continue;
    const k = { REELS: 'reels', STORY: 'stories' }[p.media_type] || 'posts';
    o[k].planned++;
    if (p.status === 'published') o[k].published++;
  }
  return out;
}
