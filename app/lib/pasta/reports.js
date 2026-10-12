// Relatórios mensais. Agência: GET ?client= lista | POST {client_id, ref_month} gera/atualiza
// | PATCH {id, note} observações | DELETE ?id=.  Público (cliente): rota "report" com ?t=token.
import { route, send, readJson, query, need } from '../http.js';
import { requireAdmin } from '../auth.js';
import { db } from '../db.js';
import { appUrl } from '../env.js';
import { saveReport, summary, isMonth } from '../reports.js';

const shareUrl = (t) => `${appUrl()}/relatorio?t=${t}`;
const listItem = (r) => ({
  id: r.id, client_id: r.client_id, ref_month: r.ref_month, note: r.note, created_at: r.created_at, updated_at: r.updated_at,
  share_url: shareUrl(r.share_token), summary: summary(r.data || {}), partial: Boolean(r.data?.period?.partial), warnings: r.data?.warnings || [],
});

export default route({
  GET: async (req, res) => {
    requireAdmin(req);
    const { client } = query(req);
    const params = { select: '*', order: 'ref_month.desc', limit: 200 };
    if (client) params.client_id = `eq.${client}`;
    send(res, 200, (await db.select('reports', params)).map(listItem));
  },
  POST: async (req, res) => {
    requireAdmin(req);
    const b = await readJson(req);
    need(isMonth(b.ref_month), 400, 'Escolha o mês do relatório.');
    const client = await db.one('clients', { select: '*', id: `eq.${b.client_id}` });
    need(client, 404, 'Cliente não encontrado.');
    const row = await saveReport(client, b.ref_month);
    send(res, 200, listItem(row));
  },
  PATCH: async (req, res) => {
    requireAdmin(req);
    const b = await readJson(req);
    need(b.id, 400, 'Relatório não informado.');
    const [row] = await db.update('reports', { id: `eq.${b.id}` }, { note: String(b.note || '').trim().slice(0, 3000) || null });
    need(row, 404, 'Relatório não encontrado.');
    send(res, 200, listItem(row));
  },
  DELETE: async (req, res) => {
    requireAdmin(req);
    const { id } = query(req);
    need(id, 400, 'Relatório não informado.');
    await db.remove('reports', { id: `eq.${id}` });
    send(res, 200, { ok: true });
  },
});

// Página pública do relatório (o link que vai para o cliente). Só leitura, sem dados internos.
export const publicReport = route({
  GET: async (req, res) => {
    const { t } = query(req);
    need(t && /^[a-f0-9]{20,64}$/.test(t), 404, 'Relatório não encontrado.');
    const r = await db.one('reports', { select: 'ref_month,data,note,updated_at', share_token: `eq.${t}` });
    need(r, 404, 'Relatório não encontrado. Peça um link novo para a agência.');
    send(res, 200, { ref_month: r.ref_month, data: r.data, note: r.note, updated_at: r.updated_at });
  },
});
