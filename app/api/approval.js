// Página pública do cliente. GET ?t=<token> lista os posts | POST registra a decisão.
// Não precisa de login: o token longo e aleatório do link é a credencial do cliente.
import crypto from 'node:crypto';
import { route, send, readJson, readRaw, query, need, redirect } from '../lib/http.js';
import { db, docs } from '../lib/db.js';
import { TIMEZONE } from '../lib/env.js';
import { CLIENT_CAN_DECIDE } from '../lib/posts.js';
import { logEvent } from '../lib/events.js';
import { recentFeed } from '../lib/feed.js';
import { notify } from '../lib/push.js';
import { decideScript } from '../lib/pasta/script.js';
import { publicScript } from '../public/roteiro.js';

async function clientByToken(t) {
  need(t && /^[0-9a-f]{32,}$/.test(t), 404, 'Link de aprovação inválido.');
  const c = await db.one('clients', { select: 'id,name,ig_username,ig_token,ig_user_id', approval_token: `eq.${t}` });
  need(c, 404, 'Este link de aprovação não existe mais. Peça um novo para a agência.');
  return c;
}

// Áudio do pedido de ajuste: o navegador grava (webm/opus no Android e Chrome, mp4/aac no iPhone).
const AUDIO_TYPES = { 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/aac': 'aac', 'audio/mpeg': 'mp3', 'audio/x-m4a': 'm4a', 'video/webm': 'webm', 'video/mp4': 'm4a' };
const isUuid = (v) => /^[0-9a-f-]{36}$/i.test(String(v || ''));
async function ownAudio(c, id) {
  if (!isUuid(id)) return null;
  const f = await db.one('client_files', { select: 'id,path,client_id,category', id: `eq.${id}` });
  return f && f.client_id === c.id && f.category === 'audio' ? f : null;
}

export default route({
  GET: async (req, res) => {
    const q = query(req);
    const c = await clientByToken(q.t);
    if (q.script_file) { // o cliente abre o roteiro anexado (PDF, Word…) de um post dele
      const p = /^[0-9a-f-]{36}$/i.test(q.script_file) ? await db.one('posts', { select: '*', id: `eq.${q.script_file}`, client_id: `eq.${c.id}` }) : null;
      const f = p?.script?.file ? await db.one('client_files', { select: 'id,path,client_id', id: `eq.${p.script.file.id}` }) : null;
      need(f && f.client_id === c.id, 404, 'Roteiro não encontrado.');
      return redirect(res, await docs.signedUrl(f.path, { expiresIn: 1800 }), { 'Cache-Control': 'no-store' });
    }
    if (q.audio) { // o cliente ouve o próprio áudio
      const f = await ownAudio(c, q.audio);
      need(f, 404, 'Áudio não encontrado.');
      return redirect(res, await docs.signedUrl(f.path, { expiresIn: 1800 }), { 'Cache-Control': 'no-store' });
    }
    const since = new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString();
    const posts = await db.select('posts', {
      select: '*',
      client_id: `eq.${c.id}`,
      status: `in.(${[...CLIENT_CAN_DECIDE, 'publishing', 'published'].join(',')})`,
      scheduled_at: `gte.${since}`,
      order: 'scheduled_at.asc',
      limit: 100,
    });
    // só o que o cliente precisa ver (sem notas internas da equipe)
    const pub = posts.map((p) => ({ id: p.id, image_url: p.image_url, caption: p.caption, alt_text: p.alt_text, scheduled_at: p.scheduled_at, status: p.status,
      client_feedback: p.client_feedback, feedback_audio: p.feedback_audio || null, decided_at: p.decided_at, ig_permalink: p.ig_permalink, media_type: p.media_type || 'IMAGE', media: p.media || null }));
    // roteiros de vídeo: os que esperam o cliente + os decididos nos últimos 10 dias
    const recent = Date.now() - 10 * 864e5;
    const withScript = await db.select('posts', { select: '*', client_id: `eq.${c.id}`, script: 'not.is.null', status: 'not.in.(published,publishing)', limit: 100 }).catch(() => []);
    const scripts = withScript
      .filter((p) => ['sent', 'changes'].includes(p.script?.status) || (p.script?.status === 'approved' && new Date(p.script.decided_at || 0) > recent))
      .sort((a, b) => String(a.scheduled_at || '9').localeCompare(String(b.scheduled_at || '9')))
      .map((p) => ({ id: p.id, title: p.title, media_type: p.media_type || 'REELS', scheduled_at: p.scheduled_at, script: publicScript(p.script) }));
    const feed = q.feed && c.ig_token ? await recentFeed(c).catch(() => []) : undefined;
    send(res, 200, { client: { name: c.name, ig_username: c.ig_username, ig_connected: Boolean(c.ig_token) }, timezone: TIMEZONE(), posts: pub, scripts, feed });
  },

  POST: async (req, res) => {
    const q = query(req);
    if (q.audio) { // envia a gravação; devolve o id para mandar junto com o pedido de ajuste
      const c = await clientByToken(q.t);
      const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      const ext = AUDIO_TYPES[type];
      need(ext, 415, 'Formato de áudio não suportado. Tente gravar de novo ou escreva o pedido.');
      const recent = await db.select('client_files', { select: 'id', client_id: `eq.${c.id}`, category: 'eq.audio', created_at: `gte.${new Date(Date.now() - 864e5).toISOString()}` });
      need(recent.length < 60, 429, 'Muitos áudios hoje. Escreva o pedido ou tente amanhã.');
      const buf = await readRaw(req);
      need(buf.length > 800, 400, 'O áudio ficou vazio. Grave de novo.');
      need(buf.length <= 4 * 1024 * 1024, 413, 'Áudio longo demais (até uns 3 minutos).');
      const stamp = new Intl.DateTimeFormat('pt-BR', { timeZone: TIMEZONE(), day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date()).replace(/[/:, ]+/g, '-');
      const path = `${c.id}/audio/${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${ext}`;
      await docs.upload(path, buf, type.replace('video/', 'audio/'));
      const row = await db.insert('client_files', { client_id: c.id, category: 'audio', name: `Ajuste por audio ${stamp}.${ext}`, path, mime: type.replace('video/', 'audio/'), size: buf.length });
      return send(res, 201, { audio_id: row.id });
    }
    const body = await readJson(req);
    const c = await clientByToken(body.t);
    if (body.kind === 'script') { // aprovação do roteiro (antes de gravar)
      need(['approve', 'changes'].includes(body.decision), 400, 'Escolha aprovar ou pedir ajuste.');
      const audio = body.decision === 'changes' && body.audio_id ? await ownAudio(c, body.audio_id) : null;
      need(!body.audio_id || audio || body.decision === 'approve', 400, 'Áudio não encontrado. Grave de novo.');
      const row = await decideScript(c, body, audio);
      return send(res, 200, { id: row.id, script: publicScript(row.script) });
    }
    need(/^[0-9a-f-]{36}$/i.test(String(body.post_id || '')), 400, 'Post inválido.');
    need(['approve', 'changes'].includes(body.decision), 400, 'Escolha aprovar ou pedir ajuste.');
    const feedback = String(body.feedback || '').trim().slice(0, 1000);
    const audio = body.decision === 'changes' && body.audio_id ? await ownAudio(c, body.audio_id) : null;
    need(!body.audio_id || audio || body.decision === 'approve', 400, 'Áudio não encontrado. Grave de novo.');
    need(body.decision === 'approve' || feedback || audio, 400, 'Escreva ou grave o que você quer mudar.');
    const patch = body.decision === 'approve'
      ? { status: 'approved', client_feedback: feedback || null, decided_at: new Date().toISOString() }
      : { status: 'changes_requested', client_feedback: feedback || (audio ? '🎤 Pedido por áudio' : ''), decided_at: new Date().toISOString(), ...(audio ? { feedback_audio: audio.id } : {}) };
    if (body.decision === 'approve' || !audio) { // limpa um áudio antigo (só se a coluna já existe)
      const cur = await db.one('posts', { select: '*', id: `eq.${body.post_id}` }).catch(() => null);
      if (cur && 'feedback_audio' in cur) patch.feedback_audio = null;
    }
    const [row] = await db.update('posts', {
      id: `eq.${body.post_id}`,
      client_id: `eq.${c.id}`,                       // só posts deste cliente
      status: `in.(${CLIENT_CAN_DECIDE.join(',')})`,  // e ainda não publicados
    }, patch);
    need(row, 409, 'Este post já foi publicado ou saiu da fila de aprovação.');
    await logEvent(row, body.decision === 'approve' ? 'approved' : 'changes_requested', [audio ? '🎤 áudio' : null, feedback || null].filter(Boolean).join(' · ') || null);
    const what = row.title || (row.caption || '').split('\n')[0].slice(0, 80) || 'post';
    await notify(body.decision === 'approve'
      ? { title: `✅ ${c.name} aprovou`, body: `${what}${feedback ? ` — “${feedback.slice(0, 100)}”` : ''}`, url: '/equipe#agenda', tag: `post-${row.id}` }
      : { title: `✏️ ${c.name} pediu ajuste${audio ? ' por áudio 🎤' : ''}`, body: feedback ? `${what}: “${feedback.slice(0, 140)}”` : `${what}: ouça o áudio no post.`, url: '/equipe#fluxo', tag: `post-${row.id}` });
    send(res, 200, { id: row.id, status: row.status, client_feedback: row.client_feedback, feedback_audio: row.feedback_audio || null, decided_at: row.decided_at });
  },
});
