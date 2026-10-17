// Regras de status dos posts — num lugar só, usadas pelo painel, pela aprovação e pelo publicador.
//
// Fluxo (workflow):
//   idea → draft (Em produção) → internal_review → pending_approval → approved → publishing → published
//                                                   ↘ changes_requested ↗
//   failed = a publicação deu erro

export const STATUS = {
  idea: 'Ideia',
  draft: 'Em produção',
  internal_review: 'Revisão interna',
  pending_approval: 'Aguardando cliente',
  changes_requested: 'Ajuste pedido',
  approved: 'Aprovado',
  publishing: 'Publicando',
  published: 'Publicado',
  failed: 'Falhou',
};

// O que a agência pode editar em cada status.
export const EDITABLE = ['idea', 'draft', 'internal_review', 'pending_approval', 'approved', 'changes_requested', 'failed'];
// Em quais status o cliente ainda pode decidir (inclusive mudar de ideia antes de publicar).
export const CLIENT_CAN_DECIDE = ['pending_approval', 'approved', 'changes_requested'];
// Status em que mexer no conteúdo exige nova aprovação do cliente.
const NEEDS_REAPPROVAL = ['pending_approval', 'approved', 'changes_requested', 'failed'];

export const FIELDS = ['title', 'notes', 'caption', 'alt_text', 'scheduled_at', 'image_url', 'image_path', 'media_type', 'media'];
export const CONTENT_FIELDS = ['caption', 'image_url', 'alt_text', 'media_type', 'media'];
export const MEDIA_TYPES = { IMAGE: 'Foto', CAROUSEL: 'Carrossel', REELS: 'Reels', STORY: 'Story' };

const bad = (msg) => Object.assign(new Error(msg), { status: 400 });

export function cleanPostInput(input) {
  const out = {};
  for (const f of FIELDS) if (input[f] !== undefined) out[f] = input[f] === '' && f !== 'caption' ? null : input[f];
  if (out.caption !== undefined) {
    out.caption = String(out.caption || '');
    if (out.caption.length > 2200) throw bad('A legenda passa de 2.200 caracteres, o limite do Instagram.');
    const tags = (out.caption.match(/#[\p{L}\p{N}_]+/gu) || []).length;
    if (tags > 30) throw bad('O Instagram aceita no máximo 30 hashtags por post.');
  }
  if (out.scheduled_at) {
    const d = new Date(out.scheduled_at);
    if (Number.isNaN(d.getTime())) throw bad('Data e hora inválidas.');
    out.scheduled_at = d.toISOString();
  }
  if (out.media_type !== undefined) {
    out.media_type = out.media_type || 'IMAGE';
    if (!MEDIA_TYPES[out.media_type]) throw bad('Formato de post inválido.');
  }
  if (out.media !== undefined && out.media !== null) {
    if (!Array.isArray(out.media)) throw bad('Mídia inválida.');
    if (out.media.length > 10) throw bad('O carrossel aceita no máximo 10 itens.');
    out.media = out.media.map((m) => {
      const url = String(m?.url || '');
      if (!/^https?:\/\//.test(url)) throw bad('Mídia inválida.');
      return { url, path: m.path ? String(m.path).slice(0, 300) : null, kind: m.kind === 'video' ? 'video' : 'image' };
    });
    if (!out.media.length) out.media = null;
  }
  if (out.title) out.title = String(out.title).trim().slice(0, 140);
  if (out.notes) out.notes = String(out.notes).slice(0, 4000);
  if (out.alt_text) out.alt_text = String(out.alt_text).slice(0, 1000);
  return out;
}

// Para ir ao cliente ou para a fila de publicação, o post precisa estar completo.
export function readyProblem(post) {
  const type = post.media_type || 'IMAGE';
  if (type === 'CAROUSEL' && (post.media || []).length < 2) return 'O carrossel precisa de pelo menos 2 itens (fotos ou vídeos).';
  if (type === 'REELS' && !(post.media || []).some((m) => m.kind === 'video')) return 'Falta o vídeo do Reels.';
  if (type === 'STORY') return post.image_url || (post.media || []).length ? (post.scheduled_at ? null : 'Falta a data e a hora de publicação.') : 'Falta a imagem ou o vídeo do Story.';
  if (!post.image_url) return type === 'REELS' ? 'Falta a capa do Reels.' : 'Falta a imagem do post.';
  if (!post.scheduled_at) return 'Falta a data e a hora de publicação.';
  return null;
}

// Ações do painel sobre um post: o "patch" a aplicar, de quais status pode partir
// e se o post precisa estar completo (imagem + data).
export function actionPatch(action, now = new Date().toISOString()) {
  switch (action) {
    case 'to_idea':
      return { from: ['draft', 'internal_review'], patch: { status: 'idea' } };
    case 'to_production': // começar a produzir / voltar para produção
    case 'to_draft':
      return { from: ['idea', 'internal_review', 'pending_approval', 'approved', 'changes_requested', 'failed'], patch: { status: 'draft', decided_at: null } };
    case 'to_review': // revisão interna da agência antes do cliente
      return { from: ['idea', 'draft', 'changes_requested'], patch: { status: 'internal_review' } };
    case 'send': // enviar (ou reenviar) para o cliente aprovar
      return { from: ['draft', 'internal_review', 'changes_requested', 'pending_approval'], complete: true,
        patch: { status: 'pending_approval', sent_for_approval_at: now, client_feedback: null, decided_at: null } };
    case 'approve': // a agência aprova sem passar pelo cliente
      return { from: ['draft', 'internal_review', 'pending_approval', 'changes_requested'], complete: true,
        patch: { status: 'approved', decided_at: now } };
    case 'retry': // tentar publicar de novo depois de uma falha
      return { from: ['failed'], complete: true, patch: { status: 'approved', attempts: 0, last_error: null, ig_container_id: null } };
    default:
      return null;
  }
}

// Depois de editar o conteúdo: em que status o post fica.
export function statusAfterEdit(oldStatus, contentChanged, sendNow) {
  if (sendNow) return 'pending_approval';
  if (oldStatus === 'failed') return 'draft';
  if (contentChanged && NEEDS_REAPPROVAL.includes(oldStatus)) return 'draft';
  return oldStatus;
}

// Remove campos sensíveis antes de mandar para o navegador.
export function publicClient(c, appUrl) {
  const { ig_token, approval_token, portal_token, ...rest } = c;
  return {
    ...rest,
    ig_connected: Boolean(ig_token),
    approval_url: `${appUrl}/aprovar?t=${approval_token}`,
    portal_url: portal_token ? `${appUrl}/cliente?t=${portal_token}` : null,
  };
}
