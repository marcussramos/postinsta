// Páginas públicas com prévia de link (WhatsApp, Instagram, e-mail): devolve o HTML da página
// com as etiquetas Open Graph (imagem, título e descrição) preenchidas para aquele link.
// Os robôs de prévia não rodam JavaScript, por isso o título/imagem precisam vir prontos no HTML.
// /aprovar, /cliente, /relatorio, /proposta, /historico → (rewrite no vercel.json) → /api/page?p=...
// Os HTML ficam em app/pages/ (fora de public/) para a Vercel não servi-los direto, sem as etiquetas.
import fs from 'node:fs';
import path from 'node:path';
import { db } from '../lib/db.js';
import { appUrl } from '../lib/env.js';
import { getState } from '../lib/appstate.js';

const PAGES = ['aprovar', 'cliente', 'relatorio', 'proposta', 'historico', 'boasvindas', 'diagnostico', 'privacidade', 'exclusao', 'termos', 'sobre', 'conectar'];
// Páginas legais (exigidas pela Meta): públicas, indexáveis e preenchidas com os dados da agência (Ajustes → Dados da agência).
const LEGAL = { privacidade: '/privacidade', exclusao: '/exclusao-de-dados', termos: '/termos', sobre: '/sobre' };
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const tokenOk = (t) => typeof t === 'string' && /^[a-f0-9]{32,64}$/.test(t);
const nf = (v) => (v == null ? null : Number(v).toLocaleString('pt-BR'));
const brl = (c) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const DEFAULTS = {
  aprovar: { image: 'aprovacao', title: 'Posts para aprovar', description: 'Veja cada post como vai aparecer no Instagram e aprove com um toque.' },
  cliente: { image: 'cliente', title: 'Área do cliente', description: 'Contrato, relatórios, financeiro e pedidos do seu Instagram em um só lugar.' },
  relatorio: { image: 'relatorio', title: 'Relatório mensal do Instagram', description: 'Alcance, interações, seguidores e os melhores posts do mês.' },
  proposta: { image: 'proposta', title: 'Proposta comercial', description: 'Gestão de Instagram: planejamento, criação, aprovação e publicação.' },
  diagnostico: { image: 'diagnostico', title: 'Diagnóstico grátis do seu Instagram', description: 'Responda 2 minutos de perguntas e receba na hora uma análise do seu perfil com 3 ações para crescer.' },
  boasvindas: { image: 'boasvindas', title: 'Bem-vindo à MC Digital', description: 'Conheça como vamos trabalhar juntos e responda ao questionário da sua marca.' },
  privacidade: { image: 'boasvindas', title: 'Política de Privacidade · MC DIGITAL', description: 'Como o MC DIGITAL trata os dados dos perfis de Instagram dos clientes. Privacy Policy in English included.' },
  exclusao: { image: 'boasvindas', title: 'Exclusão de dados · MC DIGITAL', description: 'Como apagar os dados que o MC DIGITAL recebeu do seu Instagram. Data deletion instructions.' },
  sobre: { image: 'painel', title: 'MC Digital · Agência de social media', description: 'Planejamento, criação, aprovação pelo celular e publicação do Instagram da sua empresa, com relatório todo mês.' },
  termos: { image: 'boasvindas', title: 'Termos de Uso · MC DIGITAL', description: 'Termos de uso do MC DIGITAL. Terms of Service.' },
  conectar: { image: 'cliente', title: 'Conecte seu Instagram', description: 'Autorize a publicação dos posts aprovados. Você entra direto no Instagram; a agência não vê sua senha.' },
  historico: { image: 'historico', title: 'Histórico de aprovações', description: 'Registro de envios, aprovações e publicações com data e hora.' },
};

