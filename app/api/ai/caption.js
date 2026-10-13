// IA: sugere legendas + hashtags olhando a imagem do post (API do Claude, com visão).
// Precisa da variável ANTHROPIC_API_KEY na Vercel (console.anthropic.com → API Keys).
import { route, send, readJson, need } from '../../lib/http.js';
import { requirePerm, needClient } from '../../lib/auth.js';
import { db } from '../../lib/db.js';
import { brandBrief } from '../../lib/onboarding.js';

const MODEL = () => process.env.AI_MODEL || 'claude-sonnet-5-5';

function imageBlock(body) {
  const data = String(body.image_base64 || '');
  if (data) {
    const m = data.match(/^data:(image\/(?:jpeg|png|webp|gif));base64,(.+)$/);
    need(m, 400, 'Imagem inválida.');
    need(m[2].length < 7_000_000, 413, 'Imagem grande demais para a IA.');
    return { type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } };
  }
  if (body.image_url && /^https:\/\//.test(body.image_url)) return { type: 'image', source: { type: 'url', url: body.image_url } };
  return null;
}

function buildPrompt({ client, brief, title, current, format }) {
  return `Você é redator(a) sênior de social media de uma agência brasileira. Escreva legendas para um post de feed do Instagram.

Marca/cliente: ${client?.name || 'não informado'}${client?.ig_username ? ` (@${client.ig_username})` : ''}
Tom de voz da marca: ${client?.brand_voice || 'não definido — deduza pelo visual do post e mantenha natural'}
${client?.brand_kit?.style ? `Estilo/posicionamento: ${client.brand_kit.style}\n` : ''}${client?.brand_kit?.dos ? `Sempre: ${client.brand_kit.dos}\n` : ''}${client?.brand_kit?.donts ? `Nunca (palavras/temas proibidos): ${client.brand_kit.donts}\n` : ''}${client?.brand_kit?.notes ? `Observações da marca: ${client.brand_kit.notes}\n` : ''}${client?.brand_kit?.avoid ? `Não associar à marca: ${client.brand_kit.avoid}\n` : ''}${client?.brand_kit?.perception ? `Percepção desejada no primeiro contato: ${client.brand_kit.perception}\n` : ''}${brandBrief(client) ? `${brandBrief(client)}\n` : ''}${format ? `Formato do post: ${format}` : ''}
Pauta / título interno: ${title || '—'}
O que o post precisa comunicar (briefing): ${brief || '—'}
${current ? `Legenda atual (melhore, não repita): ${current}` : ''}
${'' /* a imagem vem anexada, quando houver */}
Regras:
- Português do Brasil, natural, sem clichês de IA ("descubra", "mergulhe", "jornada", "eleve").
- Leia a imagem: use o texto e o visual dela; não descreva o óbvio, complemente.
- 3 opções com abordagens DIFERENTES: (1) curta e direta, (2) engajamento (pergunta ou convite a comentar/marcar alguém), (3) contexto/storytelling.
- Cada legenda: gancho forte na 1ª linha, até 600 caracteres, termina com uma chamada para ação clara (salvar, compartilhar, comentar, link na bio…).
- Emojis com moderação (0 a 3).
- Hashtags: 5 a 12 por opção, misture amplas e de nicho, todas relevantes ao post e ao público brasileiro; sem espaços nem acentos estranhos.
- Não invente fatos, preços, prêmios, resultados ou promoções que não estejam no briefing ou na imagem.
- Nunca reproduza letras de músicas, poemas ou textos de terceiros.

Responda SOMENTE com JSON válido, neste formato:
{"options":[{"label":"Curta","caption":"texto sem hashtags","hashtags":["#exemplo","#outra"]}]}`;
}

export default route({
  POST: async (req, res) => {
    const u = await requirePerm(req, 'ia');
    need(process.env.ANTHROPIC_API_KEY, 503, 'A IA ainda não está ligada: falta ANTHROPIC_API_KEY na Vercel (veja a aba Ajustes).');
    const body = await readJson(req);
    if (body.client_id) needClient(u, body.client_id);
    const client = body.client_id
      ? await db.one('clients', { select: '*', id: `eq.${body.client_id}` })
      : null;
    const img = imageBlock(body);
    need(img || body.brief || body.title, 400, 'Envie a imagem ou escreva sobre o que é o post.');

    const content = [];
    if (img) content.push(img); // imagem antes do texto: a IA entende melhor
    content.push({ type: 'text', text: buildPrompt({ client, brief: String(body.brief || '').slice(0, 1500), title: body.title, current: String(body.current || '').slice(0, 2200), format: { CAROUSEL: 'carrossel (a imagem é a capa; a legenda pode convidar a deslizar)', REELS: 'Reels (a imagem é a capa do vídeo)' }[body.media_type] || '' }) });

    let r;
    try {
      r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({ model: MODEL(), max_tokens: 2000, messages: [{ role: 'user', content }] }),
      });
    } catch { need(false, 502, 'Não consegui falar com a IA agora. Tente de novo.'); }
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = data?.error?.message || `erro ${r.status}`;
      const hint = r.status === 401 ? ' Confira a ANTHROPIC_API_KEY.' : r.status === 400 && /credit|billing/i.test(msg) ? ' Verifique o saldo/créditos no console da Anthropic.' : '';
      need(false, r.status === 429 ? 429 : 502, `IA: ${msg}.${hint}`);
    }
    const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
    const json = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
    let parsed;
    try { parsed = JSON.parse(json); } catch { need(false, 502, 'A IA respondeu num formato inesperado. Tente de novo.'); }
    const options = (parsed.options || []).slice(0, 3).map((o) => {
      const tags = [...new Set((o.hashtags || []).map((t) => `#${String(t).replace(/^#+/, '').replace(/\s+/g, '')}`).filter((t) => t.length > 1))].slice(0, 15);
      return { label: String(o.label || '').slice(0, 40), caption: String(o.caption || '').trim(), hashtags: tags };
    }).filter((o) => o.caption);
    need(options.length, 502, 'A IA não trouxe sugestões. Tente de novo.');
    send(res, 200, { options, model: MODEL() });
  },
});
