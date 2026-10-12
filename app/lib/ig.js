// Instagram API com Login do Instagram (sem precisar de Página do Facebook).
// Documentação: https://developers.facebook.com/docs/instagram-platform/content-publishing
import { env, appUrl, IG_API_VERSION } from './env.js';

const SCOPES = ['instagram_business_basic', 'instagram_business_content_publish'];
const graph = () => `https://graph.instagram.com/${IG_API_VERSION()}`;

export class IgError extends Error {
  constructor(message, { status, code, transient } = {}) {
    super(message);
    this.status = status; this.code = code;
    // Erros temporários (instabilidade, limite de uso) podem ser tentados de novo.
    this.transient = transient ?? (status >= 500 || [1, 2, 4, 17, 32, 613, 9004].includes(code));
  }
}

async function igFetch(url, init) {
  let res;
  try { res = await fetch(url, init); }
  catch (e) { throw new IgError(`Sem conexão com o Instagram: ${e.message}`, { transient: true }); }
  const text = await res.text();
  let body; try { body = JSON.parse(text); } catch { body = { raw: text }; }
  if (!res.ok || body.error || body.error_message) {
    const err = body.error || {};
    const msg = err.error_user_msg || err.message || body.error_message || text || res.statusText;
    throw new IgError(`Instagram: ${msg}`, { status: res.status, code: err.code });
  }
  return body;
}

const form = (obj) => new URLSearchParams(Object.entries(obj).filter(([, v]) => v !== undefined && v !== null && v !== ''));

export const redirectUri = () => `${appUrl()}/api/ig/callback`;

export function authorizeUrl(state) {
  const u = new URL('https://www.instagram.com/oauth/authorize');
  u.search = form({
    client_id: env('IG_APP_ID'),
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: SCOPES.join(','),
    state,
    force_reauth: 'true', // sempre pede para escolher a conta: evita conectar o perfil errado
  }).toString();
  return u.toString();
}

// Troca o código do login por um token de 60 dias e descobre qual perfil foi conectado.
export async function connectAccount(code) {
  const short = await igFetch('https://api.instagram.com/oauth/access_token', {
    method: 'POST',
    body: form({
      client_id: env('IG_APP_ID'),
      client_secret: env('IG_APP_SECRET'),
      grant_type: 'authorization_code',
      redirect_uri: redirectUri(),
      code: String(code).replace(/#_$/, ''),
    }),
  });
  const s = Array.isArray(short.data) ? short.data[0] : short;
  const perms = String(s.permissions || '');
  if (perms && !perms.includes('instagram_business_content_publish')) {
    throw new IgError('A permissão de publicar não foi concedida. Conecte de novo e aceite todas as permissões.', { transient: false });
  }
  const long = await igFetch(`https://graph.instagram.com/access_token?${form({
    grant_type: 'ig_exchange_token',
    client_secret: env('IG_APP_SECRET'),
    access_token: s.access_token,
  })}`);
  const me = await igFetch(`${graph()}/me?${form({ fields: 'user_id,username', access_token: long.access_token })}`);
  return {
    ig_user_id: String(me.user_id || me.id || s.user_id),
    ig_username: me.username || null,
    ig_token: long.access_token,
    ig_token_expires_at: new Date(Date.now() + (Number(long.expires_in) || 5184000) * 1000).toISOString(),
  };
}

export async function refreshToken(token) {
  const r = await igFetch(`https://graph.instagram.com/refresh_access_token?${form({ grant_type: 'ig_refresh_token', access_token: token })}`);
  return {
    ig_token: r.access_token,
    ig_token_expires_at: new Date(Date.now() + (Number(r.expires_in) || 5184000) * 1000).toISOString(),
  };
}

// Passo 1 da publicação: cria o "container" com a imagem e a legenda.
export async function createContainer(igUserId, token, { image_url, caption, alt_text }) {
  const post = (extra) => igFetch(`${graph()}/${igUserId}/media`, {
    method: 'POST',
    body: form({ image_url, caption, access_token: token, ...extra }),
  });
  try {
    return (await post({ alt_text })).id;
  } catch (e) {
    // Se a API recusar o texto alternativo, publica sem ele em vez de falhar o post.
    if (alt_text && /alt_text/i.test(e.message)) return (await post({})).id;
    throw e;
  }
}

// FINISHED = pronto; IN_PROGRESS = processando; ERROR/EXPIRED = falhou.
export async function containerStatus(containerId, token) {
  const r = await igFetch(`${graph()}/${containerId}?${form({ fields: 'status_code,status', access_token: token })}`);
  return { code: r.status_code, detail: r.status };
}

// Passo 2: publica o container no feed.
export async function publishContainer(igUserId, token, containerId) {
  const r = await igFetch(`${graph()}/${igUserId}/media_publish`, {
    method: 'POST',
    body: form({ creation_id: containerId, access_token: token }),
  });
  return r.id;
}

export async function permalink(mediaId, token) {
  try {
    const r = await igFetch(`${graph()}/${mediaId}?${form({ fields: 'permalink', access_token: token })}`);
    return r.permalink || null;
  } catch { return null; }
}
