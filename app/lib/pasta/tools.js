// Ferramentas de produção (admin e equipe):
//   plan       POST {client_id, month, extra}            planejamento do mês com IA (prévia)
//              POST {client_id, items, create: true}     cria as ideias escolhidas no Fluxo
//   snippets   GET ?client= | POST | PATCH {id} | DELETE ?id=    modelos de legenda e grupos de hashtags
//   media      GET ?client= | POST {client_id, url, path, name} | DELETE ?id=    banco de mídia do cliente
//   duplicate  POST {from, days, shift, client_id?}       duplica uma semana (ou período) de posts
import { route, send, readJson, query, need } from '../http.js';
import { requireStaff, requirePerm, needClient, seesClient } from '../auth.js';
import { db, storage } from '../db.js';
import { env, TIMEZONE } from '../env.js';
import { generatePlan, createPlanPosts, zonedISO } from '../planner.js';
import { isMonth } from '../reports.js';

const isDay = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d || '');
const addDays = (day, n) => new Date(new Date(`${day}T12:00:00Z`).getTime() + n * 864e5).toISOString().slice(0, 10);
const uuid = (v) => /^[0-9a-f-]{36}$/i.test(String(v || ''));

export const planRoute = route({
  POST: async (req, res) => {
    const u = await requirePerm(req, 'ia');
    const b = await readJson(req);
    need(uuid(b.client_id), 400, 'Escolha o cliente.');
    needClient(u, b.client_id);
    const c = await db.one('clients', { select: '*', id: `eq.${b.client_id}` });
    need(c, 404, 'Cliente não encontrado.');
    if (b.create) {
      need(Array.isArray(b.items) && b.items.length, 400, 'Escolha pelo menos uma ideia.');
      const rows = await createPlanPosts(c.id, b.items);
      return send(res, 201, rows);
    }
    need(isMonth(b.month), 400, 'Mês inválido.');
    send(res, 200, await generatePlan(c, b.month, String(b.extra || '').trim().slice(0, 800)));
  },
});

function cleanSnippet(b, partial = false) {
  const out = {};
  if (!partial || b.kind !== undefined) { need(['caption', 'hashtags'].includes(b.kind), 400, 'Tipo inválido.'); out.kind = b.kind; }
  if (!partial || b.name !== undefined) { out.name = String(b.name || '').trim().slice(0, 60); need(out.name, 400, 'Dê um nome ao modelo.'); }
  if (!partial || b.text !== undefined) {
    let t = String(b.text || '').trim().slice(0, 2200);
    if ((b.kind || 'caption') === 'hashtags') t = [...new Set(t.split(/[\s,]+/).filter(Boolean).map((x) => `#${x.replace(/^#+/, '')}`))].slice(0, 30).join(' ');
    need(t, 400, 'Escreva o texto do modelo.'); out.text = t;
  }
  if (b.client_id !== undefined) { need(b.client_id === null || b.client_id === '' || uuid(b.client_id), 400, 'Cliente inválido.'); out.client_id = b.client_id || null; }
  return out;
}

export const snippetsRoute = route({
  GET: async (req, res) => {
    const u = await requireStaff(req);
    const { client } = query(req);
    if (uuid(client)) needClient(u, client);
    const params = { select: '*', order: 'name.asc', limit: 300 };
    if (uuid(client)) params.or = `(client_id.eq.${client},client_id.is.null)`;
    send(res, 200, await db.select('snippets', params));
  },
  POST: async (req, res) => {
    const u = await requirePerm(req, 'marca', 'conteudo');
    const data = cleanSnippet(await readJson(req));
    if (data.client_id) needClient(u, data.client_id);
    const row = await db.insert('snippets', data);
    send(res, 201, row);
  },
  PATCH: async (req, res) => {
    const u = await requirePerm(req, 'marca', 'conteudo');
    const b = await readJson(req);
    need(uuid(b.id), 400, 'Modelo não informado.');
    const cur = await db.one('snippets', { select: 'kind', id: `eq.${b.id}` });
    need(cur, 404, 'Modelo não encontrado.');
    const [row] = await db.update('snippets', { id: `eq.${b.id}` }, cleanSnippet({ kind: cur.kind, ...b }, true));
    send(res, 200, row);
  },
  DELETE: async (req, res) => {
    const u = await requirePerm(req, 'marca', 'conteudo');
    const { id } = query(req);
    need(uuid(id), 400, 'Modelo não informado.');
    const own = await db.one('snippets', { select: 'client_id', id: `eq.${id}` });
    if (own?.client_id) needClient(u, own.client_id);
    await db.remove('snippets', { id: `eq.${id}` });
    send(res, 200, { ok: true });
  },
});

