// Contas da equipe (só o administrador gerencia). GET lista | POST cria | PATCH {id, ...} edita | DELETE ?id=
import { route, send, readJson, query, need } from '../http.js';
import { requireAdmin, hashPassword } from '../auth.js';
import { db } from '../db.js';

const pub = ({ pass_hash, ...u }) => u;
const okEmail = (e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);

export default route({
  GET: async (req, res) => {
    await requireAdmin(req);
    send(res, 200, (await db.select('users', { select: 'id,name,email,role,active,created_at', order: 'name.asc' })));
  },
  POST: async (req, res) => {
    await requireAdmin(req);
    const b = await readJson(req);
    const name = String(b.name || '').trim().slice(0, 80);
    const email = String(b.email || '').trim().toLowerCase();
    need(name.length >= 2, 400, 'Informe o nome.');
    need(okEmail(email), 400, 'E-mail inválido.');
    need(String(b.password || '').length >= 8, 400, 'A senha precisa ter pelo menos 8 caracteres.');
    need(['admin', 'team'].includes(b.role || 'team'), 400, 'Papel inválido.');
    const dup = await db.one('users', { select: 'id', email: `eq.${email}` });
    need(!dup, 409, 'Já existe uma conta com esse e-mail.');
    const row = await db.insert('users', { name, email, role: b.role || 'team', pass_hash: hashPassword(b.password), active: true });
    send(res, 201, pub(row));
  },
  PATCH: async (req, res) => {
    const me = await requireAdmin(req);
    const b = await readJson(req);
    need(b.id, 400, 'Conta não informada.');
    const patch = {};
    if (b.name !== undefined) { patch.name = String(b.name).trim().slice(0, 80); need(patch.name.length >= 2, 400, 'Informe o nome.'); }
    if (b.role !== undefined) { need(['admin', 'team'].includes(b.role), 400, 'Papel inválido.'); patch.role = b.role; }
    if (b.active !== undefined) patch.active = Boolean(b.active);
    if (b.password) { need(String(b.password).length >= 8, 400, 'A senha precisa ter pelo menos 8 caracteres.'); patch.pass_hash = hashPassword(b.password); }
    need(!(me.uid === b.id && (patch.active === false || patch.role === 'team')), 400, 'Você não pode tirar o seu próprio acesso de administrador.');
    const [row] = await db.update('users', { id: `eq.${b.id}` }, patch);
    need(row, 404, 'Conta não encontrada.');
    send(res, 200, pub(row));
  },
  DELETE: async (req, res) => {
    const me = await requireAdmin(req);
    const { id } = query(req);
    need(id && id !== me.uid, 400, 'Conta inválida.');
    await db.remove('users', { id: `eq.${id}` });
    send(res, 200, { ok: true });
  },
});
