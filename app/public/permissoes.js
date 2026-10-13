// Permissões das contas da equipe (o mesmo no painel e no servidor). Administrador tem tudo.
export const PERMS = [
  ['conteudo', 'Criar e editar posts', 'Agenda, Calendário, Fluxo, ideias, mídias e legendas.'],
  ['enviar', 'Enviar ao cliente e aprovar direto', 'Mandar posts para aprovação e colocar na fila de publicação.'],
  ['apagar', 'Apagar posts', ''],
  ['ia', 'Usar a IA', 'Legendas, planejamento do mês e revisão com IA (gera custo).'],
  ['marca', 'Marca, banco de mídia, modelos e pedidos', 'Identidade de cada cliente e os pedidos que ele manda.'],
  ['clientes', 'Cadastrar e editar clientes', 'Dados de contato, conectar o Instagram, links de aprovação.'],
  ['relatorios', 'Relatórios e histórico de aprovações', 'Gerar e ver os relatórios mensais do Instagram.'],
  ['financeiro', 'Financeiro e contratos', 'Mensalidades, cobranças, Pix, notas, contratos, pasta privada e área do cliente.'],
  ['vendas', 'Vendas e propostas', 'Funil de leads, diagnóstico e propostas comerciais.'],
];
export const PERM_KEYS = PERMS.map(([k]) => k);
export const PERM_LABEL = Object.fromEntries(PERMS.map(([k, l]) => [k, l]));
// padrão de quem é "equipe" (igual ao comportamento antigo)
export const TEAM_DEFAULT = { conteudo: true, enviar: true, apagar: true, ia: true, marca: true, clientes: false, relatorios: false, financeiro: false, vendas: false };
export function cleanPerms(p = {}) { return Object.fromEntries(PERM_KEYS.map((k) => [k, p[k] === undefined ? TEAM_DEFAULT[k] : Boolean(p[k])])); }
