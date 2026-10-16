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
  // cota vazia ou 0 = não definida no contrato (antes aparecia "1/0 completo ✓")
  const quota = (v) => { const n = Number(v); return v === '' || v == null || !Number.isFinite(n) || n <= 0 ? null : Math.round(n); };
  for (const c of clients) {
    const k = c.contract_data || {};
    out[c.id] = { month, posts: { published: 0, planned: 0, quota: quota(k.quota_posts) }, reels: { published: 0, planned: 0, quota: quota(k.quota_reels) }, stories: { published: 0, planned: 0, quota: quota(k.quota_stories) } };
  }
  for (const p of posts) {
    const o = out[p.client_id]; if (!o) continue;
    const k = { REELS: 'reels', STORY: 'stories' }[p.media_type] || 'posts';
    o[k].planned++;
    if (p.status === 'published') o[k].published++;
  }
  return out;
}
