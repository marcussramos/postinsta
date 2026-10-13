// Login do painel e cookie assinado com HMAC.
// Dono: senha ADMIN_PASSWORD (papel admin). Equipe: e-mail + senha da tabela users (papel admin ou team).
// "team" usa agenda, posts e clientes, mas não vê financeiro, contratos, pastas nem Ajustes.
import crypto from 'node:crypto';
import { env, sessionSecret } from './env.js';
import { HttpError } from './http.js';
import { cleanPerms, PERM_LABEL } from '../public/permissoes.js';

const COOKIE = 'pauta_sess';
const MAX_AGE = 60 * 60 * 24 * 30; // 30 dias

const b64url = (buf) => Buffer.from(buf).toString('base64url');

export function sign(payload) {
  const body = b64url(JSON.stringify(payload));
  const mac = crypto.createHmac('sha256', sessionSecret()).update(body).digest('base64url');
  return `${body}.${mac}`;
}

export function verify(token) {
  if (!token || !token.includes('.')) return null;
  const [body, mac] = token.split('.');
  const expected = crypto.createHmac('sha256', sessionSecret()).update(body).digest('base64url');
  const a = Buffer.from(mac), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (data.exp && data.exp < Date.now()) return null;
    return data;
  } catch { return null; }
}

function cookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

// Sessão crua do cookie (sem consultar o banco).
export function sessionOf(req) {
  return verify(cookies(req)[COOKIE]);
}

// Sessão válida: para contas da equipe confere no banco se a conta segue ativa (e o papel atual).
export async function currentUser(req) {
  const s = sessionOf(req);
  if (!s || !['admin', 'team'].includes(s.role)) return null;
  if (!s.uid) return s.role === 'admin' ? { role: 'admin', name: 'Dono', uid: null, perms: null, clients: null } : null;
  const { db } = await import('./db.js');
  const u = await db.one('users', { select: '*', id: `eq.${s.uid}` }).catch(() => null); // '*': antes da atualização 12 não há perms/client_ids
  if (!u || !u.active) return null;
  if (u.role === 'admin') return { role: 'admin', name: u.name, uid: u.id, perms: null, clients: null };
  return { role: u.role, name: u.name, uid: u.id, perms: cleanPerms(u.perms || {}), clients: Array.isArray(u.client_ids) && u.client_ids.length ? u.client_ids : null };
}

// Permissões: administrador pode tudo; equipe conforme marcado em Ajustes → Equipe.
export const can = (u, perm) => u?.role === 'admin' || Boolean(u?.perms?.[perm]);
export async function requirePerm(req, ...perms) { // passa se tiver QUALQUER uma das permissões
  const u = await requireStaff(req);
  if (!perms.some((p) => can(u, p))) throw new HttpError(403, `Sem permissão para isto (${perms.map((p) => PERM_LABEL[p]).join(' ou ')}). Peça ao administrador.`);
  return u;
}
// Clientes que a pessoa enxerga (null = todos)
export const seesClient = (u, id) => u?.role === 'admin' || !u?.clients || u.clients.includes(id);
export function needClient(u, id) {
  if (id && !seesClient(u, id)) throw new HttpError(403, 'Você não tem acesso a este cliente.');
}

export async function isAdmin(req) {
  return (await currentUser(req))?.role === 'admin';
}

export async function requireAdmin(req) {
  const u = await currentUser(req);
  if (!u) throw new HttpError(401, 'Entre com sua senha para continuar.');
  if (u.role !== 'admin') throw new HttpError(403, 'Só o administrador da agência acessa isto.');
  return u;
}

// Admin ou equipe.
export async function requireStaff(req) {
  const u = await currentUser(req);
  if (!u) throw new HttpError(401, 'Entre com sua senha para continuar.');
  return u;
}

export function checkPassword(given) {
  const h = (s) => crypto.createHash('sha256').update(String(s || '')).digest();
  return crypto.timingSafeEqual(h(given), h(env('ADMIN_PASSWORD')));
}

export function sessionCookie(user = { role: 'admin' }) {
  const token = sign({ role: user.role, uid: user.uid || undefined, exp: Date.now() + MAX_AGE * 1000 });
  return `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${MAX_AGE}`;
}

export function clearCookie() {
  return `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export function randomToken(bytes = 24) {
  return crypto.randomBytes(bytes).toString('hex');
}

// Senhas da equipe: scrypt com sal aleatório. Formato "scrypt$sal$hash".
export function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(pw), salt, 32);
  return `scrypt$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}
export function checkUserPassword(pw, stored) {
  const [alg, salt, hash] = String(stored || '').split('$');
  if (alg !== 'scrypt' || !salt || !hash) return false;
  const a = crypto.scryptSync(String(pw || ''), Buffer.from(salt, 'base64url'), 32);
  const b = Buffer.from(hash, 'base64url');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
