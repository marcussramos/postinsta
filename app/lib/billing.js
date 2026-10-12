// Situação das mensalidades mês a mês (mesma regra do painel): paid | waived | open (no prazo) | late (venceu).
import { TIMEZONE } from './env.js';

const next = (m) => { const [y, mo] = m.split('-').map(Number); const d = new Date(Date.UTC(y, mo, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`; };

export function billingMonths(client, payments, { now = Date.now(), tz = TIMEZONE() } = {}) {
  if (!client.billing_start) return [];
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(now);
  const cur = today.slice(0, 7);
  const pays = new Map(payments.map((p) => [p.ref_month, p]));
  let last = cur; for (const k of pays.keys()) if (k > last) last = k;
  const out = [];
  for (let m = client.billing_start.slice(0, 7); m <= last && out.length < 240; m = next(m)) {
    const [y, mo] = m.split('-').map(Number);
    const lastDay = new Date(Date.UTC(y, mo, 0)).getUTCDate();
    const due = `${m}-${String(Math.min(client.due_day || lastDay, lastDay)).padStart(2, '0')}`;
    const p = pays.get(m) || null;
    const status = p?.status === 'paid' ? 'paid' : p?.status === 'waived' ? 'waived' : today > due ? 'late' : 'open';
    out.push({ month: m, due, status, payment: p });
  }
  return out.reverse();
}
