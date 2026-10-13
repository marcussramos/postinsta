// Pasta privada de cada cliente: contratos, comprovantes, relatórios e outros.
// GET ?client=  lista | GET ?id=&open=1 (ou &download=1) abre por link temporário
// POST ?client=&category=&ref_month=  envia (corpo = arquivo; nome no cabeçalho x-file-name)
// DELETE ?id=  apaga
import crypto from 'node:crypto';
import { route, send, readRaw, query, need, redirect } from '../http.js';
import { requireStaff } from '../auth.js';
import { db, docs } from '../db.js';

const CATEGORIES = ['contract', 'receipt', 'report', 'other', 'brand', 'briefing', 'invoice', 'audio'];
const TEAM_CATEGORIES = ['brand', 'briefing', 'audio']; // a equipe só mexe na identidade da marca e nos anexos de pedidos
async function who(req) {
  const u = await requireStaff(req);
  return { u, allowed: (cat) => u.role === 'admin' || TEAM_CATEGORIES.includes(cat) };
}
const MAX = 4 * 1024 * 1024; // limite da Vercel para envio
const TYPES = {
  pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv', txt: 'text/plain',
};
const isMonth = (m) => /^\d{4}-(0[1-9]|1[0-2])$/.test(m || '');

function safeName(name) {
  const base = String(name || 'arquivo').normalize('NFD').replace(/[̀-ͯ]/g, '');
  return base.replace(/[^\w.\- ]+/g, '').replace(/\s+/g, '-').slice(-80) || 'arquivo';
}

export default route({
  GET: async (req, res) => {
    const { u, allowed } = await who(req);
    const q = query(req);
    if (q.id) {
      const f = await db.one('client_files', { select: 'path,name,category', id: `eq.${q.id}` });
      need(f && allowed(f.category), 404, 'Arquivo não encontrado.');
      return redirect(res, await docs.signedUrl(f.path, { expiresIn: f.category === 'audio' ? 1800 : 120, downloadName: q.download ? f.name : undefined }), { 'Cache-Control': 'no-store' });
    }
    need(q.client, 400, 'Cliente não informado.');
    const params = { select: 'id,client_id,category,name,mime,size,ref_month,created_at', client_id: `eq.${q.client}`, order: 'created_at.desc', limit: 500 };
    if (q.category) params.category = `eq.${q.category}`;
    if (u.role !== 'admin') { need(!q.category || allowed(q.category), 403, 'Sem acesso a esta seção.'); if (!q.category) params.category = `in.(${TEAM_CATEGORIES.join(',')})`; }
    send(res, 200, await db.select('client_files', params));
  },

  POST: async (req, res) => {
    const { allowed } = await who(req);
    const q = query(req);
    need(q.client, 400, 'Cliente não informado.');
    need(CATEGORIES.includes(q.category), 400, 'Escolha a seção da pasta.');
    need(allowed(q.category), 403, 'Sem acesso a esta seção.');
    need(!q.ref_month || isMonth(q.ref_month), 400, 'Mês inválido.');
    const name = decodeURIComponent(String(req.headers['x-file-name'] || 'arquivo'));
    const ext = (name.split('.').pop() || '').toLowerCase();
    need(TYPES[ext], 415, 'Tipo de arquivo não aceito. Use PDF, imagem, Word, Excel ou texto.');
    const client = await db.one('clients', { select: 'id', id: `eq.${q.client}` });
    need(client, 404, 'Cliente não encontrado.');
    const buf = await readRaw(req);
    need(buf.length > 0, 400, 'Arquivo vazio.');
    need(buf.length <= MAX, 413, 'Arquivo grande demais (máx. 4 MB). Comprima o PDF e tente de novo.');
    if (ext === 'pdf') need(buf.subarray(0, 4).toString() === '%PDF', 415, 'Esse arquivo não parece ser um PDF válido.');
    const path = `${q.client}/${q.category}/${Date.now()}-${crypto.randomBytes(4).toString('hex')}-${safeName(name)}`;
    await docs.upload(path, buf, TYPES[ext]);
    const row = await db.insert('client_files', {
      client_id: q.client, category: q.category, name: name.slice(0, 200), path, mime: TYPES[ext], size: buf.length, ref_month: q.ref_month || null,
    });
    const { path: _p, ...out } = row;
    send(res, 201, out);
  },

  DELETE: async (req, res) => {
    const { allowed } = await who(req);
    const { id } = query(req);
    need(id, 400, 'Arquivo não informado.');
    const cur = await db.one('client_files', { select: 'category', id: `eq.${id}` });
    need(cur && allowed(cur.category), 404, 'Arquivo não encontrado.');
    const [row] = await db.remove('client_files', { id: `eq.${id}` });
    need(row, 404, 'Arquivo não encontrado.');
    await docs.remove(row.path);
    send(res, 200, { ok: true });
  },
});
