// Roteiros de vídeo (Reels e Stories): modelos, regras de publicidade por nicho e a checagem automática.
// Usado pelo painel (navegador) e pelo servidor (IA e testes) — sem dependências.

export const SCRIPT_STATUS = {
  draft: 'Roteiro em escrita',
  sent: 'Roteiro com o cliente',
  changes: 'Ajuste no roteiro',
  approved: 'Roteiro aprovado',
};

// Modelos: a estrutura que a IA segue. "beats" vira o esqueleto das cenas.
export const TEMPLATES = {
  livre: { label: 'Livre', beats: 'Estruture como achar melhor para o tema.' },
  mito: { label: 'Mito x verdade', beats: 'Apresente o mito como o público fala → "isso é mito" → a verdade explicada simples → o que fazer na prática.' },
  dicas: { label: '3 dicas rápidas', beats: 'Promessa das 3 dicas → dica 1 → dica 2 → dica 3 (a mais forte por último).' },
  pergunta: { label: 'Pergunta de cliente', beats: 'Leia/mostre a pergunta real que clientes fazem → resposta direta → explicação curta → convite para mandar outras perguntas.' },
  bastidores: { label: 'Bastidores', beats: 'Mostre um momento real do dia a dia → o cuidado/processo que o público não vê → por que isso importa para o cliente.' },
  erro: { label: 'Erro comum', beats: 'O erro que muita gente comete → por que é um problema → como fazer certo.' },
  antes_depois: { label: 'Antes e depois', beats: 'Situação inicial (sem exagero) → o processo → resultado real, com contexto honesto (prazo, caso individual).' },
  depoimento: { label: 'Depoimento', beats: 'Cliente real conta a situação → o que mudou → fala própria dela, sem roteiro decorado; a marca só fecha com o CTA.' },
};

export const DURATIONS = [15, 30, 45, 60, 90];

// Regras resumidas dos conselhos. Servem de guia para a equipe e para a IA — não substituem o código de ética.
export const NICHE_RULES = {
  odonto: {
    name: 'CFO (Odontologia)',
    summary: 'Resolução CFO 196/2019 e Código de Ética Odontológica',
    rules: [
      'Não divulgar preço, desconto, promoção, parcelamento, brinde ou consulta grátis.',
      'Não prometer nem garantir resultado ("sem dor", "resultado garantido", "definitivo").',
      'Sem sensacionalismo, autopromoção comparativa ou superlativos ("o melhor", "o único").',
      'Antes e depois só com autorização por escrito do paciente, imagem real, sem edição e com caráter educativo.',
      'Identificar o profissional/responsável técnico com nome e número do CRO.',
    ],
  },
  saude: {
    name: 'Conselhos de saúde (CFM e afins)',
    summary: 'Resolução CFM 2.336/2023 e códigos de ética das profissões de saúde',
    rules: [
      'Não prometer cura nem garantir resultado.',
      'Sem sensacionalismo, medo exagerado ou superlativos ("o melhor", "o único").',
      'Não divulgar promoção, desconto, brinde ou procedimento grátis.',
      'Antes e depois só com autorização do paciente, com finalidade educativa e sem garantia de resultado.',
      'Identificar o profissional com nome e número do conselho (ex.: CRM e RQE quando citar especialidade).',
    ],
  },
  juridico: {
    name: 'OAB (Advocacia)',
    summary: 'Provimento OAB 205/2021 e Código de Ética da OAB',
    rules: [
      'Conteúdo informativo e educativo, sem mercantilizar a advocacia.',
      'Não divulgar honorários, preço, desconto ou consulta grátis.',
      'Não prometer resultado nem citar causas ganhas como garantia.',
      'Sem captação direta de clientela ("contrate agora", "ligue já", "garanta seu direito comigo").',
      'Não expor casos ou clientes sem autorização.',
    ],
  },
  beleza: {
    name: 'Estética (boas práticas)',
    summary: 'Código de Defesa do Consumidor e regras do conselho do profissional responsável',
    rules: [
      'Não prometer resultado garantido, "definitivo" ou "milagroso".',
      'Antes e depois real, sem filtro, com autorização da cliente e contexto (sessões, prazo).',
      'Se o procedimento for feito por dentista, biomédico ou médico, valem as regras do conselho dele.',
    ],
  },
};

