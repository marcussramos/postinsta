// Regras de status dos posts — num lugar só, usadas pelo painel, pela aprovação e pelo publicador.

export const STATUS = {
  draft: 'Rascunho',
  pending_approval: 'Aguardando cliente',
  approved: 'Aprovado',
  changes_requested: 'Ajuste pedido',
  publishing: 'Publicando',
  published: 'Publicado',
  failed: 'Falhou',
};

// O que a agência pode editar em cada status.
export const EDITABLE = ['draft', 'pending_approval', 'approved', 'changes_requested', 'failed'];
// Em quais status o cliente ainda pode decidir (inclusive mudar de ideia antes de publicar).
export const CLIENT_CAN_DECIDE = ['pending_approval', 'approved', 'changes_requested'];

export const FIELDS = ['caption', 'alt_text', 'scheduled_at', 'image_url', 'image_path'];

export function cleanPostInput(input) {
  const out = {};
  for (const f of FIELDS) if (input[f] !== undefined) out[f] = input[f] === '' && f !== 'caption' ? null : input[f];
  if (out.caption !== undefined) {
    out.caption = String(out.caption || '');
    if (out.caption.length > 2200) throw Object.assign(new Error('A legenda passa de 2.200 caracteres, o limite do Instagram.'), { status: 400 });
    const tags = (out.caption.match(/#[\p{L}\p{N}_]+/gu) || []).length;
    if (tags > 30) throw Object.assign(new Error('O Instagram aceita no máximo 30 hashtags por post.'), { status: 400 });
  }
  if (out.scheduled_at !== undefined) {
    const d = new Date(out.scheduled_at);
    if (Number.isNaN(d.getTime())) throw Object.assign(new Error('Data e hora inválidas.'), { status: 400 });
    out.scheduled_at = d.toISOString();
  }
  if (out.alt_text) out.alt_text = String(out.alt_text).slice(0, 1000);
  return out;
}

// Ações do painel sobre um post: devolve o "patch" a aplicar e de quais status ela pode partir.
export function actionPatch(action, now = new Date().toISOString()) {
  switch (action) {
    case 'send': // enviar (ou reenviar) para o cliente aprovar
      return { from: ['draft', 'changes_requested', 'pending_approval'], patch: { status: 'pending_approval', sent_for_approval_at: now, client_feedback: null, decided_at: null } };
    case 'approve': // a agência aprova sem passar pelo cliente
      return { from: ['draft', 'pending_approval', 'changes_requested'], patch: { status: 'approved', decided_at: now } };
    case 'to_draft': // tirar da fila / cancelar aprovação
      return { from: ['pending_approval', 'approved', 'changes_requested', 'failed'], patch: { status: 'draft', decided_at: null } };
    case 'retry': // tentar publicar de novo depois de uma falha
      return { from: ['failed'], patch: { status: 'approved', attempts: 0, last_error: null, ig_container_id: null } };
    default:
      return null;
  }
}

// Remove campos sensíveis antes de mandar para o navegador.
export function publicClient(c, appUrl) {
  const { ig_token, approval_token, ...rest } = c;
  return {
    ...rest,
    ig_connected: Boolean(ig_token),
    approval_url: `${appUrl}/aprovar?t=${approval_token}`,
  };
}