async function personalize(p, t) {
  if (!tokenOk(t)) return {};
  if (p === 'aprovar') {
    const c = await db.one('clients', { select: 'id,name', approval_token: `eq.${t}` });
    if (!c) return {};
    const pend = await db.select('posts', { select: 'id', client_id: `eq.${c.id}`, status: 'eq.pending_approval' }).catch(() => []);
    return {
      title: pend.length ? `${pend.length} post${pend.length > 1 ? 's' : ''} para aprovar · ${c.name}` : `Aprovação de posts · ${c.name}`,
      description: pend.length ? 'Toque para ver como vão ficar no Instagram e aprovar ou pedir ajuste.' : 'Tudo em dia por aqui. Os próximos posts aparecem neste mesmo link.',
    };
  }
  if (p === 'conectar') {
    const c = await db.one('clients', { select: 'name', approval_token: `eq.${t}` });
    return c ? { title: `Conecte seu Instagram · ${c.name}`, description: 'Uma autorização rápida para os posts aprovados saírem sozinhos. Você entra direto no Instagram; a agência não vê sua senha.' } : {};
  }
  if (p === 'cliente') {
    const c = await db.one('clients', { select: 'name,contract_data', portal_token: `eq.${t}` });
    return c ? { title: `Área do cliente · ${c.contract_data?.nome || c.name}`, description: 'Seu contrato, relatórios mensais, financeiro e pedidos em um só lugar. Link pessoal.' } : {};
  }
  if (p === 'boasvindas') {
    const c = await db.one('clients', { select: 'name,contract_data', portal_token: `eq.${t}` });
    const first = (c?.contract_data?.representante || '').trim().split(/\s+/)[0];
    return c ? { title: `${first ? `Oi, ${first}! ` : ''}Bem-vindo à MC Digital`, description: `Seu manual de boas-vindas e o questionário da marca ${c.contract_data?.nome || c.name}. Leva uns 15 minutos.` } : {};
  }
  if (p === 'relatorio') {
    const r = await db.one('reports', { select: 'ref_month,data', share_token: `eq.${t}` });
    if (!r) return {};
    const [y, m] = r.ref_month.split('-').map(Number);
    const T = r.data?.totals || {};
    const bits = [T.reach?.value != null && `${nf(T.reach.value)} de alcance`, T.interactions?.value != null && `${nf(T.interactions.value)} interações`,
      T.followers_gained?.value != null && `${T.followers_gained.value > 0 ? '+' : ''}${nf(T.followers_gained.value)} seguidores`].filter(Boolean);
    return { title: `Relatório de ${MESES[m - 1]} de ${y} · ${r.data?.client_name || 'Instagram'}`, description: bits.length ? `${bits.join(' · ')}. Veja os melhores posts do mês.` : DEFAULTS.relatorio.description };
  }
  if (p === 'proposta') {
    const pr = await db.one('proposals', { select: 'client_name,status,monthly_fee_cents,quota_posts,quota_reels', token: `eq.${t}` });
    if (!pr || pr.status === 'draft') return {};
    const ent = [pr.quota_posts && `${pr.quota_posts} posts`, pr.quota_reels && `${pr.quota_reels} Reels`].filter(Boolean).join(' + ');
    return { title: `Proposta para ${pr.client_name}`, description: `Gestão de Instagram${ent ? `: ${ent} por mês` : ''}. Veja o que está incluso e aceite pelo celular.` };
  }
  return {};
}

// Dados públicos do CNPJ da agência (cartão MEI), usados quando Ajustes → Dados da agência estiver vazio.
const AGENCY_PUBLIC = { razao_social: '55.846.288 MARIA CAROLINA SILVESTRI DE FIGUEIREDO', cnpj: '55.846.288/0001-01', cidade: 'Cuiabá – MT', email: 'mariacarolsf01@gmail.com', marca: 'MC DIGITAL' };

