// Controle de mensalidades. GET ?client= | PUT (marca o mês) | DELETE ?client=&month= (volta a "em aberto")
import { route, send, readJson, query, need } from '../http.js';
import { requireAdmin } from '../auth.js';
import { db } from '../db.js';

const isMonth = (m) => /^\d{4}-(0[1-9]|1[0-2])$/.test(m || '');

export default route({
  GET: async (req, res) => {
    requireAdmin(req);
    const { client } = query(req);
    const params = { select: '*', order: 'ref_month.desc', limit: 1000 };
    if (client) params.client_id = `eq.${client}`;
    send(res, 200, await db.select('payments', params));
  },

  PUT: async (req, res) => {
    requireAdmin(req);
    const b = await readJson(req);
    need(b.client_id, 400, 'Cliente não informado.');
    need(isMonth(b.ref_month), 400, 'Mês inválido.');
    need(['paid', 'pending', 'waived'].includes(b.status || 'paid'), 400, 'Situação inválida.');
    const cents = b.amount_cents == null || b.amount_cents === '' ? null : Math.round(Number(b.amount_cents));
    need(cents === null || (Number.isFinite(cents) && cents >= 0), 400, 'Valor inválido.');
    need(!b.paid_at || /^\d{4}-\d{2}-\d{2}$/.test(b.paid_at), 400, 'Data de pagamento inválida.');
    const row = {
      client_id: b.client_id, ref_month: b.ref_month, status: b.status || 'paid', amount_cents: cents,
      paid_at: b.paid_at || null, file_id: b.file_id || null, note: b.note ? String(b.note).slice(0, 500) : null,
      updated_at: new Date().toISOString(),
    };
    await db.upsert('payments', row);
    send(res, 200, row);
  },

  DELETE: async (req, res) => {
    requireAdmin(req);
    const { client, month } = query(req);
    need(client && isMonth(month), 400, 'Informe cliente e mês.');
    await db.remove('payments', { client_id: `eq.${client}`, ref_month: `eq.${month}` });
    send(res, 200, { ok: true });
  },
});
