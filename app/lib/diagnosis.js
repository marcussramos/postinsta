// Diagnóstico grátis de Instagram (isca de clientes).
// 1) Tenta ler os dados PÚBLICOS do perfil comercial pelo "Business Discovery" da Meta, usando a conexão de
//    um perfil da própria agência (Ajustes → Diagnóstico). Se a Meta não liberar, segue só com as respostas.
// 2) A IA monta a análise: nota geral, nota por área, pontos fortes e 3 ações prioritárias.
import { db } from './db.js';
import { IG_API_VERSION } from './env.js';
import { getState } from './appstate.js';
import { askClaude, jsonFrom } from './ai.js';
import { HttpError } from './http.js';

export const DIAG_DEFAULTS = { enabled: true, lookup_client_id: '', whatsapp: '', headline: 'Descubra o que está travando o crescimento do seu Instagram', cta: 'Quero ajuda da MC Digital' };
export async function diagSettings() { return { ...DIAG_DEFAULTS, ...((await getState('diag_settings')) || {}) }; }

export const cleanHandle = (v) => String(v || '').trim().replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').replace(/[/?#].*$/, '').replace(/^@+/, '').toLowerCase();
export const validHandle = (h) => /^[a-z0-9._]{1,30}$/.test(h);

// Dados públicos do perfil (seguidores, posts, últimas publicações). null = indisponível.
export async function lookupProfile(handle) {
  const cfg = await diagSettings();
  if (!cfg.lookup_client_id) return null;
  const c = await db.one('clients', { select: 'ig_user_id,ig_token', id: `eq.${cfg.lookup_client_id}` }).catch(() => null);
  if (!c?.ig_token || !c.ig_user_id) return null;
  const fields = `business_discovery.username(${handle}){username,name,biography,website,followers_count,follows_count,media_count,profile_picture_url,media.limit(18){caption,like_count,comments_count,timestamp,media_type,media_product_type,permalink}}`;
  try {
    const r = await fetch(`https://graph.instagram.com/${IG_API_VERSION()}/${c.ig_user_id}?${new URLSearchParams({ fields, access_token: c.ig_token })}`);
    if (!r.ok) return null;
    const d = (await r.json())?.business_discovery;
    if (!d) return null;
    const media = (d.media?.data || []).map((m) => ({
      type: m.media_product_type === 'REELS' ? 'Reels' : m.media_type === 'CAROUSEL_ALBUM' ? 'Carrossel' : m.media_type === 'VIDEO' ? 'Vídeo' : 'Foto',
      likes: m.like_count ?? null, comments: m.comments_count ?? null, at: m.timestamp, caption: (m.caption || '').slice(0, 220),
    }));
    const days = media.length > 1 ? (new Date(media[0].at) - new Date(media.at(-1).at)) / 864e5 : null;
    const inter = media.filter((m) => m.likes != null).map((m) => (m.likes || 0) + (m.comments || 0));
    const avg = inter.length ? Math.round(inter.reduce((a, b) => a + b, 0) / inter.length) : null;
    return {
      username: d.username, name: d.name || null, biography: d.biography || '', website: d.website || null, picture: d.profile_picture_url || null,
      followers: d.followers_count ?? null, following: d.follows_count ?? null, posts: d.media_count ?? null,
      last_post_days: media[0] ? Math.round((Date.now() - new Date(media[0].at)) / 864e5) : null,
      posts_per_week: days ? Math.round((media.length / Math.max(1, days)) * 7 * 10) / 10 : null,
      avg_interactions: avg, engagement_rate: avg != null && d.followers_count ? Math.round((avg / d.followers_count) * 1000) / 10 : null,
      formats: media.reduce((acc, m) => ({ ...acc, [m.type]: (acc[m.type] || 0) + 1 }), {}),
      recent: media.slice(0, 12),
    };
  } catch { return null; }
}

export const DIAG_QUESTIONS = {
  nicho: 'Segmento do negócio', objetivo: 'Principal objetivo com o Instagram', seguidores: 'Seguidores (aproximado)', frequencia: 'Com que frequência posta',
  formatos: 'Formatos que mais usa', quem_faz: 'Quem cuida do Instagram hoje', dificuldade: 'Maior dificuldade',
};

