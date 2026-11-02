// Estúdio: a IA escreve a peça inteira (3 ganchos, texto de cada lâmina, CTA e legenda) no tom do cliente.
//   studio POST {client_id, format, goal, topic, slides, duration, template, extra}  →  { piece, warnings, checks }
// Não salva nada: o painel mostra, a equipe ajusta e cria o post no Fluxo pelo /api/posts (e o roteiro pelo ?r=script).
import { route, send, readJson, need } from '../http.js';
import { requirePerm, needClient } from '../auth.js';
import { db } from '../db.js';
import { askClaude, jsonFrom } from '../ai.js';
import { brandBrief } from '../onboarding.js';
import { hookBank } from './script.js';
import { TEMPLATES, NICHE_RULES, DURATIONS, cleanScript, checkScript } from '../../public/roteiro.js';

export const FORMATS = { CAROUSEL: 'Carrossel', IMAGE: 'Post estático', REELS: 'Reels' };
export const GOALS = {
  educar: { label: 'Educar', cta: 'salvar ou compartilhar (conteúdo que a pessoa quer guardar)' },
  engajar: { label: 'Engajar', cta: 'comentar ou responder uma pergunta simples' },
  autoridade: { label: 'Autoridade', cta: 'seguir o perfil para mais conteúdo do especialista' },
  vender: { label: 'Vender', cta: 'chamar no direct / WhatsApp ou clicar no link da bio (sem pressão)' },
};
const str = (v, n) => String(v ?? '').replace(/\s+$/g, '').slice(0, n);
const isUuid = (v) => /^[0-9a-f-]{36}$/i.test(String(v || ''));

export function cleanStudioInput(b = {}) {
  const format = FORMATS[b.format] ? b.format : 'CAROUSEL';
  return {
    format,
    goal: GOALS[b.goal] ? b.goal : 'educar',
    topic: str(b.topic, 300).trim(),
    slides: Math.max(3, Math.min(20, Math.round(Number(b.slides) || 7))),
    duration: DURATIONS.includes(Number(b.duration)) ? Number(b.duration) : 30,
    template: TEMPLATES[b.template] ? b.template : 'livre',
    extra: str(b.extra, 600).trim(),
  };
}

// Normaliza o que a IA devolveu (e o que o painel manda de volta depois de editar).
export function cleanPiece(r = {}, format) {
  const list = (a, n, max) => (Array.isArray(a) ? a : []).map((x) => str(x, max).trim()).filter(Boolean).slice(0, n);
  const piece = {
    format,
    hooks: list(r.hooks, 3, 220),
    cta: str(r.cta, 300).trim(),
    caption: str(r.caption, 2000).trim(),
    hashtags: list(r.hashtags, 15, 60).map((t) => `#${t.replace(/^#+/, '').replace(/\s+/g, '')}`).filter((t) => t.length > 1),
  };
  if (format === 'CAROUSEL') {
    piece.slides = (Array.isArray(r.slides) ? r.slides : []).slice(0, 20)
      .map((s) => ({ title: str(s?.title, 120).trim(), text: str(s?.text, 400).trim() })).filter((s) => s.title || s.text);
  }
  if (format === 'IMAGE') { piece.headline = str(r.headline, 120).trim(); piece.support = str(r.support, 300).trim(); }
  if (format === 'REELS') {
    const s = cleanScript({ ...r, hooks: piece.hooks, cta: piece.cta, caption: piece.caption });
    Object.assign(piece, { scenes: s.scenes, audio: s.audio, cover: s.cover });
  }
  return piece;
}

// Texto corrido da peça, para o verificador de regras do nicho (o mesmo dos roteiros).
const asScript = (p) => ({
  hooks: p.hooks, cta: p.cta, caption: p.caption, cover: p.cover || p.headline || '',
  scenes: p.scenes || (p.slides || []).map((s) => ({ text: s.title, say: s.text })).concat(p.support ? [{ say: p.support }] : []),
});
export const checkPiece = (p, niche) => checkScript(asScript(p), niche);

