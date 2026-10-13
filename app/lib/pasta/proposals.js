// Propostas comerciais. Agência: GET lista | POST cria | PATCH {id, ...} edita/envia | DELETE ?id=
// Público (link do cliente, rota "proposal"): GET ?t= mostra | POST ?t= aceita (cria o cliente) ou recusa.
import { route, send, readJson, query, need } from '../http.js';
import { requireAdmin, randomToken, currentUser } from '../auth.js';
import { db } from '../db.js';
import { appUrl, TIMEZONE } from '../env.js';
import { loadSettings } from './settings.js';
import { notify } from '../push.js';

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE() }).format(new Date());
const txt = (v, n) => String(v ?? '').trim().slice(0, n);
const isDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d || '');

function money(v) {
  if (typeof v === 'number') return Math.round(v);
  const n = Number(String(v || '').replace(/[R$\s]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
}

function clean(b, partial = false) {
  const out = {};
  if (!partial || b.client_name !== undefined) { out.client_name = txt(b.client_name, 120); need(out.client_name.length >= 2, 400, 'Informe o nome do cliente.'); }
  if (b.contact !== undefined) {
    const c = b.contact || {};
    const wa = String(c.whatsapp || '').replace(/\D/g, '');
    out.contact = { name: txt(c.name, 120) || null, email: txt(c.email, 160) || null, whatsapp: wa ? (wa.length <= 11 ? `55${wa}` : wa) : null };
  }
  for (const [k, n] of [['intro', 3000], ['entregas', 300], ['forma_pagamento', 400], ['notes', 3000]]) if (b[k] !== undefined) out[k] = txt(b[k], n) || null;
  if (b.items !== undefined) {
    out.items = (Array.isArray(b.items) ? b.items : []).map((i) => ({ title: txt(i?.title, 120), desc: txt(i?.desc, 400) })).filter((i) => i.title).slice(0, 12);
  }
  for (const q of ['quota_posts', 'quota_reels']) if (b[q] !== undefined) {
    const n = b[q] === '' || b[q] == null ? null : Number(b[q]);
    need(n === null || (Number.isInteger(n) && n >= 0 && n <= 999), 400, 'Quantidade de entregas inválida.');
    out[q] = n;
  }
  if (!partial || b.monthly_fee !== undefined) {
    out.monthly_fee_cents = money(b.monthly_fee);
    need(Number.isFinite(out.monthly_fee_cents) && out.monthly_fee_cents > 0, 400, 'Informe o valor mensal.');
  }
  if (b.installments !== undefined) {
    const list = Array.isArray(b.installments) ? b.installments : [];
    need(list.length >= 1 && list.length <= 6, 400, 'Informe de 1 a 6 vencimentos.');
    out.installments = list.map((p) => {
      const day = Number(p.day), cents = Math.round(Number(p.cents));
      need(Number.isInteger(day) && day >= 1 && day <= 31, 400, 'Dia de vencimento deve ser de 1 a 31.');
      need(Number.isFinite(cents) && cents > 0, 400, 'Valor de parcela inválido.');
      return { day, cents };
    });
  }
  if (b.valid_until !== undefined) { need(!b.valid_until || isDate(b.valid_until), 400, 'Validade inválida.'); out.valid_until = b.valid_until || null; }
  return out;
}

const withUrl = (p) => ({ ...p, url: `${appUrl()}/proposta?t=${p.token}` });

export default route({
  GET: async (req, res) => {
    await requireAdmin(req);
    send(res, 200, (await db.select('proposals', { select: '*', order: 'created_at.desc', limit: 200 })).map(withUrl));
  },
  POST: async (req, res) => {
    await requireAdmin(req);
    const b = await readJson(req);
    const data = clean(b);
    if (!data.installments) data.installments = [{ day: 10, cents: data.monthly_fee_cents }];
    const row = await db.insert('proposals', { ...data, token: randomToken(20), status: b.send ? 'sent' : 'draft' });
    send(res, 201, withUrl(row));
  },
  PATCH: async (req, res) => {
    await requireAdmin(req);
    const b = await readJson(req);
    need(b.id, 400, 'Proposta não informada.');
    const cur = await db.one('proposals', { select: 'status', id: `eq.${b.id}` });
    need(cur, 404, 'Proposta não encontrada.');
    need(cur.status !== 'accepted', 409, 'Proposta já aceita: não dá mais para editar.');
    const patch = { ...clean(b, true), updated_at: new Date().toISOString() };
    if (b.send) patch.status = 'sent';
    if (b.back_to_draft) patch.status = 'draft';
    const [row] = await db.update('proposals', { id: `eq.${b.id}` }, patch);
    send(res, 200, withUrl(row));
  },
  DELETE: async (req, res) => {
    await requireAdmin(req);
    const { id } = query(req);
    need(id, 400, 'Proposta não informada.');
    await db.remove('proposals', { id: `eq.${id}` });
    send(res, 200, { ok: true });
  },
});

async function byToken(t) {
  need(typeof t === 'string' && /^[a-f0-9]{32,64}$/.test(t), 404, 'Proposta não encontrada.');
  const p = await db.one('proposals', { select: '*', token: `eq.${t}` });
  need(p, 404, 'Proposta não encontrada.');
  return p;
}

export const publicProposal = route({
  GET: async (req, res) => {
    const p = await byToken(query(req).t);
    const admin = (await currentUser(req))?.role === 'admin';
    need(p.status !== 'draft' || admin, 404, 'Proposta não encontrada.');
    const { agency } = await loadSettings();
    const expired = p.status === 'sent' && p.valid_until && p.valid_until < today();
    let portal = null;
    if (p.status === 'accepted' && p.client_id) {
      const c = await db.one('clients', { select: 'portal_token', id: `eq.${p.client_id}` });
      if (c?.portal_token) portal = `${appUrl()}/cliente?t=${c.portal_token}`;
    }
    send(res, 200, {
      client_name: p.client_name, contact_name: p.contact?.name || null, intro: p.intro, items: p.items || [], entregas: p.entregas,
      quota_posts: p.quota_posts, quota_reels: p.quota_reels, monthly_fee_cents: p.monthly_fee_cents, installments: p.installments || [],
      forma_pagamento: p.forma_pagamento, valid_until: p.valid_until, notes: p.notes, status: expired ? 'expired' : p.status, preview: p.status === 'draft',
      accepted_at: p.accepted_at, portal_url: portal,
      agency: { marca: agency.marca || 'MC DIGITAL', slogan: agency.slogan || '', representante: agency.representante || '', email: agency.email || '', cidade: agency.cidade || '' },
    }, { 'Cache-Control': 'no-store' });
  },
  POST: async (req, res) => {
    const p = await byToken(query(req).t);
    const b = await readJson(req);
    need(p.status === 'sent', 409, p.status === 'accepted' ? 'Esta proposta já foi aceita.' : 'Esta proposta não está disponível para aceite.');
    need(!p.valid_until || p.valid_until >= today(), 409, 'Esta proposta venceu. Peça uma atualizada para a agência.');
    if (b.decline) {
      await db.update('proposals', { id: `eq.${p.id}`, status: 'eq.sent' }, { status: 'declined', accepted: { reason: txt(b.reason, 1000) || null }, updated_at: new Date().toISOString() });
      return send(res, 200, { status: 'declined' });
    }
    const a = {
      nome: txt(b.nome, 200), documento: txt(b.documento, 30), endereco: txt(b.endereco, 300), representante: txt(b.representante, 200),
      representante_cpf: txt(b.representante_cpf, 20), email: txt(b.email, 160), whatsapp: String(b.whatsapp || '').replace(/\D/g, ''), inicio: b.inicio,
    };
    need(a.nome.length >= 2, 400, 'Informe o nome ou a razão social.');
    need([11, 14].includes(a.documento.replace(/\D/g, '').length), 400, 'Informe um CPF (11 dígitos) ou CNPJ (14 dígitos) válido.');
    need(a.endereco.length >= 8, 400, 'Informe o endereço completo.');
    need(a.representante.length >= 2, 400, 'Informe quem vai assinar o contrato.');
    need(/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(a.email), 400, 'Informe um e-mail válido.');
    need(a.whatsapp.length >= 10, 400, 'Informe o WhatsApp com DDD.');
    need(isDate(a.inicio) && a.inicio >= today(), 400, 'Escolha a data de início (hoje ou depois).');
    need(b.aceite === true, 400, 'Marque que você leu e aceita a proposta.');
    // trava: só um aceite
    const [lock] = await db.update('proposals', { id: `eq.${p.id}`, status: 'eq.sent' }, { status: 'accepted', accepted: a, accepted_at: new Date().toISOString(), updated_at: new Date().toISOString() });
    need(lock, 409, 'Esta proposta já foi aceita.');
    const inst = p.installments?.length ? p.installments : [{ day: 10, cents: p.monthly_fee_cents }];
    const client = await db.insert('clients', {
      name: p.client_name,
      contact_email: a.email,
      contact_whatsapp: a.whatsapp.length <= 11 ? `55${a.whatsapp}` : a.whatsapp,
      monthly_fee_cents: p.monthly_fee_cents,
      due_day: inst.length === 1 ? inst[0].day : null,
      installments: inst.length > 1 ? inst : null,
      billing_start: a.inicio,
      contract_data: {
        nome: a.nome, documento: a.documento, endereco: a.endereco, representante: a.representante, representante_cpf: a.representante_cpf || undefined,
        entregas: p.entregas || undefined, quota_posts: p.quota_posts ?? undefined, quota_reels: p.quota_reels ?? undefined,
        total_conteudos: (p.quota_posts || 0) + (p.quota_reels || 0) || undefined, forma_pagamento: p.forma_pagamento || undefined,
      },
      portal_token: randomToken(),
    });
    await db.update('proposals', { id: `eq.${p.id}` }, { client_id: client.id });
    await notify({ title: `🎉 ${p.client_name} aceitou a proposta`, body: `${(p.monthly_fee_cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}/mês · início ${a.inicio.split('-').reverse().join('/')}. Cadastro e pasta já criados.`, url: `/#pasta/${client.id}` }, { adminOnly: true });
    send(res, 200, { status: 'accepted', portal_url: `${appUrl()}/cliente?t=${client.portal_token}` });
  },
});
