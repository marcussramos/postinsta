// Pix automático pelo Asaas (conta de cobrança; o dinheiro pode ir sozinho para o Nubank pela transferência automática do Asaas).
// Variável na Vercel: ASAAS_API_KEY  (chave de "sandbox" começa com $aact_hmlg_; a de produção, com $aact_prod_)
// Fluxo: cada parcela vira uma cobrança Pix exclusiva (externalReference = mc:<cliente>:<AAAA-MM>:<parcela>).
// Quando o cliente paga, o Asaas chama /api/pasta?r=asaas e o app dá baixa na parcela certa.
import crypto from 'node:crypto';
import { db } from './db.js';
import { sessionSecret, TIMEZONE } from './env.js';
import { HttpError } from './http.js';
import { billingMonths } from './billing.js';

export const asaasReady = () => Boolean(process.env.ASAAS_API_KEY);
export const asaasEnv = () => (process.env.ASAAS_ENV || (String(process.env.ASAAS_API_KEY || '').includes('_hmlg_') ? 'sandbox' : 'production'));
const base = () => (asaasEnv() === 'sandbox' ? 'https://api-sandbox.asaas.com/v3' : 'https://api.asaas.com/v3');
// Código que o Asaas manda no cabeçalho asaas-access-token (o app configura sozinho; derivado do segredo da sessão)
export const webhookToken = () => crypto.createHmac('sha256', sessionSecret()).update('asaas-webhook').digest('hex').slice(0, 48);

export async function asaas(path, { method = 'GET', body } = {}) {
  if (!asaasReady()) throw new HttpError(503, 'O Pix automático ainda não está ligado: falta ASAAS_API_KEY na Vercel (veja Ajustes).');
  let r;
  try {
    r = await fetch(`${base()}${path}`, {
      method,
      headers: { access_token: process.env.ASAAS_API_KEY, 'Content-Type': 'application/json', 'User-Agent': 'MC-DIGITAL' },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch { throw new HttpError(502, 'Não consegui falar com o Asaas agora. Tente de novo.'); }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = (data.errors || []).map((e) => e.description).join(' ') || `erro ${r.status}`;
    throw new HttpError(r.status === 401 ? 503 : 400, `Asaas: ${msg}${r.status === 401 ? ' Confira a ASAAS_API_KEY.' : ''}`);
  }
  return data;
}

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE() }).format(new Date());
export const refOf = (clientId, month, n) => `mc:${clientId}:${month}:${n}`;
export function parseRef(ref) {
  const m = /^mc:([0-9a-f-]{36}):(\d{4}-\d{2}):(\d{1,2})$/.exec(String(ref || ''));
  return m ? { client_id: m[1], ref_month: m[2], installment: Number(m[3]) } : null;
}

async function ensureCustomer(c) {
  if (c.asaas_customer_id) return c.asaas_customer_id;
  const k = c.contract_data || {};
  const doc = String(k.documento || '').replace(/\D/g, '');
  if (![11, 14].includes(doc.length)) throw new HttpError(400, `Para gerar Pix, preencha o CPF/CNPJ de ${c.name} (Pasta → Contrato → Editar dados).`);
  const phone = String(c.contact_whatsapp || '').replace(/^55/, '');
  const cu = await asaas('/customers', { method: 'POST', body: {
    name: k.nome || c.name, cpfCnpj: doc, email: c.contact_email || undefined, mobilePhone: phone || undefined,
    externalReference: c.id, notificationDisabled: true, // o app avisa pelo WhatsApp; evita cobranças de notificação do Asaas
  } });
  await db.update('clients', { id: `eq.${c.id}` }, { asaas_customer_id: cu.id });
  c.asaas_customer_id = cu.id;
  return cu.id;
}

