// Questionário de onboarding (o mesmo no navegador e no servidor). As respostas vão para a Marca do cliente.
export const SECTIONS = [
  { id: 'publico', title: 'Sua empresa e seu público', intro: 'Para começar, quem é você e com quem vamos falar.' },
  { id: 'objetivos', title: 'Objetivos', intro: 'Aonde você quer chegar com o digital.' },
  { id: 'essencia', title: 'A essência da sua marca', intro: 'O que te move e o que te torna diferente.' },
  { id: 'cliente', title: 'Seu cliente', intro: 'Quem você atende e como você transforma a vida dele.' },
  { id: 'digital', title: 'Sua marca no digital', intro: 'Referências, limites e a impressão que você quer causar.' },
];

export const QUESTIONS = [
  { id: 'empresa', section: 'publico', q: 'Qual o nome da sua empresa?', type: 'short' },
  { id: 'idade', section: 'publico', q: 'Qual a idade do seu público?', type: 'short', ph: 'Ex.: 25 a 45 anos' },
  { id: 'sexo', section: 'publico', q: 'Qual o sexo do seu público?', type: 'choice', options: ['Feminino', 'Masculino', 'Ambos'] },
  { id: 'formado', section: 'publico', q: 'Seu público é formado?', hint: 'Tem ensino superior completo.', type: 'choice', options: ['Sim', 'Não'] },
  { id: 'classe', section: 'publico', q: 'Qual a classe social?', type: 'choice', options: ['Classe A', 'Classe B', 'Classe C', 'Classes A e B', 'Classes B e C'] },
  { id: 'local', section: 'publico', q: 'Localização?', hint: 'Onde está o público que você quer atingir.', type: 'choice', options: ['Cuiabá', 'Cuiabá e VG', 'Regional', 'Nacional'] },
  { id: 'objetivo_curto', section: 'objetivos', q: 'Qual seu objetivo a curto prazo (6 meses)?', type: 'long' },
  { id: 'objetivo_longo', section: 'objetivos', q: 'Qual seu objetivo a longo prazo (01 ano)?', type: 'long' },
  { id: 'diferencial', section: 'essencia', q: 'Qual o seu diferencial?', type: 'long' },
  { id: 'inimigo', section: 'essencia', q: 'Qual seu inimigo em comum com o público?', hint: 'Aquilo que vocês dois combatem juntos (ex.: o atendimento frio, o "jeitinho", a falta de tempo).', type: 'long' },
  { id: 'por_que', section: 'essencia', q: 'Por que você produz conteúdo?', type: 'long' },
  { id: 'proposito', section: 'essencia', q: 'Qual seu propósito?', type: 'long' },
  { id: 'missao', section: 'essencia', q: 'Qual sua missão?', type: 'long' },
  { id: 'valores', section: 'essencia', q: 'Quais são seus valores?', type: 'long' },
  { id: 'cliente_ideal', section: 'cliente', q: 'Qual seu cliente ideal?', type: 'long' },
  { id: 'ajuda', section: 'cliente', q: 'Como sua empresa ajuda na vida do seu público?', type: 'long' },
  { id: 'problemas', section: 'cliente', q: 'Quais problemas seus clientes enfrentam?', type: 'long' },
  { id: 'inspiracoes', section: 'digital', q: 'Quais marcas, perfis ou criadores de conteúdo você admira? O que chama sua atenção na comunicação deles?', type: 'long', ph: 'Ex.: @perfil — gosto das fotos claras e do jeito leve de explicar.' },
  { id: 'evitar', section: 'digital', q: 'Existe algum tipo de conteúdo, linguagem, tendência ou abordagem que você não gostaria de associar à sua marca?', type: 'long' },
  { id: 'concorrentes', section: 'digital', q: 'Quem são seus principais concorrentes e o que você acredita que eles fazem bem ou deixam de fazer na comunicação digital?', type: 'long' },
  { id: 'percepcao', section: 'digital', q: 'O que você gostaria que as pessoas sentissem, percebessem ou associassem à sua empresa logo no primeiro contato com o seu perfil?', type: 'long' },
];

// Valida e limpa as respostas. Devolve { answers, missing }.
export function cleanAnswers(input = {}) {
  const answers = {}; const missing = [];
  for (const q of QUESTIONS) {
    let v = String(input[q.id] ?? '').trim().slice(0, q.type === 'short' ? 200 : 2500);
    if (q.type === 'choice' && v && !q.options.includes(v)) v = '';
    if (v) answers[q.id] = v; else missing.push(q.id);
  }
  return { answers, missing };
}
