// Regras da mensalidade, usadas no painel, na área do cliente e no servidor (o mesmo arquivo).
// Uma mensalidade pode ser paga em parcelas: client.installments = [{ day: 4, cents: 43334 }, …].
// Sem parcelas: uma só, no dia do vencimento (ou no último dia do mês).

const nextMonth = (m) => { const [y, mo] = m.split('-').map(Number); const d = new Date(Date.UTC(y, mo, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`; };

// Plano de parcelas do cliente (sempre ao menos uma).
export function planOf(client) {
  const list = Array.isArray(client.installments) ? client.installments.filter((p) => p && p.day) : [];
  if (list.length) return list.map((p, i) => ({ n: i + 1, day: Number(p.day), cents: p.cents == null ? null : Number(p.cents) }));
  return [{ n: 1, day: client.due_day || null, cents: client.monthly_fee_cents ?? null }];
}

// Divide o valor em n parcelas iguais; a primeira leva os centavos que sobram (ex.: 1300 → 433,34 + 433,33 + 433,33).
export function splitCents(total, n) {
  const base = Math.floor(total / n), rest = total - base * n;
  return Array.from({ length: n }, (_, i) => base + (i === 0 ? rest : 0));
}

// Meses desde o início da cobrança (mais novo primeiro). Cada mês tem as parcelas e um status geral:
// paid (tudo pago) | waived (isento) | late (alguma parcela vencida) | open (no prazo).
export function billingMonths(client, payments, today) {
  if (!client.billing_start) return [];
  const cur = today.slice(0, 7);
  const plan = planOf(client);
  const pays = new Map(payments.filter((p) => !p.client_id || p.client_id === client.id).map((p) => [`${p.ref_month}#${p.installment || 1}`, p]));
  let last = cur; for (const p of payments) if ((!p.client_id || p.client_id === client.id) && p.ref_month > last) last = p.ref_month;
  const out = [];
  for (let m = client.billing_start.slice(0, 7); m <= last && out.length < 240; m = nextMonth(m)) {
    const [y, mo] = m.split('-').map(Number);
    const lastDay = new Date(Date.UTC(y, mo, 0)).getUTCDate();
    const parcels = plan.map((pl) => {
      // parcela que cairia antes do início do contrato (ex.: início 16/10, vencimento dia 15) vence no próprio dia do início
      let due = `${m}-${String(Math.min(pl.day || lastDay, lastDay)).padStart(2, '0')}`;
      if (due < client.billing_start.slice(0, 10)) due = client.billing_start.slice(0, 10);
      const pay = pays.get(`${m}#${pl.n}`) || null;
      const status = pay?.status === 'paid' ? 'paid' : pay?.status === 'waived' ? 'waived' : today > due ? 'late' : 'open';
      return { n: pl.n, of: plan.length, due, cents: pay?.amount_cents ?? pl.cents, status, payment: pay };
    });
    const st = parcels.every((p) => p.status === 'waived') ? 'waived'
      : parcels.every((p) => p.status === 'paid' || p.status === 'waived') ? 'paid'
      : parcels.some((p) => p.status === 'late') ? 'late' : 'open';
    const pending = parcels.filter((p) => p.status === 'open' || p.status === 'late');
    out.push({
      month: m, status: st, parcels,
      due: (pending[0] || parcels[0]).due,
      amount_cents: parcels.reduce((s, p) => s + (p.cents || 0), 0),
      open_cents: pending.reduce((s, p) => s + (p.cents || 0), 0),
      late_cents: parcels.filter((p) => p.status === 'late').reduce((s, p) => s + (p.cents || 0), 0),
      paid_count: parcels.filter((p) => p.status === 'paid').length,
    });
  }
  return out.reverse();
}

// Parcelas para cobrar: vencidas ou vencendo nos próximos `days` dias.
export function dueSoon(months, today, days = 2) {
  const lim = new Date(`${today}T12:00:00Z`); lim.setUTCDate(lim.getUTCDate() + days);
  const limit = lim.toISOString().slice(0, 10);
  const out = [];
  for (const m of months) for (const p of m.parcels) if ((p.status === 'late') || (p.status === 'open' && p.due <= limit)) out.push({ month: m.month, ...p });
  return out.sort((a, b) => a.due.localeCompare(b.due));
}
