// Página pública do cliente. GET ?t=<token> lista os posts | POST registra a decisão.
// Não precisa de login: o token longo e aleatório do link é a credencial do cliente.
import { route, send, readJson, query, need } from '../lib/http.js';
import { db } from '../lib/db.js';
import { TIMEZONE } from '../lib/env.js';
import { CLIENT_CAN_DECIDE } from '../lib/posts.js';
import { logEvent } from '../lib/events.js';
import { recentFeed } from '../lib/feed.js';

async function clientByToken(t) {
  need(t && /^[0-9a-f]{32,}$/.test(t), 404, 'Link de aprovação inválido.');
  const c = await db.one('clients', { select: 'id,name,ig_username,ig_token,ig_user_id', approval_token: `eq.${t}` });
  need(c, 404, 'Este link de aprovação não existe mais. Peça um novo para a agência.');
  return c;
}

export default route({
  GET: async (req, res) => {
    const q = query(req);
    const c = await clientByToken(q.t);
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
      client_feedback: p.client_feedback, decided_at: p.decided_at, ig_permalink: p.ig_permalink, media_type: p.media_type || 'IMAGE', media: p.media || null }));
    const feed = q.feed && c.ig_token ? await recentFeed(c).catch(() => []) : undefined;
    send(res, 200, { client: { name: c.name, ig_username: c.ig_username, ig_connected: Boolean(c.ig_token) }, timezone: TIMEZONE(), posts: pub, feed });
  },

  POST: async (req, res) => {
    const body = await readJson(req);
    const c = await clientByToken(body.t);
    need(/^[0-9a-f-]{36}$/i.test(String(body.post_id || '')), 400, 'Post inválido.');
    need(['approve', 'changes'].includes(body.decision), 400, 'Escolha aprovar ou pedir ajuste.');
    const feedback = String(body.feedback || '').trim().slice(0, 1000);
    need(body.decision === 'approve' || feedback, 400, 'Escreva o que você quer mudar.');
    const patch = body.decision === 'approve'
      ? { status: 'approved', client_feedback: feedback || null, decided_at: new Date().toISOString() }
      : { status: 'changes_requested', client_feedback: feedback, decided_at: new Date().toISOString() };
    const [row] = await db.update('posts', {
      id: `eq.${body.post_id}`,
      client_id: `eq.${c.id}`,                       // só posts deste cliente
      status: `in.(${CLIENT_CAN_DECIDE.join(',')})`,  // e ainda não publicados
    }, patch);
    need(row, 409, 'Este post já foi publicado ou saiu da fila de aprovação.');
    await logEvent(row, body.decision === 'approve' ? 'approved' : 'changes_requested', feedback || null);
    send(res, 200, { id: row.id, status: row.status, client_feedback: row.client_feedback, decided_at: row.decided_at });
  },
});
