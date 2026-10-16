// Histórico dos posts (prova de envio, aprovação e publicação). Nunca derruba a ação principal:
// antes da atualização 6 do banco a tabela não existe e o registro é simplesmente ignorado.
import { db } from './db.js';

export const EVENT_LABEL = {
  sent: 'Enviado para aprovação',
  reminded: 'Lembrete de aprovação enviado',
  approved: 'Aprovado pelo cliente',
  changes_requested: 'Cliente pediu ajuste',
  approved_by_agency: 'Aprovado pela agência',
  published: 'Publicado no Instagram',
  failed: 'Falha ao publicar',
  script_sent: 'Roteiro enviado para aprovação',
  script_approved: 'Roteiro aprovado pelo cliente',
  script_changes: 'Cliente pediu ajuste no roteiro',
};

export function snapshot(p) {
  return {
    title: p.title || null, caption: (p.caption || '').slice(0, 300), image_url: p.image_url || null,
    media_type: p.media_type || 'IMAGE', scheduled_at: p.scheduled_at || null, permalink: p.ig_permalink || null,
  };
}

export async function logEvent(post, type, note = null) {
  if (!post?.client_id) return;
  try {
    await db.insert('post_events', { post_id: post.id || null, client_id: post.client_id, type, note: note ? String(note).slice(0, 1000) : null, snapshot: snapshot(post) });
  } catch (e) {
    if (!/post_events|relation|schema cache/i.test(e.message)) console.warn('Histórico:', e.message);
  }
}
