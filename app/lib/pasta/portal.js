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
import { appUrl } from '../env.js';
import { billingMonths } from '../billing.js';
import { summary } from '../reports.js';
import { loadSettings } from './settings.js';
import { notify } from '../push.js';

const VISIBLE = ['contract', 'receipt', 'report', 'briefing', 'invoice']; // "Outros" e "Marca" ficam só para a agência
const UPLOAD_TYPES = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic', mp4: 'video/mp4', mov: 'video/quicktime' };
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
    if (q.file) {
      const f = await db.one('client_files', { select: 'path,name,category,client_id', id: `eq.${q.file}` });
      need(f && f.client_id === c.id && VISIBLE.includes(f.category), 404, 'Arquivo não encontrado.');
      return redirect(res, await docs.signedUrl(f.path, { expiresIn: 120, downloadName: q.download ? f.name : undefined }), { 'Cache-Control': 'no-store' });
    }
    const [files, payments, reports, pending, settings, events, requests, deliv] = await Promise.all([
      db.select('client_files', { select: 'id,category,name,mime,size,ref_month,created_at', client_id: `eq.${c.id}`, category: `in.(${VISIBLE.join(',')})`, order: 'created_at.desc', limit: 500 }),
      db.select('payments', { select: '*', client_id: `eq.${c.id}` }),
      db.select('reports', { select: 'ref_month,data,share_token,updated_at', client_id: `eq.${c.id}`, order: 'ref_month.desc', limit: 60 }).catch(() => []),
      db.select('posts', { select: 'id', client_id: `eq.${c.id}`, status: 'eq.pending_approval' }).catch(() => []),
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
      approval: { url: `${appUrl()}/aprovar?t=${c.approval_token}`, pending: pending.length },
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
});
