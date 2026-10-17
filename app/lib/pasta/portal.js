// Área do cliente (pública, por link secreto): só os dados DESTE cliente —
// contrato(s), relatórios e financeiro. Nada sobre outros clientes, nada interno.
// GET ?t=token            → dados da área
// GET ?t=token&file=ID    → abre o arquivo (link temporário) se ele for deste cliente e de uma seção liberada
import crypto from 'node:crypto';
import { route, send, query, need, redirect, readRaw, readJson } from '../http.js';
import { deliveries } from '../deliveries.js';
import { currentMonth } from '../reports.js';
import { asaasReady, ensureCharge } from '../asaas.js';
import { db, docs } from '../db.js';
import { appUrl, TIMEZONE } from '../env.js';
import { zonedISO } from '../planner.js';
import { billingMonths } from '../billing.js';
import { summary } from '../reports.js';
import { loadSettings } from './settings.js';
import { notify } from '../push.js';
import { getState, setState } from '../appstate.js';
import { logEvent } from '../events.js';
import { requirePerm, needClient } from '../auth.js';

const VISIBLE = ['contract', 'receipt', 'report', 'briefing', 'invoice']; // "Outros" e "Marca" ficam só para a agência
const UPLOAD_TYPES = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic', mp4: 'video/mp4', mov: 'video/quicktime' };
// Calendário do cliente: só datas, formato, título e situação. Prévia da arte só depois que vai para aprovação.
const CAL_GROUP = { idea: 'producao', draft: 'producao', internal_review: 'producao', changes_requested: 'ajuste', failed: 'producao', pending_approval: 'aprovar', approved: 'programado', publishing: 'programado', published: 'publicado' };
// Cliente reorganiza o calendário (liga/desliga por cliente na agência): move posts com 48h de antecedência
// e sugere ideias (entram como "ideia", não contam na cota, e só ele apaga as que ele mesmo sugeriu).
export const LEAD_MS = 48 * 3600e3;
export const CLIENT_IDEA = '💡 Ideia sugerida pelo cliente';
const FIXED = ['published', 'publishing'];
export async function portalEditable(clientId) { const list = await getState('portal_edit', []); return Array.isArray(list) && list.includes(clientId); }
const isMine = (p) => p.status === 'idea' && String(p.notes || '').startsWith(CLIENT_IDEA);
const canMove = (p, now = Date.now()) => !FIXED.includes(p.status) && p.scheduled_at && new Date(p.scheduled_at).getTime() - now >= LEAD_MS;
const dayLabel = (iso, tz) => new Intl.DateTimeFormat('pt-BR', { timeZone: tz, day: '2-digit', month: '2-digit' }).format(new Date(iso));
async function calendar(c, month, editable = false) {
  need(/^\d{4}-(0[1-9]|1[0-2])$/.test(month || ''), 400, 'Mês inválido.');
  const [y, m] = month.split('-').map(Number);
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  const tz = TIMEZONE();
  const rows = await db.select('posts', { select: '*', client_id: `eq.${c.id}`,
    and: `(scheduled_at.gte.${zonedISO(`${month}-01`, '00:00', tz)},scheduled_at.lt.${zonedISO(`${next}-01`, '00:00', tz)})`, order: 'scheduled_at.asc', limit: 200 });
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
  const hour = new Intl.DateTimeFormat('pt-BR', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  return rows.filter((p) => CAL_GROUP[p.status]).map((p) => {
    const at = new Date(p.scheduled_at);
    const art = true; // a capa aparece em qualquer etapa (inclusive em produção)
    return { id: p.id, day: day.format(at), time: hour.format(at), title: p.title || null, media_type: p.media_type || 'IMAGE', group: CAL_GROUP[p.status] === 'producao' && p.script?.status === 'sent' ? 'roteiro' : CAL_GROUP[p.status],
      image_url: art ? (p.image_url || p.media?.[0]?.url || null) : null, permalink: p.status === 'published' ? p.ig_permalink || null : null,
      ...(editable ? { can_move: canMove(p), mine: isMine(p) } : {}), ...(isMine(p) ? { group: 'sugestao' } : {}) };
  });
}

const okToken = (t) => typeof t === 'string' && /^[a-f0-9]{32,64}$/.test(t);

async function clientByToken(t) {
  need(okToken(t), 404, 'Link inválido. Peça um link novo para a agência.');
  const c = await db.one('clients', { select: '*', portal_token: `eq.${t}` });
  need(c, 404, 'Este link não está mais ativo. Peça um link novo para a agência.');
  return c;
}

export default route({
  GET: async (req, res) => {
    const q = query(req);
    const c = await clientByToken(q.t);
    if (q.cal) { const editable = await portalEditable(c.id); return send(res, 200, { month: q.cal, timezone: TIMEZONE(), editable, lead_hours: 48, posts: await calendar(c, q.cal, editable) }, { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' }); }
    if (q.file) {
      const f = await db.one('client_files', { select: 'path,name,category,client_id', id: `eq.${q.file}` });
      need(f && f.client_id === c.id && VISIBLE.includes(f.category), 404, 'Arquivo não encontrado.');
      return redirect(res, await docs.signedUrl(f.path, { expiresIn: 120, downloadName: q.download ? f.name : undefined }), { 'Cache-Control': 'no-store' });
    }
    const [files, payments, reports, pending, scriptsPending, settings, events, requests, deliv] = await Promise.all([
      db.select('client_files', { select: 'id,category,name,mime,size,ref_month,created_at', client_id: `eq.${c.id}`, category: `in.(${VISIBLE.join(',')})`, order: 'created_at.desc', limit: 500 }),
      db.select('payments', { select: '*', client_id: `eq.${c.id}` }),
      db.select('reports', { select: 'ref_month,data,share_token,updated_at', client_id: `eq.${c.id}`, order: 'ref_month.desc', limit: 60 }).catch(() => []),
      db.select('posts', { select: 'id', client_id: `eq.${c.id}`, status: 'eq.pending_approval' }).catch(() => []),
      db.select('posts', { select: 'id,script', client_id: `eq.${c.id}`, script: 'not.is.null', limit: 200 }).then((r) => r.filter((p) => p.script?.status === 'sent')).catch(() => []),
      loadSettings(),
      db.select('post_events', { select: 'type,note,snapshot,created_at', client_id: `eq.${c.id}`, order: 'created_at.desc', limit: 500 }).catch(() => []),
      db.select('requests', { select: 'id,text,wanted_date,status,file_ids,created_at', client_id: `eq.${c.id}`, order: 'created_at.desc', limit: 100 }).catch(() => []),
      deliveries(currentMonth(), { clientId: c.id }).catch(() => ({})),
    ]);
    const months = billingMonths(c, payments).map((m) => ({
      month: m.month, due: m.due, status: m.status, amount_cents: m.amount_cents, open_cents: m.open_cents, late_cents: m.late_cents,
      parcels: m.parcels.map((p) => ({
        n: p.n, of: p.of, due: p.due, cents: p.cents, status: p.status, paid_at: p.payment?.paid_at || null, receipt_url: p.payment?.receipt_url || null,
        receipt_id: p.payment?.file_id && files.some((f) => f.id === p.payment.file_id) ? p.payment.file_id : null,
      })),
    }));
    const a = settings.agency || {};
    send(res, 200, {
      client: { name: c.contract_data?.nome || c.name, ig_username: c.ig_username || null },
      agency: { marca: a.marca || 'MC DIGITAL', slogan: a.slogan || '', pix: a.pix || '', email: a.email || '' },
      billing: c.billing_start ? { monthly_fee_cents: c.monthly_fee_cents, due_day: c.due_day, months } : null,
      files,
      reports: reports.map((r) => ({ ref_month: r.ref_month, url: `${appUrl()}/relatorio?t=${r.share_token}`, summary: summary(r.data || {}), partial: Boolean(r.data?.period?.partial), updated_at: r.updated_at })),
      approval: { url: `${appUrl()}/aprovar?t=${c.approval_token}`, pending: pending.length + scriptsPending.length, scripts: scriptsPending.length },
      history: events.map((e) => ({ type: e.type, note: e.note, at: e.created_at, title: e.snapshot?.title || null, caption: e.snapshot?.caption || '', scheduled_at: e.snapshot?.scheduled_at || null, media_type: e.snapshot?.media_type || 'IMAGE', image_url: e.snapshot?.image_url || null, permalink: e.snapshot?.permalink || null })),
      requests: requests.map((r) => ({ ...r, files: (r.file_ids || []).map((id) => files.find((f) => f.id === id)).filter(Boolean) })),
      deliveries: deliv[c.id] || null,
      pix_enabled: asaasReady(),
      onboarding: { url: `${appUrl()}/boasvindas?t=${c.portal_token}`, done: Boolean(c.brand_kit?.onboarding?.submitted_at) },
    }, { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' });
  },

  // Pedidos do cliente: ?t&upload=1 (corpo = arquivo, nome em x-file-name) envia um anexo;
  // ?t (JSON {text, wanted_date, file_ids}) cria o pedido.
  POST: async (req, res) => {
    const q = query(req);
    const c = await clientByToken(q.t);
    if (q.move || q.idea) {
      need(await portalEditable(c.id), 403, 'A edição do calendário não está liberada. Fale com a agência.');
      const b = await readJson(req);
      const tz = TIMEZONE();
      need(/^\d{4}-\d{2}-\d{2}$/.test(String(b.day || '')), 400, 'Escolha o dia.');
      if (q.move) {
        const p = await db.one('posts', { select: '*', id: `eq.${String(b.id || '')}`, client_id: `eq.${c.id}` }).catch(() => null);
        need(p, 404, 'Post não encontrado.');
        need(!FIXED.includes(p.status), 409, 'Esse post já foi publicado.');
        need(canMove(p), 409, 'Esse post sai em menos de 48h e já está travado. Para mudar, fale com a agência em Pedidos.');
        const hhmm = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(p.scheduled_at));
        const at = zonedISO(b.day, hhmm, tz);
        need(new Date(at).getTime() - Date.now() >= LEAD_MS, 409, 'Esse dia está perto demais: a agência precisa de pelo menos 48h. Escolha outro dia.');
        if (new Date(at).getTime() === new Date(p.scheduled_at).getTime()) return send(res, 200, { id: p.id, scheduled_at: p.scheduled_at });
        const [row] = await db.update('posts', { id: `eq.${p.id}`, client_id: `eq.${c.id}` }, { scheduled_at: at });
        const note = `de ${dayLabel(p.scheduled_at, tz)} para ${dayLabel(at, tz)}`;
        await logEvent(row, 'client_moved', note);
        await notify({ title: `📅 ${c.name} mudou um post de dia`, body: `${row.title || 'Post'}: ${note}`, url: '/#fluxo', tag: `move-${row.id}` }).catch(() => {});
        return send(res, 200, { id: row.id, scheduled_at: row.scheduled_at });
      }
      const title = String(b.title || '').trim().slice(0, 120);
      need(title.length >= 3, 400, 'Escreva a ideia.');
      const media_type = ['IMAGE', 'CAROUSEL', 'REELS', 'STORY'].includes(b.media_type) ? b.media_type : 'IMAGE';
      const at = zonedISO(b.day, '19:00', tz);
      need(new Date(at).getTime() - Date.now() >= LEAD_MS, 409, 'Esse dia está perto demais: a agência precisa de pelo menos 48h. Escolha outro dia.');
      const open = await db.select('posts', { select: 'id,notes', client_id: `eq.${c.id}`, status: 'eq.idea' });
      need(open.filter(isMine).length < 30, 429, 'Você já tem muitas ideias aguardando. Espere a agência responder.');
      const details = String(b.details || '').trim().slice(0, 1500);
      const today = new Intl.DateTimeFormat('pt-BR', { timeZone: tz, day: '2-digit', month: '2-digit' }).format(new Date());
      const row = await db.insert('posts', { client_id: c.id, status: 'idea', title, media_type, scheduled_at: at, caption: '',
        notes: `${CLIENT_IDEA} em ${today} pela área do cliente.${details ? `\n${details}` : ''}` });
      await logEvent(row, 'client_idea', details || null);
      await notify({ title: `💡 ${c.name} sugeriu uma ideia`, body: `${title} · ${dayLabel(at, tz)}`, url: '/#fluxo', tag: `idea-${row.id}` }).catch(() => {});
      return send(res, 201, { id: row.id });
    }
    if (q.pix) { // o cliente pede o Pix de uma parcela em aberto
      need(asaasReady(), 404, 'Pagamento por Pix indisponível. Fale com a agência.');
      const b = await readJson(req);
      const out = await ensureCharge(c, String(b.month || ''), Number(b.n) || 1);
      return send(res, 200, { payload: out.payload, image: out.image, value_cents: out.value_cents, due: out.due, label: out.label });
    }
    if (q.upload) {
      const name = decodeURIComponent(String(req.headers['x-file-name'] || 'arquivo')).slice(0, 150);
      const ext = (name.split('.').pop() || '').toLowerCase();
      need(UPLOAD_TYPES[ext], 415, 'Envie foto (JPG, PNG, HEIC), vídeo curto (MP4/MOV) ou PDF.');
      const today = new Date(Date.now() - 864e5).toISOString();
      const recent = await db.select('client_files', { select: 'id', client_id: `eq.${c.id}`, category: 'eq.briefing', created_at: `gte.${today}` });
      need(recent.length < 40, 429, 'Muitos arquivos enviados hoje. Tente amanhã ou fale com a agência.');
      const buf = await readRaw(req);
      need(buf.length > 0, 400, 'Arquivo vazio.');
      need(buf.length <= 4 * 1024 * 1024, 413, 'Arquivo grande demais (máx. 4 MB). Para vídeos maiores, mande pelo WhatsApp.');
      if (ext === 'pdf') need(buf.subarray(0, 4).toString() === '%PDF', 415, 'Esse arquivo não parece ser um PDF válido.');
      const safe = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w.\- ]+/g, '').replace(/\s+/g, '-').slice(-80) || 'arquivo';
      const path = `${c.id}/briefing/${Date.now()}-${crypto.randomBytes(4).toString('hex')}-${safe}`;
      await docs.upload(path, buf, UPLOAD_TYPES[ext]);
      const row = await db.insert('client_files', { client_id: c.id, category: 'briefing', name, path, mime: UPLOAD_TYPES[ext], size: buf.length });
      return send(res, 201, { id: row.id, name: row.name, size: row.size, mime: row.mime });
    }
    const b = await readJson(req);
    const text = String(b.text || '').trim().slice(0, 3000);
    need(text.length >= 3, 400, 'Escreva o que você precisa.');
    need(!b.wanted_date || /^\d{4}-\d{2}-\d{2}$/.test(b.wanted_date), 400, 'Data inválida.');
    const ids = (Array.isArray(b.file_ids) ? b.file_ids : []).slice(0, 10).map(String);
    if (ids.length) {
      const own = await db.select('client_files', { select: 'id', client_id: `eq.${c.id}`, category: 'eq.briefing', id: `in.(${ids.join(',')})` });
      need(own.length === ids.length, 400, 'Anexo inválido.');
    }
    const open = await db.select('requests', { select: 'id', client_id: `eq.${c.id}`, status: 'neq.done' });
    need(open.length < 50, 429, 'Você tem muitos pedidos em aberto. Aguarde a agência responder.');
    const row = await db.insert('requests', { client_id: c.id, text, wanted_date: b.wanted_date || null, file_ids: ids, status: 'open' });
    await notify({ title: `📩 Pedido novo de ${c.name}`, body: text.slice(0, 160), url: `/#pasta/${c.id}`, tag: `req-${row.id}` });
    send(res, 201, { id: row.id, text: row.text, wanted_date: row.wanted_date, status: row.status, created_at: row.created_at });
  },

  // O cliente apaga só a ideia que ele mesmo sugeriu, enquanto ela ainda é ideia
  DELETE: async (req, res) => {
    const q = query(req);
    const c = await clientByToken(q.t);
    need(await portalEditable(c.id), 403, 'A edição do calendário não está liberada. Fale com a agência.');
    const p = await db.one('posts', { select: '*', id: `eq.${String(q.idea || '')}`, client_id: `eq.${c.id}` }).catch(() => null);
    need(p && isMine(p), 404, 'Só dá para apagar as ideias que você sugeriu e que a agência ainda não começou a produzir.');
    await logEvent(p, 'client_idea_removed');
    await db.remove('posts', { id: `eq.${p.id}`, client_id: `eq.${c.id}` });
    send(res, 200, { ok: true });
  },
});

// Agência liga/desliga, por cliente, a edição do calendário pela área do cliente
export const portalEditRoute = route({
  GET: async (req, res) => {
    await requirePerm(req, 'conteudo', 'financeiro');
    const list = await getState('portal_edit', []);
    send(res, 200, { clients: Array.isArray(list) ? list : [] });
  },
  PUT: async (req, res) => {
    const u = await requirePerm(req, 'conteudo', 'financeiro');
    const b = await readJson(req);
    need(b.client_id, 400, 'Cliente não informado.');
    needClient(u, b.client_id);
    const c = await db.one('clients', { select: 'id', id: `eq.${b.client_id}` });
    need(c, 404, 'Cliente não encontrado.');
    const cur = await getState('portal_edit', []);
    const set = new Set(Array.isArray(cur) ? cur : []);
    if (b.enabled) set.add(c.id); else set.delete(c.id);
    await setState('portal_edit', [...set]);
    send(res, 200, { client_id: c.id, enabled: Boolean(b.enabled) });
  },
});
