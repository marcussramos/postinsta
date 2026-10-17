// O publicador: roda a cada 5 minutos (chamado pelo agendador do Supabase).
// 1) renova tokens do Instagram perto de vencer
// 2) termina publicações em andamento
// 3) publica os posts aprovados cujo horário chegou
import { db } from './db.js';
import * as ig from './ig.js';
import { logEvent } from './events.js';
import { notify } from './push.js';
import { signMedia } from './media.js';

const MAX_ATTEMPTS = 3;
const STUCK_MS = 30 * 60 * 1000;     // container processando há mais de 30 min = falha
const REFRESH_BEFORE_MS = 10 * 24 * 3600 * 1000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function runPublisher({ budgetMs = 45000, now = () => Date.now(), wait = sleep } = {}) {
  const started = now();
  const timeLeft = () => budgetMs - (now() - started);
  const log = { refreshed: [], published: [], failed: [], retrying: [], waiting: [] };

  const clients = await db.select('clients', { select: 'id,name,ig_user_id,ig_username,ig_token,ig_token_expires_at,ig_connected_at', ig_token: 'not.is.null' });
  const byId = new Map(clients.map((c) => [c.id, c]));

  // 1) Tokens: valem 60 dias; renovamos quando faltam menos de 10.
  for (const c of clients) {
    const exp = new Date(c.ig_token_expires_at || 0).getTime();
    const age = now() - new Date(c.ig_connected_at || 0).getTime();
    if (exp - now() > REFRESH_BEFORE_MS || age < 24 * 3600 * 1000) continue;
    try {
      const t = await ig.refreshToken(c.ig_token);
      await db.update('clients', { id: `eq.${c.id}` }, t);
      Object.assign(c, t);
      log.refreshed.push(c.name);
    } catch (e) {
      log.failed.push({ client: c.name, error: `Renovação do token: ${e.message}` });
    }
  }

  // 2) Publicações já iniciadas (container criado, esperando processar).
  const inFlight = await db.select('posts', { select: '*', status: 'eq.publishing', order: 'scheduled_at.asc', limit: 20 });
  for (const p of inFlight) {
    if (timeLeft() < 8000) break;
    await finish(p, byId.get(p.client_id), log, now);
  }

  // 3) Aprovados com horário vencido.
  const due = await db.select('posts', {
    select: '*', status: 'eq.approved', scheduled_at: `lte.${new Date(now()).toISOString()}`,
    order: 'scheduled_at.asc', limit: 15,
  });
  for (const p of due) {
    if (timeLeft() < 10000) break;
    const c = byId.get(p.client_id);
    // Trava: só segue se o post ainda estiver "approved" (evita publicar em dobro).
    const [claimed] = await db.update('posts', { id: `eq.${p.id}`, status: 'eq.approved' },
      { status: 'publishing', attempts: (p.attempts || 0) + 1, last_error: null });
    if (!claimed) continue;
    if (!c?.ig_token) {
      await fail(claimed, 'O Instagram deste cliente não está conectado.', log, true);
      continue;
    }
    try {
      // com "Fotos privadas" ligado, a Meta recebe links assinados (válidos por 7 dias) para baixar a mídia
      const containerId = await ig.createPostContainer(c.ig_user_id, c.ig_token, await signMedia(claimed), { wait });
      await db.update('posts', { id: `eq.${claimed.id}` }, { ig_container_id: containerId });
      claimed.ig_container_id = containerId;
      const isVideo = claimed.media_type === 'REELS' || (claimed.media || []).some((m) => m.kind === 'video');
      await wait(isVideo ? 8000 : 3000); // vídeo demora mais; se não ficar pronto, termina na próxima rodada
      await finish(claimed, c, log, now);
    } catch (e) {
      await handleError(claimed, e, log);
    }
  }
  // Registra que o agendador rodou (a aba Ajustes do painel mostra "última execução").
  try {
    await db.upsert('app_state', {
      key: 'publisher',
      value: { at: new Date(now()).toISOString(), published: log.published.length, failed: log.failed.length },
      updated_at: new Date(now()).toISOString(),
    });
  } catch (e) {
    // não impede a publicação; aparece na resposta do agendador para diagnóstico
    log.state_error = e.message;
  }
  return log;
}

