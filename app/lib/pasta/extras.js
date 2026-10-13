// Rotas da equipe/agência ligadas aos clientes (admin e equipe, salvo indicação):
//   deliveries  GET ?month=&client=      contador de entregas do mês
//   history     GET ?client=  (admin)    histórico de aprovações (prova)
//   brand       GET ?client= | PUT {client_id, brand_kit}   identidade da marca
//   requests    GET ?client= (ou todos abertos) | PATCH {id, status}   pedidos dos clientes
//   feed        GET ?client=             últimos posts do Instagram (prévia da grade)
//   besttime    GET ?client=             melhores horários para postar
import { route, send, readJson, query, need } from '../http.js';
import { requireStaff, requireAdmin } from '../auth.js';
import { db } from '../db.js';
import { deliveries } from '../deliveries.js';
import { currentMonth, isMonth } from '../reports.js';
import { recentFeed } from '../feed.js';
import { bestTimes } from '../besttime.js';
import { NICHES } from '../../public/dates.js';

export const deliveriesRoute = route({
  GET: async (req, res) => {
    await requireStaff(req);
    const q = query(req);
    need(!q.month || isMonth(q.month), 400, 'Mês inválido.');
    send(res, 200, await deliveries(q.month || currentMonth(), { clientId: q.client || undefined }));
  },
});

export const historyRoute = route({
  GET: async (req, res) => {
    await requireAdmin(req);
    const { client } = query(req);
    need(client, 400, 'Cliente não informado.');
    send(res, 200, await db.select('post_events', { select: 'id,post_id,type,note,snapshot,created_at', client_id: `eq.${client}`, order: 'created_at.desc', limit: 1000 }));
  },
});

const COLOR = /^#[0-9a-f]{6}$/i;
export function cleanBrandKit(b = {}) {
  const txt = (v, n) => String(v ?? '').trim().slice(0, n) || null;
  const colors = (Array.isArray(b.colors) ? b.colors : []).map((c) => String(c).trim()).filter((c) => COLOR.test(c)).slice(0, 8);
  return {
    colors, fonts: txt(b.fonts, 200), style: txt(b.style, 600), dos: txt(b.dos, 1000), donts: txt(b.donts, 1000),
    references: txt(b.references, 1500), notes: txt(b.notes, 2000), logo_file_id: b.logo_file_id ? String(b.logo_file_id) : null,
    niche: NICHES[b.niche] ? b.niche : null,
    inspirations: txt(b.inspirations, 2500), avoid: txt(b.avoid, 2500), competitors: txt(b.competitors, 2500), perception: txt(b.perception, 2500),
  };
}
export const brandRoute = route({
  GET: async (req, res) => {
    await requireStaff(req);
    const { client } = query(req);
    need(client, 400, 'Cliente não informado.');
    const c = await db.one('clients', { select: 'id,name,brand_voice,brand_kit', id: `eq.${client}` });
    need(c, 404, 'Cliente não encontrado.');
    const files = await db.select('client_files', { select: 'id,name,mime,size,created_at', client_id: `eq.${client}`, category: 'eq.brand', order: 'created_at.desc' }).catch(() => []);
    send(res, 200, { brand_voice: c.brand_voice, brand_kit: c.brand_kit || {}, files });
  },
  PUT: async (req, res) => {
    await requireStaff(req);
    const b = await readJson(req);
    need(b.client_id, 400, 'Cliente não informado.');
    const cur = await db.one('clients', { select: 'brand_kit', id: `eq.${b.client_id}` });
    need(cur, 404, 'Cliente não encontrado.');
    const patch = { brand_kit: { ...cleanBrandKit(b.brand_kit), onboarding: cur.brand_kit?.onboarding || undefined } }; // as respostas do questionário são do cliente: mantém
    if (b.brand_voice !== undefined) patch.brand_voice = String(b.brand_voice || '').trim().slice(0, 1500) || null;
    const [row] = await db.update('clients', { id: `eq.${b.client_id}` }, patch);
    need(row, 404, 'Cliente não encontrado.');
    send(res, 200, { brand_voice: row.brand_voice, brand_kit: row.brand_kit });
  },
});

export const requestsRoute = route({
  GET: async (req, res) => {
    await requireStaff(req);
    const { client, open } = query(req);
    const params = { select: '*', order: 'created_at.desc', limit: 300 };
    if (client) params.client_id = `eq.${client}`;
    if (open) params.status = 'neq.done';
    const rows = await db.select('requests', params);
    const ids = [...new Set(rows.flatMap((r) => r.file_ids || []))];
    const files = ids.length ? await db.select('client_files', { select: 'id,name,mime,size', id: `in.(${ids.join(',')})` }) : [];
    const byId = new Map(files.map((f) => [f.id, f]));
    send(res, 200, rows.map((r) => ({ ...r, files: (r.file_ids || []).map((id) => byId.get(id)).filter(Boolean) })));
  },
  PATCH: async (req, res) => {
    await requireStaff(req);
    const b = await readJson(req);
    need(b.id && ['open', 'doing', 'done'].includes(b.status), 400, 'Situação inválida.');
    const [row] = await db.update('requests', { id: `eq.${b.id}` }, { status: b.status, updated_at: new Date().toISOString() });
    need(row, 404, 'Pedido não encontrado.');
    send(res, 200, row);
  },
});

export const feedRoute = route({
  GET: async (req, res) => {
    await requireStaff(req);
    const { client } = query(req);
    const c = await db.one('clients', { select: 'id,ig_token,ig_user_id', id: `eq.${client}` });
    need(c, 404, 'Cliente não encontrado.');
    send(res, 200, await recentFeed(c).catch(() => []));
  },
});

export const besttimeRoute = route({
  GET: async (req, res) => {
    await requireStaff(req);
    const { client, refresh } = query(req);
    need(client, 400, 'Cliente não informado.');
    send(res, 200, await bestTimes(client, { refresh: Boolean(refresh) }));
  },
});