function prompt({ c, b, bank }) {
  const k = c.brand_kit || {};
  const rules = NICHE_RULES[k.niche];
  const goal = GOALS[b.goal];
  const worked = bank.filter((x) => x.views != null || x.reach != null).slice(0, 6);
  const shape = {
    CAROUSEL: `CARROSSEL de ${b.slides} lâminas (1080×1350).
- Lâmina 1 = capa: o "title" dela fica VAZIO (o gancho escolhido entra ali); no "text" um apoio de até 8 palavras ou vazio.
- Lâminas do meio: cada uma com UMA ideia. "title" curto (até 7 palavras, forte, sem ponto final) e "text" com até 30 palavras, frases curtas, fácil de ler no celular.
- Lâmina final = CTA: "title" com o convite e "text" com o reforço (até 15 palavras).
- A sequência precisa prender: cada lâmina dá motivo para passar para a próxima.`,
    IMAGE: `POST ESTÁTICO (1 imagem 1080×1350).
- "headline": frase principal da arte, até 9 palavras (o gancho escolhido pode virar a headline; escreva uma versão própria).
- "support": apoio na arte, até 20 palavras.
- O conteúdo de verdade vai na legenda.`,
    REELS: `REELS de ${b.duration}s (vertical 9:16) para gravar com celular. Modelo: ${TEMPLATES[b.template].label} — ${TEMPLATES[b.template].beats}
- Cenas numeradas: "show" (o que aparece, simples de gravar), "say" (fala exata, como a pessoa fala de verdade), "text" (texto na tela até 6 palavras ou vazio), "secs".
- A 1ª cena é a do gancho ("say" pode ficar vazio). A soma dos "secs" ≈ ${b.duration}s (±5s).
- "audio": estilo de trilha (nunca uma música famosa específica). "cover": texto da capa até 5 palavras.`,
  }[b.format];
  const json = {
    CAROUSEL: '{"hooks":["","",""],"slides":[{"title":"","text":""}],"cta":"","caption":"","hashtags":[""],"warnings":[]}',
    IMAGE: '{"hooks":["","",""],"headline":"","support":"","cta":"","caption":"","hashtags":[""],"warnings":[]}',
    REELS: '{"hooks":["","",""],"scenes":[{"show":"","say":"","text":"","secs":3}],"audio":"","cover":"","cta":"","caption":"","hashtags":[""],"warnings":[]}',
  }[b.format];
  return `ESTÚDIO DE CONTEÚDO
Você é redator(a) e diretor(a) de criação sênior de uma agência brasileira de social media (MC Digital). Escreva a peça abaixo pronta para a designer montar no Canva.

Cliente: ${c.name}${c.ig_username ? ` (@${c.ig_username})` : ''}
Tom de voz: ${c.brand_voice || 'não definido — natural e próximo'}
${k.niche ? `Nicho: ${k.niche}\n` : ''}${k.style ? `Estilo/posicionamento: ${k.style}\n` : ''}${k.dos ? `Sempre: ${k.dos}\n` : ''}${k.donts ? `Nunca: ${k.donts}\n` : ''}${k.avoid ? `Não associar à marca: ${k.avoid}\n` : ''}${k.notes ? `Observações: ${k.notes}\n` : ''}${brandBrief(c) ? `${brandBrief(c)}\n` : ''}
Tema: ${b.topic}
Objetivo: ${goal.label} → o CTA deve levar a ${goal.cta}.
${b.extra ? `Pedido extra: ${b.extra}\n` : ''}
Formato: ${shape}
${worked.length ? `\nGanchos deste cliente que já funcionaram (referência de estilo, não copie):\n${worked.map((x) => `- "${x.hook}" (${x.views != null ? `${x.views} visualizações` : `${x.reach} de alcance`})`).join('\n')}\n` : ''}${rules ? `\nREGRAS OBRIGATÓRIAS — ${rules.name} (${rules.summary}):\n${rules.rules.map((r) => `- ${r}`).join('\n')}\nSe o tema pedir algo proibido, adapte para uma versão permitida e explique em "warnings".\n` : ''}
Como escrever:
- 3 GANCHOS bem diferentes (até 12 palavras cada): um de curiosidade, um de dor/problema do público, um direto ou contraintuitivo. É a frase que para o scroll.
- "cta": uma frase de chamada clara e permitida, coerente com o objetivo.
- "caption": legenda de 3 a 6 parágrafos curtos, a 1ª linha forte (não repita o gancho igual), termina com o CTA. Sem hashtags dentro dela.
- "hashtags": de 5 a 10, específicas do nicho e da cidade quando fizer sentido (sem #fyp, #viral).
- Português do Brasil, frases curtas. Nada de clichês de IA ("descubra", "mergulhe", "jornada", "eleve", "transforme"). Não invente dados, números, preços, estudos ou depoimentos.

Responda SOMENTE com JSON válido:
${json}`;
}

export const studioRoute = route({
  POST: async (req, res) => {
    const u = await requirePerm(req, 'ia');
    const body = await readJson(req);
    need(isUuid(body.client_id), 400, 'Escolha o cliente.');
    needClient(u, body.client_id);
    const b = cleanStudioInput(body);
    need(b.topic.length >= 3, 400, 'Escreva o tema da peça.');
    const c = await db.one('clients', { select: '*', id: `eq.${body.client_id}` });
    need(c, 404, 'Cliente não encontrado.');
    const bank = await hookBank(c.id, 10).catch(() => []);
    const r = jsonFrom(await askClaude([{ type: 'text', text: prompt({ c, b, bank }) }], { maxTokens: 5000 }));
    const piece = cleanPiece(r, b.format);
    if (b.format === 'CAROUSEL' && piece.slides?.length) piece.slides[0].title = ''; // a capa recebe o gancho escolhido
    need(piece.hooks.length && (piece.slides?.length || piece.headline || piece.scenes?.length), 502, 'A IA não montou a peça direito. Tente de novo.');
    const warnings = (Array.isArray(r.warnings) ? r.warnings : []).map((w) => String(w).slice(0, 300)).filter(Boolean).slice(0, 5);
    send(res, 200, { piece, input: b, warnings, checks: checkPiece(piece, c.brand_kit?.niche) });
  },
});
