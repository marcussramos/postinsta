// Posts. GET lista | POST cria (um ou vários clientes) | PATCH ?id= edita ou executa ação | DELETE ?id= remove
import { route, send, readJson, query, need } from '../lib/http.js';
import { requireStaff } from '../lib/auth.js';
import { db, storage } from '../lib/db.js';
import { logEvent } from '../lib/events.js';
import { cleanPostInput, actionPatch, statusAfterEdit, readyProblem, EDITABLE, CONTENT_FIELDS } from '../lib/posts.js';

// '*' (e não uma lista fixa) para o painel continuar abrindo mesmo antes da atualização do banco.
const LIST_FIELDS = '*';

// A mesma mídia pode estar em posts de vários clientes: só apaga quando ninguém mais usa.
async function removeImageIfUnused(path) {
  if (!path) return;
  const still = await db.select('posts', { select: 'id', image_path: `eq.${path}`, limit: 1 });
  if (!still.length) await storage.remove(path);
}
async function removeMediaIfUnused(media) {
  for (const m of media || []) {
    if (!m?.path) continue;
    const still = await db.select('posts', { select: 'id', media: `cs.${JSON.stringify([{ path: m.path }])}`, limit: 1 }).catch(() => [1]);
    const asCover = await db.select('posts', { select: 'id', image_path: `eq.${m.path}`, limit: 1 }).catch(() => [1]);
    if (!still.length && !asCover.length) await storage.remove(m.path);
  }
}
const pathsOf = (media) => new Set((media || []).map((m) => m.path).filter(Boolean));