function prompt(input, prof) {
  const a = input.answers || {};
  return `DIAGNÓSTICO DE INSTAGRAM
Você é estrategista sênior de social media de uma agência brasileira. Faça um diagnóstico honesto, específico e motivador do perfil abaixo, para um dono de negócio (linguagem simples, sem jargão).

Perfil: @${input.handle}${input.company ? ` (${input.company})` : ''}
Respostas do dono:
${Object.entries(DIAG_QUESTIONS).map(([k, q]) => `- ${q}: ${a[k] || 'não informado'}`).join('\n')}
${prof ? `Dados públicos reais do perfil (use como fonte principal; não invente outros números):
- Seguidores: ${prof.followers ?? '?'} · seguindo: ${prof.following ?? '?'} · posts: ${prof.posts ?? '?'}
- Bio: "${prof.biography || '(vazia)'}" · link na bio: ${prof.website ? 'sim' : 'não'}
- Último post há ${prof.last_post_days ?? '?'} dias · ritmo: ${prof.posts_per_week ?? '?'} posts/semana
- Média de interações por post: ${prof.avg_interactions ?? '?'} · taxa de engajamento aproximada: ${prof.engagement_rate ?? '?'}%
- Formatos recentes: ${Object.entries(prof.formats || {}).map(([k, v]) => `${k} ${v}`).join(', ') || '?'}
- Legendas recentes: ${(prof.recent || []).slice(0, 6).map((m) => `[${m.type}, ${(m.likes ?? 0) + (m.comments ?? 0)} interações] ${m.caption.replace(/\s+/g, ' ').slice(0, 120)}`).join(' | ')}` : 'Não há dados públicos do perfil: baseie-se nas respostas e deixe claro quando algo é estimativa.'}

Regras:
- Áreas: "Perfil e bio", "Constância", "Conteúdo", "Engajamento". Nota de 0 a 100 em cada uma e uma geral (média ponderada, seja realista: perfis medianos ficam entre 40 e 65).
- Cada área: 1 a 2 frases objetivas sobre o que está bom ou ruim, citando dados quando houver.
- 2 pontos fortes reais e 3 ações prioritárias, práticas e específicas para este negócio (o que fazer nas próximas 2 semanas).
- Nunca prometa números de crescimento, nem invente métricas. Não mencione concorrentes por nome.
- Termine com uma frase curta convidando para uma conversa, sem pressão.

Responda SOMENTE com JSON válido:
{"score":0,"headline":"frase de resumo em até 14 palavras","areas":[{"name":"Perfil e bio","score":0,"comment":"..."}],"strengths":["..."],"actions":[{"title":"...","detail":"..."}],"closing":"..."}`;
}

const clamp = (n) => Math.max(0, Math.min(100, Math.round(Number(n) || 0)));
export function cleanDiagnosis(p) {
  const areas = (Array.isArray(p?.areas) ? p.areas : []).slice(0, 4).map((x) => ({ name: String(x.name || '').slice(0, 40), score: clamp(x.score), comment: String(x.comment || '').slice(0, 400) })).filter((x) => x.name);
  if (!areas.length) throw new HttpError(502, 'A análise não saiu como esperado. Tente de novo em instantes.');
  return {
    score: clamp(p.score ?? areas.reduce((s, x) => s + x.score, 0) / areas.length), headline: String(p.headline || '').slice(0, 160), areas,
    strengths: (Array.isArray(p.strengths) ? p.strengths : []).map((s) => String(s).slice(0, 240)).filter(Boolean).slice(0, 3),
    actions: (Array.isArray(p.actions) ? p.actions : []).map((x) => ({ title: String(x.title || '').slice(0, 100), detail: String(x.detail || '').slice(0, 400) })).filter((x) => x.title).slice(0, 3),
    closing: String(p.closing || '').slice(0, 240),
  };
}

export async function runDiagnosis(input) {
  const prof = await lookupProfile(input.handle);
  const text = await askClaude([{ type: 'text', text: prompt(input, prof) }], { maxTokens: 3000 });
  return { ...cleanDiagnosis(jsonFrom(text)), profile: prof ? { ...prof, recent: undefined } : null, at: new Date().toISOString() };
}
