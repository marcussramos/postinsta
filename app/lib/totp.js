// Verificação em duas etapas (TOTP, RFC 6238): o mesmo padrão do Google Authenticator, Microsoft Authenticator, Authy…
// Dono do painel: segredo em app_state "totp_owner". Contas da equipe: coluna users.totp_secret.
// Perdeu o celular? Na Vercel, crie DISABLE_2FA=1, faça Redeploy, entre e desligue/ative de novo; depois apague a variável.
import crypto from 'node:crypto';
import { db } from './db.js';
import { getState, setState } from './appstate.js';

const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32(buf) {
  let bits = 0, value = 0, out = '';
  for (const b of buf) { value = (value << 8) | b; bits += 8; while (bits >= 5) { out += ALPHA[(value >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) out += ALPHA[(value << (5 - bits)) & 31];
  return out;
}
export function unbase32(s) {
  const clean = String(s).toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0, value = 0; const out = [];
  for (const ch of clean) { value = (value << 5) | ALPHA.indexOf(ch); bits += 5; if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; } }
  return Buffer.from(out);
}
export const newSecret = () => base32(crypto.randomBytes(20));

export function totp(secret, t = Date.now(), step = 30) {
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(t / 1000 / step)));
  const mac = crypto.createHmac('sha1', unbase32(secret)).update(counter).digest();
  const o = mac[mac.length - 1] & 15;
  return String((mac.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, '0');
}
export function verifyTotp(secret, code, t = Date.now()) {
  const c = String(code || '').replace(/\D/g, '');
  if (!secret || c.length !== 6) return false;
  return [-1, 0, 1].some((w) => crypto.timingSafeEqual(Buffer.from(totp(secret, t + w * 30000)), Buffer.from(c)));
}
export const otpauthUrl = (secret, label) => `otpauth://totp/${encodeURIComponent(`MC DIGITAL:${label}`)}?secret=${secret}&issuer=${encodeURIComponent('MC DIGITAL')}&digits=6&period=30`;

export const twoFactorOff = () => process.env.DISABLE_2FA === '1';

// Segredo ativo da conta (null = sem 2 etapas). uid vazio = dono.
export async function activeSecret(uid) {
  if (uid) return (await db.one('users', { select: 'totp_secret', id: `eq.${uid}` }).catch(() => null))?.totp_secret || null;
  return (await getState('totp_owner'))?.secret || null;
}
export async function saveSecret(uid, secret) {
  if (uid) await db.update('users', { id: `eq.${uid}` }, { totp_secret: secret });
  else await setState('totp_owner', { secret, at: new Date().toISOString() });
}
