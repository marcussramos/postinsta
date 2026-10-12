// Clientes (marcas). GET lista | POST cria | PATCH ?id= edita | DELETE ?id= remove
import { route, send, readJson, query, need } from '../lib/http.js';
import { requireAdmin, randomToken } from '../lib/auth.js';
import { db, storage } from '../lib/db.js';
import { env } from '../lib/env.js';
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
  if (input.contact_email !== undefined) {
    const e = String(input.contact_email || '').trim();
    need(!e || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e), 400, 'E-mail inválido.');
    out.contact_email = e || null;
  }
  return out;
}

export default route({
  GET: async (req, res) => {
    requireAdmin(req);
    const rows = await db.select('clients', { select: '*', order: 'name.asc' });
    send(res, 200, rows.map((c) => publicClient(c, env('APP_URL'))));
  },

  POST: async (req, res) => {
    requireAdmin(req);
    const data = cleanClient(await readJson(req));
    need(data.name, 400, 'Dê um nome ao cliente.');
    const row = await db.insert('clients', data);
    send(res, 201, publicClient(row, env('APP_URL')));
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
    send(res, 200, publicClient(row, env('APP_URL')));
  },

  DELETE: async (req, res) => {
    requireAdmin(req);
    const { id } = query(req);
    need(id, 400, 'Cliente não informado.');
    const posts = await db.select('posts', { select: 'image_path', client_id: `eq.${id}` });
    await db.remove('clients', { id: `eq.${id}` }); // os posts saem junto (on delete cascade)
    for (const p of posts) await storage.remove(p.image_path);
    send(res, 200, { ok: true });
  },
});
