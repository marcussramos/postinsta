// Instagram API com Login do Instagram (sem precisar de Página do Facebook).
// Documentação: https://developers.facebook.com/docs/instagram-platform/content-publishing
import { env, appUrl, IG_API_VERSION } from './env.js';

// manage_insights: métricas para os relatórios mensais (clientes conectados antes precisam reconectar)
const SCOPES = ['instagram_business_basic', 'instagram_business_content_publish', 'instagram_business_manage_insights'];
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
    scoped_id: String(me.id || s.user_id || ''), // ID no escopo do app: é o que a Meta manda ao remover o app ou pedir exclusão
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

// Cria o container certo para cada formato de post.
//   IMAGE    → uma imagem (image_url)
//   CAROUSEL → um container por imagem (is_carousel_item) + o container "pai" com children
//   REELS    → video_url + capa (cover_url); o Instagram processa o vídeo por alguns minutos
export async function createPostContainer(igUserId, token, post, { wait = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const type = post.media_type || 'IMAGE';
  if (type === 'IMAGE') return createContainer(igUserId, token, { image_url: post.image_url, caption: post.caption, alt_text: post.alt_text });
  const create = (fields) => igFetch(`${graph()}/${igUserId}/media`, { method: 'POST', body: form({ ...fields, access_token: token }) }).then((r) => r.id);
  if (type === 'STORY') { // Stories não têm legenda; vídeo ou imagem em 9:16
    const video = (post.media || []).find((m) => m.kind === 'video');
    return create(video ? { media_type: 'STORIES', video_url: video.url } : { media_type: 'STORIES', image_url: post.image_url });
  }
  if (type === 'REELS') {
    const video = (post.media || []).find((m) => m.kind === 'video');
    if (!video) throw new IgError('O Reels está sem vídeo.', { transient: false });
    return create({ media_type: 'REELS', video_url: video.url, cover_url: post.image_url, caption: post.caption, share_to_feed: 'true' });
  }
  // CAROUSEL
  const items = (post.media || []).filter((m) => m.kind === 'image').slice(0, 10);
  if (items.length < 2) throw new IgError('O carrossel precisa de pelo menos 2 imagens.', { transient: false });
  const children = [];
  for (const it of items) children.push(await create({ image_url: it.url, is_carousel_item: 'true' }));
  // espera os itens ficarem prontos (imagens costumam levar segundos)
  for (let i = 0; i < 6; i++) {
    const st = await Promise.all(children.map((id) => containerStatus(id, token)));
    if (st.some((x) => x.code === 'ERROR' || x.code === 'EXPIRED')) throw new IgError('O Instagram recusou uma das imagens do carrossel.', { transient: false });
    if (st.every((x) => x.code === 'FINISHED')) break;
    await wait(2000);
  }
  return create({ media_type: 'CAROUSEL', children: children.join(','), caption: post.caption });
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

// ───────── métricas (relatórios)
// Sem a permissão de métricas a API responde (#10)/(#200)/"permission": o cliente precisa reconectar.
export const isPermissionError = (e) => [10, 200, 190].includes(e?.code) || /permiss|not authorized|does not have/i.test(e?.message || '');

export async function profile(token) {
  return igFetch(`${graph()}/me?${form({ fields: 'user_id,username,followers_count,media_count', access_token: token })}`);
}

// Posts publicados entre since e until (ms). Percorre o feed do mais novo para o mais antigo.
export async function mediaBetween(igUserId, token, since, until, maxPages = 8) {
  const fields = 'id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count';
  let url = `${graph()}/${igUserId}/media?${form({ fields, limit: 50, access_token: token })}`;
  const out = [];
  for (let i = 0; i < maxPages && url; i++) {
    const r = await igFetch(url);
    let older = false;
    for (const m of r.data || []) {
      const t = new Date(m.timestamp).getTime();
      if (t < since) { older = true; continue; }
      if (t < until) out.push(m);
    }
    if (older) break;
    url = r.paging?.next || null;
  }
  return out;
}

const MEDIA_METRICS = ['reach', 'likes', 'comments', 'saved', 'shares', 'views', 'total_interactions'];
// Métricas de um post. Pede tudo; se a API recusar alguma, cai para o conjunto básico.
export async function mediaInsights(mediaId, token) {
  const read = (r) => Object.fromEntries((r.data || []).map((d) => [d.name, d.values?.[0]?.value ?? d.total_value?.value ?? null]));
  try {
    return read(await igFetch(`${graph()}/${mediaId}/insights?${form({ metric: MEDIA_METRICS.join(','), access_token: token })}`));
  } catch (e) {
    if (isPermissionError(e)) throw e;
    return read(await igFetch(`${graph()}/${mediaId}/insights?${form({ metric: 'reach,likes,comments,saved,shares', access_token: token })}`));
  }
}

// Total de uma métrica da conta num período (segundos unix). null = indisponível.
export async function accountTotal(igUserId, token, metric, since, until, extra = {}) {
  const r = await igFetch(`${graph()}/${igUserId}/insights?${form({ metric, period: 'day', metric_type: 'total_value', since, until, access_token: token, ...extra })}`);
  const d = (r.data || [])[0];
  if (!d) return null;
  if (extra.breakdown) {
    const res = d.total_value?.breakdowns?.[0]?.results || [];
    return Object.fromEntries(res.map((x) => [x.dimension_values?.[0], x.value]));
  }
  return d.total_value?.value ?? null;
}