async function finish(p, c, log, now) {
  if (!c?.ig_token) return fail(p, 'O Instagram deste cliente não está conectado.', log, true);
  if (!p.ig_container_id) return backToQueue(p, 'Publicação interrompida; tentando de novo.', log);
  try {
    // carrossel com vídeo: espera os itens processarem e só então cria o carrossel
    if (p.ig_container_id.startsWith(ig.CHILDREN)) {
      const children = p.ig_container_id.slice(ig.CHILDREN.length).split(',').filter(Boolean);
      if (await ig.carouselChildren(children, c.ig_token) === 'waiting') {
        if (now() - new Date(p.updated_at || p.scheduled_at).getTime() > STUCK_MS * 2) return handleError(p, new ig.IgError('O Instagram demorou demais para processar os vídeos do carrossel.', { transient: true }), log);
        log.waiting.push(p.id);
        return;
      }
      const parent = await ig.createCarouselParent(c.ig_user_id, c.ig_token, children, p.caption);
      await db.update('posts', { id: `eq.${p.id}` }, { ig_container_id: parent });
      p.ig_container_id = parent;
    }
    const st = await ig.containerStatus(p.ig_container_id, c.ig_token);
    if (st.code === 'IN_PROGRESS') {
      const limit = (p.media || []).some((m) => m.kind === 'video') ? STUCK_MS * 2 : STUCK_MS; // vídeo pode levar mais tempo
      if (now() - new Date(p.updated_at || p.scheduled_at).getTime() > limit) {
        return handleError(p, new ig.IgError(p.media_type === 'REELS' ? 'O Instagram demorou demais para processar o vídeo.' : 'O Instagram demorou demais para processar a imagem.', { transient: true }), log);
      }
      log.waiting.push(p.id);
      return;
    }
    if (st.code === 'ERROR' || st.code === 'EXPIRED') {
      const what = p.media_type === 'STORY' ? 'o Story (use 9:16; vídeo até 60 s)' : p.media_type === 'REELS' ? 'o vídeo (confira: MP4/MOV, H.264, 3 s a 15 min, até 50 MB)' : p.media_type === 'CAROUSEL' ? 'o carrossel' : 'a imagem';
      return handleError(p, new ig.IgError(`O Instagram recusou ${what} (${st.detail || st.code}).`, { transient: st.code === 'EXPIRED' }), log);
    }
    if (st.code === 'PUBLISHED') { // já saiu numa rodada anterior que caiu antes de registrar
      await db.update('posts', { id: `eq.${p.id}` }, { status: 'published', published_at: new Date().toISOString(), last_error: null });
      log.published.push({ id: p.id, client: c.name, permalink: null });
      return;
    }
    const mediaId = await ig.publishContainer(c.ig_user_id, c.ig_token, p.ig_container_id);
    const link = await ig.permalink(mediaId, c.ig_token);
    await db.update('posts', { id: `eq.${p.id}` }, {
      status: 'published', ig_media_id: mediaId, ig_permalink: link, published_at: new Date().toISOString(), last_error: null,
    });
    log.published.push({ id: p.id, client: c.name, permalink: link });
    await logEvent({ ...p, ig_permalink: link }, 'published');
  } catch (e) {
    await handleError(p, e, log);
  }
}

async function handleError(p, e, log) {
  const attempts = p.attempts || 1;
  if (e.transient && attempts < MAX_ATTEMPTS) return backToQueue(p, e.message, log);
  return fail(p, e.message, log);
}

async function backToQueue(p, message, log) {
  await db.update('posts', { id: `eq.${p.id}` }, { status: 'approved', ig_container_id: null, last_error: message });
  log.retrying.push({ id: p.id, error: message });
}

async function fail(p, message, log, keepTrying = false) {
  // Sem Instagram conectado: deixa aprovado para sair assim que reconectarem.
  const patch = keepTrying && (p.attempts || 1) < MAX_ATTEMPTS
    ? { status: 'approved', last_error: message }
    : { status: 'failed', last_error: message };
  await db.update('posts', { id: `eq.${p.id}` }, patch);
  log.failed.push({ id: p.id, error: message });
  if (patch.status === 'failed') {
    await logEvent(p, 'failed', message);
    const c = await db.one('clients', { select: 'name', id: `eq.${p.client_id}` }).catch(() => null);
    await notify({ title: `⚠️ Post de ${c?.name || 'cliente'} não publicou`, body: String(message).slice(0, 160), url: '/#agenda', tag: `fail-${p.id}` });
  }
}
