// Clientes (marcas). GET lista | POST cria | PATCH ?id= edita | DELETE ?id= remove
import { route, send, readJson, query, need } from '../lib/http.js';
import { requireAdmin, requireStaff, requirePerm, can, seesClient, needClient, randomToken } from '../lib/auth.js';
import { db, storage, docs } from '../lib/db.js';
import { appUrl } from '../lib/env.js';
import { publicClient } from '../lib/posts.js';
import { getState, setState } from '../lib/appstate.js';
import { productionList, setProductionOnly } from '../lib/production.js';

// Conta própria da agência (ex.: o perfil da MC DIGITAL): continua com posts, mas fica fora de receita, cobranças e contagem de clientes
const ownList = async () => { const v = await getState('own_accounts', []); return Array.isArray(v) ? v : []; };

function cleanClient(input) {
  const out = {};
  if (input.name !== undefined) {
    out.name = String(input.name).trim();
    need(out.name.length >= 2, 400, 'Dê um nome ao cliente.');
  }
  if (input.contact_whatsapp !== undefined) {
    const digits = String(input.contact_whatsapp || '').replace(/\D/g, '');
    // aceita "65 99999-9999" e completa com o 55 do Brasil
    out.contact_whatsapp = digits ? (digits.length <= 11 ? `55${digits}` : digits) : null;
  }
  if (input.brand_voice !== undefined) out.brand_voice = String(input.brand_voice || '').trim().slice(0, 1500) || null;
  if (input.contact_email !== undefined) {
    const e = String(input.contact_email || '').trim();
    need(!e || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e), 400, 'E-mail inválido.');
    out.contact_email = e || null;
  }
  // ── financeiro e dados do contrato (só a agência vê)
  if (input.monthly_fee !== undefined) { // aceita "1.500,00", "1500" ou número
    const raw = String(input.monthly_fee ?? '').trim();
    if (!raw) out.monthly_fee_cents = null;
    else {
      const n = Number(raw.replace(/[R$\s]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'));
      need(Number.isFinite(n) && n >= 0 && n < 1e7, 400, 'Valor mensal inválido.');
      out.monthly_fee_cents = Math.round(n * 100);
    }
  }
  if (input.due_day !== undefined) {
    const d = input.due_day === '' || input.due_day == null ? null : Number(input.due_day);
    need(d === null || (Number.isInteger(d) && d >= 1 && d <= 31), 400, 'Dia de vencimento deve ser de 1 a 31.');
    out.due_day = d;
  }
  if (input.billing_start !== undefined) {
    const s = String(input.billing_start || '').trim();
    need(!s || /^\d{4}-\d{2}-\d{2}$/.test(s), 400, 'Data de início inválida.');
    out.billing_start = s || null;
  }
  if (input.installments !== undefined) { // parcelas da mensalidade: [{ day, cents }]; vazio = uma parcela só
    const list = Array.isArray(input.installments) ? input.installments : [];
    need(list.length <= 6, 400, 'No máximo 6 parcelas por mês.');
    out.installments = list.length > 1 ? list.map((p) => {
      const day = Number(p.day), cents = Math.round(Number(p.cents));
      need(Number.isInteger(day) && day >= 1 && day <= 31, 400, 'Dia da parcela deve ser de 1 a 31.');
      need(Number.isFinite(cents) && cents > 0, 400, 'Valor de parcela inválido.');
      return { day, cents };
    }) : null;
  }
  if (input.contract_data !== undefined) {
    const k = input.contract_data || {};
    const keep = {};
    for (const f of ['nome', 'documento', 'endereco', 'representante', 'representante_cpf', 'servicos', 'entregas', 'forma_pagamento']) {
      const v = String(k[f] ?? '').trim().slice(0, f === 'servicos' ? 3000 : 300);
      if (v) keep[f] = v;
    }
    if (k.prazo_meses !== undefined && k.prazo_meses !== '' && k.prazo_meses !== null) {
      const p = Number(k.prazo_meses);
      need(Number.isInteger(p) && p > 0 && p <= 120, 400, 'Prazo do contrato deve ser em meses (1 a 120).');
      keep.prazo_meses = p;
    }
    for (const q of ['quota_posts', 'quota_reels', 'quota_stories']) { // cota mensal de entregas (contador)
      if (k[q] !== undefined && k[q] !== '' && k[q] !== null) {
        const n = Number(k[q]);
        need(Number.isInteger(n) && n >= 0 && n <= 999, 400, 'Quantidade de entregas inválida.');
        keep[q] = n;
      }
    }
    if (k.retroativo) { // contrato que substitui outro: data em que o serviço começou
      need(/^\d{4}-\d{2}-\d{2}$/.test(String(k.retroativo)), 400, 'Data de início do serviço inválida.');
      keep.retroativo = String(k.retroativo);
    }
    if (k.total_conteudos !== undefined && k.total_conteudos !== '' && k.total_conteudos !== null) {
      const n = Number(k.total_conteudos);
      need(Number.isInteger(n) && n > 0 && n <= 999, 400, 'Total de conteúdos por mês inválido.');
      keep.total_conteudos = n;
    }
    out.contract_data = keep;
  }
  return out;
}

// A equipe vê o necessário para produzir e aprovar posts; nada de financeiro, contrato ou área do cliente.
function teamClient(c, url) {
  const { monthly_fee_cents, due_day, billing_start, contract_data, installments, portal_url, ...rest } = publicClient(c, url);
  return rest;
}

export default route({
  GET: async (req, res) => {
    const u = await requireStaff(req);
    const rows = (await db.select('clients', { select: '*', order: 'name.asc' })).filter((c) => seesClient(u, c.id));
    const own = new Set(await ownList());
    const prod = new Set(await productionList());
    send(res, 200, rows.map((c) => ({ ...(can(u, 'financeiro') ? publicClient(c, appUrl()) : teamClient(c, appUrl())), own: own.has(c.id), production_only: prod.has(c.id) })));
  },

  POST: async (req, res) => {
    const u = await requirePerm(req, 'clientes');
    need(!u.clients, 403, 'Contas com acesso a clientes específicos não cadastram clientes novos.');
    const data = cleanClient(await readJson(req));
    need(data.name, 400, 'Dê um nome ao cliente.');
    const row = await db.insert('clients', data);
    send(res, 201, publicClient(row, appUrl()));
  },

  PATCH: async (req, res) => {
    const u = await requirePerm(req, 'clientes', 'financeiro');
    const { id } = query(req);
    need(id, 400, 'Cliente não informado.');
    needClient(u, id);
    const body = await readJson(req);
    const MONEY = ['monthly_fee', 'monthly_fee_cents', 'due_day', 'billing_start', 'installments', 'contract_data', 'portal'];
    if (!can(u, 'financeiro')) need(!MONEY.some((k) => body[k] !== undefined), 403, 'Sem permissão para mexer no financeiro, no contrato ou na área do cliente.');
    if (!can(u, 'clientes')) need(Object.keys(body).every((k) => MONEY.includes(k)), 403, 'Sem permissão para editar o cadastro do cliente.');
    const patch = cleanClient(body);
    if (body.new_approval_link) patch.approval_token = randomToken(); // invalida o link antigo
    // Área do cliente: 'enable' cria o link (ou mantém o atual), 'regenerate' troca, 'disable' desliga
    if (body.portal === 'enable' || body.portal === 'regenerate') {
      const cur = await db.one('clients', { select: 'portal_token', id: `eq.${id}` });
      if (body.portal === 'regenerate' || !cur?.portal_token) patch.portal_token = randomToken();
    } else if (body.portal === 'disable') patch.portal_token = null;
    if (body.disconnect_instagram) Object.assign(patch, { ig_token: null, ig_token_expires_at: null, ig_user_id: null, ig_username: null, ig_connected_at: null });
    const [row] = Object.keys(patch).length ? await db.update('clients', { id: `eq.${id}` }, patch) : await db.select('clients', { select: '*', id: `eq.${id}` });
    need(row, 404, 'Cliente não encontrado.');
    let own = new Set(await ownList());
    if (body.own_account !== undefined) {
      need(can(u, 'clientes'), 403, 'Sem permissão para editar o cadastro do cliente.');
      if (body.own_account) own.add(row.id); else own.delete(row.id);
      await setState('own_accounts', [...own]);
    }
    let prod = new Set(await productionList());
    if (body.production_only !== undefined) prod = await setProductionOnly(row.id, Boolean(body.production_only));
    send(res, 200, { ...(can(u, 'financeiro') ? publicClient(row, appUrl()) : teamClient(row, appUrl())), own: own.has(row.id), production_only: prod.has(row.id) });
  },

  DELETE: async (req, res) => {
    await requireAdmin(req);
    const { id } = query(req);
    need(id, 400, 'Cliente não informado.');
    const posts = await db.select('posts', { select: 'image_path', client_id: `eq.${id}` });
    const files = await db.select('client_files', { select: 'path', client_id: `eq.${id}` }).catch(() => []); // antes da atualização do banco a tabela não existe
    await db.remove('clients', { id: `eq.${id}` }); // posts, arquivos e pagamentos saem junto (on delete cascade)
    for (const p of posts) await storage.remove(p.image_path);
    for (const f of files) await docs.remove(f.path);
    send(res, 200, { ok: true });
  },
});
