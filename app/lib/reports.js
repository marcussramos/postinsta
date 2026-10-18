// Relatório mensal de desempenho orgânico do Instagram de um cliente.
// Lê as métricas na API do Instagram, guarda um "retrato" do mês na tabela reports
// (os números não mudam depois de gerado, a não ser que a agência clique em Atualizar)
// e gera um link público em português para o cliente: /relatorio?t=...
import crypto from 'node:crypto';
import { db, storage } from './db.js';
import { TIMEZONE } from './env.js';
import * as ig from './ig.js';
import { HttpError } from './http.js';
import { bestTimes } from './besttime.js';
import { formatBreakdown, nextSteps } from './insights.js';

const isMonth = (m) => /^\d{4}-(0[1-9]|1[0-2])$/.test(m || '');
export { isMonth };

// Diferença do fuso em ms num instante (ex.: Cuiabá = -4h).
function tzOffset(ts, tz) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const o = {}; for (const p of f.formatToParts(ts)) o[p.type] = p.value;
  return Date.UTC(+o.year, +o.month - 1, +o.day, +o.hour % 24, +o.minute, +o.second) - Math.floor(ts / 1000) * 1000;
}
// Início do mês (meia-noite no fuso da agência) em ms.
export function monthStart(month, tz = TIMEZONE()) {
  const [y, m] = month.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, 1);
  return guess - tzOffset(guess, tz);
}
export function shiftMonth(month, delta) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
export function currentMonth(tz = TIMEZONE(), now = Date.now()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit' }).format(now).slice(0, 7);
}

async function pool(items, n, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  }));
  return out;
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const sum = (arr, k) => arr.reduce((s, x) => s + (num(x[k]) ?? 0), 0);

// Guarda a imagem do post no nosso armazenamento (os links do Instagram expiram em poucos dias).
async function keepImage(clientId, month, m, ownPosts) {
  const own = ownPosts.find((p) => p.ig_media_id === m.id && p.image_url);
  if (own) return own.image_url;
  const src = m.media_type === 'VIDEO' ? m.thumbnail_url : m.media_url || m.thumbnail_url;
  if (!src) return null;
  try {
    const r = await fetch(src);
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    if (!buf.length || buf.length > 8 * 1024 * 1024) return null;
    const { url } = await storage.upload(`relatorios/${clientId}/${month}/${m.id}-${crypto.randomBytes(3).toString('hex')}.jpg`, buf, r.headers.get('content-type') || 'image/jpeg');
    return url;
  } catch { return null; }
}

