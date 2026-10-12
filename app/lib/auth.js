// Login do painel: uma senha (ADMIN_PASSWORD) e um cookie assinado com HMAC.
import crypto from 'node:crypto';
import { env, sessionSecret } from './env.js';
import { HttpError } from './http.js';

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

export function isAdmin(req) {
  const s = verify(cookies(req)[COOKIE]);
  return Boolean(s && s.role === 'admin');
}

export function requireAdmin(req) {
  if (!isAdmin(req)) throw new HttpError(401, 'Entre com sua senha para continuar.');
}

export function checkPassword(given) {
  const h = (s) => crypto.createHash('sha256').update(String(s || '')).digest();
  return crypto.timingSafeEqual(h(given), h(env('ADMIN_PASSWORD')));
}

export function sessionCookie() {
  const token = sign({ role: 'admin', exp: Date.now() + MAX_AGE * 1000 });
  return `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${MAX_AGE}`;
}

export function clearCookie() {
  return `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export function randomToken(bytes = 24) {
  return crypto.randomBytes(bytes).toString('hex');
}
