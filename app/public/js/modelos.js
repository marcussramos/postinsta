// MC DIGITAL — Biblioteca de modelos de carrossel do Estúdio.
// Cada modelo é uma RECEITA de layout (estrutura, hierarquia, elementos), aprendida de perfis de referência
// e aplicada com as cores, fontes e fotos de cada cliente. Nunca copia a arte, os personagens ou a identidade
// de quem serviu de referência. Para incluir um modelo novo: estude o perfil, descreva a receita aqui e
// implemente o desenho em public/js/artes.js (STYLES).
export const MODELOS = [
  {
    key: 'editorial', nome: 'Editorial', origem: 'MC DIGITAL',
    receita: 'Foto do cliente em tela cheia com moldura fina; lâminas com foto em cima e número em círculo; retrato redondo e botão no CTA.',
    serve: 'Saúde e estética com fotos boas (Annielly, Laís).',
  },
  {
    key: 'revista', nome: 'Revista', origem: 'MC DIGITAL',
    receita: 'Fundo creme com textura e moldura; foto em arco; numeral gigante ao fundo; foto redonda com anel.',
    serve: 'Marcas delicadas e sofisticadas (Maria Clara, Maison K.).',
  },
  {
    key: 'impacto', nome: 'Impacto', origem: 'MC DIGITAL',
    receita: 'Cor sólida da marca, caixa alta pesada, palavra-chave com marca-texto, foto em círculo e formas.',
    serve: 'Dicas e listas que precisam parar o scroll.',
  },
  {
    key: 'poster', nome: 'Pôster', origem: '@madesigner.psd',
    receita: 'Imagem em tela cheia escurecida com textura; chamada manuscrita inclinada; título condensado empilhado e centralizado; palavra-chave em caixa de cor; brilhos ✦; etiqueta com o apoio; selo "PARTE 02" nas lâminas.',
    serve: 'Séries e conteúdos de opinião ("coisas que…", "parte 1, 2, 3"). Ótimo para a MC DIGITAL e marcas jovens.',
  },
  {
    key: 'perfil', nome: 'Perfil', origem: '@designer.fred',
    receita: 'Fundo claro com manchas de cor desfocadas; cabeçalho de perfil (foto, nome, selo, @); título forte com palavra-chave na cor da marca; foto em cartão branco inclinado com sombra; texto em cartão com barra de cor; ícone de salvar no CTA.',
    serve: 'Guias e conteúdo educativo que gera salvamento (dentistas, médicos, nutrição).',
  },
  {
    key: 'neon', nome: 'Neon', origem: '@edesson_designer',
    receita: 'Fundo quase preto com brilho da cor da marca; abas de navegação no topo; texto fino com palavra-chave grande e brilhante; cartão translúcido com tópicos em seta; botão com brilho.',
    serve: 'Serviços, tecnologia, B2B e a própria MC DIGITAL. Fica melhor com cor de destaque viva.',
  },
  {
    key: 'manchete', nome: 'Manchete', origem: '@thom.designer',
    receita: 'Foto real em tela cheia com tom quente de filme; selo do perfil no topo; manchete condensada enorme com as palavras de ligação (que, de, pra) pequenas e em itálico, "penduradas" na linha.',
    serve: 'Bastidores, rotina, opinião e storytelling com foto da pessoa.',
  },
];
// Perfis estudados que não viraram modelo próprio (a receita já está coberta por outro):
//   @maarcelodsgn — pessoa recortada sobre cor sólida + título 3D/metálico + faixa com o nome → coberto pelo Pôster
//     (o recorte da pessoa exige remover o fundo da foto, que o gerador ainda não faz).
export const MODELO_PADRAO = 'editorial';