// Monta os dados do relatório (não grava). Lança HttpError com mensagem clara quando não dá.
export async function buildReport(client, month, { now = Date.now(), tz = TIMEZONE() } = {}) {
  if (!client.ig_token || !client.ig_user_id) throw new HttpError(400, `O Instagram de ${client.name} não está conectado.`);
  const start = monthStart(month, tz);
  const end = Math.min(monthStart(shiftMonth(month, 1), tz), now);
  if (start >= now) throw new HttpError(400, 'Esse mês ainda não começou.');
  const tok = client.ig_token, uid = client.ig_user_id;
  const warnings = [];
  const reconnect = () => new HttpError(409, `Para gerar relatórios, reconecte o Instagram de ${client.name} (ele precisa liberar a permissão de métricas). Vá em Clientes → Editar → Reconectar.`);

  let prof;
  try { prof = await ig.profile(tok); } catch (e) { if (ig.isPermissionError(e)) throw reconnect(); throw e; }

  // Posts do mês + métricas de cada um
  const media = await ig.mediaBetween(uid, tok, start, end);
  let insightsOk = true;
  const own = media.length ? await db.select('posts', { select: 'ig_media_id,image_url', client_id: `eq.${client.id}`, ig_media_id: `in.(${media.map((m) => m.id).join(',')})` }).catch(() => []) : [];
  const posts = await pool(media, 5, async (m) => {
    let ins = {};
    try { ins = await ig.mediaInsights(m.id, tok); }
    catch (e) { if (ig.isPermissionError(e)) insightsOk = false; }
    const p = {
      id: m.id, permalink: m.permalink, timestamp: m.timestamp,
      type: m.media_product_type === 'REELS' ? 'Reels' : m.media_type === 'CAROUSEL_ALBUM' ? 'Carrossel' : m.media_type === 'VIDEO' ? 'Vídeo' : 'Foto',
      caption: (m.caption || '').slice(0, 300),
      likes: num(ins.likes) ?? num(m.like_count) ?? 0,
      comments: num(ins.comments) ?? num(m.comments_count) ?? 0,
      saved: num(ins.saved), shares: num(ins.shares), reach: num(ins.reach), views: num(ins.views),
      _m: m,
    };
    p.interactions = num(ins.total_interactions) ?? p.likes + p.comments + (p.saved ?? 0) + (p.shares ?? 0);
    return p;
  });
  if (!insightsOk && media.length) throw reconnect();

  // Totais da conta no mês (inclui interações em posts antigos). Se a API não der, soma os posts do mês.
  const s = Math.floor(start / 1000), u = Math.floor(end / 1000);
  const acct = async (metric, extra) => {
    try {
      return await ig.accountTotal(uid, tok, metric, s, u, extra);
    } catch (e) {
      if (ig.isPermissionError(e)) throw reconnect();
      // períodos acima de 30 dias: divide o mês em duas metades
      if (/30 days|time range|range/i.test(e.message) && !extra?.breakdown) {
        const mid = Math.floor((s + u) / 2);
        const [a, b] = await Promise.all([ig.accountTotal(uid, tok, metric, s, mid, extra), ig.accountTotal(uid, tok, metric, mid + 1, u, extra)]).catch(() => [null, null]);
        return a == null && b == null ? null : (a || 0) + (b || 0);
      }
      return null;
    }
  };
  const [reach, likes, comments, saves, shares, interactions, views, follows] = await Promise.all([
    acct('reach'), acct('likes'), acct('comments'), acct('saves'), acct('shares'), acct('total_interactions'), acct('views'),
    acct('follows_and_unfollows', { breakdown: 'follow_type' }),
  ]);

  // Seguidores ganhos: pela API (contas com 100+ seguidores) ou pelos retratos diários que o agendador guarda.
  let followersGained = null, followersNew = null, followersLost = null, followersSource = null;
  if (follows && (follows.FOLLOWER != null || follows.NON_FOLLOWER != null)) {
    followersNew = follows.FOLLOWER ?? 0; followersLost = follows.NON_FOLLOWER ?? 0; followersGained = followersNew - followersLost; followersSource = 'api';
  } else {
    const snaps = await db.select('ig_daily', { select: 'day,followers', client_id: `eq.${client.id}`, order: 'day.asc', limit: 400 }).catch(() => []);
    const ms = new Date(start).toISOString().slice(0, 10), me = new Date(end).toISOString().slice(0, 10);
    const before = [...snaps].reverse().find((x) => x.day < ms) || snaps.find((x) => x.day >= ms && x.day <= me);
    const after = [...snaps].reverse().find((x) => x.day <= me);
    const endFollowers = end >= now - 864e5 ? prof.followers_count : after?.followers;
    if (before && endFollowers != null && before.day <= me) { followersGained = endFollowers - before.followers; followersSource = 'snapshot'; }
  }
  if (followersSource === null) warnings.push('Seguidores ganhos: o Instagram só informa para perfis com 100+ seguidores. O app passa a registrar o total todo dia e calcula nos próximos meses.');

  const pick = (acctVal, postsKey) => (acctVal != null ? { value: acctVal, source: 'conta' } : { value: sum(posts, postsKey), source: 'posts' });
  const totals = {
    reach: reach != null ? { value: reach, source: 'conta' } : { value: sum(posts, 'reach'), source: 'posts' },
    likes: pick(likes, 'likes'), comments: pick(comments, 'comments'), saves: pick(saves, 'saved'), shares: pick(shares, 'shares'),
    interactions: pick(interactions, 'interactions'),
    views: views != null ? { value: views, source: 'conta' } : null,
    followers: { value: prof.followers_count ?? null },
    followers_gained: followersGained == null ? null : { value: followersGained, new: followersNew, lost: followersLost, source: followersSource },
    posts: { value: posts.length },
  };
  totals.engagement = totals.reach.value ? { value: +(100 * totals.interactions.value / totals.reach.value).toFixed(2) } : null;

  // Melhores posts: mais interações (curtidas + comentários + salvamentos + compartilhamentos), desempate pelo alcance.
  const ranked = [...posts].sort((a, b) => b.interactions - a.interactions || (b.reach ?? 0) - (a.reach ?? 0));
  const topIds = new Set(ranked.slice(0, 3).map((p) => p.id));
  await pool(ranked.slice(0, 3), 3, async (p) => { p.image = await keepImage(client.id, month, p._m, own); });
  for (const p of posts) { if (!topIds.has(p.id)) p.image = own.find((o) => o.ig_media_id === p.id)?.image_url || null; delete p._m; }

  return {
    month, client_name: client.name, ig_username: prof.username || client.ig_username,
    period: { start: new Date(start).toISOString(), end: new Date(end).toISOString(), partial: end < monthStart(shiftMonth(month, 1), tz) },
    totals, top: ranked.slice(0, 3).map((p) => p.id), posts: posts.sort((a, b) => a.timestamp.localeCompare(b.timestamp)),
    formats: formatBreakdown(posts),
    // melhores horários: últimos 4 meses de posts do perfil (curtidas + comentários por dia/hora)
    best_times: await bestTimes(client.id, { now, tz }).then((b) => ({ source: b.source, based_on: b.based_on, slots: b.slots })).catch(() => null),
    warnings, generated_at: new Date(now).toISOString(),
  };
}