export default route({
  GET: async (req, res) => {
    await requireStaff(req);
    const q = query(req);
    const params = { select: LIST_FIELDS, order: 'scheduled_at.asc.nullslast', limit: 1000 };
    if (q.client) params.client_id = `eq.${q.client}`;
    if (q.status) params.status = `in.(${q.status})`;
    if (q.from && q.to) params.and = `(scheduled_at.gte.${q.from},scheduled_at.lt.${q.to})`;
    // posts sem data (ideias) sempre aparecem
    else if (q.from) params.or = `(scheduled_at.gte.${q.from},scheduled_at.is.null)`;
    send(res, 200, await db.select('posts', params));
  },

  POST: async (req, res) => {
    await requireStaff(req);
    const body = await readJson(req);
    // Lembrete de aprovação: registra no histórico de cada post pendente do cliente (o envio é pelo WhatsApp/e-mail do painel).
    if (body.remind_client) {
      const pend = await db.select('posts', { select: '*', client_id: `eq.${body.remind_client}`, status: 'eq.pending_approval' });
      for (const p of pend) await logEvent(p, 'reminded', body.channel ? `por ${String(body.channel).slice(0, 20)}` : null);
      return send(res, 200, { reminded: pend.length });
    }
    const data = cleanPostInput(body);
    const ids = [...new Set((Array.isArray(body.client_ids) ? body.client_ids : [body.client_id]).filter(Boolean))];
    need(ids.length, 400, 'Escolha pelo menos um cliente.');
    need(ids.length <= 20, 400, 'No máximo 20 clientes por vez.');
    const found = await db.select('clients', { select: 'id', id: `in.(${ids.join(',')})` });
    need(found.length === ids.length, 404, 'Cliente não encontrado.');

    const now = new Date().toISOString();
    const status = body.send ? 'pending_approval' : body.approved ? 'approved' : body.stage === 'idea' ? 'idea'
      : body.stage === 'internal_review' ? 'internal_review' : 'draft';
    if (['pending_approval', 'approved'].includes(status)) need(!readyProblem(data), 400, readyProblem(data));

    const rows = [];
    for (const client_id of ids) {
      rows.push(await db.insert('posts', {
        ...data,
        client_id,
        status,
        sent_for_approval_at: status === 'pending_approval' ? now : null,
        decided_at: status === 'approved' ? now : null,
      }));
    }
    for (const r of rows) if (status === 'pending_approval') await logEvent(r, 'sent'); else if (status === 'approved') await logEvent(r, 'approved_by_agency');
    send(res, 201, Array.isArray(body.client_ids) ? rows : rows[0]);
  },

  PATCH: async (req, res) => {
    await requireStaff(req);
    const { id } = query(req);
    need(id, 400, 'Post não informado.');
    const body = await readJson(req);

    if (body.action) {
      const a = actionPatch(body.action);
      need(a, 400, 'Ação desconhecida.');
      if (a.complete) {
        const cur = await db.one('posts', { select: '*', id: `eq.${id}` });
        need(cur, 404, 'Post não encontrado.');
        need(!readyProblem(cur), 400, readyProblem(cur));
      }
      const [row] = await db.update('posts', { id: `eq.${id}`, status: `in.(${a.from.join(',')})` }, a.patch);
      need(row, 409, 'Este post não pode ir para essa etapa agora. Atualize a página e tente de novo.');
      if (body.action === 'send') await logEvent(row, 'sent');
      if (body.action === 'approve') await logEvent(row, 'approved_by_agency');
      return send(res, 200, row);
    }

    // Edição. Conteúdo novo em post já enviado/aprovado volta para produção,
    // para o cliente aprovar a versão nova (ou já reenvia, com send: true).
    const patch = cleanPostInput(body);
    need(Object.keys(patch).length || body.send, 400, 'Nada para alterar.');
    const old = await db.one('posts', { select: '*', id: `eq.${id}` });
    need(old, 404, 'Post não encontrado.');
    if (!('media_type' in old) && (patch.media_type || 'IMAGE') === 'IMAGE' && !patch.media) { delete patch.media_type; delete patch.media; }
    need(EDITABLE.includes(old.status), 409, 'Post publicado ou publicando não pode ser editado.');
    const contentChanged = CONTENT_FIELDS.some((k) => k in patch);
    const next = statusAfterEdit(old.status, contentChanged, Boolean(body.send));
    if (next === 'pending_approval') {
      need(!readyProblem({ ...old, ...patch }), 400, readyProblem({ ...old, ...patch }));
      Object.assign(patch, { sent_for_approval_at: new Date().toISOString(), client_feedback: null, decided_at: null });
    }
    if (['pending_approval', 'approved'].includes(next)) need(!readyProblem({ ...old, ...patch }), 400, `${readyProblem({ ...old, ...patch })} Para tirar a data, volte o post para produção antes.`);
    if (next !== old.status) patch.status = next;
    if (next === 'draft') patch.decided_at = null;
    if (old.status === 'failed') Object.assign(patch, { attempts: 0, last_error: null, ig_container_id: null });
    const [row] = await db.update('posts', { id: `eq.${id}`, status: `in.(${EDITABLE.join(',')})` }, patch);
    need(row, 409, 'Este post mudou de status. Atualize a página e tente de novo.');
    if (next === 'pending_approval') await logEvent(row, 'sent');
    if (patch.image_path !== undefined && old.image_path && patch.image_path !== old.image_path) await removeImageIfUnused(old.image_path);
    if (patch.media !== undefined) { const keep = pathsOf(row.media); await removeMediaIfUnused((old.media || []).filter((m) => !keep.has(m.path))); }
    send(res, 200, row);
  },

  DELETE: async (req, res) => {
    await requireStaff(req);
    const { id } = query(req);
    need(id, 400, 'Post não informado.');
    const [row] = await db.remove('posts', { id: `eq.${id}`, status: 'neq.publishing' });
    need(row, 409, 'Post em publicação não pode ser apagado agora.');
    // Post já publicado: apaga do painel, mas mantém a imagem (o Instagram já tem a dele).
    if (row.status !== 'published') { await removeImageIfUnused(row.image_path); await removeMediaIfUnused(row.media); }
    send(res, 200, { ok: true });
  },
});
