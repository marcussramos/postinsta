// Melhores horários para postar, por cliente.
// Lê os posts dos últimos 120 dias do Instagram (curtidas + comentários, sem precisar da permissão de métricas),
// compara cada post com a mediana do perfil e agrupa por dia da semana + hora (no fuso da agência).
// Com poucos posts, devolve uma sugestão geral e avisa.
import { db } from './db.js';
import { TIMEZONE } from './env.js';
import * as ig from './ig.js';

const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const GENERIC = [{ weekday: 2, hour: 19 }, { weekday: 4, hour: 12 }, { weekday: 6, hour: 10 }];
const label = (s) => `${DIAS[s.weekday]} ${s.hour}h`;

function localParts(iso, tz) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: '2-digit', hourCycle: 'h23' });
  const o = {}; for (const p of f.formatToParts(new Date(iso))) o[p.type] = p.value;
  return { weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(o.weekday), hour: Number(o.hour) % 24 };
}

export function rankSlots(media, tz = TIMEZONE()) {
  const scored = media.map((m) => ({ ...localParts(m.timestamp, tz), s: (m.like_count || 0) + 2 * (m.comments_count || 0) }));
  if (scored.length < 6) return null;
  const sorted = scored.map((x) => x.s).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] || 1;
  const buckets = new Map();
  for (const x of scored) {
    const k = `${x.weekday}-${x.hour}`;
    const b = buckets.get(k) || { weekday: x.weekday, hour: x.hour, sum: 0, n: 0 };
    b.sum += x.s / median; b.n++; buckets.set(k, b);
  }
  // média "encolhida" para não premiar um único post que viralizou
  const ranked = [...buckets.values()].map((b) => ({ ...b, lift: (b.sum + 1) / (b.n + 1) })).sort((a, b) => b.lift - a.lift);
  const out = [];
  for (const b of ranked) {
    if (out.some((o) => o.weekday === b.weekday && Math.abs(o.hour - b.hour) < 2)) continue;
    out.push({ weekday: b.weekday, hour: b.hour, lift: +b.lift.toFixed(2), n: b.n, label: label(b) });
    if (out.length === 3) break;
  }
  return out;
}

export async function bestTimes(clientId, { refresh = false, now = Date.now(), tz = TIMEZONE() } = {}) {
  const key = `besttime_${clientId}`;
  if (!refresh) {
    const cached = await db.one('app_state', { select: 'value', key: `eq.${key}` }).catch(() => null);
    if (cached?.value?.at && now - new Date(cached.value.at).getTime() < 24 * 3600e3) return cached.value;
  }
  const c = await db.one('clients', { select: 'id,ig_token,ig_user_id', id: `eq.${clientId}` });
  let media = [];
  if (c?.ig_token && c.ig_user_id) {
    try { media = await ig.mediaBetween(c.ig_user_id, c.ig_token, now - 120 * 864e5, now, 4); } catch { media = []; }
  }
  const slots = rankSlots(media, tz);
  const value = slots
    ? { at: new Date(now).toISOString(), source: 'perfil', based_on: media.length, slots }
    : { at: new Date(now).toISOString(), source: 'geral', based_on: media.length, slots: GENERIC.map((s) => ({ ...s, label: label(s) })) };
  await db.upsert('app_state', { key, value, updated_at: new Date(now).toISOString() }).catch(() => {});
  return value;
}
