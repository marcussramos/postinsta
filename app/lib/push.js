// Notificações no celular/computador (Web Push), sem bibliotecas: VAPID (RFC 8292) + criptografia aes128gcm (RFC 8291).
// As chaves VAPID são geradas sozinhas na primeira vez e ficam em app_state (ou nas variáveis VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY).
import crypto from 'node:crypto';
import { db } from './db.js';
import { appUrl } from './env.js';
import { getState, setState } from './appstate.js';

const b64u = (b) => Buffer.from(b).toString('base64url');
const unb64u = (s) => Buffer.from(String(s), 'base64url');

let cached = null;
export async function vapidKeys() {
  if (cached) return cached;
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    const pub = unb64u(process.env.VAPID_PUBLIC_KEY);
    const jwk = { kty: 'EC', crv: 'P-256', x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)), d: process.env.VAPID_PRIVATE_KEY };
    return (cached = { publicKey: process.env.VAPID_PUBLIC_KEY, jwk });
  }
  let st = await getState('vapid');
  if (!st?.jwk) {
    const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const jwk = privateKey.export({ format: 'jwk' });
    st = { jwk, publicKey: b64u(Buffer.concat([Buffer.from([4]), unb64u(jwk.x), unb64u(jwk.y)])) };
    await setState('vapid', st);
  }
  return (cached = st);
}
export function resetVapidCache() { cached = null; }

function vapidJwt(audience, jwk, subject) {
  const header = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const claims = b64u(JSON.stringify({ aud: audience, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject }));
  const key = crypto.createPrivateKey({ key: jwk, format: 'jwk' });
  const sig = crypto.sign('sha256', Buffer.from(`${header}.${claims}`), { key, dsaEncoding: 'ieee-p1363' });
  return `${header}.${claims}.${b64u(sig)}`;
}

// Criptografa a mensagem para UMA inscrição (RFC 8291, um registro só).
export function encryptPayload(sub, payload) {
  const uaPublic = unb64u(sub.p256dh);
  const authSecret = unb64u(sub.auth);
  const ecdh = crypto.createECDH('prime256v1');
  const asPublic = ecdh.generateKeys();
  const shared = ecdh.computeSecret(uaPublic);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', shared, authSecret, Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]), 32));
  const salt = crypto.randomBytes(16);
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const body = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const rs = Buffer.alloc(4); rs.writeUInt32BE(4096);
  return Buffer.concat([salt, rs, Buffer.from([asPublic.length]), asPublic, body]);
}

export async function sendPush(sub, message, { ttl = 86400 } = {}) {
  const keys = await vapidKeys();
  const endpoint = new URL(sub.endpoint);
  let subject = 'mailto:contato@mcdigital.app';
  try { subject = appUrl(); } catch { /* sem endereço: usa o padrão */ }
  const jwt = vapidJwt(endpoint.origin, keys.jwk, subject);
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 6000);
  try {
    const r = await fetch(sub.endpoint, {
      method: 'POST', signal: ctrl.signal,
      headers: { Authorization: `vapid t=${jwt}, k=${keys.publicKey}`, 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: String(ttl), Urgency: 'high' },
      body: encryptPayload(sub, JSON.stringify(message)),
    });
    return r.status;
  } catch { return 0; } finally { clearTimeout(t); }
}

// Avisa todos os aparelhos inscritos. adminOnly: só quem é administrador (financeiro, propostas).
// Nunca derruba a ação principal: antes da atualização 9 do banco a tabela não existe e nada acontece.
export async function notify(message, { adminOnly = false } = {}) {
  let subs;
  try { subs = await db.select('push_subs', { select: '*', ...(adminOnly ? { role: 'eq.admin' } : {}), limit: 50 }); }
  catch { return 0; }
  const msg = { title: 'MC DIGITAL', url: '/equipe#inicio', ...message };
  const results = await Promise.all(subs.map(async (s) => {
    const status = await sendPush(s, msg);
    if (status === 404 || status === 410) await db.remove('push_subs', { id: `eq.${s.id}` }).catch(() => {});
    return status >= 200 && status < 300;
  }));
  return results.filter(Boolean).length;
}
