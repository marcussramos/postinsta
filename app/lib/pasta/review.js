// Revisão com IA antes de enviar ao cliente (admin e equipe): português da legenda, tom da marca e a arte.
//   review  POST {client_id, caption, title, media_type, image_url | image_base64}
import { route, send, readJson, need } from '../http.js';
import { requirePerm, needClient } from '../auth.js';
import { db } from '../db.js';
import { askClaude, jsonFrom } from '../ai.js';

const TYPE = { IMAGE: 'post de feed (foto)', CAROUSEL: 'carrossel (a imagem é a 1ª)', REELS: 'Reels (a imagem é a capa)', STORY: 'Story (vertical 1080×1920, sem legenda)' };

export const reviewRoute = route({
  POST: async (req, res) => {
    const u = await requirePerm(req, 'ia');
    const b = await readJson(req);
    if (b.client_id) needClient(u, b.client_id);
    const c = b.client_id ? await db.one('clients', { select: 'name,brand_voice,brand_kit', id: `eq.${b.client_id}` }) : null;
    const content = [];
    const data = String(b.image_base64 || '');
    const m = data.match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/);
    if (m) { need(m[2].length < 7_000_000, 413, 'Imagem grande demais para a revisão.'); content.push({ type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } }); }
    else if (/^https:\/\//.test(b.image_url || '')) content.push({ type: 'image', source: { type: 'url', url: b.image_url } });
    const caption = String(b.caption || '').slice(0, 2500);
    need(content.length || caption.trim(), 400, 'Nada para revisar ainda: adicione a imagem ou a legenda.');
    const k = c?.brand_kit || {};
    content.push({ type: 'text', text: `REVISÃO DE POST
Você é revisor(a) sênior de uma agência de social media brasileira, com olho de diretor(a) de arte. Revise este ${TYPE[b.media_type] || 'post'} ANTES de ir para o cliente aprovar.
Cliente: ${c?.name || '—'} · tom de voz: ${c?.brand_voice || 'não definido'}${k.colors?.length ? ` · cores da marca: ${k.colors.join(', ')}` : ''}${k.donts ? ` · nunca: ${k.donts}` : ''}${k.avoid ? ` · não associar: ${k.avoid}` : ''}
Pauta: ${String(b.title || '—').slice(0, 200)}
Legenda:
"""${caption || '(sem legenda)'}"""

Verifique:
1. Português da legenda: ortografia, acentos, concordância, pontuação, digitação. Corrija SEM mudar o estilo, as gírias intencionais da marca, os emojis nem as hashtags.
2. Se a legenda combina com o tom da marca e tem chamada para ação.
3. A arte (se houver imagem): texto legível no celular, erros de português escritos na arte, contraste, excesso de texto, elementos cortados, coerência com as cores da marca${b.media_type === 'STORY' ? ', textos dentro da área segura (longe do topo e da base)' : ''}.
Seja objetivo: só aponte o que realmente vale corrigir. Não invente problemas.

Responda SOMENTE com JSON válido:
{"ok":true,"issues":[{"level":"erro|atencao|dica","area":"legenda|arte|tom","title":"curto","detail":"o que e como corrigir"}],"corrected_caption":"legenda corrigida, igual à original se não houver erro","changes":["trocou X por Y"]}` });
    const r = jsonFrom(await askClaude(content, { maxTokens: 3000 }));
    const issues = (Array.isArray(r.issues) ? r.issues : []).slice(0, 12).map((i) => ({
      level: ['erro', 'atencao', 'dica'].includes(i.level) ? i.level : 'dica', area: String(i.area || '').slice(0, 20), title: String(i.title || '').slice(0, 100), detail: String(i.detail || '').slice(0, 500),
    })).filter((i) => i.title);
    const corrected = typeof r.corrected_caption === 'string' && r.corrected_caption.trim() && r.corrected_caption.trim() !== caption.trim() ? r.corrected_caption.slice(0, 2200) : null;
    send(res, 200, { issues, corrected_caption: corrected, changes: (Array.isArray(r.changes) ? r.changes : []).map((x) => String(x).slice(0, 200)).slice(0, 15) });
  },
});