// Cobrança Pix de uma parcela (reaproveita a que já existe). Devolve QR Code e copia-e-cola.
export async function ensureCharge(c, month, n) {
  const payments = await db.select('payments', { select: '*', client_id: `eq.${c.id}` });
  const m = billingMonths(c, payments).find((x) => x.month === month);
  const parcel = m?.parcels.find((p) => p.n === Number(n));
  if (!parcel) throw new HttpError(404, 'Parcela não encontrada.');
  if (!['open', 'late'].includes(parcel.status)) throw new HttpError(409, 'Esta parcela já está paga ou isenta.');
  const cents = parcel.cents;
  if (!cents) throw new HttpError(400, 'Defina o valor da mensalidade antes de gerar o Pix.');
  const row = parcel.payment;
  const label = `${parcel.of > 1 ? `${parcel.n}ª parcela da m` : 'M'}ensalidade ${month.slice(5)}/${month.slice(0, 4)}`;
  let id = row?.asaas_id && row.status === 'pending' && row.amount_cents === cents ? row.asaas_id : null;
  let invoice = row?.pix_url || null;
  if (id) {
    const cur = await asaas(`/payments/${id}`).catch(() => null);
    if (!cur || cur.deleted || ['REFUNDED', 'RECEIVED', 'CONFIRMED'].includes(cur.status)) id = null;
  }
  if (!id) {
    const customer = await ensureCustomer(c);
    const due = parcel.due < today() ? today() : parcel.due;
    const pay = await asaas('/payments', { method: 'POST', body: {
      customer, billingType: 'PIX', value: cents / 100, dueDate: due, description: `${label} · ${c.contract_data?.nome || c.name}`, externalReference: refOf(c.id, month, parcel.n),
    } });
    id = pay.id; invoice = pay.invoiceUrl || null;
  }
  const qr = await asaas(`/payments/${id}/pixQrCode`);
  await db.upsert('payments', { client_id: c.id, ref_month: month, installment: parcel.n, status: 'pending', amount_cents: cents, asaas_id: id, pix_payload: qr.payload || null, pix_url: invoice, updated_at: new Date().toISOString() });
  return { asaas_id: id, payload: qr.payload, image: qr.encodedImage ? `data:image/png;base64,${qr.encodedImage}` : null, expires: qr.expirationDate || null, value_cents: cents, due: parcel.due, label, invoice_url: invoice };
}

// Baixa manual no app de uma parcela que tinha Pix em aberto: cancela a cobrança para o cliente não pagar duas vezes.
export async function cancelCharge(asaasId) {
  if (!asaasId || !asaasReady()) return;
  try { await asaas(`/payments/${asaasId}`, { method: 'DELETE' }); } catch { /* já paga ou removida */ }
}

// Aviso do Asaas (webhook). Pago → baixa automática.
export async function handleWebhook(evt) {
  const p = evt?.payment;
  const ref = parseRef(p?.externalReference);
  if (!ref) return { ignored: true };
  if (['PAYMENT_RECEIVED', 'PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED_IN_CASH'].includes(evt.event)) {
    const cur = await db.one('payments', { select: 'status,file_id,note', client_id: `eq.${ref.client_id}`, ref_month: `eq.${ref.ref_month}`, installment: `eq.${ref.installment}` });
    if (cur?.status === 'paid') return { already: true }; // o Asaas pode repetir o aviso
    await db.upsert('payments', {
      ...ref, status: 'paid', paid_at: String(p.paymentDate || p.confirmedDate || today()).slice(0, 10),
      amount_cents: Math.round(Number(p.value) * 100), asaas_id: p.id, receipt_url: p.transactionReceiptUrl || null,
      note: 'Pix automático (Asaas)', updated_at: new Date().toISOString(),
    });
    return { paid: ref };
  }
  if (evt.event === 'PAYMENT_DELETED') {
    await db.update('payments', { ...Object.fromEntries(Object.entries(ref).map(([k, v]) => [k, `eq.${v}`])), status: 'eq.pending', asaas_id: `eq.${p.id}` }, { asaas_id: null, pix_payload: null, pix_url: null }).catch(() => {});
    return { deleted: ref };
  }
  return { ignored: true };
}

export async function setupWebhook(appUrl, email) {
  const url = `${appUrl}/api/pasta?r=asaas`;
  const list = await asaas('/webhooks').catch(() => ({ data: [] }));
  const old = (list.data || []).find((w) => w.url === url);
  const body = { name: 'MC DIGITAL - baixa automática', url, email, enabled: true, interrupted: false, authToken: webhookToken(), sendType: 'SEQUENTIALLY',
    events: ['PAYMENT_RECEIVED', 'PAYMENT_CONFIRMED', 'PAYMENT_DELETED'] };
  return old ? asaas(`/webhooks/${old.id}`, { method: 'PUT', body }) : asaas('/webhooks', { method: 'POST', body });
}
