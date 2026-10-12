// Controle de mensalidades. GET ?client= | PUT (marca o mês) | DELETE ?client=&month= (volta a "em aberto")
import { route, send, readJson, query, need } from '../http.js';
import { requireAdmin } from '../auth.js';
import { db } from '../db.js';
import { cancelCharge } from '../asaas.js';

const isMonth = (m) => /^\d{4}-(0[1-9]|1[0-2])$/.test(m || '');

export default route({
  GET: async (req, res) => {
    await requireAdmin(req);
    const { client } = query(req);
    const params = { select: '*', order: 'ref_month.desc', limit: 1000 };
    if (client) params.client_id = `eq.${client}`;
    send(res, 200, await db.select('payments', params));
  },

  PUT: async (req, res) => {
    await requireAdmin(req);
    const b = await readJson(req);
    // Em lote: marcar várias parcelas como pagas/isentas de uma vez (ex.: meses antigos ao cadastrar um cliente)
    if (Array.isArray(b.items)) {
      need(b.client_id && b.items.length <= 500, 400, 'Lote inválido.');
      need(['paid', 'waived'].includes(b.status), 400, 'Situação inválida.');
      const now = new Date().toISOString();
      const rows = b.items.filter((i) => isMonth(i.ref_month)).map((i) => ({
        client_id: b.client_id, ref_month: i.ref_month, installment: Number(i.installment) || 1, status: b.status,
        amount_cents: i.amount_cents == null ? null : Math.round(Number(i.amount_cents)), paid_at: null, file_id: null, note: b.note ? String(b.note).slice(0, 500) : null, updated_at: now,
      }));
      if (rows.length) await db.upsert('payments', rows);
      return send(res, 200, rows);
    }
    need(b.client_id, 400, 'Cliente não informado.');
    need(isMonth(b.ref_month), 400, 'Mês inválido.');
    need(['paid', 'pending', 'waived'].includes(b.status || 'paid'), 400, 'Situação inválida.');
    const cents = b.amount_cents == null || b.amount_cents === '' ? null : Math.round(Number(b.amount_cents));
    need(cents === null || (Number.isFinite(cents) && cents >= 0), 400, 'Valor inválido.');
    need(!b.paid_at || /^\d{4}-\d{2}-\d{2}$/.test(b.paid_at), 400, 'Data de pagamento inválida.');
    const n = b.installment == null ? 1 : Number(b.installment);
    need(Number.isInteger(n) && n >= 1 && n <= 12, 400, 'Parcela inválida.');
    const row = {
      client_id: b.client_id, ref_month: b.ref_month, status: b.status || 'paid', amount_cents: cents,
      paid_at: b.paid_at || null, file_id: b.file_id || null, note: b.note ? String(b.note).slice(0, 500) : null,
      updated_at: new Date().toISOString(),
    };
    // Tinha um Pix automático em aberto e a agência deu baixa na mão: cancela a cobrança no Asaas
    const prev = await db.one('payments', { select: '*', client_id: `eq.${b.client_id}`, ref_month: `eq.${b.ref_month}`, ...(b.installment != null ? { installment: `eq.${n}` } : {}) }).catch(() => null);
    if (prev?.asaas_id && prev.status === 'pending') { await cancelCharge(prev.asaas_id); Object.assign(row, { asaas_id: null, pix_payload: null, pix_url: null }); }
    if (n > 1) row.installment = n; // parcela 1 = padrão (funciona também antes da atualização 6 do banco)
    else if (b.installment != null) row.installment = 1;
    await db.upsert('payments', row);
    send(res, 200, row);
  },

  DELETE: async (req, res) => {
    await requireAdmin(req);
    const { client, month, n } = query(req);
    need(client && isMonth(month), 400, 'Informe cliente e mês.');
    const f = { client_id: `eq.${client}`, ref_month: `eq.${month}` };
    if (n) f.installment = `eq.${Number(n)}`;
    const removed = await db.remove('payments', f);
    for (const r of removed || []) if (r.asaas_id && r.status === 'pending') await cancelCharge(r.asaas_id);
    send(res, 200, { ok: true });
  },
});
