// Onboarding do cliente: apresentação da agência (textos editáveis em Ajustes) + questionário que alimenta a Marca.
import { db } from './db.js';
import { getState } from './appstate.js';
import { QUESTIONS } from '../public/onboarding-perguntas.js';

// Textos do manual de boas-vindas da MC Digital. **negrito** vira destaque.
export const ONB_DEFAULTS = {
  instagram: '@mcdigital.ag',
  hello_sub: 'Se você recebeu esse manual, significa que uma mudança está prestes a acontecer.',
  founder_name: 'Maria Carolina',
  founder_role: 'founder',
  founder_photo: '',
  founder_bio: 'Eu sou a Maria Carolina, criadora da MC Digital, e é um prazer enorme poder te acompanhar nessa jornada.\n\nO meu trabalho vai além de postar nas redes sociais: eu mergulho na essência da sua marca, entendo seus valores, seu propósito e o que te torna diferente. A partir disso, construo um storytelling estratégico, que conecta pessoas, gera proximidade e transforma seguidores em clientes.',
  mission: 'Nossa missão é dar **visibilidade** e **reconhecimento** aos nossos clientes, transformando empresas, marcas e profissionais em **referências**. Mostramos ao mundo o valor e a identidade únicos de cada um, criando **conexões** reais e duradouras.',
  values: 'Tudo começou com um propósito: **transformar** empresas e marcas no mundo digital. Não apenas para que vendam, mas para que sejam **referência** em seus mercados. E faço isso guiada por meus valores: **honestidade, foco e empenho**. Cada ação é pensada para gerar resultados reais e duradouros.',
  steps: ['Reunião de alinhamento', 'Ideias de conteúdo', 'Cronograma', 'Roteirização', 'Gravação', 'Edição', 'Revisão e aprovação', 'Postagens', 'Coleta de insights'],
  approval: 'Nossos conteúdos são enviados na semana que antecede a semana de posts, geralmente nas quintas-feiras (a depender do caso), por um **link de aprovação**: você vê cada post exatamente como vai ficar no Instagram, com fotos, vídeos, legendas, data e horário.\n\nApós o recebimento, você tem até **24 horas** para realizar a aprovação e poderá solicitar alterações de forma gratuita, escrevendo ou mandando um **áudio**.',
  cta_title: 'Deixe que sua marca seja vista e reconhecida pelo que a torna única.',
  cta_strong: 'Vamos construir isso juntos?',
  cta_text: 'Responda ao questionário e vamos avançar na transformação da sua empresa no mundo digital!',
  thanks_title: 'Obrigada!',
  thanks_text: 'Vamos trabalhar juntos e levar sua empresa para o próximo nível.',
};
export const ONB_TEXT_FIELDS = ['instagram', 'hello_sub', 'founder_name', 'founder_role', 'founder_bio', 'mission', 'values', 'approval', 'cta_title', 'cta_strong', 'cta_text', 'thanks_title', 'thanks_text'];

export async function onboardingContent() {
  const saved = (await getState('onboarding_content')) || {};
  const out = { ...ONB_DEFAULTS, ...saved };
  if (!Array.isArray(out.steps) || !out.steps.length) out.steps = ONB_DEFAULTS.steps;
  return out;
}

// Checklist do processo: os itens marcam sozinhos conforme o trabalho anda.
const CHECKLIST = [
  ['Reunião de alinhamento', 'always'], ['Grupo no WhatsApp', 'always'], ['Contrato + pagamento', 'always'], ['Onboarding', 'form'],
  ['Envio de materiais disponíveis (identidade) + liberação de acessos', 'materials'],
  ['Elaboração do planejamento estratégico + análise completa de perfil (15 dias)', 'posts'],
  ['Apresentação do planejamento', 'sent'], ['Cronograma + produção dos conteúdos (10 dias)', 'sent'],
  ['Aprovação dos conteúdos', 'approved'], ['Programação dos conteúdos', 'approved'], ['Envio de insights (01 mês)', 'report'],
];
export async function checklistFor(c) {
  const [files, posts, reports] = await Promise.all([
    db.select('client_files', { select: 'id', client_id: `eq.${c.id}`, category: 'in.(brand,briefing)', limit: 1 }).catch(() => []),
    db.select('posts', { select: 'status', client_id: `eq.${c.id}`, limit: 500 }).catch(() => []),
    db.select('reports', { select: 'id', client_id: `eq.${c.id}`, limit: 1 }).catch(() => []),
  ]);
  const st = new Set(posts.map((p) => p.status));
  const done = {
    always: true, form: Boolean(c.brand_kit?.onboarding?.submitted_at), materials: files.length > 0 || Boolean(c.ig_token),
    posts: posts.length > 0, sent: ['pending_approval', 'changes_requested', 'approved', 'publishing', 'published'].some((s) => st.has(s)),
    approved: ['approved', 'publishing', 'published'].some((s) => st.has(s)), report: reports.length > 0,
  };
  return CHECKLIST.map(([text, rule]) => ({ text, done: done[rule] }));
}

// Resumo da marca para a IA (legendas e planejamento): questionário + campos do digital.
export function brandBrief(client) {
  const a = client?.brand_kit?.onboarding?.answers;
  if (!a) return '';
  const pick = (id) => a[id] ? `${QUESTIONS.find((q) => q.id === id).q} ${a[id]}` : null;
  const publico = [a.idade && `idade ${a.idade}`, a.sexo && `sexo ${a.sexo.toLowerCase()}`, a.classe && a.classe.toLowerCase(), a.local && `localização ${a.local}`, a.formado && `formação superior: ${a.formado.toLowerCase()}`].filter(Boolean).join(', ');
  return ['Questionário de onboarding respondido pelo cliente:', publico && `Público: ${publico}.`,
    ...['objetivo_curto', 'objetivo_longo', 'diferencial', 'inimigo', 'proposito', 'missao', 'valores', 'cliente_ideal', 'ajuda', 'problemas', 'inspiracoes', 'evitar', 'concorrentes', 'percepcao'].map(pick)]
    .filter(Boolean).map((l) => l.slice(0, 600)).join('\n');
}