export const mediaRoute = route({
  GET: async (req, res) => {
    const u = await requirePerm(req, 'marca', 'conteudo');
    const { client } = query(req);
    need(uuid(client), 400, 'Cliente não informado.');
    needClient(u, client);
    send(res, 200, await db.select('media_bank', { select: '*', client_id: `eq.${client}`, order: 'created_at.desc', limit: 500 }));
  },
  POST: async (req, res) => {
    const u = await requirePerm(req, 'marca', 'conteudo');
    const b = await readJson(req);
    need(uuid(b.client_id), 400, 'Cliente não informado.');
    needClient(u, b.client_id);
    const prefix = `${env('SUPABASE_URL')}/storage/v1/object/public/posts/`;
    const items = (Array.isArray(b.items) ? b.items : [b]).slice(0, 30);
    const rows = [];
    for (const it of items) {
      need(String(it.url || '').startsWith(prefix), 400, 'Envie a imagem pelo app antes de guardar no banco.');
      rows.push(await db.insert('media_bank', { client_id: b.client_id, url: it.url, path: it.path || it.url.slice(prefix.length), name: String(it.name || '').slice(0, 150) || null }));
    }
    send(res, 201, Array.isArray(b.items) ? rows : rows[0]);
  },
  DELETE: async (req, res) => {
    const u = await requirePerm(req, 'marca', 'conteudo');
    const { id } = query(req);
    need(uuid(id), 400, 'Mídia não informada.');
    const own = await db.one('media_bank', { select: 'client_id', id: `eq.${id}` });
    if (own) needClient(u, own.client_id);
    const [row] = await db.remove('media_bank', { id: `eq.${id}` });
    need(row, 404, 'Mídia não encontrada.');
    if (row.path) { // só apaga o arquivo se nenhum post e nenhuma outra entrada do banco usa
      const inPost = await db.select('posts', { select: 'id', image_path: `eq.${row.path}`, limit: 1 }).catch(() => [1]);
      const inMedia = await db.select('posts', { select: 'id', media: `cs.${JSON.stringify([{ path: row.path }])}`, limit: 1 }).catch(() => [1]);
      const inBank = await db.select('media_bank', { select: 'id', path: `eq.${row.path}`, limit: 1 }).catch(() => [1]);
      if (!inPost.length && !inMedia.length && !inBank.length) await storage.remove(row.path);
    }
    send(res, 200, { ok: true });
  },
});

export const duplicateRoute = route({
  POST: async (req, res) => {
    const u = await requirePerm(req, 'conteudo');
    const b = await readJson(req);
    need(isDay(b.from), 400, 'Escolha o primeiro dia do período.');
    if (b.client_id) needClient(u, b.client_id);
    const days = Number(b.days ?? 7), shift = Number(b.shift ?? 7);
    need(Number.isInteger(days) && days >= 1 && days <= 31, 400, 'Período de 1 a 31 dias.');
    need(Number.isInteger(shift) && shift >= 1 && shift <= 366, 400, 'Escolha para quantos dias depois copiar.');
    const params = { select: '*', and: `(scheduled_at.gte.${zonedISO(b.from, '00:00', TIMEZONE())},scheduled_at.lt.${zonedISO(addDays(b.from, days), '00:00', TIMEZONE())})`, order: 'scheduled_at.asc', limit: 300 };
    if (b.client_id) { need(uuid(b.client_id), 400, 'Cliente inválido.'); params.client_id = `eq.${b.client_id}`; }
    const src = (await db.select('posts', params)).filter((p) => seesClient(u, p.client_id));
    need(src.length, 404, 'Não há posts nesse período para duplicar.');
    const rows = [];
    for (const p of src) {
      rows.push(await db.insert('posts', {
        client_id: p.client_id, status: p.status === 'idea' ? 'idea' : 'draft', title: p.title, notes: p.notes, caption: p.caption, alt_text: p.alt_text,
        image_url: p.image_url, image_path: p.image_path, media_type: p.media_type || 'IMAGE', media: p.media || null,
        scheduled_at: new Date(new Date(p.scheduled_at).getTime() + shift * 864e5).toISOString(),
      }));
    }
    send(res, 201, rows);
  },
});