// Preenche {{campos}} das páginas legais com os dados da agência; o que faltar vira um texto neutro (nunca um colchete).
async function fillLegal(p, html, q, base) {
  let a = {};
  try { a = (await getState('agency', {})) || {}; } catch { /* sem banco */ }
  a = { ...AGENCY_PUBLIC, ...Object.fromEntries(Object.entries(a).filter(([, x]) => String(x || '').trim())) };
  const cidade = a.cidade || 'Brasil';
  const v = {
    marca: a.marca || 'MC DIGITAL',
    razao: a.razao_social || a.marca || 'MC Digital',
    cnpj: a.cnpj || 'informado no contrato',
    email: a.email || '—',
    cidade, cidade_en: `${cidade}, Brazil`,
    endereco: a.endereco ? `${a.endereco} · ` : '',
    app_url: base,
    status: '',
  };
  if (p === 'exclusao' && q.get('code')) {
    const code = String(q.get('code')).replace(/[^a-z0-9]/gi, '').slice(0, 40);
    let r = null;
    try { r = ((await getState('ig_deletions', {})) || {})[code] || null; } catch { /* sem banco */ }
    const when = r ? new Date(r.at).toLocaleDateString('pt-BR', { timeZone: 'America/Cuiaba' }) : '';
    v.status = `<div class="status"><div class="eyebrow">Pedido ${esc(code)} · Request ${esc(code)}</div>${r
      ? `<p><b>Concluído em ${esc(when)}.</b> O token de acesso, o ID e o nome de usuário do Instagram foram apagados do sistema.<br><span lang="en"><b>Completed on ${esc(new Date(r.at).toISOString().slice(0, 10))}.</b> The Instagram access token, account ID and username were deleted.</span></p>`
      : '<p>Não encontramos esse código. Se você acabou de pedir, aguarde alguns minutos ou escreva para o e-mail abaixo.<br><span lang="en">We could not find this code. If you just made the request, wait a few minutes or email us.</span></p>'}</div>`;
  }
  return html.replace(/\{\{(\w+)\}\}/g, (m, k) => (k === 'status' ? v.status : k in v ? esc(v[k]) : ''));
}

const files = new Map();
function readPage(p) {
  // caminho relativo a este arquivo (a Vercel inclui app/pages/ no pacote da função via includeFiles)
  if (!files.has(p)) {
    const candidates = [new URL(`../pages/${p}.html`, import.meta.url), path.join(process.cwd(), 'pages', `${p}.html`)];
    let html = null;
    for (const c of candidates) { try { html = fs.readFileSync(c, 'utf8'); break; } catch { /* tenta o próximo */ } }
    if (html === null) throw new Error('página não encontrada');
    files.set(p, html);
  }
  return files.get(p);
}

export default async function handler(req, res) {
  const u = new URL(req.url, 'http://x');
  const p = u.searchParams.get('p');
  if (!PAGES.includes(p)) { res.statusCode = 404; return res.end('Página não encontrada.'); }
  let html;
  try { html = readPage(p); } catch { res.statusCode = 500; return res.end('Página indisponível.'); }
  let meta = { ...DEFAULTS[p] };
  try { Object.assign(meta, await personalize(p, u.searchParams.get('t'))); } catch { /* sem banco: usa o padrão */ }
  let base = '';
  try { base = appUrl(); } catch { base = `https://${req.headers.host}`; }
  if (LEGAL[p]) html = await fillLegal(p, html, u.searchParams, base);
  const pageUrl = LEGAL[p] ? `${base}${LEGAL[p]}` : `${base}/${p}${u.searchParams.get('t') ? `?t=${encodeURIComponent(u.searchParams.get('t'))}` : ''}`;
  const tags = `
<meta property="og:type" content="website">
<meta property="og:site_name" content="MC DIGITAL">
<meta property="og:locale" content="pt_BR">
<meta property="og:title" content="${esc(meta.title)}">
<meta property="og:description" content="${esc(meta.description)}">
<meta property="og:url" content="${esc(pageUrl)}">
<meta property="og:image" content="${esc(`${base}/og/v2/${meta.image}.jpg`)}">
<meta property="og:image:secure_url" content="${esc(`${base}/og/v2/${meta.image}.jpg`)}">
<meta property="og:image:type" content="image/jpeg">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${esc(meta.title)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="description" content="${esc(meta.description)}">
`;
  html = html.replace(/<title>[^<]*<\/title>/, `<title>${esc(meta.title)}</title>${tags}`);
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  if (LEGAL[p] && !u.searchParams.get('code')) res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=300');
  else { res.setHeader('Cache-Control', 'private, no-store'); res.setHeader('X-Robots-Tag', 'noindex, nofollow'); }
  res.end(html);
}