// Checagem automática (rápida, sem IA). Cada regra: [nichos, regex, nível, título, detalhe]
const ALL = ['*'];
const CHECKS = [
  [ALL, /\b(resultado garantido|garantimos|garantia de resultado|100% (de )?(garantid|eficaz|seguro)|milagr)/i, 'atencao', 'Promessa de resultado', 'Evite garantir resultado: troque por algo verificável ("na maioria dos casos", "depende de avaliação").'],
  [['odonto', 'saude', 'juridico'], /(R\$\s?[\d.,]+|\bpreço|\bvalor promocional|\bdesconto|\bpromoç|\bgrátis|\bgratuit|\bparcel|\bbrinde|\bhonorári)/i, 'erro', 'Preço ou promoção', 'O conselho não permite falar de preço, desconto, brinde ou gratuidade. Tire esse trecho.'],
  [['odonto', 'saude'], /\b(o|a) (melhor|único|única)\b|\bmais barat|\bsem dor\b|\bdefinitiv/i, 'erro', 'Superlativo ou promessa', 'Nada de "o melhor", "o único", "sem dor" ou "definitivo": é autopromoção ou promessa, proibidas pelo conselho.'],
  [['odonto', 'saude', 'beleza'], /antes e depois|antes\/depois/i, 'atencao', 'Antes e depois', 'Só com autorização por escrito do paciente, imagem real sem edição e sem prometer o mesmo resultado para todos.'],
  [['juridico'], /\b(ganhe sua causa|causa ganha|ganhamos|vitória garantida|contrate (agora|já)|ligue (agora|já)|chame (agora|já))/i, 'erro', 'Promessa ou captação', 'A OAB proíbe prometer resultado e chamar cliente de forma direta. Troque por um CTA informativo ("salve para consultar depois").'],
  [['juridico'], /\b(o|a) (melhor|único|única) (advogad|escritório)/i, 'erro', 'Autopromoção', 'Sem superlativos sobre o escritório ou o profissional.'],
];

const scriptText = (s) => [
  ...(s.hooks || []), s.cta, s.caption, s.cover,
  ...(s.scenes || []).flatMap((c) => [c.say, c.text, c.show]),
].filter(Boolean).join('\n');

// Devolve [{level: 'erro'|'atencao'|'dica', title, detail, quote}]
export function checkScript(script, niche) {
  const text = scriptText(script || {});
  const out = [];
  for (const [niches, re, level, title, detail] of CHECKS) {
    if (!niches.includes('*') && !niches.includes(niche)) continue;
    const m = text.match(re);
    if (m) out.push({ level, title, detail, quote: m[0] });
  }
  if (['odonto', 'saude'].includes(niche) && !/\b(CRO|CRM|CRN|CREFITO|CRP|CRBM|RQE)\b/.test(text)) {
    out.push({ level: 'dica', title: 'Identificação do profissional', detail: `Lembre de mostrar nome e número do ${niche === 'odonto' ? 'CRO' : 'conselho'} na tela, na legenda ou na bio.`, quote: '' });
  }
  const secs = (script?.scenes || []).reduce((a, c) => a + (Number(c.secs) || 0), 0);
  if (script?.duration && secs && Math.abs(secs - script.duration) > Math.max(8, script.duration * 0.35)) {
    out.push({ level: 'dica', title: 'Duração', detail: `As cenas somam ${secs}s, mas o alvo é ${script.duration}s.`, quote: '' });
  }
  if (!(script?.hooks || []).some((x) => String(x).trim())) out.push({ level: 'atencao', title: 'Sem gancho', detail: 'Os 3 primeiros segundos decidem se a pessoa fica. Escreva o gancho.', quote: '' });
  return out;
}

// Limpa e limita o que vem do navegador ou da IA antes de salvar.
const str = (v, n) => String(v ?? '').replace(/\r/g, '').trim().slice(0, n);
export function cleanScript(s = {}) {
  const hooks = (Array.isArray(s.hooks) ? s.hooks : []).map((x) => str(x, 220)).filter(Boolean).slice(0, 3);
  const scenes = (Array.isArray(s.scenes) ? s.scenes : []).slice(0, 12).map((c) => ({
    show: str(c?.show, 400), say: str(c?.say, 700), text: str(c?.text, 160), secs: Math.max(0, Math.min(120, Math.round(Number(c?.secs) || 0))),
  })).filter((c) => c.show || c.say || c.text);
  return {
    template: TEMPLATES[s.template] ? s.template : 'livre',
    duration: DURATIONS.includes(Number(s.duration)) ? Number(s.duration) : 30,
    topic: str(s.topic, 300),
    hooks,
    hook: Math.max(0, Math.min(hooks.length - 1, Number(s.hook) || 0)),
    scenes,
    cta: str(s.cta, 300),
    audio: str(s.audio, 200),
    cover: str(s.cover, 200),
    caption: str(s.caption, 2200),
    notes: str(s.notes, 1000), // só a equipe vê
  };
}

// O que o cliente vê (sem notas internas nem as outras opções de gancho).
export function publicScript(s) {
  if (!s) return null;
  return {
    status: s.status, template: s.template, duration: s.duration, topic: s.topic,
    hook: (s.hooks || [])[s.hook || 0] || '', scenes: s.scenes || [], cta: s.cta, audio: s.audio, cover: s.cover,
    feedback: s.feedback || null, feedback_audio: s.feedback_audio || null, decided_at: s.decided_at || null, sent_at: s.sent_at || null,
  };
}
