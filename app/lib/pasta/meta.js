// Avisos da Meta (públicos, assinados com IG_APP_SECRET):
//   igdeauth  POST signed_request   a pessoa removeu o app no Instagram → apaga o token da conta
//   igdelete  POST signed_request   pedido de exclusão de dados → apaga e devolve {url, confirmation_code}
// Configure no app da Meta (Instagram → Configurar login de empresa do Instagram):
//   "URL de retorno de chamada para cancelar autorização" = <app>/api/pasta?r=igdeauth
//   "URL de solicitação de exclusão de dados"             = <app>/api/pasta?r=igdelete
import crypto from 'node:crypto';
import { route, send, readRaw, need } from '../http.js';
import { db } from '../db.js';
import { env, appUrl } from '../env.js';
import { getState, setState } from '../appstate.js';
import { notify } from '../push.js';

const CLEAR = { ig_token: null, ig_token_expires_at: null, ig_user_id: null, ig_username: null, ig_connected_at: null };

export function parseSignedRequest(sr, secret) {
  const [sig, payload] = String(sr || '').split('.');
  if (!sig || !payload) return null;
  const expected = crypto.createHmac('sha256', secret).update(payload).digest();
  let got;
  try { got = Buffer.from(sig.replace(/-/g, '+').replace(/_/g, '/'), 'base64'); } catch { return null; }
  if (got.length !== expected.length || !crypto.timingSafeEqual(got, expected)) return null;
  try { return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); } catch { return null; }
}

async function signedBody(req) {
  let b = 'body' in req ? req.body : undefined;
  if (!b || typeof b !== 'object' || Buffer.isBuffer(b)) {
    const raw = Buffer.isBuffer(b) ? b.toString('utf8') : typeof b === 'string' ? b : (await readRaw(req)).toString('utf8');
    b = raw.trim().startsWith('{') ? JSON.parse(raw) : Object.fromEntries(new URLSearchParams(raw));
  }
  const data = parseSignedRequest(b.signed_request, env('IG_APP_SECRET'));
  need(data && data.user_id, 400, 'signed_request inválido.');
  return data;
}

// Acha os clientes desta conta: pelo ID guardado na conexão (escopo do app) ou pelo ID da conta profissional.
async function clientsOf(userId) {
  const id = String(userId);
  const map = (await getState('ig_ids', {})) || {};
  const ids = new Set(Object.entries(map).filter(([k]) => k === id).map(([, v]) => v));
  for (const c of await db.select('clients', { select: 'id', ig_user_id: `eq.${id}` }).catch(() => [])) ids.add(c.id);
  return { ids: [...ids], map };
}

async function wipe(userId) {
  const { ids, map } = await clientsOf(userId);
  const names = [];
  for (const id of ids) {
    const [row] = await db.update('clients', { id: `eq.${id}` }, CLEAR).catch(() => []);
    if (row) names.push(row.name);
  }
  if (map[String(userId)]) { delete map[String(userId)]; await setState('ig_ids', map); }
  return names;
}

export const igDeauthRoute = route({
  POST: async (req, res) => {
    const data = await signedBody(req);
    const names = await wipe(data.user_id);
    if (names.length) await notify({ title: '⚠️ Instagram desconectado', body: `${names.join(', ')} removeu o acesso do app no Instagram. Peça para conectar de novo.`, url: '/#clientes' }, { adminOnly: true }).catch(() => {});
    send(res, 200, { ok: true });
  },
});

export const igDeleteRoute = route({
  POST: async (req, res) => {
    const data = await signedBody(req);
    const names = await wipe(data.user_id);
    const code = crypto.randomBytes(8).toString('hex');
    const log = (await getState('ig_deletions', {})) || {};
    log[code] = { at: new Date().toISOString(), clients: names.length };
    const keep = Object.entries(log).sort((a, b) => b[1].at.localeCompare(a[1].at)).slice(0, 300);
    await setState('ig_deletions', Object.fromEntries(keep));
    await notify({ title: '🗑️ Pedido de exclusão de dados', body: `${names.length ? names.join(', ') : 'Uma conta do Instagram'} pediu exclusão dos dados pela Meta (código ${code}). O token já foi apagado; apague o restante em até 30 dias se o contrato terminou.`, url: '/#clientes' }, { adminOnly: true }).catch(() => {});
    send(res, 200, { url: `${appUrl()}/exclusao-de-dados?code=${code}`, confirmation_code: code });
  },
});

// Guarda o ID da conta no escopo do app (é o que a Meta manda nos avisos acima).
export async function rememberScopedId(scopedId, clientId) {
  if (!scopedId) return;
  const map = (await getState('ig_ids', {})) || {};
  for (const [k, v] of Object.entries(map)) if (v === clientId) delete map[k];
  map[String(scopedId)] = clientId;
  await setState('ig_ids', map);
}
