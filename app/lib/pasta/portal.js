// Área do cliente (pública, por link secreto): só os dados DESTE cliente —
// contrato(s), relatórios e financeiro. Nada sobre outros clientes, nada interno.
// GET ?t=token            → dados da área
// GET ?t=token&file=ID    → abre o arquivo (link temporário) se ele for deste cliente e de uma seção liberada
import { route, send, query, need, redirect } from '../http.js';
import { db, docs } from '../db.js';
import { appUrl } from '../env.js';
import { billingMonths } from '../billing.js';
import { summary } from '../reports.js';
import { loadSettings } from './settings.js';

const VISIBLE = ['contract', 'receipt', 'report']; // "Outros" fica só para a agência
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
    const [files, payments, reports, pending, settings] = await Promise.all([
      db.select('client_files', { select: 'id,category,name,mime,size,ref_month,created_at', client_id: `eq.${c.id}`, category: `in.(${VISIBLE.join(',')})`, order: 'created_at.desc', limit: 500 }),
      db.select('payments', { select: 'ref_month,status,amount_cents,paid_at,file_id', client_id: `eq.${c.id}` }),
      db.select('reports', { select: 'ref_month,data,share_token,updated_at', client_id: `eq.${c.id}`, order: 'ref_month.desc', limit: 60 }).catch(() => []),
      db.select('posts', { select: 'id', client_id: `eq.${c.id}`, status: 'eq.pending_approval' }).catch(() => []),
      loadSettings(),
    ]);
    const months = billingMonths(c, payments).map(({ month, due, status, payment: p }) => ({
      month, due, status, amount_cents: p?.amount_cents ?? c.monthly_fee_cents, paid_at: p?.paid_at || null,
      receipt_id: p?.file_id && files.some((f) => f.id === p.file_id) ? p.file_id : null,
    }));
    const a = settings.agency || {};
    send(res, 200, {
      client: { name: c.contract_data?.nome || c.name, ig_username: c.ig_username || null },
      agency: { marca: a.marca || 'MC DIGITAL', slogan: a.slogan || '', pix: a.pix || '', email: a.email || '' },
      billing: c.billing_start ? { monthly_fee_cents: c.monthly_fee_cents, due_day: c.due_day, months } : null,
      files,
      reports: reports.map((r) => ({ ref_month: r.ref_month, url: `${appUrl()}/relatorio?t=${r.share_token}`, summary: summary(r.data || {}), partial: Boolean(r.data?.period?.partial), updated_at: r.updated_at })),
      approval: { url: `${appUrl()}/aprovar?t=${c.approval_token}`, pending: pending.length },
    }, { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' });
  },
});
