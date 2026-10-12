// Clientes (marcas). GET lista | POST cria | PATCH ?id= edita | DELETE ?id= remove
import { route, send, readJson, query, need } from '../lib/http.js';
import { requireAdmin, randomToken } from '../lib/auth.js';
import { db, storage, docs } from '../lib/db.js';
import { appUrl } from '../lib/env.js';
import { publicClient } from '../lib/posts.js';

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
    if (k.total_conteudos !== undefined && k.total_conteudos !== '' && k.total_conteudos !== null) {
      const n = Number(k.total_conteudos);
      need(Number.isInteger(n) && n > 0 && n <= 999, 400, 'Total de conteúdos por mês inválido.');
      keep.total_conteudos = n;
    }
    out.contract_data = keep;
  }
  return out;
}

export default route({
  GET: async (req, res) => {
    requireAdmin(req);
    const rows = await db.select('clients', { select: '*', order: 'name.asc' });
    send(res, 200, rows.map((c) => publicClient(c, appUrl())));
  },

  POST: async (req, res) => {
    requireAdmin(req);
    const data = cleanClient(await readJson(req));
    need(data.name, 400, 'Dê um nome ao cliente.');
    const row = await db.insert('clients', data);
    send(res, 201, publicClient(row, appUrl()));
  },

  PATCH: async (req, res) => {
    requireAdmin(req);
    const { id } = query(req);
    need(id, 400, 'Cliente não informado.');
    const body = await readJson(req);
    const patch = cleanClient(body);
    if (body.new_approval_link) patch.approval_token = randomToken(); // invalida o link antigo
    if (body.disconnect_instagram) Object.assign(patch, { ig_token: null, ig_token_expires_at: null, ig_user_id: null, ig_username: null, ig_connected_at: null });
    const [row] = await db.update('clients', { id: `eq.${id}` }, patch);
    need(row, 404, 'Cliente não encontrado.');
    send(res, 200, publicClient(row, appUrl()));
  },

  DELETE: async (req, res) => {
    requireAdmin(req);
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
