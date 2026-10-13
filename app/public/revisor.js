// Revisor do post antes de ir para o cliente: regras rápidas, sem IA (a revisão com IA fica em /api/pasta?r=review).
// level: 'erro' (precisa corrigir) | 'atencao' (provavelmente vale corrigir) | 'dica'
const CTA = /(coment|salv[ae]|compartilh|marqu?e |marca (alg|aquel|quem)|link na bio|clique|clica|cham[ae] (no|na|a gente)|agend|reserv|garant|peç|pedido|encomend|envi[ae]|mand[ae] (um|uma|no|na)|direct|\bdm\b|whats|me conta|conta pra|qual (você|vc)|vem (pro|para|conhecer)|\?)/i;
const EMOJI = /\p{Extended_Pictographic}/gu;

export function forbiddenTerms(kit = {}) {
  return [kit.donts, kit.avoid].filter(Boolean).join('\n').split(/[\n,;•]+|\s-\s/)
    .map((s) => s.replace(/^["'“”\s]+|["'“”.\s]+$/g, '').trim().toLowerCase())
    .filter((s) => s.length >= 3 && s.length <= 30 && s.split(/\s+/).length <= 3);
}

// p: { media_type, caption, scheduled_at, image: {w,h}, items: [{w,h}], video: {w,h,duration} }
// ctx: { brand_kit, sameDay: n de outros posts de feed do cliente no mesmo dia, now }
export function reviewPost(p, ctx = {}) {
  const out = [];
  const add = (level, title, detail, fix) => out.push({ level, title, detail, fix });
  const type = p.media_type || 'IMAGE';
  const cap = String(p.caption || '');
  const tags = cap.match(/#[\p{L}\p{N}_]+/gu) || [];
  const textOnly = cap.replace(/#[\p{L}\p{N}_]+/gu, '').trim();
  const now = ctx.now || Date.now();

  // legenda
  if (type === 'STORY') {
    if (cap.trim()) add('dica', 'Story não tem legenda', 'O texto da legenda não aparece no Story. Se ele é importante, coloque na própria arte.');
  } else {
    if (cap.length > 2200) add('erro', 'Legenda longa demais', `${cap.length} caracteres: o Instagram aceita até 2.200 e recusa a publicação.`);
    if (!textOnly) add('atencao', 'Post sem legenda', 'Feed e Reels sem legenda perdem alcance e contexto. Use o ✨ Legenda com IA ou um modelo.');
    if (tags.length > 30) add('erro', 'Hashtags demais', `${tags.length} hashtags: o máximo é 30, acima disso o Instagram não publica.`, 'trim_tags');
    else if (tags.length > 15) add('dica', 'Muitas hashtags', `${tags.length} hashtags. Poucas e bem escolhidas (5 a 10) costumam funcionar melhor e não parecem spam.`, 'trim_tags');
    if (new Set(tags.map((t) => t.toLowerCase())).size < tags.length) add('dica', 'Hashtag repetida', 'Há hashtags iguais na legenda.', 'dedupe_tags');
    if (textOnly && !CTA.test(textOnly)) add('dica', 'Sem chamada para ação', 'Termine pedindo algo: comentar, salvar, compartilhar, chamar no direct ou clicar no link da bio.');
    const first = textOnly.split('\n').find((l) => l.trim()) || '';
    if (first.length > 125) add('dica', 'Gancho longo', 'Só ~125 caracteres aparecem antes do "mais". Deixe a primeira linha curta e forte.');
    if ((textOnly.match(EMOJI) || []).length > 12) add('dica', 'Muitos emojis', 'Emojis demais deixam a legenda difícil de ler.');
    if (/ {2,}| ([,.!?;:])/.test(textOnly)) add('dica', 'Espaços sobrando', 'Há espaços duplos ou antes de pontuação.', 'fix_spaces');
  }
  const bad = forbiddenTerms(ctx.brand_kit).filter((w) => cap.toLowerCase().includes(w));
  if (bad.length) add('atencao', 'Palavra que a marca evita', `A legenda tem: ${bad.map((w) => `"${w}"`).join(', ')} — está na lista de "Nunca"/"Não associar" da Marca do cliente.`);

  // mídia
  const ratio = (m) => (m && m.w && m.h ? m.w / m.h : null);
  if (type === 'IMAGE' && p.image) {
    const r = ratio(p.image);
    if (p.image.w && p.image.w < 1080) add('atencao', 'Imagem em baixa resolução', `${p.image.w}×${p.image.h} px. O ideal é 1080 px de largura (1080×1350 no feed).`);
    if (r && r < 0.79) add('atencao', 'Imagem alta demais para o feed', 'No feed o máximo é 4:5 (1080×1350). Mais alta que isso, o Instagram corta.');
    if (r && r > 1.92) add('atencao', 'Imagem larga demais', 'No feed o máximo é 1,91:1 (paisagem). Mais larga, o Instagram corta.');
  }
  if (type === 'CAROUSEL' && p.items?.length) {
    const rs = p.items.map(ratio).filter(Boolean);
    if (rs.length > 1 && Math.max(...rs) - Math.min(...rs) > 0.02) add('atencao', 'Imagens com formatos diferentes', 'No carrossel todas são cortadas no formato da 1ª. Use o mesmo tamanho em todas (de preferência 1080×1350).');
    if (p.items.some((m) => m.w && m.w < 1080)) add('atencao', 'Alguma imagem em baixa resolução', 'Há imagens com menos de 1080 px de largura no carrossel.');
  }
  if ((type === 'STORY' || type === 'REELS')) {
    const m = p.video || p.image;
    const r = ratio(m);
    if (r && Math.abs(r - 9 / 16) > 0.04) add('atencao', type === 'STORY' ? 'Story fora do 9:16' : 'Reels fora do 9:16', `A mídia tem ${m.w}×${m.h}. O ideal é vertical 1080×1920, senão aparecem faixas ou cortes.`);
    if (type === 'STORY') add('dica', 'Área segura do Story', 'Deixe textos e logos longe do topo (~250 px) e da base (~340 px): ali ficam o nome do perfil e a caixa de resposta.');
  }

  // data
  if (p.scheduled_at) {
    const t = new Date(p.scheduled_at).getTime();
    if (t < now) add('erro', 'Horário já passou', 'Escolha uma data futura, ou o post sai na próxima rodada (até 5 min) depois de aprovado.');
    const hr = Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hourCycle: 'h23', timeZone: ctx.tz || 'America/Cuiaba' }).format(t));
    if (hr < 6) add('dica', 'Horário de madrugada', 'Poucas pessoas estão online entre 0h e 6h. Confira os melhores horários do perfil.');
  } else add('atencao', 'Sem data', 'Para ir ao cliente, escolha a data e a hora de publicação.');
  if (type !== 'STORY' && ctx.sameDay > 0) add('dica', 'Outro post no mesmo dia', `O cliente já tem ${ctx.sameDay} post(s) de feed neste dia. Espaçar ajuda o alcance de cada um.`);

  const order = { erro: 0, atencao: 1, dica: 2 };
  return out.sort((a, b) => order[a.level] - order[b.level]);
}

// Correções automáticas simples
export function applyFix(caption, fix) {
  let c = String(caption || '');
  if (fix === 'fix_spaces') c = c.replace(/ {2,}/g, ' ').replace(/ ([,.!?;:])/g, '$1');
  if (fix === 'dedupe_tags' || fix === 'trim_tags') {
    const seen = new Set(); let kept = 0;
    c = c.replace(/#[\p{L}\p{N}_]+/gu, (t) => { const k = t.toLowerCase(); if (seen.has(k) || (fix === 'trim_tags' && kept >= 10)) return ''; seen.add(k); kept++; return t; })
      .replace(/[ \t]{2,}/g, ' ').replace(/[ \t]+\n/g, '\n').trimEnd();
  }
  return c;
}
