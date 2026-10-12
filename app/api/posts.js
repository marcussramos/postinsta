// Posts. GET lista | POST cria | PATCH ?id= edita ou executa ação | DELETE ?id= remove
import { route, send, readJson, query, need } from '../lib/http.js';
import { requireAdmin } from '../lib/auth.js';
import { db, storage } from '../lib/db.js';
import { cleanPostInput, actionPatch, EDITABLE } from '../lib/posts.js';

const LIST_FIELDS = 'id,client_id,image_url,caption,alt_text,scheduled_at,status,client_feedback,decided_at,sent_for_approval_at,ig_permalink,published_at,last_error,attempts,created_at,updated_at';

export default route({
  GET: async (req, res) => {
    requireAdmin(req);
    const q = query(req);
    const params = { select: LIST_FIELDS, order: 'scheduled_at.asc', limit: 500 };
    if (q.client) params.client_id = `eq.${q.client}`;
    if (q.status) params.status = `in.(${q.status})`;
    if (q.from && q.to) params.and = `(scheduled_at.gte.${q.from},scheduled_at.lt.${q.to})`;
    else if (q.from) params.scheduled_at = `gte.${q.from}`;
    send(res, 200, await db.select('posts', params));
  },

  POST: async (req, res) => {
    requireAdmin(req);
    const body = await readJson(req);
    const data = cleanPostInput(body);
    need(body.client_id, 400, 'Escolha o cliente.');
    need(data.image_url, 400, 'Envie a imagem do post.');
    need(data.scheduled_at, 400, 'Escolha a data e a hora.');
    const client = await db.one('clients', { select: 'id', id: `eq.${body.client_id}` });
    need(client, 404, 'Cliente não encontrado.');
    const now = new Date().toISOString();
    const status = body.send ? 'pending_approval' : body.approved ? 'approved' : 'draft';
    const row = await db.insert('posts', {
      ...data,
      client_id: body.client_id,
      status,
      sent_for_approval_at: status === 'pending_approval' ? now : null,
      decided_at: status === 'approved' ? now : null,
    });
    send(res, 201, row);
  },

  PATCH: async (req, res) => {
    requireAdmin(req);
    const { id } = query(req);
    need(id, 400, 'Post não informado.');
    const body = await readJson(req);

    if (body.action) {
      const a = actionPatch(body.action);
      need(a, 400, 'Ação desconhecida.');
      const [row] = await db.update('posts', { id: `eq.${id}`, status: `in.(${a.from.join(',')})` }, a.patch);
      need(row, 409, 'Este post mudou de status. Atualize a página e tente de novo.');
      return send(res, 200, row);
    }

    // Edição de conteúdo: o cliente precisa ver a versão nova, então volta para rascunho
    // (a não ser que a agência peça para reenviar na mesma hora com send: true).
    const patch = cleanPostInput(body);
    need(Object.keys(patch).length, 400, 'Nada para alterar.');
    const old = await db.one('posts', { select: 'status,image_path', id: `eq.${id}` });
    need(old, 404, 'Post não encontrado.');
    need(EDITABLE.includes(old.status), 409, 'Post publicado ou publicando não pode ser editado.');
    const contentChanged = ['caption', 'image_url', 'alt_text'].some((k) => k in patch);
    if (contentChanged || old.status === 'failed') {
      Object.assign(patch, body.send
        ? { status: 'pending_approval', sent_for_approval_at: new Date().toISOString(), client_feedback: null, decided_at: null }
        : { status: 'draft', decided_at: null });
    }
    if (old.status === 'failed') Object.assign(patch, { attempts: 0, last_error: null, ig_container_id: null });
    const [row] = await db.update('posts', { id: `eq.${id}`, status: `in.(${EDITABLE.join(',')})` }, patch);
    need(row, 409, 'Este post mudou de status. Atualize a página e tente de novo.');
    if (patch.image_path && old.image_path && patch.image_path !== old.image_path) await storage.remove(old.image_path);
    send(res, 200, row);
  },

  DELETE: async (req, res) => {
    requireAdmin(req);
    const { id } = query(req);
    need(id, 400, 'Post não informado.');
    const [row] = await db.remove('posts', { id: `eq.${id}`, status: 'neq.publishing' });
    need(row, 409, 'Post em publicação não pode ser apagado agora.');
    // Post já publicado: apaga do painel, mas mantém a imagem (o Instagram já tem a dele).
    if (row.status !== 'published') await storage.remove(row.image_path);
    send(res, 200, { ok: true });
  },
});