// Gera (ou atualiza) e grava. Mantém o link e as observações se já existia.
export async function saveReport(client, month, opts) {
  const data = await buildReport(client, month, opts);
  const prev = await db.one('reports', { select: 'data', client_id: `eq.${client.id}`, ref_month: `eq.${shiftMonth(month, -1)}` }).catch(() => null);
  if (prev?.data?.totals) data.previous = summary(prev.data);
  data.next_steps = nextSteps(data, { tz: opts?.tz || TIMEZONE() });
  const old = await db.one('reports', { select: 'id,share_token,data', client_id: `eq.${client.id}`, ref_month: `eq.${month}` });
  if (old?.data?.next_steps_custom) data.next_steps_custom = old.data.next_steps_custom; // o que a agência escreveu não se perde ao atualizar
  const now = new Date().toISOString();
  if (old) {
    const [row] = await db.update('reports', { id: `eq.${old.id}` }, { data, updated_at: now });
    return row;
  }
  return db.insert('reports', { client_id: client.id, ref_month: month, data, share_token: crypto.randomBytes(18).toString('hex'), updated_at: now });
}

// Números principais (para comparar com o mês anterior e para a lista do painel).
export function summary(d) {
  const t = d.totals || {};
  return {
    reach: t.reach?.value ?? null, likes: t.likes?.value ?? null, comments: t.comments?.value ?? null, saves: t.saves?.value ?? null,
    shares: t.shares?.value ?? null, interactions: t.interactions?.value ?? null, followers_gained: t.followers_gained?.value ?? null,
    followers: t.followers?.value ?? null, posts: t.posts?.value ?? null, engagement: t.engagement?.value ?? null,
  };
}

// Agendador: no dia 3 de cada mês (o Instagram atrasa até 48h) gera o relatório do mês anterior
// de cada cliente conectado. Um por execução, para caber no tempo.
export async function autoReports({ now = Date.now(), tz = TIMEZONE() } = {}) {
  const day = Number(new Intl.DateTimeFormat('en-CA', { timeZone: tz, day: '2-digit' }).format(now));
  if (day < 3) return null;
  const month = shiftMonth(currentMonth(tz, now), -1);
  const clients = await db.select('clients', { select: '*', ig_token: 'not.is.null' });
  const done = new Set((await db.select('reports', { select: 'client_id', ref_month: `eq.${month}` })).map((r) => r.client_id));
  const failedKey = `reports_failed_${month}`;
  const failed = (await db.one('app_state', { select: 'value', key: `eq.${failedKey}` }).catch(() => null))?.value || {};
  const c = clients.find((x) => !done.has(x.id) && !failed[x.id] && new Date(x.ig_connected_at || 0).getTime() < monthStart(currentMonth(tz, now), tz));
  if (!c) return null;
  try { await saveReport(c, month, { now, tz }); return { generated: c.name, month }; }
  catch (e) {
    failed[c.id] = e.message.slice(0, 200); // não tenta de novo a cada 5 min; a agência gera na mão depois de reconectar
    await db.upsert('app_state', { key: failedKey, value: failed, updated_at: new Date().toISOString() });
    return { failed: c.name, error: e.message };
  }
}

// Uma vez por dia guarda o número de seguidores de cada cliente (base para "seguidores ganhos").
export async function snapshotFollowers({ now = Date.now(), tz = TIMEZONE() } = {}) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(now);
  const st = await db.one('app_state', { select: 'value', key: 'eq.followers_snapshot' });
  if (st?.value?.day === today) return null;
  const clients = await db.select('clients', { select: 'id,ig_token', ig_token: 'not.is.null' });
  let n = 0;
  for (const c of clients) {
    try { const p = await ig.profile(c.ig_token); if (p.followers_count != null) { await db.upsert('ig_daily', { client_id: c.id, day: today, followers: p.followers_count }); n++; } }
    catch { /* token inválido: segue com os outros */ }
  }
  await db.upsert('app_state', { key: 'followers_snapshot', value: { day: today, count: n }, updated_at: new Date().toISOString() });
  return n;
}
