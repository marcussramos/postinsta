// MC DIGITAL — painel da agência (JavaScript puro, sem build).
import { billingMonths as billingMonthsShared, dueSoon, splitCents, planOf } from '/billing.js';
import { QUESTIONS as ONB_QUESTIONS, SECTIONS as ONB_SECTIONS } from '/onboarding-perguntas.js';
import { reviewPost, applyFix } from '/revisor.js';
import { PERMS, TEAM_DEFAULT } from '/permissoes.js';
import { TEMPLATES, DURATIONS, NICHE_RULES, SCRIPT_STATUS, checkScript } from '/roteiro.js';
import { NICHES, datesBetween, dateAlerts, relevantFor, daysBetween } from '/dates.js';
import { h, api, toast, fmtDate, fmtTime, dayKey, zonedToISO, partsInTz, prepareImage, copyText, waLink, mailLink, blobToDataUrl, STATUS_LABEL, brl, monthLabel, fileSize, videoInfo, videoFrame, uploadVideo, MEDIA_LABEL, compressVideo, VIDEO_MAX } from '/shared.js';

const VIEWS = ['inicio', 'agenda', 'calendario', 'fluxo', 'clientes', 'vendas', 'propostas', 'ajustes'];
const S = {
  admin: false, tz: 'America/Cuiaba', setup: null, clients: [], posts: [], view: 'agenda', fClient: '', fStatus: '',
  payments: [], folderId: null, folder: { id: null, files: [], preview: null, loading: false, error: null, tab: 'contract' }, settings: undefined,
  cal: { month: null, posts: [], day: null, loading: false, mode: savedPref('mc_cal_mode', 'thumbs') },
};
function savedPref(key, fallback) { try { return localStorage.getItem(key) || fallback; } catch { return fallback; } }
function savePref(key, value) { try { localStorage.setItem(key, value); } catch { /* navegador sem armazenamento: só não lembra */ } }
function viewFromHash() {
  const v = location.hash.slice(1);
  if (v.startsWith('pasta/')) { S.folderId = v.slice(6); return 'pasta'; }
  return VIEWS.includes(v) ? v : 'inicio';
}
const root = document.getElementById('app');
const can = (p) => S.role === 'admin' || Boolean(S.perms?.[p]);
const sinceISO = () => new Date(Date.now() - 7 * 86400e3).toISOString();

boot();

async function boot() {
  const p = new URLSearchParams(location.search);
  if (p.get('ig')) {
    toast(p.get('msg') || 'Pronto.', p.get('ig') !== 'ok');
    history.replaceState(null, '', `/${location.hash || '#clientes'}`);
  }
  S.view = viewFromHash();
  try {
    const s = await api('/api/session');
    Object.assign(S, { admin: s.admin, staff: s.staff ?? s.admin, role: s.role || (s.admin ? 'admin' : null), userName: s.name, perms: s.perms || null, limitClients: s.clients || null, tz: s.timezone, setup: s.setup || null });
  } catch { /* mostra o login */ }
  if (!S.staff) return renderLogin();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  if ((S.view === 'ajustes' && S.role !== 'admin') || (['propostas', 'vendas'].includes(S.view) && !can('vendas'))) { S.view = 'inicio'; history.replaceState(null, '', '#inicio'); }
  await loadAll();
}

async function loadAll() {
  try {
    // tudo de uma vez (antes era em fila e o painel demorava para abrir)
    const [clients, posts, payments] = await Promise.all([api('/api/clients'), api(`/api/posts?from=${encodeURIComponent(sinceISO())}`),
      can('financeiro') ? api('/api/pasta?r=payments').catch(() => []) : null, loadExtras()]); // pagamentos: vazio até a atualização do banco
    S.clients = clients; S.posts = posts; if (payments) S.payments = payments;
  } catch (e) {
    if (e.status === 401) { S.admin = false; S.staff = false; return renderLogin(); }
    toast(e.message, true);
  }
  render();
}

window.addEventListener('hashchange', () => { S.view = viewFromHash(); render(); });

// Mantém tudo em dia com as decisões dos clientes: atualiza ao voltar para a aba e a cada minuto.
async function refresh() {
  if (!S.staff || document.hidden || document.querySelector('.drawer')) return;
  try {
    const [clients, posts] = await Promise.all([api('/api/clients'), api(`/api/posts?from=${encodeURIComponent(sinceISO())}`)]);
    const changed = JSON.stringify(posts) !== JSON.stringify(S.posts) || JSON.stringify(clients) !== JSON.stringify(S.clients);
    S.clients = clients; S.posts = posts;
    await loadExtras();
    if (S.view === 'calendario') await loadMonth(S.cal.month, true);
    if (changed) render();
  } catch { /* tenta de novo na próxima */ }
}
document.addEventListener('visibilitychange', refresh);
setInterval(refresh, 60_000);

// Contador de entregas do mês e pedidos abertos dos clientes (falham em silêncio antes da atualização do banco).
async function loadExtras() {
  const sales = can('vendas');
  const [deliv, reqs, proposals, leads] = await Promise.all([
    api(`/api/pasta?r=deliveries&month=${todayLocal().slice(0, 7)}`).catch(() => null),
    api('/api/pasta?r=requests&open=1').catch(() => null),
    sales ? api('/api/pasta?r=proposals').catch(() => null) : null,
    sales ? api('/api/pasta?r=leads').catch(() => null) : null,
  ]);
  S.deliv = deliv || {}; S.requests = reqs || [];
  if (sales) Object.assign(S, { proposals, leads });
}

// ───────────────────────── tema: Automático (segue o aparelho) → Claro → Escuro, salvo neste aparelho
const THEMES = { auto: ['◐', 'Tema: automático (segue o aparelho)'], light: ['☀', 'Tema: claro'], dark: ['☾', 'Tema: escuro'] };
function currentTheme() { try { const t = localStorage.getItem('mc-theme'); return THEMES[t] ? t : 'auto'; } catch { return 'auto'; } }
function applyTheme(t) {
  if (t === 'auto') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t;
  try { if (t === 'auto') localStorage.removeItem('mc-theme'); else localStorage.setItem('mc-theme', t); } catch { /* sem armazenamento: vale só nesta aba */ }
}
function themeButton() {
  const b = h('button', { class: 'btn ghost sm theme-btn', type: 'button' });
  const draw = () => { const t = currentTheme(); b.textContent = THEMES[t][0]; b.title = THEMES[t][1]; b.setAttribute('aria-label', `${THEMES[t][1]}. Clique para trocar.`); };
  b.onclick = () => { const order = ['auto', 'light', 'dark']; const next = order[(order.indexOf(currentTheme()) + 1) % 3]; applyTheme(next); draw(); toast(THEMES[next][1]); };
  draw();
  return b;
}

// ───────────────────────── login
function renderLogin() {
  const email = h('input', { type: 'email', id: 'em', autocomplete: 'username', placeholder: 'só para contas da equipe' });
  const pw = h('input', { type: 'password', id: 'pw', autocomplete: 'current-password', required: true });
  const btn = h('button', { class: 'btn primary', type: 'submit' }, 'Entrar');
  const code = h('input', { type: 'text', id: 'otp', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: 7, placeholder: '000000', class: 'mono otp' });
  const codeField = h('div', { class: 'field', hidden: true }, h('label', { for: 'otp' }, 'Código de verificação'), code, h('span', { class: 'hint' }, 'Abra o app autenticador (Google Authenticator, Authy…) e digite os 6 números de MC DIGITAL.'));
  root.replaceChildren(h('main', { class: 'login' },
    h('form', { onsubmit: async (e) => {
      e.preventDefault(); btn.disabled = true;
      try {
        const body = email.value.trim() ? { email: email.value.trim(), password: pw.value } : { password: pw.value };
        if (!codeField.hidden) body.code = code.value.replace(/\D/g, '');
        const s = await api('/api/session', { method: 'POST', body });
        if (s.need_code) { codeField.hidden = false; btn.disabled = false; btn.textContent = 'Confirmar'; code.focus(); return; }
        S.admin = s.admin; S.staff = true; S.role = s.role; S.tz = s.timezone; await boot();
      } catch (err) { toast(err.message, true); btn.disabled = false; if (codeField.hidden) pw.select(); else code.select(); }
    } },
      brand(),
      h('h1', {}, 'Entrar no painel'),
      h('div', { class: 'field' }, h('label', { for: 'em' }, 'E-mail'), email, h('span', { class: 'hint' }, 'Administrador principal: deixe em branco e use a senha do painel.')),
      h('div', { class: 'field' }, h('label', { for: 'pw' }, 'Senha'), pw),
      codeField,
      btn,
      h('p', { class: 'muted', style: 'font-size:13px;margin:4px 0 0;text-align:center' }, h('a', { href: '/sobre' }, 'Conheça a MC Digital'), ' · ', h('a', { href: '/privacidade' }, 'Privacidade'), ' · ', h('a', { href: '/termos' }, 'Termos')),
    )));
  pw.focus();
}

const brand = () => h('a', { class: 'brand', href: '#inicio', 'aria-label': 'MC DIGITAL — Início', title: 'Início' }, h('img', { class: 'brand-logo light', src: '/brand/logo.png', alt: 'MC Digital' }), h('img', { class: 'brand-logo dark', src: '/brand/logo-claro.png', alt: '' }));

// ───────────────────────── estrutura
function render() {
  const tab = (id, label) => h('a', { class: 'tab', href: `#${id}`, 'aria-current': S.view === id || (id === 'clientes' && S.view === 'pasta') ? 'page' : null }, label);
  const top = h('header', { class: 'topbar' }, h('div', { class: 'topbar-in' },
    brand(),
    h('nav', { class: 'tabs' }, tab('inicio', 'Início'), tab('agenda', 'Agenda'), tab('calendario', 'Calendário'), tab('fluxo', 'Fluxo'), tab('clientes', 'Clientes'), can('vendas') ? tab('vendas', 'Vendas') : null, can('vendas') ? tab('propostas', 'Propostas') : null, S.role === 'admin' ? tab('ajustes', 'Ajustes') : null),
    h('div', { class: 'spacer' }),
    can('conteudo') ? h('button', { class: 'btn primary sm', onclick: () => openPost() }, '+ Novo post') : null,
    themeButton(),
    h('button', { class: 'btn ghost sm', onclick: logout, title: S.userName ? `Sair (${S.userName})` : 'Sair' }, 'Sair'),
  ));
  const page = h('main', { class: `page${['fluxo', 'vendas'].includes(S.view) ? ' wide' : ''}` });
  if ((S.view === 'ajustes' && S.role !== 'admin') || (['propostas', 'vendas'].includes(S.view) && !can('vendas'))) S.view = 'inicio';
  const pend = S.role === 'admin' ? setupPending() : [];
  if (pend.length && S.view !== 'ajustes') page.append(h('div', { class: 'banner' }, h('b', {}, 'Falta configurar: '), pend.join(' · '), ' — ', h('a', { href: '#ajustes' }, 'ver em Ajustes')));
  const views = { inicio: viewHome, clientes: viewClients, ajustes: viewSettings, calendario: viewCalendar, fluxo: viewBoard, agenda: viewAgenda, pasta: viewFolder, propostas: viewProposals, vendas: viewSales };
  const main = views[S.view]().filter(Boolean);
  if (S.view === 'agenda' && S.clients.length) main.splice(1, 0, ...[approvalReminders(), requestsInbox()].filter(Boolean));
  page.append(...main);
  root.replaceChildren(top, page);
}

async function logout() { await api('/api/session', { method: 'DELETE' }).catch(() => {}); location.href = '/'; }

const clientById = (id) => S.clients.find((c) => c.id === id);
const clientName = (id) => clientById(id)?.name || '—';
const postLabel = (p) => p.title || p.caption?.split('\n')[0] || 'Sem título';
const isLate = (p) => ['idea', 'draft', 'internal_review', 'pending_approval', 'changes_requested'].includes(p.status) && p.scheduled_at && new Date(p.scheduled_at) < Date.now();

function clientFilter() {
  return h('div', { class: 'filters' },
    h('span', { class: 'eyebrow' }, 'Cliente'),
    h('button', { class: 'chip', 'aria-pressed': String(!S.fClient), onclick: () => { S.fClient = ''; render(); } }, 'Todos'),
    ...S.clients.map((c) => h('button', { class: 'chip', 'aria-pressed': String(S.fClient === c.id), onclick: () => { S.fClient = c.id; render(); } }, c.name)));
}

// "Out: 6/8 posts · 2/4 Reels" — publicados/programados no mês contra a cota do contrato
function deliveryLine(cid, { big = false } = {}) {
  const d = S.deliv?.[cid];
  if (!d) return null;
  const part = (x, name) => {
    if (x.quota == null && !x.planned) return null;
    const pct = x.quota ? Math.min(100, Math.round((x.planned / x.quota) * 100)) : 0;
    return h('div', { class: `dl${x.quota && x.planned > x.quota ? ' over' : ''}` },
      h('div', { class: 'dl-top' }, h('b', {}, x.quota != null ? `${x.planned}/${x.quota}` : `${x.planned}`), ` ${name}`,
        h('span', { class: 'muted' }, ` · ${x.published} no ar`)),
      x.quota ? h('div', { class: 'dl-bar' }, h('span', { style: `width:${pct}%` })) : null);
  };
  const a = part(d.posts, 'posts'), b = part(d.reels, 'Reels'), st = d.stories ? part(d.stories, 'Stories') : null;
  if (!a && !b && !st) return null;
  return h('div', { class: `deliv${big ? ' big' : ''}`, title: 'Programados/publicados no mês contra a cota do contrato' },
    h('span', { class: 'eyebrow' }, `Entregas · ${monthLabel(d.month, true)}`), a, b, st);
}
const typeBadge = (p) => (p.media_type === 'STORY' ? h('span', { class: 'type-badge story' }, '◷ Story') : p.media_type === 'REELS' ? h('span', { class: 'type-badge' }, '▶ Reels') : p.media_type === 'CAROUSEL' ? h('span', { class: 'type-badge' }, `❐ ${(p.media || []).length || ''}`.trim()) : null);
const thumb = (p, cls = 'thumb') => p.image_url
  ? h('img', { class: cls, src: p.image_url, alt: '', loading: 'lazy' })
  : h('span', { class: `${cls} thumb-empty`, 'aria-hidden': 'true' }, p.status === 'idea' ? '💡' : '🖼');

function noClients() {
  return h('div', { class: 'empty' }, h('h3', {}, 'Comece cadastrando um cliente'),
    h('p', { class: 'muted' }, 'Cada cliente tem o próprio Instagram conectado e um link fixo de aprovação.'),
    h('a', { class: 'btn primary', href: '#clientes' }, 'Ir para Clientes'));
}

// ───────────────────────── agenda (lista por dia)
function viewAgenda() {
  const now = Date.now();
  const relevant = S.posts.filter((p) => p.scheduled_at && (!S.fClient || p.client_id === S.fClient));
  const cards = [
    [['pending_approval'], 'Aguardando cliente', '--s-wait'],
    [['changes_requested'], 'Ajuste pedido', '--s-change'],
    [['approved'], 'Aprovados na fila', '--s-ok'],
    [['planned'], 'Planejados', '--line'],
    [['idea', 'draft', 'internal_review'], 'Em produção', '--s-draft'],
    [['failed'], 'Falharam', '--s-fail'],
  ];
  const key = (sts) => sts.join(',');
  const summary = h('div', { class: 'summary' }, ...cards.map(([sts, label, color]) =>
    h('button', { class: 'sum', 'aria-pressed': String(S.fStatus === key(sts)), onclick: () => { S.fStatus = S.fStatus === key(sts) ? '' : key(sts); render(); } },
      h('span', { class: 'eyebrow' }, h('span', { class: 'dot', style: `background:var(${color})` }), label),
      h('b', {}, String(relevant.filter((p) => sts.includes(stageOf(p))).length)))));

  let list = relevant.filter((p) => !S.fStatus || S.fStatus.split(',').includes(stageOf(p)));
  list = list.filter((p) => p.status !== 'published' || now - new Date(p.published_at || p.scheduled_at) < 86400e3 || S.fStatus === 'published');

  const out = [h('div', { class: 'page-head' }, h('div', {}, h('div', { class: 'eyebrow' }, 'Próximas publicações'), h('h1', {}, 'Agenda')))];
  if (!S.clients.length) return [...out, noClients()];
  out.push(summary, clientFilter());
  const ideas = S.posts.filter((p) => !p.scheduled_at && (!S.fClient || p.client_id === S.fClient)).length;
  if (ideas) out.push(h('p', { class: 'muted', style: 'margin:0' }, `${ideas} ${ideas > 1 ? 'posts sem data estão' : 'post sem data está'} no `, h('a', { href: '#fluxo' }, 'Fluxo'), '.'));
  if (!list.length) {
    out.push(h('div', { class: 'empty' }, h('h3', {}, S.fStatus ? 'Nada neste status' : 'Nenhum post agendado'),
      h('p', { class: 'muted' }, 'Crie um post, envie para o cliente e ele sai sozinho depois de aprovado.'),
      h('button', { class: 'btn primary', onclick: () => openPost() }, '+ Novo post')));
    return out;
  }
  const groups = new Map();
  for (const p of list) { const k = dayKey(p.scheduled_at, S.tz); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(p); }
  for (const [, posts] of groups) {
    out.push(h('section', { class: 'day' },
      h('div', { class: 'day-head' }, h('h2', {}, fmtDate(posts[0].scheduled_at, S.tz, true)), h('span', { class: 'rule' }), h('span', { class: 'eyebrow' }, `${posts.length} post${posts.length > 1 ? 's' : ''}`)),
      ...posts.map(rowPost)));
  }
  return out;
}

function rowPost(p) {
  const note = p.status === 'changes_requested' && p.client_feedback ? h('div', { class: 'note' }, `“${p.client_feedback}”`)
    : p.status === 'failed' && p.last_error ? h('div', { class: 'note fail' }, p.last_error) : null;
  return h('button', { class: 'row', onclick: () => openPost(p) },
    thumb(p),
    h('div', { class: 'time' }, p.scheduled_at ? fmtTime(p.scheduled_at, S.tz) : '—'),
    h('div', { class: 'main' }, h('div', { class: 'client' }, clientName(p.client_id), ' ', typeBadge(p)), h('div', { class: 'cap' }, p.title ? p.title : (p.caption || 'Sem legenda')), note),
    h('div', { class: 'side' }, h('span', { class: `pill st-${p.status}` }, STATUS_LABEL[p.status]), isLate(p) ? h('span', { class: 'late' }, 'Horário já passou') : null));
}

// ───────────────────────── calendário do mês
function monthOf(iso) { return partsInTz(iso, S.tz).date.slice(0, 7); }
function shiftMonth(m, delta) {
  const [y, mo] = m.split('-').map(Number);
  const d = new Date(Date.UTC(y, mo - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
function monthGrid(m) { // dias de domingo a sábado cobrindo o mês
  const [y, mo] = m.split('-').map(Number);
  const first = new Date(Date.UTC(y, mo - 1, 1));
  const start = new Date(first); start.setUTCDate(1 - first.getUTCDay());
  const last = new Date(Date.UTC(y, mo, 0));
  const end = new Date(last); end.setUTCDate(last.getUTCDate() + (6 - last.getUTCDay()));
  const days = [];
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) days.push(d.toISOString().slice(0, 10));
  return days;
}
async function loadMonth(m, silent = false) {
  const days = monthGrid(m);
  const from = zonedToISO(days[0], '00:00', S.tz);
  const to = zonedToISO(days.at(-1), '23:59', S.tz);
  S.cal.loading = !silent;
  try {
    S.cal.posts = await api(`/api/posts?from=${encodeURIComponent(from)}&to=${encodeURIComponent(new Date(new Date(to).getTime() + 60e3).toISOString())}`);
    S.cal.month = m;
  } catch (e) { toast(e.message, true); }
  S.cal.loading = false;
  if (!silent) render();
}

function viewCalendar() {
  if (!S.clients.length) return [h('div', { class: 'page-head' }, h('h1', {}, 'Calendário')), noClients()];
  const today = partsInTz(new Date().toISOString(), S.tz).date;
  if (!S.cal.month) { S.cal.month = today.slice(0, 7); loadMonth(S.cal.month); }
  const m = S.cal.month;
  const raw = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${m}-15T12:00:00Z`));
  const label = raw.charAt(0).toUpperCase() + raw.slice(1);
  const go = (delta) => { S.cal.day = null; loadMonth(delta === 0 ? today.slice(0, 7) : shiftMonth(m, delta)); };
  const monthPosts = S.cal.posts.filter((p) => p.scheduled_at && dayKey(p.scheduled_at, S.tz).slice(0, 7) === m);
  const posts = monthPosts.filter((p) => !S.fClient || p.client_id === S.fClient);
  const byDay = new Map();
  for (const p of posts) { const k = dayKey(p.scheduled_at, S.tz); if (!byDay.has(k)) byDay.set(k, []); byDay.get(k).push(p); }
  for (const l of byDay.values()) l.sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at));

  const head = h('div', { class: 'page-head' },
    h('div', {}, h('div', { class: 'eyebrow' }, 'Planejamento'), h('h1', {}, label)),
    h('div', { class: 'spacer' }),
    h('div', { class: 'actions' },
      can('ia') ? h('button', { class: 'btn ai sm', onclick: () => openPlan({ month: m }) }, '✨ Planejar o mês') : null,
      can('conteudo') ? h('button', { class: 'btn sm', onclick: () => openDuplicate() }, 'Duplicar semana') : null,
      h('div', { class: 'seg', role: 'group', 'aria-label': 'Modo de exibição' },
        ...[['thumbs', 'Miniaturas'], ['list', 'Lista']].map(([k, l]) => h('button', { class: 'seg-btn', 'aria-pressed': String(S.cal.mode === k),
          onclick: () => { S.cal.mode = k; savePref('mc_cal_mode', k); render(); } }, l))),
      h('button', { class: 'btn sm', onclick: () => go(-1), 'aria-label': 'Mês anterior' }, '‹'),
      h('button', { class: 'btn sm', onclick: () => go(0) }, 'Hoje'),
      h('button', { class: 'btn sm', onclick: () => go(1), 'aria-label': 'Próximo mês' }, '›')));

  // chips de cliente: filtro de um toque, na cor do cliente, com quantos posts tem no mês
  const count = (id) => monthPosts.filter((p) => p.client_id === id).length;
  const chips = h('div', { class: 'cc-chips', role: 'group', 'aria-label': 'Filtrar por cliente' },
    h('button', { class: 'cc-chip', type: 'button', 'aria-pressed': String(!S.fClient), onclick: () => { S.fClient = ''; render(); } }, `Todos · ${monthPosts.length}`),
    ...S.clients.map((c) => h('button', { class: 'cc-chip', type: 'button', style: `--cc:${clientColor(c.id)}`, 'aria-pressed': String(S.fClient === c.id),
      onclick: () => { S.fClient = S.fClient === c.id ? '' : c.id; render(); } },
      h('span', { class: 'cc-dot', 'aria-hidden': 'true' }), `${c.name} · ${count(c.id)}`)),
    can('conteudo') ? h('button', { class: 'cc-chip ghost', type: 'button', onclick: openColors }, '🎨 Cores') : null);

  // datas comemorativas: as principais + as dos nichos dos clientes (ou do cliente filtrado)
  const gridDays = monthGrid(m);
  const niches = new Set((S.fClient ? [clientById(S.fClient)] : S.clients).map((c) => c?.brand_kit?.niche).filter(Boolean));
  const dayDates = new Map();
  for (const x of datesBetween(gridDays[0], gridDays.at(-1)).filter((x) => x.major || x.tags.some((t) => niches.has(t)))) dayDates.set(x.date, [...(dayDates.get(x.date) || []), x]);
  const FMT_ICON = { REELS: '▶', CAROUSEL: '❐', STORY: '◷' };
  const FMT_NAME = { IMAGE: 'Post', REELS: 'Reels', CAROUSEL: 'Carrossel', STORY: 'Story' };
  const weekend = (d) => [0, 6].includes(new Date(`${d}T12:00:00Z`).getUTCDay());
  const dropOn = (d) => ({
    ondragover: (e) => { e.preventDefault(); e.currentTarget.classList.add('drop-over'); },
    ondragleave: (e) => { if (!e.currentTarget.contains(e.relatedTarget)) e.currentTarget.classList.remove('drop-over'); },
    ondrop: (e) => { e.preventDefault(); e.currentTarget.classList.remove('drop-over'); const p = S.cal.posts.find((x) => x.id === e.dataTransfer.getData('text/plain')); if (p && dayKey(p.scheduled_at, S.tz) !== d) reschedule(p, d, fmtTime24(p.scheduled_at)); },
  });
  const drag = (p) => ({ draggable: movable(p) ? 'true' : null, ondragstart: (e) => { e.dataTransfer.setData('text/plain', p.id); e.dataTransfer.effectAllowed = 'move'; } });
  const addBtn = (d, big) => (can('conteudo') && d >= today ? h('button', { class: `cal-add${big ? ' big' : ''}`, type: 'button', 'aria-label': `Criar post em ${d.slice(8)}/${d.slice(5, 7)}`, title: 'Criar post neste dia',
    onclick: (e) => { e.stopPropagation(); openPost(null, { date: d, client: S.fClient || undefined }); } }, big ? '+ Criar post neste dia' : '+') : null);

  let body;
  if (S.cal.mode === 'list') {
    // ── D: agenda por dia (faixa da cor do cliente, foto, horário, formato e status)
    const days = gridDays.filter((d) => d.slice(0, 7) === m);
    const wdName = (d) => new Intl.DateTimeFormat('pt-BR', { weekday: 'long', timeZone: 'UTC' }).format(new Date(`${d}T12:00:00Z`));
    const items = [];
    for (const d of days) {
      const list = byDay.get(d) || [];
      if (!list.length && d < today) continue; // dia passado sem post: não ocupa espaço
      const dates = dayDates.get(d) || [];
      const name = `${d === today ? 'Hoje, ' : ''}${wdName(d)} ${Number(d.slice(8))}`;
      items.push(h('section', { class: `ag-day${d < today ? ' past' : ''}${weekend(d) ? ' wkend' : ''}${d === today ? ' today' : ''}`, ...dropOn(d) },
        h('div', { class: 'ag-head' },
          h('b', {}, name.charAt(0).toUpperCase() + name.slice(1)),
          h('span', { class: 'muted' }, list.length ? `${list.length} post${list.length > 1 ? 's' : ''}` : 'dia livre'),
          ...dates.map((x) => h('span', { class: `cal-date${x.major ? ' major' : ''}` }, x.name)),
          h('span', { class: 'spacer' }), list.length ? addBtn(d) : null),
        ...(list.length ? list.map((p) => h('button', { type: 'button', class: 'ag-row', style: `--cc:${clientColor(p.client_id)}`, onclick: () => openPost(p), ...drag(p),
          title: movable(p) ? 'Abrir · arraste para outro dia para remarcar' : 'Abrir' },
          h('span', { class: 'ag-bar', 'aria-hidden': 'true' }),
          h('span', { class: 'ag-time mono' }, fmtTime(p.scheduled_at, S.tz)),
          p.image_url ? h('img', { class: 'ag-ph', src: p.image_url, alt: '', loading: 'lazy' }) : h('span', { class: 'ag-ph empty' }, FMT_ICON[p.media_type] || '▢'),
          h('span', { class: 'ag-main' },
            h('span', { class: 'ag-title' }, postLabel(p)),
            h('span', { class: 'ag-sub' }, h('span', { class: 'cc-tag' }, clientName(p.client_id)), ` ${FMT_ICON[p.media_type] ? `${FMT_ICON[p.media_type]} ` : ''}${FMT_NAME[p.media_type] || 'Post'}`, p.script ? ` · 🎬 ${SCRIPT_STATUS[p.script.status] || 'Roteiro'}` : '')),
          h('span', { class: `pill st-${p.status}` }, STATUS_LABEL[p.status])))
          : [addBtn(d, true) || h('div', { class: 'ag-free muted' }, 'Nenhum post')])));
    }
    body = h('div', { class: `agenda${S.cal.loading ? ' loading' : ''}` }, ...(items.length ? items : [h('p', { class: 'muted' }, 'Nenhum dia para mostrar neste mês.')]));
  } else {
    // ── A: mês em miniaturas com a moldura da cor do cliente
    const week = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
    body = h('div', { class: `cal mode-thumbs${S.cal.loading ? ' loading' : ''}`, role: 'grid', 'aria-label': `Calendário de ${label}` },
      ...week.map((w, i) => h('div', { class: `cal-wd${i === 0 || i === 6 ? ' wkend' : ''}`, role: 'columnheader' }, w)),
      ...gridDays.map((d) => {
        const list = byDay.get(d) || [];
        const out = d.slice(0, 7) !== m;
        const dates = dayDates.get(d) || [];
        return h('div', { class: `cal-day${out ? ' out' : ''}${d === today ? ' today' : ''}${d < today ? ' past' : ''}${weekend(d) ? ' wkend' : ''}${S.cal.day === d ? ' sel' : ''}`, role: 'gridcell', tabindex: 0,
          onclick: (e) => { if (!e.target.closest('.cal-tile, .cal-add')) openDay(d, dates); },
          onkeydown: (e) => { if (e.key === 'Enter') openDay(d, dates); }, ...dropOn(d) },
          dates.length ? h('div', { class: `cal-strip${dates.some((x) => x.major) ? ' major' : ''}`, title: dates.map((x) => x.name).join(' · ') }, dates.map((x) => x.name).join(' · ')) : null,
          h('div', { class: 'cal-top' }, h('span', { class: 'cal-num' }, String(Number(d.slice(8)))), out ? null : addBtn(d)),
          h('div', { class: 'cal-dots', 'aria-hidden': 'true' }, ...list.slice(0, 4).map((p) => h('span', { class: 'dot', style: `color:${clientColor(p.client_id)}` }))),
          list.length ? h('div', { class: 'cal-mini', style: `--cc:${clientColor(list[0].client_id)}`, 'aria-hidden': 'true' },
            list[0].image_url ? h('img', { src: list[0].image_url, alt: '' }) : h('span', { class: 'thumb-empty' }),
            list.length > 1 ? h('span', { class: 'cal-badge' }, String(list.length)) : null) : null,
          h('div', { class: 'cal-thumbs' },
            ...list.slice(0, 4).map((p, i) => h('button', { class: 'cal-tile', type: 'button', style: `--cc:${clientColor(p.client_id)}`,
              title: `${fmtTime(p.scheduled_at, S.tz)} · ${clientName(p.client_id)} · ${postLabel(p)} · ${STATUS_LABEL[p.status]}${movable(p) ? ' · arraste para outro dia' : ''}`, ...drag(p),
              onclick: () => (i === 3 && list.length > 4 ? openDay(d, dates) : openPost(p)) },
              p.image_url ? h('img', { src: p.image_url, alt: postLabel(p), loading: 'lazy' }) : h('span', { class: 'cal-tile-empty' }, postLabel(p)),
              FMT_ICON[p.media_type] ? h('span', { class: 'cal-tile-fmt', title: FMT_NAME[p.media_type] }, FMT_ICON[p.media_type]) : null,
              h('span', { class: 'cal-tile-time mono' }, fmtTime(p.scheduled_at, S.tz)),
              h('span', { class: `cal-tile-st st-${p.status}`, 'aria-hidden': 'true' }),
              i === 3 && list.length > 4 ? h('span', { class: 'cal-tile-more' }, `+${list.length - 3}`) : null))));
      }));
  }

  const out = [head, chips, body,
    h('p', { class: 'muted', style: 'margin:0;font-size:13.5px' }, S.cal.mode === 'list'
      ? 'Toque num post para abrir. Arraste um post para outro dia para remarcar. A barra colorida é a cor do cliente.'
      : 'Clique num dia para ver os horários. Use o + para criar um post naquele dia e arraste um post para outro dia para remarcar. A moldura é a cor do cliente; a bolinha no canto, o status.')];
  if (S.cal.day && S.cal.mode !== 'list') {
    const list = byDay.get(S.cal.day) || [];
    out.push(h('section', { class: 'day' },
      h('div', { class: 'day-head' }, h('h2', {}, fmtDate(zonedToISO(S.cal.day, '12:00', S.tz), S.tz, true)), h('span', { class: 'rule' }),
        h('button', { class: 'btn sm', onclick: () => openPost(null, { date: S.cal.day }) }, '+ Post neste dia')),
      ...(list.length ? list.map(rowPost) : [h('p', { class: 'muted', style: 'margin:0' }, 'Nenhum post neste dia.')])));
  }
  return out;
}

// Cores fixas dos clientes: aparecem no calendário, no Fluxo e nos filtros.
function openColors() {
  const rows = S.clients.map((c) => {
    const cur = clientColor(c.id);
    const row = h('div', { class: 'cc-pick' },
      h('span', { class: 'cc-name' }, h('span', { class: 'cc-dot', style: `--cc:${cur}`, 'aria-hidden': 'true' }), c.name),
      h('div', { class: 'cc-swatches', role: 'radiogroup', 'aria-label': `Cor de ${c.name}` },
        ...CLIENT_COLORS.map(([hex, name]) => {
          const usedBy = S.clients.find((o) => o.id !== c.id && clientColor(o.id) === hex);
          return h('button', { type: 'button', class: 'cc-sw', role: 'radio', 'aria-checked': String(cur === hex), style: `--cc:${hex}`,
            title: usedBy ? `${name} · já usada por ${usedBy.name}` : name, 'aria-label': name,
            onclick: async () => {
              try {
                const r = await api('/api/pasta?r=brand', { method: 'PUT', body: { client_id: c.id, label_color: hex } });
                c.brand_kit = r.brand_kit; colorCache = null; render(); close(); openColors(); toast(`${c.name}: ${name.toLowerCase()}.`);
              } catch (e) { toast(e.message, true); }
            } }, usedBy ? h('span', { class: 'cc-used', 'aria-hidden': 'true' }, '•') : null);
        })));
    return row;
  });
  const close = drawer('Cores dos clientes', [h('p', { class: 'muted', style: 'margin:0' }, 'Cada cliente com uma cor fixa no calendário, no Fluxo e nos filtros. As marcadas com • já estão com outro cliente.'), ...rows], []);
}

// ───────────────────────── fluxo (quadro do workflow)
// "Planejado" = em produção mas ainda sem arte (só pauta/data). Não é um status novo: é o rascunho sem mídia.
const hasMedia = (p) => Boolean(p.image_url || (p.media || []).length);
const isPlanned = (p) => p.status === 'draft' && !hasMedia(p);
function stageOf(p) { return isPlanned(p) ? 'planned' : p.status; }
const COLUMNS = [
  { id: 'idea', label: 'Ideia', drop: 'to_idea', next: ['to_production', 'Produzir'] },
  { id: 'planned', status: 'draft', match: isPlanned, label: 'Planejado', drop: 'to_production', open: 'Criar arte' },
  { id: 'draft', match: (p) => p.status === 'draft' && hasMedia(p), label: 'Em produção', drop: 'to_production', next: ['to_review', 'Revisar'] },
  { id: 'internal_review', label: 'Revisão interna', drop: 'to_review', next: ['send', 'Enviar ao cliente'] },
  { id: 'pending_approval', label: 'Aguardando cliente', drop: 'send' },
  { id: 'changes_requested', label: 'Ajuste pedido' },
  { id: 'approved', label: 'Aprovado', drop: 'approve', also: ['publishing', 'failed'] },
  { id: 'published', label: 'Publicado' },
];

// cor fixa por cliente (etiqueta no estilo Trello)
// A cor escolhida fica na marca do cliente (brand_kit.label_color); quem não escolheu ganha a próxima livre.
const CLIENT_COLORS = [['#D4537E', 'Rosa'], ['#1D9E75', 'Verde-água'], ['#C98A1E', 'Mostarda'], ['#7F77DD', 'Lilás'], ['#378ADD', 'Azul'],
  ['#D85A30', 'Coral'], ['#639922', 'Verde'], ['#993556', 'Vinho'], ['#0F6E7A', 'Petróleo'], ['#8A6A4F', 'Caramelo'], ['#5F5E5A', 'Grafite'], ['#B04FB8', 'Magenta']];
let colorCache = null;
function clientColor(id) {
  if (!colorCache || colorCache.src !== S.clients) {
    const map = new Map();
    const valid = new Set(CLIENT_COLORS.map(([c]) => c));
    for (const c of S.clients) if (valid.has(c.brand_kit?.label_color)) map.set(c.id, c.brand_kit.label_color);
    const used = new Set(map.values());
    const free = CLIENT_COLORS.map(([c]) => c).filter((c) => !used.has(c));
    let i = 0;
    for (const c of S.clients) if (!map.has(c.id)) map.set(c.id, free.length ? free[i++ % free.length] : CLIENT_COLORS[i++ % CLIENT_COLORS.length][0]);
    colorCache = { src: S.clients, map };
  }
  return colorCache.map.get(id) || CLIENT_COLORS[0][0];
}
const initials = (name) => (name || '?').split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w[0] || '')).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';

function viewBoard() {
  if (!S.clients.length) return [h('div', { class: 'page-head' }, h('h1', {}, 'Fluxo')), noClients()];
  const q = (S.boardQ || '').trim().toLowerCase();
  const posts = S.posts.filter((p) => !S.fClient || p.client_id === S.fClient)
    .filter((p) => p.status !== 'published' || Date.now() - new Date(p.published_at || p.scheduled_at) < 7 * 86400e3)
    .filter((p) => !q || `${p.title || ''} ${p.caption || ''} ${clientName(p.client_id)}`.toLowerCase().includes(q));
  const sortKey = (p) => (p.scheduled_at ? new Date(p.scheduled_at).getTime() : Infinity);
  const board = h('div', { class: 'tboard' }, ...COLUMNS.map((col) => {
    const items = posts.filter((p) => (col.match ? col.match(p) : p.status === col.id) || col.also?.includes(p.status)).sort((a, b) => sortKey(a) - sortKey(b));
    const body = h('div', { class: 'tlist-cards' }, ...items.map((p) => boardCard(p, col)));
    const colEl = h('section', { class: `tlist${col.drop ? ' droppable' : ''}`, 'data-col': col.id, 'aria-label': col.label },
      h('header', { class: 'tlist-head' }, h('span', { class: `tlist-dot st-${col.id}`, 'aria-hidden': 'true' }), h('h2', {}, col.label), h('span', { class: 'tlist-n' }, String(items.length))),
      body,
      ['idea', 'planned', 'internal_review'].includes(col.id) && can('conteudo') ? quickAdd(col) : h('div', { class: 'tlist-foot muted' }, col.id === 'draft' ? 'Chega aqui quando a arte é anexada' : col.id === 'pending_approval' ? 'Envie pelo cartão ou arraste para cá' : col.id === 'approved' ? 'Sai sozinho no horário' : col.id === 'published' ? 'Últimos 7 dias' : 'Volta para produção ao ajustar'));
    if (col.drop) {
      colEl.addEventListener('dragover', (e) => { e.preventDefault(); colEl.classList.add('over'); });
      colEl.addEventListener('dragleave', (e) => { if (!colEl.contains(e.relatedTarget)) colEl.classList.remove('over'); });
      colEl.addEventListener('drop', async (e) => {
        e.preventDefault(); colEl.classList.remove('over');
        const id = e.dataTransfer.getData('text/plain');
        const p = S.posts.find((x) => x.id === id);
        if (!p || p.status === (col.status || col.id)) return;
        await movePost(p, col.drop, `Movido para ${col.label}.`);
      });
    }
    return colEl;
  }));
  const search = h('input', { type: 'search', class: 'tsearch', placeholder: 'Filtrar cartões…', value: S.boardQ || '', 'aria-label': 'Filtrar cartões',
    oninput: (e) => { S.boardQ = e.target.value; clearTimeout(S.boardT); S.boardT = setTimeout(() => { render(); const el = document.querySelector('.tsearch'); el?.focus(); el?.setSelectionRange(el.value.length, el.value.length); }, 250); } });
  return [
    h('div', { class: 'page-head' }, h('div', {}, h('div', { class: 'eyebrow' }, 'Workflow de criação e aprovação'), h('h1', {}, 'Fluxo')), h('div', { class: 'spacer' }),
      h('div', { class: 'actions' }, search, can('ia') ? h('button', { class: 'btn ai sm', onclick: () => openPlan({}) }, '✨ Planejar o mês com IA') : null)),
    clientFilter(),
    h('div', { class: 'tboard-wrap' }, board),
    h('p', { class: 'muted', style: 'margin:0;font-size:13px' }, 'Arraste os cartões entre as listas. Para ir ao cliente ou à fila, o post precisa de mídia e data.'),
  ];
}

// "+ Adicionar um cartão" no fim da lista (cria ideia / post em produção / revisão só com a pauta)
function quickAdd(col) {
  const stage = { idea: 'idea', planned: 'production', draft: 'production', internal_review: 'internal_review' }[col.id];
  const wrap = h('div', { class: 'tadd' });
  const closed = () => wrap.replaceChildren(h('button', { class: 'tadd-btn', type: 'button', onclick: opened }, '+ Adicionar um cartão'));
  function opened() {
    const ta = h('textarea', { class: 'tadd-ta', placeholder: 'Pauta do post (ex.: Dica de banho no inverno)', rows: 3, maxlength: 140 });
    const sel = h('select', { class: 'tadd-sel', 'aria-label': 'Cliente' }, ...S.clients.map((c) => h('option', { value: c.id, selected: c.id === (S.fClient || S.lastClient || S.clients[0].id) }, c.name)));
    const add = async () => {
      const title = ta.value.trim(); if (!title) return ta.focus();
      try {
        const saved = await api('/api/posts', { method: 'POST', body: { client_id: sel.value, title, stage: stage === 'production' ? 'draft' : stage } });
        S.lastClient = sel.value; upsert(saved, false); render();
        const again = document.querySelector(`.tlist[data-col="${col.id}"] .tadd-btn`); again?.click();
      } catch (e) { toast(e.message, true); }
    };
    ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); add(); } if (e.key === 'Escape') closed(); });
    wrap.replaceChildren(h('div', { class: 'tadd-form' }, ta, S.clients.length > 1 ? sel : null,
      h('div', { class: 'tadd-act' }, h('button', { class: 'btn primary sm', type: 'button', onclick: add }, 'Adicionar cartão'), h('button', { class: 'tadd-x', type: 'button', 'aria-label': 'Cancelar', onclick: closed }, '✕'))));
    ta.focus();
  }
  closed();
  return wrap;
}

// Mídias do post na ordem de exibição (carrossel, vídeo do Reels ou a imagem única).
function mediaItems(p) {
  const list = (p.media || []).filter((m) => m?.url).map((m) => ({ kind: m.kind === 'video' ? 'video' : 'image', url: m.url }));
  if (!list.length && p.image_url) list.push({ kind: 'image', url: p.image_url });
  return list;
}
// Capa do cartão: clicar abre a mídia em tela cheia (o resto do cartão continua abrindo o editor).
function coverButton(p) {
  const items = mediaItems(p);
  if (!items.length) return null;
  const video = items.find((m) => m.kind === 'video');
  const thumb = p.image_url
    ? h('img', { src: p.image_url, alt: '', loading: 'lazy', draggable: 'false' })
    : h('video', { src: `${video.url}#t=0.5`, muted: true, preload: 'metadata', playsinline: true, 'aria-hidden': 'true' });
  const badge = video ? '▶' : items.length > 1 ? `❐ ${items.length}` : null;
  return h('button', { type: 'button', class: `tcover${p.media_type === 'STORY' || p.media_type === 'REELS' ? ' tall' : ''}`,
    'aria-label': `Ver ${video ? 'vídeo' : items.length > 1 ? `as ${items.length} imagens` : 'imagem'} de ${postLabel(p)} em tela cheia`,
    onclick: (e) => { e.stopPropagation(); openViewer(p); } },
    thumb, badge ? h('span', { class: 'tcover-badge', 'aria-hidden': 'true' }, badge) : null, h('span', { class: 'tcover-zoom', 'aria-hidden': 'true' }, '⤢'));
}
// Visualizador em tela cheia: setas, teclado (← → Esc), deslizar no celular, vídeo com controles.
function openViewer(p, start = 0) {
  const items = mediaItems(p);
  if (!items.length) return;
  let i = Math.min(start, items.length - 1);
  const prevFocus = document.activeElement;
  const stage = h('div', { class: 'vw-stage' });
  const count = h('span', { class: 'vw-count', 'aria-live': 'polite' });
  const dots = h('div', { class: 'vw-dots', 'aria-hidden': 'true' });
  const prev = h('button', { type: 'button', class: 'vw-nav prev', 'aria-label': 'Anterior', onclick: (e) => { e.stopPropagation(); go(-1); } }, '‹');
  const next = h('button', { type: 'button', class: 'vw-nav next', 'aria-label': 'Próxima', onclick: (e) => { e.stopPropagation(); go(1); } }, '›');
  const close = h('button', { type: 'button', class: 'vw-close', 'aria-label': 'Fechar', onclick: () => done() }, '×');
  const edit = can('conteudo') ? h('button', { type: 'button', class: 'btn sm', onclick: () => { done(); openPost(p); } }, 'Abrir post') : null;
  const box = h('div', { class: 'viewer', role: 'dialog', 'aria-modal': 'true', 'aria-label': `Mídia de ${postLabel(p)}`, tabindex: '-1',
    onclick: (e) => { if (e.target === box || e.target === stage) done(); } },
    h('div', { class: 'vw-top' }, h('div', { class: 'vw-title' }, h('b', {}, clientName(p.client_id)), h('span', {}, postLabel(p))), h('div', { class: 'vw-actions' }, count, edit, close)),
    stage, items.length > 1 ? [prev, next, dots] : null);
  function draw() {
    stage.querySelector('video')?.pause();
    const m = items[i];
    stage.replaceChildren(m.kind === 'video'
      ? h('video', { src: m.url, controls: true, autoplay: true, playsinline: true, class: 'vw-media' })
      : h('img', { src: m.url, alt: `${postLabel(p)} — ${i + 1} de ${items.length}`, class: 'vw-media' }));
    count.textContent = items.length > 1 ? `${i + 1} / ${items.length}` : '';
    dots.replaceChildren(...items.map((_, k) => h('span', { class: k === i ? 'on' : '' })));
    prev.disabled = i === 0; next.disabled = i === items.length - 1;
  }
  function go(d) { const n = i + d; if (n < 0 || n >= items.length) return; i = n; draw(); }
  function key(e) { if (e.key === 'Escape') done(); else if (e.key === 'ArrowLeft') go(-1); else if (e.key === 'ArrowRight') go(1); }
  let x0 = null;
  box.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; }, { passive: true });
  box.addEventListener('touchend', (e) => { if (x0 == null) return; const dx = e.changedTouches[0].clientX - x0; if (Math.abs(dx) > 40) go(dx < 0 ? 1 : -1); x0 = null; });
  function done() { stage.querySelector('video')?.pause(); document.removeEventListener('keydown', key); box.remove(); document.body.classList.remove('vw-open'); prevFocus?.focus?.(); }
  document.addEventListener('keydown', key);
  document.body.append(box); document.body.classList.add('vw-open');
  draw(); box.focus();
}

function boardCard(p, col) {
  const late = isLate(p);
  const t = p.scheduled_at ? new Date(p.scheduled_at) : null;
  const dateBadge = t ? h('span', { class: `tbadge${p.status === 'published' ? ' ok' : late ? ' late' : t - Date.now() < 2 * 864e5 && t > Date.now() ? ' soon' : ''}`, title: late ? 'Horário já passou' : 'Data de publicação' },
    '🕒 ', `${fmtDate(p.scheduled_at, S.tz)} ${fmtTime(p.scheduled_at, S.tz)}`) : h('span', { class: 'tbadge muted' }, 'sem data');
  const fmt = { REELS: 'Reels', CAROUSEL: `Carrossel${(p.media || []).length ? ` · ${(p.media || []).length}` : ''}`, STORY: 'Story' }[p.media_type] || (p.image_url ? 'Foto' : null);
  const card = h('article', { class: `tcard${p.status === 'failed' ? ' failed' : ''}`, draggable: 'true', tabindex: 0, onclick: (e) => { if (!e.target.closest('button')) openPost(p); },
    onkeydown: (e) => { if (e.key === 'Enter') openPost(p); } },
    coverButton(p),
    h('div', { class: 'tcard-in' },
      h('div', { class: 'tlabels' },
        h('span', { class: 'tlabel', style: `--lc:${clientColor(p.client_id)}`, title: clientName(p.client_id) }, clientName(p.client_id)),
        fmt ? h('span', { class: 'tlabel fmt' }, fmt) : null,
        (p.notes || '').startsWith('✨') ? h('span', { class: 'tlabel ia', title: 'Planejado com IA' }, '✨ IA') : null,
        scriptBadge(p)),
      h('div', { class: 'ttitle' }, postLabel(p)),
      p.status === 'changes_requested' && (p.client_feedback || p.feedback_audio) ? h('div', { class: 'tnote' }, p.feedback_audio ? '🎤 ' : '', p.client_feedback && p.client_feedback !== '🎤 Pedido por áudio' ? `“${p.client_feedback}”` : 'Ajuste pedido por áudio') : null,
      p.status === 'failed' ? h('div', { class: 'tnote fail' }, `Falhou: ${p.last_error || ''}`) : null,
      h('div', { class: 'tbadges' },
        dateBadge,
        p.status === 'publishing' ? h('span', { class: 'tbadge soon' }, 'Publicando…') : null,
        p.caption ? h('span', { class: 'tbadge', title: 'Tem legenda' }, '≡') : null,
        p.notes && !(p.notes || '').startsWith('✨') ? h('span', { class: 'tbadge', title: 'Tem notas da equipe' }, '✎') : null,
        h('span', { class: 'tavatar', style: `--lc:${clientColor(p.client_id)}`, title: clientName(p.client_id) }, initials(clientName(p.client_id)))),
      col.next || col.open || p.status === 'changes_requested' ? h('div', { class: 'tcard-act' },
        col.open && can('conteudo') ? h('button', { class: 'tnext', type: 'button', onclick: () => openPost(p) }, `${col.open} →`) : null,
        col.next && (col.next[0] !== 'send' || can('enviar')) && can('conteudo') ? h('button', { class: 'tnext', type: 'button', onclick: () => movePost(p, col.next[0], col.next[0] === 'send' ? 'Enviado ao cliente.' : 'Avançou de etapa.') }, `${col.next[1]} →`) : null,
        p.status === 'changes_requested' ? h('button', { class: 'tnext', type: 'button', onclick: () => openPost(p) }, 'Ajustar →') : null,
        null) : null));
  card.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', p.id); e.dataTransfer.effectAllowed = 'move'; card.classList.add('dragging'); });
  card.addEventListener('dragend', () => card.classList.remove('dragging'));
  return card;
}

async function movePost(p, action, msg) {
  try {
    const saved = await api(`/api/posts?id=${p.id}`, { method: 'PATCH', body: { action } });
    upsert(saved); toast(msg);
    if (action === 'send') maybeNotify([saved]);
  } catch (e) {
    toast(e.message, true);
    if (/imagem|data/i.test(e.message)) openPost(p);
  }
}

// ───────────────────────── painel lateral
function drawer(title, body, foot) {
  const close = () => { scrim.remove(); panel.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const scrim = h('div', { class: 'scrim', onclick: close });
  const panel = h('aside', { class: 'drawer', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div', { class: 'drawer-head' }, h('h2', {}, title), h('button', { class: 'btn ghost sm', onclick: close, 'aria-label': 'Fechar' }, '✕')),
    h('div', { class: 'drawer-body' }, ...body.filter(Boolean)), h('div', { class: 'drawer-foot' }, ...foot));
  document.addEventListener('keydown', onKey);
  document.body.append(scrim, panel);
  return close;
}

function confirmButton(label, confirmLabel, onConfirm, cls = 'btn danger') {
  let armed = false, t;
  const b = h('button', { class: cls, type: 'button', onclick: async () => {
    if (!armed) { armed = true; b.textContent = confirmLabel; t = setTimeout(() => { armed = false; b.textContent = label; }, 4000); return; }
    clearTimeout(t); b.disabled = true; try { await onConfirm(); } finally { b.disabled = false; }
  } }, label);
  return b;
}

// ───────────────────────── post (novo / editar)
// opts: { date: 'YYYY-MM-DD', stage: 'idea' }
function openPost(post = null, opts = {}) {
  if (!S.clients.length) { location.hash = '#clientes'; return toast('Cadastre um cliente primeiro.'); }
  const isNew = !post;
  const st = post?.status || opts.stage || 'draft';
  const locked = post && ['publishing', 'published'].includes(post.status);
  let img = post?.image_url ? { url: post.image_url } : opts.image ? { url: opts.image.url, path: opts.image.path } : null; // { blob, url, note } quando trocada

  // Clientes: no post novo dá para escolher vários (um post por cliente).
  const picked = new Set([post?.client_id || opts.client || S.fClient || S.clients[0].id]);
  const clientBox = h('div', { class: 'pick' });
  const drawClients = () => clientBox.replaceChildren(...S.clients.map((c) => h('button', {
    type: 'button', class: 'chip', 'aria-pressed': String(picked.has(c.id)), disabled: !isNew,
    onclick: () => { if (picked.has(c.id) && picked.size > 1) picked.delete(c.id); else picked.add(c.id); drawClients(); },
  }, c.name)));
  drawClients();

  const title = h('input', { type: 'text', id: 'f-title', value: post?.title || opts.title || '', disabled: locked, placeholder: 'Ex.: Frase motivacional de segunda', maxlength: 140 });
  const notes = h('textarea', { id: 'f-notes', disabled: locked, placeholder: 'Briefing, referências, observações para a equipe. O cliente não vê.', style: 'min-height:70px' }, post?.notes || opts.notes || '');

  // ── mídia: Foto (1 imagem) | Carrossel (2 a 10 imagens) | Reels (vídeo + capa)
  let mtype = post?.media_type || 'IMAGE';
  let mediaDirty = false;
  let items = mtype === 'CAROUSEL' ? (post.media || []).filter((m) => m.kind === 'image').map((m) => ({ url: m.url, path: m.path })) : [];
  let video = ['REELS', 'STORY'].includes(mtype) ? ((post.media || []).find((m) => m.kind === 'video') || null) : null; // { url, path } ou { file, url, duration }
  let coverT = 1;
  const fileIn = h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: () => fileIn.files[0] && takeFile(fileIn.files[0]) });
  const multiIn = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true, onchange: () => addItems([...multiIn.files]) });
  const videoIn = h('input', { type: 'file', accept: 'video/mp4,video/quicktime,.mp4,.mov,.m4v', hidden: true, onchange: () => videoIn.files[0] && takeVideo(videoIn.files[0]) });
  const imgBox = h('div', { class: 'media-box' });
  const typeSeg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Formato do post' });
  const drawSeg = () => typeSeg.replaceChildren(...Object.entries(MEDIA_LABEL).map(([k, l]) => h('button', {
    type: 'button', class: 'seg-btn', 'aria-pressed': String(mtype === k), disabled: locked,
    onclick: () => { if (mtype === k) return; if (['REELS', 'STORY'].includes(mtype) || k === 'STORY') { img = null; video = null; } mtype = k; mediaDirty = true; syncCaption(); if (k === 'CAROUSEL' && img && !items.length) items = [{ ...img }]; if (k === 'IMAGE' && items[0] && !img) img = { ...items[0] }; drawSeg(); drawImage(); drawScriptBox?.(); },
  }, { IMAGE: '🖼 ', CAROUSEL: '❐ ', REELS: '▶ ', STORY: '◷ ' }[k] + l)));
  const dropZone = (title, hint, onPick, onFiles) => {
    const drop = h('div', { class: 'drop', tabindex: 0, role: 'button', onclick: () => !locked && onPick(), onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(); } } },
      h('b', {}, title), h('span', { class: 'muted' }, hint));
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); if (e.dataTransfer.files.length) onFiles([...e.dataTransfer.files]); });
    return drop;
  };
  const drawImage = () => {
    if (mtype === 'CAROUSEL') return drawCarousel();
    if (mtype === 'REELS') return drawReels();
    if (mtype === 'STORY') return drawStory();
    if (!img) return imgBox.replaceChildren(dropZone('Escolha a imagem do post', 'Arraste aqui, cole (Ctrl+V) ou clique. Pode deixar para depois se ainda é ideia.', () => fileIn.click(), (fs) => takeFile(fs[0])), fileIn);
    imgBox.replaceChildren(h('div', { class: 'preview' }, h('img', { src: img.url, alt: 'Prévia do post' }),
      h('div', { style: 'display:grid;gap:8px' },
        h('span', { class: 'hint muted' }, img.note || 'Como vai aparecer no feed.'),
        locked ? null : h('button', { class: 'btn sm', type: 'button', onclick: () => fileIn.click() }, 'Trocar imagem'))), fileIn);
  };
  const drawCarousel = () => {
    const move = (i, d) => { const j = i + d; if (j < 0 || j >= items.length) return; [items[i], items[j]] = [items[j], items[i]]; mediaDirty = true; drawImage(); };
    const tiles = items.map((it, i) => h('div', { class: 'car-item' },
      h('img', { src: it.url, alt: `Imagem ${i + 1}` }), h('span', { class: 'car-n' }, String(i + 1)),
      locked ? null : h('div', { class: 'car-act' },
        h('button', { type: 'button', title: 'Mover para a esquerda', disabled: i === 0, onclick: () => move(i, -1) }, '←'),
        h('button', { type: 'button', title: 'Remover', onclick: () => { items.splice(i, 1); mediaDirty = true; drawImage(); } }, '✕'),
        h('button', { type: 'button', title: 'Mover para a direita', disabled: i === items.length - 1, onclick: () => move(i, 1) }, '→'))));
    const add = items.length < 10 && !locked ? h('button', { type: 'button', class: 'car-add', onclick: () => multiIn.click() }, h('b', {}, '+'), h('span', {}, items.length ? 'Adicionar' : 'Escolher imagens')) : null;
    const box = h('div', { class: 'car-grid' }, ...tiles, add);
    box.addEventListener('dragover', (e) => e.preventDefault());
    box.addEventListener('drop', (e) => { e.preventDefault(); if (e.dataTransfer.files.length) addItems([...e.dataTransfer.files]); });
    imgBox.replaceChildren(box, h('span', { class: 'hint muted' }, `${items.length}/10 imagens · a 1ª é a capa · o Instagram usa a proporção da 1ª em todas (use o mesmo formato, de preferência 4:5).`), multiIn);
  };
  const addItems = async (files) => {
    for (const f of files.slice(0, 10 - items.length)) {
      try { items.push(await prepareImage(f)); mediaDirty = true; } catch (e) { toast(e.message, true); }
    }
    multiIn.value = ''; drawImage();
  };
  const drawReels = () => {
    if (!video) return imgBox.replaceChildren(dropZone('Escolha o vídeo do Reels', 'MP4 ou MOV, vertical 9:16, de 3 s a 15 min. Acima de 50 MB o app comprime sozinho.', () => videoIn.click(), (fs) => takeVideo(fs[0])), videoIn);
    const v = h('video', { src: video.url, controls: true, playsinline: true, muted: true, preload: 'metadata', class: 'reel-video', poster: img?.url || null });
    const coverImg = img ? h('img', { src: img.url, alt: 'Capa do Reels', class: 'reel-cover' }) : h('div', { class: 'reel-cover thumb-empty' }, 'sem capa');
    const slider = video.duration ? h('input', { type: 'range', min: 0, max: Math.max(0, Math.floor(video.duration * 10) / 10), step: 0.1, value: coverT, 'aria-label': 'Momento da capa',
      onchange: async (e) => { coverT = Number(e.target.value); v.currentTime = coverT; try { img = await videoFrame(video.url, coverT); mediaDirty = true; drawImage(); } catch (err) { toast(err.message, true); } } }) : null;
    imgBox.replaceChildren(h('div', { class: 'reel-wrap' }, v,
      h('div', { class: 'reel-side' },
        h('span', { class: 'label' }, 'Capa'), coverImg,
        slider ? h('label', { class: 'hint muted' }, 'Arraste para escolher o quadro da capa', slider) : null,
        locked ? null : h('button', { class: 'btn sm', type: 'button', onclick: () => fileIn.click() }, 'Usar outra imagem como capa'),
        locked ? null : h('button', { class: 'btn ghost sm', type: 'button', onclick: () => videoIn.click() }, 'Trocar vídeo'),
        video.duration ? h('span', { class: 'hint muted' }, `${Math.round(video.duration)} s${video.file ? ` · ${fileSize(video.file.size)}` : ''}`) : null)), fileIn, videoIn);
  };
  // Story: foto ou vídeo vertical (9:16), sem legenda
  const storyIn = h('input', { type: 'file', accept: 'image/*,video/mp4,video/quicktime,.mp4,.mov', hidden: true, onchange: () => storyIn.files[0] && takeStory(storyIn.files[0]) });
  const drawStory = () => {
    if (!img && !video) return imgBox.replaceChildren(dropZone('Escolha a foto ou o vídeo do Story', 'Vertical 9:16 (1080×1920). Vídeo de até 60 s (acima de 50 MB o app comprime sozinho). O texto vai na própria arte: Story não tem legenda.', () => storyIn.click(), (fs) => takeStory(fs[0])), storyIn);
    const view = video ? h('video', { src: video.url, controls: true, playsinline: true, muted: true, class: 'reel-video', poster: img?.url || null }) : h('img', { src: img.url, alt: 'Story', class: 'story-img' });
    imgBox.replaceChildren(h('div', { class: 'reel-wrap' }, view,
      h('div', { class: 'reel-side' },
        h('span', { class: 'hint muted' }, video ? `Vídeo de ${Math.round(video.duration || 0)} s.` : 'Foto em tela cheia.', ' Fica 24 h no ar a partir do horário marcado.'),
        locked ? null : h('button', { class: 'btn sm', type: 'button', onclick: () => storyIn.click() }, 'Trocar'))), storyIn);
  };
  // vídeo acima de 50 MB: comprime aqui no navegador antes (mostra o andamento no lugar da mídia)
  const shrink = async (f) => {
    if (f.size <= VIDEO_MAX) return f;
    if (f.size > 4 * 1024 ** 3) throw new Error(`Vídeo com ${fileSize(f.size)} é grande demais até para comprimir. Exporte em 1080p e tente de novo.`);
    const bar = h('span', { class: 'vz-bar' }, h('span', { class: 'vz-fill', style: 'width:0%' }));
    const pct = h('b', {}, '0%');
    imgBox.replaceChildren(h('div', { class: 'vz' }, h('span', {}, `Comprimindo o vídeo (${fileSize(f.size)}) para caber no limite de 50 MB…`), bar, pct,
      h('span', { class: 'muted', style: 'font-size:12.5px' }, 'Pode levar alguns minutos em vídeos longos. Não feche esta janela.')));
    const t0 = Date.now();
    const out = await compressVideo(f, (p) => { bar.firstChild.style.width = `${Math.round(p * 100)}%`; pct.textContent = `${Math.round(p * 100)}%`; });
    toast(`Vídeo comprimido: ${fileSize(f.size)} → ${fileSize(out.size)} em ${Math.max(1, Math.round((Date.now() - t0) / 1000))} s.`);
    return out;
  };
  const takeStory = async (f) => {
    try {
      if (f.type.startsWith('image/')) { img = await videoFrameFromImage(f); video = null; }
      else {
        { const info0 = await videoInfo(f); if (info0.duration > 60) throw new Error('Story em vídeo pode ter no máximo 60 segundos.'); }
        f = await shrink(f);
        const info = await videoInfo(f);
        if (info.duration > 60) throw new Error('Story em vídeo pode ter no máximo 60 segundos.');
        video = { file: f, url: info.url, duration: info.duration };
        img = await videoFrame(info.url, Math.min(1, info.duration / 2));
      }
      mediaDirty = true;
    } catch (e) { toast(e.message, true); }
    storyIn.value = ''; drawImage();
  };
  const takeVideo = async (f) => {
    try {
      let info = await videoInfo(f);
      if (info.duration < 3) throw new Error('O Reels precisa ter pelo menos 3 segundos.');
      if (info.duration > 900) throw new Error('O Reels pode ter no máximo 15 minutos.');
      if (f.size > VIDEO_MAX) { URL.revokeObjectURL(info.url); f = await shrink(f); info = await videoInfo(f); }
      video = { file: f, url: info.url, duration: info.duration };
      coverT = Math.min(1, info.duration / 2);
      img = await videoFrame(info.url, coverT);
      mediaDirty = true;
      if (info.width > info.height) toast('Dica: vídeo horizontal aparece com faixas no Reels. O ideal é vertical 9:16.');
    } catch (e) { toast(e.message, true); }
    videoIn.value = ''; drawImage();
  };
  const takeFile = async (f) => {
    try {
      if (mtype === 'REELS') { img = await videoFrameFromImage(f); } else if (mtype === 'STORY') { return takeStory(f); } else { img = await prepareImage(f); }
      mediaDirty = true; drawImage();
    } catch (e) { toast(e.message, true); }
  };
  // capa do Reels enviada pela agência: JPEG sem cortar (pode ser 9:16)
  const videoFrameFromImage = async (f) => {
    if (!f.type.startsWith('image/')) throw new Error('Escolha uma imagem para a capa.');
    const url = URL.createObjectURL(f);
    const bmp = await createImageBitmap(f);
    const scale = Math.min(1, 1080 / bmp.width);
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9));
    URL.revokeObjectURL(url);
    return { blob, url: URL.createObjectURL(blob) };
  };
  // foto do banco de mídia do cliente (já está no Storage: não precisa enviar de novo)
  const takeFromBank = (m) => {
    const it = { url: m.url, path: m.path };
    if (mtype === 'CAROUSEL') { if (items.length >= 10) return toast('O carrossel já tem 10 imagens.', true); items.push(it); }
    else if (mtype === 'STORY') { img = it; video = null; }
    else img = it;
    mediaDirty = true; drawImage(); toast(mtype === 'REELS' ? 'Capa escolhida do banco.' : 'Imagem do banco aplicada.');
  };
  const onPaste = (e) => { const fs = [...(e.clipboardData?.files || [])]; if (!fs.length || locked) return; if (mtype === 'CAROUSEL') addItems(fs); else takeFile(fs[0]); };
  document.addEventListener('paste', onPaste);
  drawSeg(); drawImage();

  const cap = h('textarea', { id: 'f-cap', disabled: locked, placeholder: 'Legenda, emojis e hashtags…' }, post?.caption || '');
  const capNote = h('span', { class: 'hint', hidden: true }, 'Story não tem legenda no Instagram: o texto vai na arte. Use este campo só como anotação para o cliente.');
  function syncCaption() { capNote.hidden = mtype !== 'STORY'; }
  syncCaption();
  const counter = h('div', { class: 'counter' });
  const updCounter = () => {
    const n = cap.value.length, tags = (cap.value.match(/#[\p{L}\p{N}_]+/gu) || []).length;
    counter.textContent = `${n}/2200 caracteres · ${tags}/30 hashtags`;
    counter.classList.toggle('bad', n > 2200 || tags > 30);
  };
  cap.addEventListener('input', updCounter); updCounter();
  const snipBar = locked ? null : snippetBar(() => [...picked][0], cap, updCounter);
  const revBox = h('div', { class: 'review', hidden: true });

  // Data: post existente usa a dele; dia clicado no calendário; ideia começa sem data; resto = amanhã 19h.
  const when = post?.scheduled_at ? partsInTz(post.scheduled_at, S.tz)
    : opts.date ? { date: opts.date, time: opts.time || '19:00' }
    : st === 'idea' ? { date: '', time: '' }
    : { date: partsInTz(new Date(Date.now() + 86400e3).toISOString(), S.tz).date, time: '19:00' };
  const dIn = h('input', { type: 'date', id: 'f-date', value: when.date, disabled: locked });
  const tIn = h('input', { type: 'time', id: 'f-time', value: when.time, disabled: locked });
  const alt = h('input', { type: 'text', id: 'f-alt', value: post?.alt_text || '', disabled: locked, placeholder: 'Ex.: Card escuro com a frase “Não é sorte, é corre.”' });

  // ── melhores horários do cliente (clique para usar a próxima data com aquele dia/hora)
  const bestBox = h('div', { class: 'best' });
  const loadBest = async () => {
    const cid = [...picked][0];
    bestBox.replaceChildren(h('span', { class: 'muted' }, 'Calculando melhores horários…'));
    try {
      const r = await api(`/api/pasta?r=besttime&client=${cid}`);
      const nextDate = (wd) => { const t = new Date(`${todayLocal()}T12:00:00Z`); for (let i = 1; i <= 7; i++) { const d = new Date(t.getTime() + i * 864e5); if (d.getUTCDay() === wd) return d.toISOString().slice(0, 10); } return todayLocal(); };
      bestBox.replaceChildren(h('span', { class: 'label' }, '⏱ Melhores horários'),
        ...r.slots.map((sl) => h('button', { type: 'button', class: 'chip', title: sl.lift ? `${sl.lift}× o desempenho médio do perfil (${sl.n} post${sl.n > 1 ? 's' : ''})` : 'Sugestão geral', onclick: () => { dIn.value = nextDate(sl.weekday); tIn.value = `${String(sl.hour).padStart(2, '0')}:00`; toast(`Agendado para ${sl.label}.`); } }, sl.label)),
        h('span', { class: 'hint muted' }, r.source === 'perfil' ? `com base em ${r.based_on} posts do perfil (curtidas e comentários)` : 'sugestão geral; o app aprende com os posts do perfil'));
    } catch { bestBox.replaceChildren(); }
  };
  if (!locked) loadBest();

  const body = [];
  let pendingScript = null; // post novo: o arquivo sobe depois de salvar
  const scriptBox = h('div', { class: 'sf-box' });
  const scriptIn = h('input', { type: 'file', hidden: true, accept: '.pdf,.doc,.docx,.txt,.md,application/pdf', onchange: () => { const f = scriptIn.files[0]; scriptIn.value = ''; if (f) attachScript(f); } });
  if (post) {
    body.push(h('div', { style: 'display:flex;gap:10px;align-items:center;flex-wrap:wrap' },
      h('span', { class: `pill st-${post.status}` }, STATUS_LABEL[post.status]),
      post.decided_at && ['approved', 'changes_requested'].includes(post.status) ? h('span', { class: 'muted', style: 'font-size:13px' }, `decidido em ${fmtDate(post.decided_at, S.tz)} ${fmtTime(post.decided_at, S.tz)}`) : null,
      post.ig_permalink ? h('a', { href: post.ig_permalink, target: '_blank', rel: 'noopener' }, 'Ver no Instagram ↗') : null));
    if (post.status === 'changes_requested' && (post.client_feedback || post.feedback_audio)) body.push(h('div', { class: 'feedback' }, h('b', {}, 'O cliente pediu:'),
      post.client_feedback && !(post.feedback_audio && post.client_feedback === '🎤 Pedido por áudio') ? h('span', {}, post.client_feedback) : null,
      post.feedback_audio ? h('div', { class: 'fb-audio' }, h('span', {}, '🎤 Áudio do cliente'), h('audio', { controls: true, preload: 'metadata', src: `/api/pasta?r=files&id=${post.feedback_audio}&open=1` })) : null));
    if (post.status === 'approved' && post.client_feedback) body.push(h('div', { class: 'feedback' }, h('b', {}, 'Comentário do cliente:'), h('span', {}, post.client_feedback)));
    if (post.last_error && ['failed', 'approved'].includes(post.status)) body.push(h('div', { class: 'errorbox' }, h('b', {}, post.status === 'failed' ? 'Não publicou: ' : 'Última tentativa: '), post.last_error));
    if (post.status === 'pending_approval') body.push(notifyBox(clientById(post.client_id)));
  }
  body.push(
    h('div', { class: 'field' }, h('span', { class: 'label' }, isNew ? 'Cliente(s)' : 'Cliente'), clientBox,
      isNew ? h('span', { class: 'hint' }, 'Escolha mais de um para criar o mesmo post em vários perfis.') : null),
    h('div', { class: 'field' }, h('label', { for: 'f-title' }, 'Pauta (uso interno)'), title),
    h('div', { class: 'field' }, h('span', { class: 'label' }, 'Formato e mídia'), typeSeg, imgBox,
      h('button', { type: 'button', class: 'btn ghost sm', style: 'justify-self:start', onclick: () => openFeedPreview([...picked][0], { image_url: (mtype === 'CAROUSEL' ? items[0]?.url : img?.url) || null, scheduled_at: collect().scheduled_at, id: post?.id || 'novo', media_type: mtype }) }, '▦ Ver no feed do cliente'),
      scriptFileBox(),
      locked ? null : h('div', { class: 'canva-row' },
        h('a', { class: 'btn sm canva', href: 'https://www.canva.com/', target: '_blank', rel: 'noopener' }, h('span', { class: 'canva-dot', 'aria-hidden': 'true' }, 'C'), 'Abrir Canva'),
        h('button', { type: 'button', class: 'btn sm', onclick: () => openBankPicker([...picked][0], takeFromBank) }, '🗂 Banco de mídia'),
        h('span', { class: 'hint' }, 'Feed 1080×1350 · Reels 1080×1920. Baixe e arraste aqui.'))),
    h('div', { class: 'field' }, h('label', { for: 'f-cap' }, 'Legenda'), capNote, cap, counter, snipBar, locked ? null : h('div', { class: 'actions' }, can('ia') ? aiPanel() : null, h('button', { class: 'btn sm', type: 'button', onclick: () => runReview(false) }, '🔎 Revisar post'))),
    revBox,
    h('div', { class: 'two' },
      h('div', { class: 'field' }, h('label', { for: 'f-date' }, 'Data'), dIn),
      h('div', { class: 'field' }, h('label', { for: 'f-time' }, 'Hora'), tIn)),
    locked ? null : bestBox,
    h('div', { class: 'field' }, h('label', { for: 'f-notes' }, 'Notas da equipe'), notes),
    h('div', { class: 'field' }, h('label', { for: 'f-alt' }, 'Texto alternativo (opcional)'), alt, h('span', { class: 'hint' }, 'Descrição da imagem para pessoas com deficiência visual.')),
  );

  // ── roteiro: arquivo feito fora (PDF, Word…) anexado ao post; dá para mandar o cliente aprovar antes de gravar
  function scriptFileBox() { drawScriptBox(); return h('div', { class: 'sf-wrap' }, scriptIn, scriptBox); }
  function drawScriptBox() {
    const sc = post?.script;
    const file = sc?.file;
    // só Reels e Story (vídeo); se já tiver roteiro anexado, continua aparecendo para dar para tirar
    if (!['REELS', 'STORY'].includes(mtype) && !file && !pendingScript) return scriptBox.replaceChildren();
    if (pendingScript) return scriptBox.replaceChildren(h('div', { class: 'sf-file' }, h('span', { class: 'sf-ic' }, 'PDF'),
      h('span', { class: 'sf-main' }, h('b', {}, 'Roteiro'), h('small', {}, `${pendingScript.name} · sobe quando você salvar`)),
      h('button', { class: 'btn ghost sm', type: 'button', onclick: () => { pendingScript = null; drawScriptBox(); } }, 'Tirar')));
    if (!file) {
      if (locked) return scriptBox.replaceChildren();
      return scriptBox.replaceChildren(h('button', { class: 'sf-add', type: 'button', onclick: () => scriptIn.click() },
        h('span', { 'aria-hidden': 'true' }, '📎'), h('span', {}, h('b', {}, 'Anexar roteiro'), h('small', {}, 'PDF, Word ou texto · o cliente pode aprovar antes da gravação'))));
    }
    const isPdf = /pdf/i.test(file.mime || file.name);
    scriptBox.replaceChildren(h('div', { class: 'sf-file' },
      h('span', { class: 'sf-ic' }, isPdf ? 'PDF' : 'DOC'),
      h('span', { class: 'sf-main' }, h('b', {}, 'Roteiro'), h('small', {}, file.name),
        h('span', { class: `pill ${SCRIPT_PILL[sc.status] || 'st-draft'}`, style: 'justify-self:start;font-size:11px' }, { draft: 'Só a equipe vê', sent: 'Com o cliente', changes: 'Cliente pediu ajuste', approved: 'Aprovado pelo cliente' }[sc.status] || 'Anexado')),
      h('a', { class: 'btn sm', href: `/api/pasta?r=files&id=${file.id}&open=1`, target: '_blank', rel: 'noopener' }, 'Abrir'),
      locked ? null : h('button', { class: 'btn ghost sm', type: 'button', onclick: () => scriptIn.click() }, 'Trocar'),
      locked || !can('conteudo') ? null : confirmButton('Remover', 'Confirmar', async () => {
        try { const saved = await api(`/api/pasta?r=script&post_id=${post.id}`, { method: 'DELETE' }); Object.assign(post, { script: saved.script }); upsert(saved, false); drawScriptBox(); toast('Roteiro removido do post.'); } catch (e) { toast(e.message, true); }
      }, 'btn ghost sm')),
      sc.status === 'changes' && (sc.feedback || sc.feedback_audio) ? h('div', { class: 'feedback' }, h('b', {}, 'O cliente pediu no roteiro:'),
        sc.feedback && sc.feedback !== '🎤 Pedido por áudio' ? h('span', {}, sc.feedback) : null,
        sc.feedback_audio ? h('div', { class: 'fb-audio' }, h('span', {}, '🎤 Áudio do cliente'), h('audio', { controls: true, preload: 'metadata', src: `/api/pasta?r=files&id=${sc.feedback_audio}&open=1` })) : null) : null,
      !locked && can('enviar') && sc.status !== 'approved' ? h('button', { class: `btn sm${sc.status === 'sent' ? ' ghost' : ' primary'}`, type: 'button', style: 'justify-self:start', onclick: () => sendScriptFile(file) },
        sc.status === 'sent' ? 'Reenviar roteiro ao cliente' : sc.status === 'changes' ? 'Mandar roteiro de novo para aprovar' : 'Enviar roteiro para o cliente aprovar') : null);
  }
  async function uploadScriptFor(p, f) {
    const up = await api(`/api/pasta?r=files&client=${p.client_id}&category=other`, { method: 'POST', raw: f, headers: { 'x-file-name': encodeURIComponent(f.name) } });
    return api('/api/pasta?r=script', { method: 'PUT', body: { post_id: p.id, script: { file: { id: up.id } } } });
  }
  async function attachScript(f) {
    if (f.size > 4 * 1024 * 1024) return toast('Arquivo grande demais (máx. 4 MB). Exporte o PDF menor e tente de novo.', true);
    if (isNew) { pendingScript = f; drawScriptBox(); return; }
    toast('Enviando o roteiro…');
    try { const saved = await uploadScriptFor(post, f); Object.assign(post, { script: saved.script }); upsert(saved, false); drawScriptBox(); toast(post.script.status === 'draft' ? 'Roteiro anexado. Só a equipe vê até você enviar ao cliente.' : 'Roteiro anexado.'); }
    catch (e) { toast(e.message, true); }
  }
  async function sendScriptFile(file) {
    try {
      const saved = await api('/api/pasta?r=script', { method: 'PUT', body: { post_id: post.id, script: { ...post.script, file }, send: true } });
      Object.assign(post, { script: saved.script }); upsert(saved, false); drawScriptBox();
      toast('Roteiro enviado. O cliente vê no link de aprovação.');
      const c = clientById(post.client_id);
      if (c?.approval_url) copyText(scriptMessage(c, post), 'Mensagem com o link copiada: cole no WhatsApp do cliente.');
    } catch (e) { toast(e.message, true); }
  }

  // ── roteiro do vídeo (abre o editor; post novo precisa ser salvo antes)
  function scriptField() {
    if (locked && !post?.script) return null;
    const sc = post?.script;
    const video = ['REELS', 'STORY'].includes(mtype);
    if (isNew && !video) return null;
    return h('div', { class: 'field sc-field' }, h('span', { class: 'label' }, 'Roteiro do vídeo'),
      isNew ? h('span', { class: 'hint' }, 'Salve o post (pode ser como ideia) para escrever o roteiro e mandar o cliente aprovar antes de gravar.')
        : h('div', { class: 'sc-row' },
          sc ? h('span', { class: `pill ${SCRIPT_PILL[sc.status] || 'st-draft'}` }, SCRIPT_STATUS[sc.status] || 'Roteiro') : h('span', { class: 'muted' }, 'Ainda sem roteiro'),
          sc?.hooks?.length ? h('span', { class: 'sc-row-hook' }, `“${sc.hooks[sc.hook || 0]}”`) : null,
          h('button', { class: `btn sm${sc ? '' : ' ai'}`, type: 'button', onclick: () => { close(); openScript(post); } }, sc ? 'Abrir roteiro' : '🎬 Escrever roteiro')));
  }

  // ── IA: sugestões de legenda + hashtags
  function aiPanel() {
    const brief = h('input', { type: 'text', id: 'f-brief', placeholder: 'Sobre o que é o post? (opcional, ajuda a IA)' });
    const results = h('div', { class: 'ai-results' });
    const go = h('button', { class: 'btn sm', type: 'button', onclick: run }, 'Gerar sugestões');
    const panel = h('div', { class: 'ai-panel', hidden: true },
      h('div', { class: 'ai-row' }, brief, go), results);
    const toggle = h('button', { class: 'btn ai sm', type: 'button', onclick: () => {
      if (!S.setup?.ai_ready) return toast('A IA ainda não está ligada. Veja a aba Ajustes → Inteligência Artificial.', true);
      panel.hidden = !panel.hidden; if (!panel.hidden) brief.focus();
    } }, '✨ Legenda com IA');
    async function run() {
      go.disabled = true; results.replaceChildren(h('p', { class: 'muted', style: 'margin:0' }, img ? 'Lendo a imagem e escrevendo…' : 'Escrevendo…'));
      try {
        const payload = { client_id: [...picked][0], brief: brief.value, title: title.value, current: cap.value };
        const aiImg = mtype === 'CAROUSEL' ? items[0] : img;
        if (aiImg?.blob) payload.image_base64 = await blobToDataUrl(aiImg.blob);
        else if (aiImg?.url && /^https:/.test(aiImg.url)) payload.image_url = aiImg.url;
        payload.media_type = mtype;
        const r = await api('/api/ai/caption', { method: 'POST', body: payload });
        results.replaceChildren(...r.options.map((o) => h('div', { class: 'ai-opt' },
          h('span', { class: 'eyebrow' }, o.label || 'Opção'),
          h('p', { style: 'margin:0;white-space:pre-line' }, o.caption),
          h('p', { class: 'mono', style: 'margin:0;font-size:12.5px;color:var(--accent)' }, o.hashtags.join(' ')),
          h('button', { class: 'btn sm', type: 'button', onclick: () => {
            cap.value = `${o.caption}\n\n${o.hashtags.join(' ')}`.trim(); updCounter(); toast('Legenda aplicada. Ajuste à vontade.');
          } }, 'Usar esta'))));
      } catch (e) { results.replaceChildren(h('div', { class: 'errorbox' }, e.message)); }
      go.disabled = false;
    }
    return h('div', { style: 'display:grid;gap:8px' }, toggle, panel);
  }

  const collect = () => ({
    title: title.value.trim(), notes: notes.value, caption: cap.value, alt_text: alt.value.trim(),
    scheduled_at: dIn.value ? zonedToISO(dIn.value, tIn.value || '19:00', S.tz) : null,
  });

  let confirmLate = false;
  // ── revisor: regras rápidas (sempre) + IA (português, tom e arte) quando ligada
  let reviewed = false;
  const sizeOf = (url) => new Promise((ok) => { if (!url) return ok(null); const im = new Image(); im.onload = () => ok({ w: im.naturalWidth, h: im.naturalHeight }); im.onerror = () => ok(null); im.src = url; });
  const vidSize = (url) => new Promise((ok) => { if (!url) return ok(null); const v = document.createElement('video'); v.preload = 'metadata'; v.muted = true; v.onloadedmetadata = () => ok({ w: v.videoWidth, h: v.videoHeight, duration: v.duration }); v.onerror = () => ok(null); v.src = url; });
  async function runReview(silent) {
    const d = collect();
    const cid = [...picked][0];
    const day = d.scheduled_at ? dayKey(d.scheduled_at, S.tz) : null;
    const sameDay = day ? [...S.posts, ...S.cal.posts].filter((x, i, arr) => arr.findIndex((y) => y.id === x.id) === i && x.client_id === cid && x.id !== post?.id && x.media_type !== 'STORY' && x.scheduled_at && dayKey(x.scheduled_at, S.tz) === day).length : 0;
    const issues = reviewPost({ media_type: mtype, caption: d.caption, scheduled_at: d.scheduled_at,
      image: mtype !== 'CAROUSEL' ? await sizeOf(img?.url) : null, items: mtype === 'CAROUSEL' ? (await Promise.all(items.map((it) => sizeOf(it.url)))).filter(Boolean) : null,
      video: ['REELS', 'STORY'].includes(mtype) && video ? await vidSize(video.url) : null }, { brand_kit: clientById(cid)?.brand_kit || {}, sameDay, tz: S.tz });
    drawReview(issues, null);
    if (!silent || issues.length) { revBox.hidden = false; revBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
    return issues;
  }
  const LV = { erro: ['Precisa corrigir', 'st-failed'], atencao: ['Atenção', 'st-pending_approval'], dica: ['Dica', 'st-draft'] };
  function drawReview(issues, ai) {
    const fixBtn = (i) => (i.fix ? h('button', { class: 'btn ghost sm', type: 'button', onclick: () => { cap.value = applyFix(cap.value, i.fix); updCounter(); runReview(false); toast('Corrigido.'); } }, 'Corrigir') : null);
    const aiBtn = h('button', { class: 'btn ai sm', type: 'button', onclick: async () => {
      if (!S.setup?.ai_ready && S.role === 'admin') return toast('A IA ainda não está ligada (Ajustes → Inteligência Artificial).', true);
      aiBtn.disabled = true; aiBtn.textContent = 'Revisando com IA…';
      try {
        const payload = { client_id: [...picked][0], caption: cap.value, title: title.value, media_type: mtype };
        const aiImg = mtype === 'CAROUSEL' ? items[0] : img;
        if (aiImg?.blob) payload.image_base64 = await blobToDataUrl(aiImg.blob); else if (aiImg?.url && /^https:/.test(aiImg.url)) payload.image_url = aiImg.url;
        drawReview(issues, await api('/api/pasta?r=review', { method: 'POST', body: payload }));
      } catch (e) { toast(e.message, true); aiBtn.disabled = false; aiBtn.textContent = '✨ Revisar português e arte com IA'; }
    } }, '✨ Revisar português e arte com IA');
    revBox.replaceChildren(
      h('div', { class: 'review-head' }, h('b', {}, '🔎 Revisor'), h('span', { class: 'muted' }, issues.length ? `${issues.length} ponto(s) nas regras rápidas` : 'Regras rápidas: tudo certo ✓'),
        h('button', { class: 'linkish', type: 'button', onclick: () => { revBox.hidden = true; } }, 'Fechar')),
      ...issues.map((i) => h('div', { class: `rev-item lv-${i.level}` }, h('span', { class: `pill ${LV[i.level][1]}` }, LV[i.level][0]), h('div', {}, h('b', {}, i.title), h('span', { class: 'muted' }, i.detail)), fixBtn(i))),
      ai ? h('div', { class: 'rev-ai' }, h('b', {}, '✨ Revisão da IA'),
        ai.issues.length ? null : h('span', { class: 'ig-ok' }, '✓ Nada importante a corrigir no português, no tom e na arte.'),
        ...ai.issues.map((i) => h('div', { class: `rev-item lv-${i.level}` }, h('span', { class: `pill ${LV[i.level][1]}` }, i.area ? `${LV[i.level][0]} · ${i.area}` : LV[i.level][0]), h('div', {}, h('b', {}, i.title), h('span', { class: 'muted' }, i.detail)))),
        ai.corrected_caption ? h('div', { class: 'rev-fix' }, h('span', { class: 'label' }, 'Legenda corrigida'), ai.changes?.length ? h('ul', { class: 'rev-changes' }, ...ai.changes.map((c) => h('li', {}, c))) : null,
          h('p', { style: 'margin:0;white-space:pre-line;font-size:14px' }, ai.corrected_caption),
          h('button', { class: 'btn primary sm', type: 'button', onclick: () => { cap.value = ai.corrected_caption; updCounter(); toast('Legenda corrigida aplicada.'); } }, 'Usar legenda corrigida')) : null)
        : (can('ia') && (mtype !== 'STORY' || img) ? aiBtn : null));
  }
  // mode: 'idea' | 'production' | 'review' | 'send' | 'approve' | 'save'
  async function save(mode) {
    const data = collect();
    const needsComplete = mode === 'send' || mode === 'approve';
    if (needsComplete && mtype === 'CAROUSEL' && items.length < 2) return toast('O carrossel precisa de pelo menos 2 imagens.', true);
    if (needsComplete && mtype === 'REELS' && !video) return toast('Escolha o vídeo do Reels.', true);
    if (needsComplete && mtype === 'STORY' && !img && !video) return toast('Escolha a foto ou o vídeo do Story.', true);
    if (needsComplete && !['CAROUSEL', 'STORY'].includes(mtype) && !img) return toast(mtype === 'REELS' ? 'Falta a capa do Reels.' : 'Para enviar ou aprovar, o post precisa de imagem.', true);
    if (needsComplete && !data.scheduled_at) return toast('Para enviar ou aprovar, escolha a data e a hora.', true);
    if (mode === 'send' && !reviewed) {
      const found = await runReview(true);
      if (found.some((i) => i.level === 'erro')) return toast('O revisor encontrou um erro que impede o envio. Veja no topo do painel.', true);
      if (found.some((i) => i.level === 'atencao')) { reviewed = true; return toast('O revisor encontrou pontos de atenção (no topo do painel). Corrija ou clique de novo em Enviar para mandar assim mesmo.'); }
    }
    if (needsComplete && new Date(data.scheduled_at) < Date.now() + 60e3 && !confirmLate) {
      confirmLate = true; return toast('Esse horário já passou: o post sai na próxima rodada (até 5 min). Clique de novo para confirmar.');
    }
    footBtns.forEach((b) => (b.disabled = true));
    try {
      const cid = [...picked][0];
      const up = (blob) => api(`/api/upload?client=${cid}`, { method: 'POST', raw: blob });
      if (mtype === 'CAROUSEL') {
        for (const [i, it] of items.entries()) if (it.blob) { toast(`Enviando imagem ${i + 1} de ${items.length}…`); const r = await up(it.blob); Object.assign(it, { url: r.image_url, path: r.image_path, blob: null }); }
        data.media = items.map((it) => ({ url: it.url, path: it.path, kind: 'image' }));
        if (items[0]) Object.assign(data, { image_url: items[0].url, image_path: items[0].path });
      } else {
        if (img?.blob) { const r = await up(img.blob); Object.assign(data, r); img = { url: r.image_url, path: r.image_path }; }
        else if (img) Object.assign(data, { image_url: img.url, image_path: img.path ?? post?.image_path ?? null });
        if (['REELS', 'STORY'].includes(mtype) && video) {
          if (video.file) { const v = await uploadVideo(video.file, cid, (pr) => toast(`Enviando vídeo… ${Math.round(pr * 100)}%`)); video = { url: v.url, path: v.path, duration: video.duration }; }
          data.media = [{ url: video.url, path: video.path, kind: 'video' }];
        } else data.media = null;
      }
      data.media_type = mtype;
      let saved;
      if (isNew) {
        const stage = mode === 'idea' ? 'idea' : mode === 'review' ? 'internal_review' : 'draft';
        saved = await api('/api/posts', { method: 'POST', body: { ...data, client_ids: [...picked], stage, send: mode === 'send', approved: mode === 'approve' } });
      } else {
        // Manda só o que mudou: assim, mexer só no horário não tira o post da fila.
        const diff = {};
        for (const k of ['title', 'notes', 'caption', 'alt_text']) if ((data[k] || '') !== (post[k] || '')) diff[k] = data[k];
        const oldT = post.scheduled_at ? new Date(post.scheduled_at).getTime() : null;
        const newT = data.scheduled_at ? new Date(data.scheduled_at).getTime() : null;
        if (oldT !== newT) diff.scheduled_at = data.scheduled_at ?? '';
        if (mediaDirty) Object.assign(diff, { image_url: data.image_url || null, image_path: data.image_path || null, media_type: data.media_type, media: data.media });
        saved = Object.keys(diff).length
          ? await api(`/api/posts?id=${post.id}`, { method: 'PATCH', body: { ...diff, send: mode === 'send' } })
          : post;
        const act = { send: 'send', approve: 'approve', review: 'to_review', production: 'to_production', idea: 'to_idea' }[mode];
        const target = { send: 'pending_approval', approve: 'approved', review: 'internal_review', production: 'draft', idea: 'idea' }[mode];
        if (act && saved.status !== target) saved = await api(`/api/posts?id=${post.id}`, { method: 'PATCH', body: { action: act } });
        if (mode === 'save' && saved === post) { close(); return toast('Nada mudou.'); }
      }
      const list = Array.isArray(saved) ? saved : [saved];
      if (pendingScript) for (const [i, p] of list.entries()) {
        try { toast(`Anexando o roteiro${list.length > 1 ? ` (${i + 1} de ${list.length})` : ''}…`); list[i] = await uploadScriptFor(p, pendingScript); }
        catch (e) { toast(`Post salvo, mas o roteiro não subiu: ${e.message}`, true); }
      }
      list.forEach((p) => upsert(p, false)); render(); close();
      const n = list.length > 1 ? ` (${list.length} clientes)` : '';
      toast({ send: `Enviado para aprovação${n}. O cliente já vê no link dele.`, approve: `Aprovado${n}. Publica sozinho no horário.`, idea: `Ideia salva${n}.`, review: `Na revisão interna${n}.`, production: `Em produção${n}.` }[mode] || `Salvo${n}.`);
      if (mode === 'send') maybeNotify(list);
    } catch (e) {
      toast(e.message, true);
    } finally { footBtns.forEach((b) => (b.disabled = false)); }
  }

  async function action(a, msg) {
    try { upsert(await api(`/api/posts?id=${post.id}`, { method: 'PATCH', body: { action: a } })); close(); toast(msg); }
    catch (e) { toast(e.message, true); }
  }

  const B = (label, cls, fn) => h('button', { class: `btn ${cls}`, type: 'button', onclick: fn }, label);
  let foot;
  if (isNew && st === 'idea') foot = [B('Salvar em produção', '', () => save('production')), B('Salvar ideia', 'primary', () => save('idea'))];
  else if (isNew) foot = [B('Salvar como ideia', 'ghost', () => save('idea')), B('Salvar em produção', '', () => save('production')), B('Aprovar direto', 'ghost', () => save('approve')), B('Enviar para aprovação', 'primary', () => save('send'))];
  else if (locked) foot = post.status === 'published'
    ? [confirmButton('Remover do painel', 'Confirmar remoção', async () => { await api(`/api/posts?id=${post.id}`, { method: 'DELETE' }); S.posts = S.posts.filter((x) => x.id !== post.id); S.cal.posts = S.cal.posts.filter((x) => x.id !== post.id); close(); render(); toast('Removido do painel. No Instagram continua publicado.'); })]
    : [h('span', { class: 'muted' }, 'Publicando agora…')];
  else {
    const del = confirmButton('Apagar', 'Confirmar exclusão', async () => { await api(`/api/posts?id=${post.id}`, { method: 'DELETE' }); S.posts = S.posts.filter((x) => x.id !== post.id); S.cal.posts = S.cal.posts.filter((x) => x.id !== post.id); close(); render(); toast('Post apagado.'); });
    foot = [del, h('span', { class: 'spacer' })];
    if (st === 'idea') foot.push(B('Salvar', '', () => save('save')), B('Produzir →', 'primary', () => save('production')));
    if (st === 'draft') foot.push(B('Salvar', '', () => save('save')), B('Revisão interna', '', () => save('review')), B('Aprovar direto', 'ghost', () => save('approve')), B('Enviar para aprovação', 'primary', () => save('send')));
    if (st === 'internal_review') foot.push(B('Voltar p/ produção', 'ghost', () => save('production')), B('Salvar', '', () => save('save')), B('Aprovar direto', 'ghost', () => save('approve')), B('Enviar para aprovação', 'primary', () => save('send')));
    if (st === 'pending_approval') foot.push(B('Voltar p/ produção', 'ghost', () => action('to_production', 'Voltou para produção.')), B('Salvar', '', () => save('save')), B('Aprovar direto', 'primary', () => save('approve')));
    if (st === 'changes_requested') foot.push(B('Aprovar assim mesmo', 'ghost', () => save('approve')), B('Salvar e reenviar', 'primary', () => save('send')));
    if (st === 'approved') foot.push(B('Tirar da fila', 'ghost', () => action('to_production', 'Saiu da fila: voltou para produção.')), B('Salvar', 'primary', () => save('save')));
    if (st === 'failed') foot.push(B('Voltar p/ produção', 'ghost', () => action('to_production', 'Voltou para produção.')), B('Tentar de novo', 'primary', () => action('retry', 'Na fila de novo. Sai em até 5 minutos.')));
  }
  if (!can('enviar')) foot = foot.filter((b) => !(b instanceof HTMLButtonElement) || !/Enviar para aprovação|Aprovar|reenviar|Tentar de novo/.test(b.textContent));
  if (!can('apagar') && foot[0]?.textContent === 'Apagar') foot = foot.slice(1);
  if (!can('conteudo')) foot = [h('span', { class: 'muted' }, 'Só leitura: sem permissão para editar posts.')];
  const footBtns = foot.filter((b) => b instanceof HTMLButtonElement);
  if (post && ['pending_approval', 'approved'].includes(post.status) && !locked) {
    body.push(h('p', { class: 'hint muted', style: 'margin:0;font-size:13px' }, 'Mudar imagem, legenda ou texto alternativo volta o post para produção, para o cliente aprovar a versão nova. Mudar só data, hora, pauta ou notas mantém o status.'));
  }
  const close0 = drawer(isNew ? (st === 'idea' ? 'Nova ideia' : 'Novo post') : 'Post', body, foot);
  const close = () => { document.removeEventListener('paste', onPaste); close0(); };
}

// ───────────────────────── roteiro de vídeo (Reels / Story): IA + regras do nicho + aprovação do cliente
const scriptMessage = (c, p) => `Olá! O roteiro do vídeo "${p.title || 'novo vídeo'}" de ${c.name} está pronto para você ler antes da gravação:\n${c.approval_url}\n\nÉ só abrir e tocar em Aprovar roteiro ou Pedir ajuste (pode mandar áudio). 🎬`;
const SCRIPT_PILL = { draft: 'st-draft', sent: 'st-pending_approval', changes: 'st-changes_requested', approved: 'st-approved' };

// vídeo (Reels/Story), pauta que fala de vídeo, ou já tem roteiro: mostra o atalho do roteiro no cartão
const wantsScript = (p) => Boolean(p.script) || (['idea', 'draft', 'internal_review', 'changes_requested'].includes(p.status) && (['REELS', 'STORY'].includes(p.media_type) || /\b(reels?|story|stories|v[íi]deo)\b/i.test(p.title || '')));

function scriptBadge(p) {
  const s = p.script;
  if (!s) return null;
  return h('span', { class: `tlabel sc-${s.status}`, title: SCRIPT_STATUS[s.status] }, `${s.file ? '📄' : '🎬'} ${{ draft: 'Roteiro', sent: 'Roteiro com o cliente', changes: 'Ajustar roteiro', approved: 'Roteiro ok' }[s.status] || 'Roteiro'}`);
}

function openScript(post) {
  const c = clientById(post.client_id);
  const niche = c?.brand_kit?.niche || '';
  const rules = NICHE_RULES[niche];
  const s0 = post.script || {};
  let hooks = [...(s0.hooks || []), '', '', ''].slice(0, 3);
  let chosen = s0.hook || 0;
  let scenes = (s0.scenes || []).map((x) => ({ ...x }));
  if (!scenes.length) scenes = [{ show: '', say: '', text: '', secs: 3 }];
  let dirty = false;
  const touch = () => { dirty = true; check(); };

  // ── gerar com IA
  const topic = h('input', { type: 'text', id: 's-topic', value: s0.topic || post.title || '', maxlength: 300, placeholder: 'Ex.: 3 mitos sobre clareamento' });
  const tpl = h('select', { id: 's-tpl' }, ...Object.entries(TEMPLATES).map(([k, v]) => h('option', { value: k, selected: (s0.template || 'livre') === k }, v.label)));
  const dur = h('select', { id: 's-dur' }, ...DURATIONS.map((d) => h('option', { value: d, selected: (s0.duration || 30) === d }, `${d} segundos`)));
  const extra = h('input', { type: 'text', id: 's-extra', maxlength: 600, placeholder: 'Opcional: quem fala, onde grava, algo que não pode faltar…' });
  const aiOut = h('div', { class: 'sc-ai-out' });
  const genBtn = h('button', { class: 'btn ai', type: 'button', onclick: generate }, scenes.some((x) => x.say || x.show) ? '✨ Gerar outra versão' : '✨ Gerar roteiro com IA');
  async function generate() {
    if (!S.setup?.ai_ready && S.role === 'admin') return toast('A IA ainda não está ligada (Ajustes → Inteligência Artificial).', true);
    if (dirty && !genBtn.dataset.ok) { genBtn.dataset.ok = '1'; genBtn.textContent = 'Substituir o que escrevi? Clique de novo'; return; }
    genBtn.disabled = true; genBtn.textContent = 'Escrevendo o roteiro…';
    aiOut.replaceChildren(h('p', { class: 'muted', style: 'margin:0' }, 'A IA está lendo a marca, os ganchos que funcionaram e as regras do nicho…'));
    try {
      const r = await api('/api/pasta?r=script', { method: 'POST', body: { post_id: post.id, topic: topic.value, template: tpl.value, duration: Number(dur.value), extra: extra.value } });
      hooks = [...r.script.hooks, '', '', ''].slice(0, 3); chosen = 0; scenes = r.script.scenes;
      cta.value = r.script.cta; cover.value = r.script.cover; audio.value = r.script.audio; cap.value = r.script.caption;
      drawHooks(); drawScenes(); dirty = true; check();
      aiOut.replaceChildren(...(r.warnings || []).map((w) => h('div', { class: 'rev-item lv-atencao' }, h('span', { class: 'pill st-pending_approval' }, 'Adaptado'), h('div', {}, h('span', {}, w)))));
      toast('Roteiro pronto. Revise, escolha o gancho e ajuste o que quiser.');
    } catch (e) { aiOut.replaceChildren(h('div', { class: 'errorbox' }, e.message)); }
    genBtn.disabled = false; genBtn.textContent = '✨ Gerar outra versão'; delete genBtn.dataset.ok;
  }

  // ── ganchos (3 opções, uma escolhida) + banco de ganchos
  const hookBox = h('div', { class: 'sc-hooks' });
  function drawHooks() {
    hookBox.replaceChildren(...hooks.map((txt, i) => h('div', { class: `sc-hook-row${i === chosen ? ' on' : ''}` },
      h('input', { type: 'radio', name: 's-hook', id: `s-hook-${i}`, checked: i === chosen, 'aria-label': `Usar o gancho ${i + 1}`, onchange: () => { chosen = i; drawHooks(); touch(); } }),
      h('textarea', { rows: 2, maxlength: 220, placeholder: ['Curiosidade: …', 'Dor ou problema: …', 'Direto ou contraintuitivo: …'][i], 'aria-label': `Gancho ${i + 1}`, oninput: (e) => { hooks[i] = e.target.value; touch(); } }, txt))));
  }
  const bankBox = h('div', { class: 'sc-bank', hidden: true });
  const bankBtn = h('button', { class: 'btn ghost sm', type: 'button', onclick: async () => {
    if (!bankBox.hidden) { bankBox.hidden = true; return; }
    bankBox.hidden = false; bankBox.replaceChildren(h('p', { class: 'muted', style: 'margin:0' }, 'Buscando os ganchos deste cliente…'));
    try {
      const { hooks: list } = await api(`/api/pasta?r=script&hooks=1&client=${post.client_id}`);
      const num = (n) => new Intl.NumberFormat('pt-BR').format(n);
      bankBox.replaceChildren(
        h('span', { class: 'muted', style: 'font-size:13px' }, list.length ? 'Ganchos que já foram ao ar ou foram aprovados, do melhor resultado para o menor (dos relatórios mensais).' : 'Ainda não há ganchos com resultado. Eles aparecem aqui quando os Reels forem publicados e o relatório do mês for gerado.'),
        ...list.map((x) => h('div', { class: 'sc-bank-row' },
          h('div', {}, h('p', { style: 'margin:0' }, `“${x.hook}”`),
            h('span', { class: 'muted', style: 'font-size:12.5px' }, [x.views != null ? `${num(x.views)} visualizações` : x.reach != null ? `${num(x.reach)} de alcance` : 'ainda sem resultado', x.saves ? `${num(x.saves)} salvamentos` : null, x.status, x.source === 'legenda' ? 'da legenda' : null].filter(Boolean).join(' · ')),
            x.permalink ? h('a', { href: x.permalink, target: '_blank', rel: 'noopener', style: 'font-size:12.5px;margin-left:8px' }, 'ver ↗') : null),
          h('button', { class: 'btn sm', type: 'button', onclick: () => { hooks[chosen] = x.hook; drawHooks(); touch(); toast(`Colocado no gancho ${chosen + 1}. Adapte ao tema.`); } }, 'Usar'))));
    } catch (e) { bankBox.replaceChildren(h('div', { class: 'errorbox' }, e.message)); }
  } }, '★ Banco de ganchos');

  // ── cenas
  const sceneBox = h('ol', { class: 'sc-edit' });
  const totalEl = h('span', { class: 'muted' });
  function drawScenes() {
    sceneBox.replaceChildren(...scenes.map((sc, i) => {
      const upd = (k) => (e) => { sc[k] = k === 'secs' ? Number(e.target.value) || 0 : e.target.value; touch(); if (k === 'secs') drawTotal(); };
      const move = (d) => { const j = i + d; if (j < 0 || j >= scenes.length) return; [scenes[i], scenes[j]] = [scenes[j], scenes[i]]; drawScenes(); touch(); };
      return h('li', { class: 'sc-scene' },
        h('div', { class: 'sc-scene-head' }, h('b', {}, `Cena ${i + 1}`),
          h('label', { class: 'sc-secs' }, h('input', { type: 'number', min: 0, max: 120, value: sc.secs || 0, oninput: upd('secs'), 'aria-label': `Duração da cena ${i + 1} em segundos` }), 's'),
          h('span', { class: 'spacer' }),
          h('button', { class: 'btn ghost sm', type: 'button', disabled: i === 0, onclick: () => move(-1), 'aria-label': 'Subir cena' }, '↑'),
          h('button', { class: 'btn ghost sm', type: 'button', disabled: i === scenes.length - 1, onclick: () => move(1), 'aria-label': 'Descer cena' }, '↓'),
          h('button', { class: 'btn ghost sm', type: 'button', disabled: scenes.length === 1, onclick: () => { scenes.splice(i, 1); drawScenes(); touch(); }, 'aria-label': `Apagar cena ${i + 1}` }, '✕')),
        h('textarea', { rows: 2, maxlength: 400, placeholder: 'O que aparece: enquadramento, ação, lugar', 'aria-label': `Cena ${i + 1}: o que aparece`, oninput: upd('show') }, sc.show || ''),
        h('textarea', { rows: 2, maxlength: 700, placeholder: i === 0 ? 'Fala (vazia = usa o gancho escolhido)' : 'Fala, do jeito que a pessoa fala', 'aria-label': `Cena ${i + 1}: fala`, oninput: upd('say') }, sc.say || ''),
        h('input', { type: 'text', maxlength: 160, placeholder: 'Texto na tela (curto, opcional)', value: sc.text || '', 'aria-label': `Cena ${i + 1}: texto na tela`, oninput: upd('text') }));
    }));
    drawTotal();
  }
  function drawTotal() { const t = scenes.reduce((a, x) => a + (Number(x.secs) || 0), 0); totalEl.textContent = `Total: ${t}s de ${dur.value}s`; }
  dur.addEventListener('change', () => { drawTotal(); touch(); });
  const addScene = h('button', { class: 'btn sm', type: 'button', onclick: () => { scenes.push({ show: '', say: '', text: '', secs: 5 }); drawScenes(); touch(); sceneBox.lastChild?.querySelector('textarea')?.focus(); } }, '+ Cena');

  const cta = h('input', { type: 'text', id: 's-cta', maxlength: 300, value: s0.cta || '', placeholder: 'Ex.: Salve para lembrar na próxima consulta', oninput: touch });
  const cover = h('input', { type: 'text', id: 's-cover', maxlength: 200, value: s0.cover || '', placeholder: 'Texto da capa (até 5 palavras)', oninput: touch });
  const audio = h('input', { type: 'text', id: 's-audio', maxlength: 200, value: s0.audio || '', placeholder: 'Estilo de trilha (biblioteca comercial do Instagram)', oninput: touch });
  const cap = h('textarea', { id: 's-cap', maxlength: 2200, placeholder: 'Legenda sugerida para o post', style: 'min-height:70px', oninput: touch }, s0.caption || '');
  const notes = h('textarea', { id: 's-notes', maxlength: 1000, placeholder: 'Só a equipe vê: figurino, objetos, lugar, quem grava…', style: 'min-height:60px', oninput: touch }, s0.notes || '');

  // ── checagem das regras (na hora, sem IA)
  const checkBox = h('div', { class: 'sc-check' });
  const LV = { erro: ['Proibido', 'st-failed'], atencao: ['Atenção', 'st-pending_approval'], dica: ['Dica', 'st-draft'] };
  const collect = () => ({ topic: topic.value, template: tpl.value, duration: Number(dur.value), hooks, hook: chosen, scenes, cta: cta.value, cover: cover.value, audio: audio.value, caption: cap.value, notes: notes.value });
  let issues = [];
  function check() {
    const data = collect();
    issues = checkScript({ ...data, hooks: data.hooks.filter((x) => x.trim()) }, niche);
    checkBox.replaceChildren(
      h('div', { class: 'review-head' }, h('b', {}, rules ? `⚖ Regras: ${rules.name}` : '⚖ Checagem'), h('span', { class: 'muted' }, issues.length ? `${issues.length} ponto(s)` : 'tudo certo ✓')),
      ...issues.map((i) => h('div', { class: `rev-item lv-${i.level}` }, h('span', { class: `pill ${LV[i.level][1]}` }, LV[i.level][0]),
        h('div', {}, h('b', {}, i.title), i.quote ? h('span', { class: 'mono', style: 'font-size:12.5px' }, ` “${i.quote}”`) : null, h('span', { class: 'muted' }, i.detail)))));
  }

  // ── status + o que o cliente pediu
  const head = [];
  if (post.script) head.push(h('div', { style: 'display:flex;gap:10px;align-items:center;flex-wrap:wrap' },
    h('span', { class: `pill ${SCRIPT_PILL[s0.status] || 'st-draft'}` }, SCRIPT_STATUS[s0.status] || 'Roteiro'),
    s0.decided_at && ['approved', 'changes'].includes(s0.status) ? h('span', { class: 'muted', style: 'font-size:13px' }, `decidido em ${fmtDate(s0.decided_at, S.tz)} ${fmtTime(s0.decided_at, S.tz)}`) : null,
    s0.status === 'sent' && s0.sent_at ? h('span', { class: 'muted', style: 'font-size:13px' }, `enviado em ${fmtDate(s0.sent_at, S.tz)}`) : null));
  if (s0.status === 'changes' && (s0.feedback || s0.feedback_audio)) head.push(h('div', { class: 'feedback' }, h('b', {}, 'O cliente pediu:'),
    s0.feedback && s0.feedback !== '🎤 Pedido por áudio' ? h('span', {}, s0.feedback) : null,
    s0.feedback_audio ? h('div', { class: 'fb-audio' }, h('span', {}, '🎤 Áudio do cliente'), h('audio', { controls: true, preload: 'metadata', src: `/api/pasta?r=files&id=${s0.feedback_audio}&open=1` })) : null));
  if (s0.status === 'sent' && c) head.push(h('div', { class: 'card', style: 'gap:10px;padding:14px' }, h('b', {}, `Avisar ${c.name}`),
    h('div', { class: 'actions' },
      c.contact_whatsapp ? h('a', { class: 'btn wa sm', href: waLink(c.contact_whatsapp, scriptMessage(c, post)), target: '_blank', rel: 'noopener' }, 'WhatsApp') : null,
      h('button', { class: 'btn sm', type: 'button', onclick: () => copyText(scriptMessage(c, post), 'Mensagem com o link copiada.') }, 'Copiar mensagem'))));

  const body = [
    ...head,
    can('ia') ? h('div', { class: 'card sc-gen', style: 'gap:10px;padding:14px' },
      h('b', {}, '✨ Escrever com IA'),
      h('div', { class: 'field' }, h('label', { for: 's-topic' }, 'Tema do vídeo'), topic),
      h('div', { class: 'two' }, h('div', { class: 'field' }, h('label', { for: 's-tpl' }, 'Modelo'), tpl), h('div', { class: 'field' }, h('label', { for: 's-dur' }, 'Duração'), dur)),
      h('div', { class: 'field' }, h('label', { for: 's-extra' }, 'Pedido extra'), extra),
      h('span', { class: 'hint' }, `Usa a aba Marca de ${c?.name || 'cliente'}, os ganchos que já funcionaram${rules ? ` e as regras do ${rules.name}` : ''}.`),
      genBtn, aiOut) : h('div', { class: 'two' }, h('div', { class: 'field' }, h('label', { for: 's-tpl' }, 'Modelo'), tpl), h('div', { class: 'field' }, h('label', { for: 's-dur' }, 'Duração'), dur)),
    h('div', { class: 'field' }, h('div', { style: 'display:flex;align-items:center;gap:8px' }, h('span', { class: 'label', style: 'flex:1' }, 'Gancho (0 a 3 segundos)'), bankBtn),
      h('span', { class: 'hint' }, 'Marque o que vai ser gravado. O cliente só vê o escolhido.'), hookBox, bankBox),
    h('div', { class: 'field' }, h('div', { style: 'display:flex;align-items:center;gap:8px' }, h('span', { class: 'label', style: 'flex:1' }, 'Cenas'), totalEl), sceneBox, h('div', {}, addScene)),
    h('div', { class: 'field' }, h('label', { for: 's-cta' }, 'Chamada final (CTA)'), cta),
    h('div', { class: 'two' }, h('div', { class: 'field' }, h('label', { for: 's-cover' }, 'Capa'), cover), h('div', { class: 'field' }, h('label', { for: 's-audio' }, 'Trilha'), audio)),
    h('div', { class: 'field' }, h('label', { for: 's-cap' }, 'Legenda sugerida'), cap,
      h('button', { class: 'btn ghost sm', type: 'button', style: 'justify-self:start', onclick: () => cap.value.trim() ? copyText(cap.value, 'Legenda copiada. Cole no post quando o vídeo estiver pronto.') : toast('A legenda está vazia.', true) }, 'Copiar legenda')),
    h('div', { class: 'field' }, h('label', { for: 's-notes' }, 'Notas da gravação (só a equipe)'), notes),
    checkBox,
    rules ? h('details', { class: 'sc-rules' }, h('summary', {}, `Ver as regras do ${rules.name}`), h('p', { class: 'muted', style: 'margin:6px 0' }, `${rules.summary}. Resumo para orientar a equipe; não substitui o código de ética.`),
      h('ul', {}, ...rules.rules.map((r) => h('li', {}, r)))) : niche ? null : h('p', { class: 'hint muted', style: 'margin:0' }, 'Defina o nicho do cliente na aba Marca para ligar as regras de publicidade (dentista, saúde, advocacia…).'),
    post.script && ['sent', 'approved'].includes(s0.status) ? h('p', { class: 'hint muted', style: 'margin:0;font-size:13px' }, 'Mudar o roteiro depois de enviado volta para escrita: reenvie para o cliente aprovar a versão nova.') : null,
  ];

  async function save(sendIt) {
    const data = collect();
    if (!data.hooks.some((x) => x.trim()) && !data.scenes.some((x) => x.say || x.show)) return toast('O roteiro está vazio. Escreva ou gere com IA.', true);
    if (sendIt && issues.some((i) => i.level === 'erro')) { checkBox.scrollIntoView({ behavior: 'smooth', block: 'center' }); return toast('Tem um ponto proibido pelas regras do nicho. Corrija antes de enviar.', true); }
    if (sendIt && !data.hooks[data.hook]?.trim()) return toast('Escreva o gancho escolhido antes de enviar.', true);
    // ganchos vazios saem, mantendo o escolhido
    const keep = data.hooks.map((x, i) => [x.trim(), i]).filter(([x]) => x);
    data.hook = Math.max(0, keep.findIndex(([, i]) => i === data.hook));
    data.hooks = keep.map(([x]) => x);
    btns.forEach((b) => (b.disabled = true));
    try {
      const saved = await api('/api/pasta?r=script', { method: 'PUT', body: { post_id: post.id, script: data, send: sendIt } });
      upsert(saved); close();
      toast(sendIt ? 'Roteiro enviado. O cliente já vê no link de aprovação.' : saved.script.status === 'draft' && ['sent', 'approved'].includes(s0.status) ? 'Salvo. Voltou para escrita: reenvie ao cliente.' : 'Roteiro salvo.');
      if (sendIt) openScript(saved);
    } catch (e) { toast(e.message, true); btns.forEach((b) => (b.disabled = false)); }
  }
  const B = (label, cls, fn) => h('button', { class: `btn ${cls}`, type: 'button', onclick: fn }, label);
  let foot = [
    post.script && can('apagar') ? confirmButton('Apagar roteiro', 'Confirmar', async () => { upsert(await api(`/api/pasta?r=script&post_id=${post.id}`, { method: 'DELETE' })); close(); toast('Roteiro apagado.'); }) : null,
    h('span', { class: 'spacer' }),
    B('Voltar ao post', 'ghost', () => { close(); openPost(S.posts.find((x) => x.id === post.id) || post); }),
    B('Salvar', '', () => save(false)),
    can('enviar') ? B(s0.status === 'changes' ? 'Salvar e reenviar' : s0.status === 'sent' ? 'Reenviar ao cliente' : 'Enviar ao cliente', 'primary', () => save(true)) : null,
  ].filter(Boolean);
  if (!can('conteudo')) foot = [h('span', { class: 'muted' }, 'Só leitura: sem permissão para editar.')];
  const btns = foot.filter((b) => b instanceof HTMLButtonElement);
  drawHooks(); drawScenes(); check();
  const close = drawer(`Roteiro · ${post.title || 'vídeo'}`, body, foot);
  document.querySelector('.drawer')?.classList.add('wide');
}

function upsert(p, rerender = true) {
  for (const arr of [S.posts, S.cal.posts]) {
    const i = arr.findIndex((x) => x.id === p.id);
    if (i >= 0) arr[i] = { ...arr[i], ...p }; else if (arr === S.posts) arr.push(p);
  }
  if (S.cal.month && p.scheduled_at && monthOf(p.scheduled_at) === S.cal.month && !S.cal.posts.some((x) => x.id === p.id)) S.cal.posts.push(p);
  const t = (x) => (x.scheduled_at ? new Date(x.scheduled_at).getTime() : Infinity);
  S.posts.sort((a, b) => t(a) - t(b));
  if (rerender) render();
}

// ───────────────────────── avisar o cliente (WhatsApp / e-mail)
function approvalMessage(c) {
  return `Olá! Os posts de ${c.name} estão prontos para sua aprovação:\n${c.approval_url}\n\nÉ só abrir, ver cada post e tocar em Aprovar ou Pedir ajuste. Depois de aprovado, ele publica sozinho no horário. 🙂`;
}
const approvalSubject = (c) => `Posts de ${c.name} para aprovação`;

function notifyBox(c) {
  if (!c) return null;
  return h('div', { class: 'card', style: 'gap:10px;padding:14px' },
    h('b', {}, `Avisar ${c.name}`),
    h('span', { class: 'muted', style: 'font-size:13.5px' }, 'Todos os posts aguardando aparecem no link fixo do cliente.'),
    h('div', { class: 'actions' },
      c.contact_whatsapp ? h('a', { class: 'btn wa sm', href: waLink(c.contact_whatsapp, approvalMessage(c)), target: '_blank', rel: 'noopener' }, 'WhatsApp') : null,
      h('a', { class: 'btn sm', href: mailLink(c.contact_email, approvalSubject(c), approvalMessage(c)) }, 'E-mail'),
      h('button', { class: 'btn sm', type: 'button', onclick: () => copyText(approvalMessage(c), 'Mensagem com o link copiada.') }, 'Copiar mensagem')));
}

function maybeNotify(posts) {
  const ids = [...new Set(posts.map((p) => p.client_id))];
  const boxes = ids.map((id) => notifyBox(clientById(id))).filter(Boolean);
  if (!boxes.length) return;
  drawer(ids.length > 1 ? 'Avisar os clientes' : `Avisar ${clientName(ids[0])}`,
    [...boxes, h('p', { class: 'muted', style: 'margin:0' }, 'Dica: envie vários posts para aprovação e avise o cliente uma vez só. O link sempre mostra tudo o que está pendente.')], []);
}

// ───────────────────────── clientes
function viewClients() {
  const out = [h('div', { class: 'page-head' },
    h('div', {}, h('div', { class: 'eyebrow' }, `${S.clients.length} de 10 clientes`), h('h1', {}, 'Clientes')),
    h('div', { class: 'spacer' }),
    can('clientes') && !S.limitClients ? h('button', { class: 'btn primary', onclick: () => openClient() }, '+ Novo cliente') : null)];
  if (!S.clients.length) {
    out.push(h('div', { class: 'empty' }, h('h3', {}, 'Nenhum cliente ainda'),
      h('p', { class: 'muted' }, 'Cadastre o cliente, conecte o Instagram dele e mande o link de aprovação.'),
      h('button', { class: 'btn primary', onclick: () => openClient() }, '+ Novo cliente')));
    return out;
  }
  out.push(chargesCard(), approvalReminders(), requestsInbox(), h('div', { class: 'grid-clients' }, ...S.clients.map(cardClient)));
  return out.filter(Boolean);
}

function cardClient(c) {
  const pend = S.posts.filter((p) => p.client_id === c.id && p.status === 'pending_approval').length;
  const exp = c.ig_token_expires_at ? Math.round((new Date(c.ig_token_expires_at) - Date.now()) / 86400e3) : null;
  const expired = exp !== null && exp <= 0;
  const ig = !c.ig_connected ? h('span', { class: 'ig-off' }, 'Não conectado')
    : expired ? h('span', { class: 'ig-off' }, `@${c.ig_username} · conexão expirou`)
    : h('span', { class: exp !== null && exp < 5 ? 'ig-warn' : 'ig-ok' }, `@${c.ig_username || 'conectado'}`);
  return h('article', { class: 'card' },
    h('h3', { class: 'client-name' }, c.name),
    h('div', { class: 'card-tags' },
      pend ? h('span', { class: 'pill st-pending_approval' }, `${pend} aguardando`) : null,
      lateCount(c) ? h('span', { class: 'pill st-failed', title: 'Mensalidades vencidas sem pagamento' }, `${lateCount(c)} em atraso`) : null,
      c.portal_url ? h('span', { class: `pill ${c.brand_kit?.onboarding?.submitted_at ? 'st-approved' : 'st-draft'}`, title: 'Questionário de onboarding' }, c.brand_kit?.onboarding?.submitted_at ? 'Onboarding ✓' : 'Onboarding pendente') : null),
    deliveryLine(c.id),
    h('dl', { class: 'kv' },
      h('dt', {}, 'Instagram'), h('dd', {}, ig),
      h('dt', {}, 'WhatsApp'), h('dd', {}, c.contact_whatsapp ? `+${c.contact_whatsapp}` : h('span', { class: 'muted' }, '—')),
      h('dt', {}, 'E-mail'), h('dd', {}, c.contact_email || h('span', { class: 'muted' }, '—')),
      h('dt', {}, 'Tom de voz'), h('dd', {}, c.brand_voice ? h('span', { class: 'clamp2' }, c.brand_voice) : h('span', { class: 'muted' }, '— (usado pela IA)'))),
    h('div', { class: 'field' }, h('span', { class: 'eyebrow' }, 'Link fixo de aprovação'),
      h('div', { class: 'linkbox' }, h('code', { translate: 'no' }, c.approval_url), h('button', { class: 'btn sm', onclick: () => copyText(c.approval_url, 'Link copiado.') }, 'Copiar'))),
    h('div', { class: 'actions' },
      c.ig_connected && !expired || !can('clientes') ? null : h('a', { class: 'btn primary sm', href: `/api/ig/connect?client=${c.id}` }, c.ig_connected ? 'Reconectar Instagram' : 'Conectar Instagram'),
      c.contact_whatsapp ? h('a', { class: 'btn wa sm', href: waLink(c.contact_whatsapp, approvalMessage(c)), target: '_blank', rel: 'noopener' }, 'WhatsApp') : null,
      c.contact_email ? h('a', { class: 'btn sm', href: mailLink(c.contact_email, approvalSubject(c), approvalMessage(c)) }, 'E-mail') : null,
      folderTabsFor().length ? h('a', { class: 'btn sm', href: `#pasta/${c.id}` }, can('financeiro') ? '🔒 Pasta' : 'Marca e pedidos') : null,
      can('clientes') ? h('button', { class: 'btn sm', onclick: () => openClient(c) }, 'Editar') : null));
}

function openClient(c = null) {
  const name = h('input', { type: 'text', id: 'c-name', value: c?.name || '', placeholder: 'Ex.: Padaria Pão Quente', required: true });
  const wa = h('input', { type: 'tel', id: 'c-wa', value: c?.contact_whatsapp ? c.contact_whatsapp.replace(/^55/, '') : '', placeholder: '65 99999-9999', inputmode: 'tel' });
  const email = h('input', { type: 'email', id: 'c-email', value: c?.contact_email || '', placeholder: 'cliente@empresa.com.br' });
  const voice = h('textarea', { id: 'c-voice', style: 'min-height:90px', placeholder: 'Ex.: Linguagem jovem e de rua, gírias de funk, frases curtas de atitude. Nada de palavrão. Público 18–30.' }, c?.brand_voice || '');
  const body = [
    h('div', { class: 'field' }, h('label', { for: 'c-name' }, 'Nome do cliente'), name),
    h('div', { class: 'field' }, h('label', { for: 'c-wa' }, 'WhatsApp de quem aprova'), wa, h('span', { class: 'hint' }, 'Com DDD. Usado no botão de WhatsApp.')),
    h('div', { class: 'field' }, h('label', { for: 'c-email' }, 'E-mail de quem aprova'), email, h('span', { class: 'hint' }, 'Usado no botão de e-mail.')),
    h('div', { class: 'field' }, h('label', { for: 'c-voice' }, 'Tom de voz da marca'), voice, h('span', { class: 'hint' }, 'A IA usa isto para escrever legendas no jeito da marca.')),
  ];
  if (c) {
    body.push(h('div', { class: 'card', style: 'gap:10px;padding:14px' }, h('b', {}, 'Instagram'),
      c.ig_connected ? h('span', {}, `Conectado como @${c.ig_username}. A conexão é renovada sozinha a cada 50 dias.`) : h('span', { class: 'muted' }, 'Ainda não conectado.'),
      h('div', { class: 'actions' },
        h('a', { class: 'btn sm', href: `/api/ig/connect?client=${c.id}` }, c.ig_connected ? 'Reconectar' : 'Conectar Instagram'),
        c.ig_connected ? confirmButton('Desconectar', 'Confirmar', async () => { await saveClient({ disconnect_instagram: true }); }, 'btn ghost sm') : null)));
    body.push(h('div', { class: 'card', style: 'gap:10px;padding:14px' }, h('b', {}, 'Link de aprovação'),
      h('span', { class: 'muted', style: 'font-size:13.5px' }, 'Se o link vazou ou mudou quem aprova, gere um novo. O antigo para de funcionar.'),
      h('div', { class: 'actions' }, confirmButton('Gerar link novo', 'Confirmar: o antigo deixa de abrir', async () => { await saveClient({ new_approval_link: true }); toast('Link novo gerado.'); }, 'btn sm'))));
  }
  async function saveClient(extra = {}) {
    const payload = { name: name.value, contact_whatsapp: wa.value, contact_email: email.value, brand_voice: voice.value, ...extra };
    try {
      const saved = c ? await api(`/api/clients?id=${c.id}`, { method: 'PATCH', body: payload }) : await api('/api/clients', { method: 'POST', body: payload });
      const i = S.clients.findIndex((x) => x.id === saved.id);
      if (i >= 0) S.clients[i] = saved; else S.clients.push(saved);
      S.clients.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
      close(); render();
      if (!c) toast('Cliente criado. Agora conecte o Instagram dele.');
    } catch (e) { toast(e.message, true); }
  }
  const foot = [];
  if (c) foot.push(confirmButton('Remover cliente', 'Confirmar: apaga posts e a pasta dele', async () => {
    await api(`/api/clients?id=${c.id}`, { method: 'DELETE' });
    S.clients = S.clients.filter((x) => x.id !== c.id); S.posts = S.posts.filter((p) => p.client_id !== c.id);
    close(); render(); toast('Cliente removido.');
  }), h('span', { class: 'spacer' }));
  foot.push(h('button', { class: 'btn primary', onclick: () => saveClient() }, c ? 'Salvar' : 'Criar cliente'));
  const close = drawer(c ? c.name : 'Novo cliente', body, foot);
  name.focus();
}

// ───────────────────────── ajustes (estado da instalação)
function setupPending() {
  const st = S.setup; if (!st) return [];
  const out = [];
  if (st.missing_env?.length) out.push(`variáveis ${st.missing_env.join(', ')} na Vercel`);
  if (st.key_problem) out.push('chave do Supabase errada (use a secreta)');
  if (st.migration_sql) out.push('atualização do banco de dados');
  if (!st.ig_ready) out.push('app da Meta (Instagram)');
  if (st.cron_sql && !st.publisher_last_run) out.push('agendador automático');
  return out;
}

function viewSettings() {
  const st = S.setup || {};
  const ago = st.publisher_last_run ? Math.round((Date.now() - new Date(st.publisher_last_run)) / 60000) : null;
  const ok = (cond, yes, no) => h('span', { class: cond ? 'ig-ok' : 'ig-warn' }, cond ? `✓ ${yes}` : `• ${no}`);
  // shown = o que aparece na tela (pode esconder segredos); o botão copia o texto completo
  const codeBox = (text, label, shown = text) => h('div', { style: 'display:grid;gap:8px' },
    h('pre', { class: 'mono notranslate', translate: 'no', style: 'margin:0;white-space:pre-wrap;overflow-wrap:anywhere;background:var(--surface-2);border:1px solid var(--line);border-radius:10px;padding:12px;font-size:12.5px;max-height:260px;overflow:auto' }, shown),
    h('button', { class: 'btn sm', style: 'justify-self:start', onclick: () => copyText(text, `${label} copiado.`) }, `Copiar ${label}`));
  return [
    h('div', { class: 'page-head' }, h('div', {}, h('div', { class: 'eyebrow' }, 'Instalação'), h('h1', {}, 'Ajustes'))),
    st.migration_sql ? h('article', { class: 'card', style: 'border-color:var(--s-wait)' },
      h('div', { class: 'eyebrow' }, 'Atualização necessária'),
      h('h3', {}, 'Atualizar o banco de dados'),
      h('span', { class: 'muted', style: 'font-size:14px' }, 'As novidades (Fluxo, ideias sem data, tom de voz da IA) precisam de uma atualização no banco. No Supabase, abra SQL Editor → New query, cole o comando e clique em Run. Leva 1 segundo e não apaga nada.'),
      codeBox(st.migration_sql, 'comando')) : null,
    h('div', { class: 'grid-clients' },
      h('article', { class: 'card' },
        h('div', { class: 'eyebrow' }, 'Etapa 2 · App no ar'),
        h('h3', {}, 'Endereço e banco de dados'),
        ok(!st.missing_env?.length && !st.key_problem, 'Banco de dados e senha configurados', st.key_problem ? 'Chave do Supabase errada' : `Faltam: ${(st.missing_env || []).join(', ')}`),
        st.key_problem ? h('div', { class: 'errorbox' }, st.key_problem) : null,
        st.app_url ? h('div', { class: 'linkbox' }, h('code', { translate: 'no' }, st.app_url), h('button', { class: 'btn sm', onclick: () => copyText(st.app_url, 'Endereço copiado.') }, 'Copiar')) : null),
      h('article', { class: 'card' },
        h('div', { class: 'eyebrow' }, 'Etapa 3 · Meta'),
        h('h3', {}, 'App do Instagram'),
        ok(st.ig_ready, 'IG_APP_ID e IG_APP_SECRET configurados', 'Falta colocar IG_APP_ID e IG_APP_SECRET na Vercel'),
        h('span', { class: 'muted', style: 'font-size:14px' }, 'Cole este endereço em "URLs de redirecionamento OAuth" no app da Meta:'),
        st.redirect_uri ? codeBox(st.redirect_uri, 'endereço') : null,
        st.app_url ? h('details', { class: 'meta-urls' },
          h('summary', {}, 'Links para a revisão da Meta'),
          st.legal_missing?.length ? h('div', { class: 'errorbox' }, `Preencha em "Dados da agência" (abaixo): ${st.legal_missing.join(', ')}. Esses dados aparecem na Política de Privacidade que a Meta confere.`) : null,
          h('span', { class: 'muted', style: 'font-size:14px' }, 'Política de privacidade:'), codeBox(`${st.app_url}/privacidade`, 'link'),
          h('span', { class: 'muted', style: 'font-size:14px' }, 'Termos de uso:'), codeBox(`${st.app_url}/termos`, 'link'),
          h('span', { class: 'muted', style: 'font-size:14px' }, 'Instruções de exclusão de dados:'), codeBox(`${st.app_url}/exclusao-de-dados`, 'link'),
          h('span', { class: 'muted', style: 'font-size:14px' }, 'URL de cancelamento de autorização (Deauthorize callback):'), codeBox(`${st.app_url}/api/pasta?r=igdeauth`, 'link'),
          h('span', { class: 'muted', style: 'font-size:14px' }, 'URL de solicitação de exclusão de dados (Data deletion request):'), codeBox(`${st.app_url}/api/pasta?r=igdelete`, 'link'),
          h('span', { class: 'muted', style: 'font-size:14px' }, 'Ícone do app 1024×1024:'), h('a', { class: 'btn sm', href: '/icons/app-icon-1024.png', download: 'mc-digital-1024.png' }, 'Baixar ícone')) : null),
      h('article', { class: 'card' },
        h('div', { class: 'eyebrow' }, 'Inteligência Artificial'),
        h('h3', {}, 'Legendas e hashtags com IA'),
        ok(st.ai_ready, 'IA ligada', 'IA desligada'),
        st.ai_ready
          ? h('span', { class: 'muted', style: 'font-size:14px' }, 'No post, clique em "✨ Legenda com IA". A IA lê a imagem e o tom de voz do cliente e sugere 3 legendas com hashtags.')
          : h('ol', { style: 'margin:0;padding-left:18px;display:grid;gap:6px;font-size:14px' },
              h('li', {}, 'Crie uma conta em console.anthropic.com e adicione créditos (o uso é cobrado por legenda gerada; você define um limite de gasto).'),
              h('li', {}, 'Em API Keys, clique em Create Key e copie a chave.'),
              h('li', {}, 'Na Vercel, adicione a variável ANTHROPIC_API_KEY com essa chave e faça Redeploy.'))),
      h('article', { class: 'card', style: 'grid-column:1/-1' },
        h('div', { class: 'eyebrow' }, 'Etapa 4 · Agendador'),
        h('h3', {}, 'Publicação automática a cada 5 minutos'),
        st.publisher_last_run
          ? ok(ago <= 15, `Funcionando · última execução há ${ago} min`, `Última execução há ${ago} min — confira o agendador no Supabase`)
          : ok(false, '', 'Ainda não configurado'),
        st.publisher_state_error ? h('div', { class: 'errorbox', translate: 'no' }, h('b', {}, 'Detalhe técnico: '), st.publisher_state_error) : null,
        st.cron_sql
          ? (() => {
              // o código secreto nunca aparece na tela; "Copiar comando" leva o texto completo
              const box = [h('span', { class: 'muted', style: 'font-size:14px' }, 'No Supabase, abra SQL Editor → New query, cole o comando abaixo e clique em Run. Ele já vem com o seu endereço e o código secreto (escondido na tela); não precisa mudar nada.'),
                codeBox(st.cron_sql, 'comando', st.cron_sql.replace(/Bearer [^']+/, 'Bearer ••••••••••••'))];
              return ago != null && ago <= 15 ? h('details', {}, h('summary', { class: 'muted', style: 'cursor:pointer;font-size:14px' }, 'Ver o comando do agendador'), ...box) : box;
            })()
          : h('span', { class: 'muted' }, 'Aparece aqui depois que o banco de dados estiver configurado.'),
        h('button', { class: 'btn sm', style: 'justify-self:start', onclick: async () => { const s = await api('/api/session'); S.setup = s.setup; render(); toast('Atualizado.'); } }, 'Verificar de novo')),
    ),
    ...settingsPrivacy(),
    ...settingsDiag(),
    ...settingsOnboarding(),
    ...settingsDevice(),
    ...settingsSecurity(),
    ...settingsMail(),
    ...settingsBackup(),
    ...settingsTeam(),
    ...settingsPix(),
    ...settingsContract(),
  ];
}

// Ajustes → dados da agência e modelo de contrato
function settingsContract() {
  if (S.settings === undefined) {
    S.settings = null;
    api('/api/pasta?r=settings').then((v) => { S.settings = v; }).catch(() => { S.settings = false; }).finally(() => { if (S.view === 'ajustes') render(); });
  }
  const head = h('div', { class: 'page-head', style: 'margin-top:12px' }, h('div', {}, h('div', { class: 'eyebrow' }, 'Pastas dos clientes'), h('h2', { style: 'font-size:22px' }, 'Contrato')));
  if (!S.settings) return [head, h('p', { class: 'muted' }, S.settings === false ? 'Disponível depois da atualização do banco de dados.' : 'Carregando…')];
  const A = S.settings.agency || {};
  const fields = [['razao_social', 'Razão social (como no CNPJ)', '00.000.000 NOME COMPLETO'], ['qualificacao', 'Tipo da empresa', 'Empresária Individual'],
    ['cnpj', 'CNPJ', '00.000.000/0001-00'], ['endereco', 'Endereço completo', 'Rua, número, bairro, Cuiabá/MT, CEP 00.000-000'],
    ['cidade', 'Cidade/UF (foro e assinatura)', 'Cuiabá/MT'], ['representante', 'Representante legal (quem assina)', 'Nome completo'],
    ['representante_cpf', 'CPF do representante', '000.000.000-00'], ['email', 'E-mail', 'contato@…'], ['pix', 'Chave PIX', ''],
    ['marca', 'Marca no rodapé do contrato', 'MCAROLINA DIGITAL'], ['slogan', 'Linha abaixo da marca', 'SOCIAL MEDIA | VIDEO MAKER']];
  const inputs = {};
  const agencyCard = h('article', { class: 'card', style: 'grid-column:1/-1' },
    h('div', { class: 'eyebrow' }, 'Contratada'), h('h3', {}, 'Dados da agência'),
    h('span', { class: 'muted', style: 'font-size:13.5px' }, 'Use os dados do CNPJ que vai assinar os contratos. Entram em todos os contratos gerados.'),
    h('div', { class: 'grid-2 tight' }, ...fields.map(([k, label, ph]) => { inputs[k] = h('input', { id: `ag-${k}`, value: A[k] || '', placeholder: ph }); return h('div', { class: 'field' }, h('label', { for: `ag-${k}` }, label), inputs[k]); })),
    h('button', { class: 'btn primary sm', style: 'justify-self:start', onclick: async (e) => {
      e.target.disabled = true;
      try { S.settings = await api('/api/pasta?r=settings', { method: 'PUT', body: { agency: Object.fromEntries(Object.entries(inputs).map(([k, el]) => [k, el.value])) } }); S.folder.id = null; toast('Dados da agência salvos.'); render(); }
      catch (err) { toast(err.message, true); e.target.disabled = false; }
    } }, 'Salvar dados'));
  const ta = h('textarea', { id: 'tpl', class: 'mono tpl', spellcheck: 'false', translate: 'no', value: S.settings.contract_template });
  const insert = (key) => {
    const tag = `{{${key}}}`; const a = ta.selectionStart ?? ta.value.length;
    ta.setRangeText(tag, a, ta.selectionEnd ?? a, 'end'); ta.focus();
  };
  const tplCard = h('article', { class: 'card', style: 'grid-column:1/-1' },
    h('div', { class: 'eyebrow' }, S.settings.template_is_default ? 'Modelo padrão MC Digital' : 'Modelo personalizado'), h('h3', {}, 'Modelo de contrato'),
    h('span', { class: 'muted', style: 'font-size:13.5px' }, 'O modelo padrão é o contrato da MC Digital (quadro resumo, 19 cláusulas, marca-d\'água e rodapé). Os campos entre {{ }} são preenchidos com os dados do cliente. "# " vira o cabeçalho de todas as páginas, "## " vira cláusula, **texto** fica destacado, linhas com "|" viram tabela, ">> " alinha à direita, {{assinaturas}} cria as assinaturas, {{se campo}}…{{fim}} só aparece quando o campo está preenchido e o bloco "!rodape" define o rodapé.'),
    h('div', { class: 'pick tpl-fields' }, ...Object.entries({ ...S.settings.fields, assinaturas: 'Linhas de assinatura' }).map(([k, label]) =>
      h('button', { class: 'chip', type: 'button', title: label, onclick: () => insert(k) }, label))),
    ta,
    h('div', { class: 'actions' },
      h('label', { class: 'btn sm', style: 'cursor:pointer' }, 'Carregar de arquivo .txt',
        h('input', { type: 'file', accept: '.txt,text/plain', hidden: true, onchange: async (e) => {
          const f = e.target.files[0]; if (!f) return;
          ta.value = await f.text(); toast('Modelo carregado. Confira e clique em Salvar modelo.');
        } })),
      h('button', { class: 'btn primary sm', onclick: async (e) => {
        e.target.disabled = true;
        try { S.settings = await api('/api/pasta?r=settings', { method: 'PUT', body: { contract_template: ta.value } }); S.folder.id = null; toast('Modelo salvo. Os próximos contratos já saem com ele.'); render(); }
        catch (err) { toast(err.message, true); e.target.disabled = false; }
      } }, 'Salvar modelo'),
      S.settings.template_is_default ? null : confirmButton('Voltar ao modelo padrão', 'Confirmar: apaga o modelo personalizado', async () => {
        S.settings = await api('/api/pasta?r=settings', { method: 'PUT', body: { contract_template: '' } }); render(); toast('Modelo padrão restaurado.');
      }, 'btn ghost sm')));
  return [head, h('div', { class: 'grid-clients' }, agencyCard, tplCard)];
}

// ───────────────────────── pasta privada do cliente (contrato, financeiro, relatórios)
const FOLDER_TABS = [['contract', 'Contrato'], ['finance', 'Financeiro'], ['report', 'Relatórios'], ['history', 'Aprovações'], ['requests', 'Pedidos'], ['brand', 'Marca'], ['media', 'Banco de mídia'], ['snippets', 'Modelos'], ['other', 'Outros']];
const TEAM_TABS = ['requests', 'brand', 'media', 'snippets'];
// seções da pasta que a pessoa pode abrir
function folderTabsFor() {
  if (can('financeiro')) return FOLDER_TABS.map(([k]) => k);
  const out = [];
  if (can('relatorios')) out.push('report', 'history');
  if (can('marca')) out.push('requests', 'brand', 'media', 'snippets');
  else if (can('conteudo')) out.push('media', 'snippets');
  return FOLDER_TABS.map(([k]) => k).filter((k) => out.includes(k));
}
const ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx,.csv,.txt';
const todayLocal = () => partsInTz(new Date().toISOString(), S.tz).date;
const nextMonth = (m) => shiftMonth(m, 1);

// Situação de cada mês (com parcelas) — mesma regra do servidor e da área do cliente (/billing.js)
const billingMonths = (c) => billingMonthsShared(c, S.payments.filter((p) => p.client_id === c.id), todayLocal());
const lateCount = (c) => billingMonths(c).filter((m) => m.status === 'late').length;
const PAY_LABEL = { paid: ['Pago', 'st-approved'], waived: ['Isento', 'st-draft'], open: ['Em aberto', 'st-pending_approval'], late: ['Atrasado', 'st-failed'] };

async function loadFolder(id) {
  if (!can('financeiro')) { // equipe: só as seções liberadas
    try {
      const [files, reports] = await Promise.all([api(`/api/pasta?r=files&client=${id}`).catch(() => []), can('relatorios') ? api(`/api/pasta?r=reports&client=${id}`).catch(() => null) : null]);
      Object.assign(S.folder, { files, reports, error: null });
    } catch (e) { S.folder.error = e.message; }
    S.folder.loading = false; if (!folderTabsFor().includes(S.folder.tab)) S.folder.tab = folderTabsFor()[0] || 'requests';
    if (S.view === 'pasta' && S.folderId === id) render();
    return;
  }
  try {
    const [files, payments, preview, reports] = await Promise.all([
      api(`/api/pasta?r=files&client=${id}`), api('/api/pasta?r=payments'), api(`/api/pasta?r=contract&client=${id}`),
      api(`/api/pasta?r=reports&client=${id}`).catch(() => null)]); // null = falta a atualização 4 do banco
    Object.assign(S.folder, { files, preview, reports, loading: false, error: null }); S.payments = payments;
  } catch (e) {
    Object.assign(S.folder, { loading: false, error: e.message });
  }
  if (S.view === 'pasta' && S.folderId === id) render();
}

function viewFolder() {
  const c = clientById(S.folderId);
  if (!c) return [h('div', { class: 'empty' }, h('h3', {}, 'Cliente não encontrado'), h('a', { class: 'btn', href: '#clientes' }, 'Voltar para Clientes'))];
  const F = S.folder;
  if (F.id !== c.id) { Object.assign(F, { id: c.id, files: [], preview: null, loading: true, error: null }); loadFolder(c.id); }
  const count = (cat) => F.files.filter((f) => f.category === cat).length;
  const late = lateCount(c);
  const head = h('div', { class: 'page-head' },
    h('div', {}, h('a', { class: 'eyebrow back', href: '#clientes' }, '← Clientes'), h('h1', {}, c.name)),
    h('div', { class: 'spacer' }),
    h('div', { class: 'actions' },
      h('span', { class: 'lock', title: 'Os arquivos ficam num cofre privado. Cada link abre por 2 minutos e só com você logado.' }, can('financeiro') ? '🔒 Pasta privada' : '🔒 Pasta do cliente'),
      can('financeiro') ? h('button', { class: `btn sm${c.portal_url ? '' : ' primary'}`, onclick: () => openPortal(c) }, c.portal_url ? '🔗 Link do cliente' : '🔗 Criar link do cliente') : null));
  const tabs = h('div', { class: 'seg folder-tabs', role: 'group', 'aria-label': 'Seções da pasta' },
    ...FOLDER_TABS.filter(([k]) => folderTabsFor().includes(k)).map(([k, l]) => {
      const n = k === 'finance' ? late : k === 'report' ? count('report') + (F.reports?.length || 0)
        : k === 'requests' ? (S.requests || []).filter((r) => r.client_id === c.id && r.status !== 'done').length
        : ['history', 'brand', 'media', 'snippets'].includes(k) ? 0 : count(k);
      return h('button', { class: 'seg-btn', 'aria-pressed': String(F.tab === k), onclick: () => { F.tab = k; render(); } },
        l, n ? h('span', { class: `seg-n${k === 'finance' || k === 'requests' ? ' bad' : ''}` }, String(n)) : null);
    }));
  if (F.loading) return [head, tabs, h('p', { class: 'muted' }, 'Abrindo a pasta…')];
  if (F.error) {
    const needsDb = S.setup?.migration_sql || /client_files|payments|relation|schema cache|bucket/i.test(F.error);
    return [head, h('article', { class: 'card', style: 'border-color:var(--s-wait)' },
      h('h3', {}, needsDb ? 'A pasta precisa da atualização do banco' : 'Não consegui abrir a pasta'),
      h('span', { class: 'muted' }, needsDb ? 'Rode o comando de atualização que aparece em Ajustes (1 segundo, não apaga nada) e volte aqui.' : F.error),
      h('div', { class: 'actions' }, needsDb ? h('a', { class: 'btn primary sm', href: '#ajustes' }, 'Ir para Ajustes') : null,
        h('button', { class: 'btn sm', onclick: () => { F.id = null; render(); } }, 'Tentar de novo')))];
  }
  const body = { contract: folderContract, finance: folderFinance, report: folderReports, other: folderOther, history: folderHistory, brand: folderBrand, requests: folderRequests, media: folderMedia, snippets: folderSnippets }[F.tab](c);
  return [head, deliveryLine(c.id, { big: true }), tabs, ...body];
}

// ── Contrato
function folderContract(c) {
  const P = S.folder.preview || {};
  const k = c.contract_data || {};
  const dd = (v) => (v ? h('dd', {}, v) : h('dd', {}, h('span', { class: 'muted' }, '—')));
  return [
    h('div', { class: 'grid-2' },
      h('article', { class: 'card' },
        h('div', { class: 'eyebrow' }, 'Contrato gerado'),
        h('h3', {}, 'Contrato de prestação de serviços'),
        P.template_is_default ? h('div', { class: 'banner', style: 'font-size:13.5px' }, 'Usando o modelo provisório. Cole o seu modelo em ', h('a', { href: '#ajustes' }, 'Ajustes → Modelo de contrato'), '.') : null,
        P.missing?.length
          ? h('div', { class: 'feedback' }, h('b', {}, `Faltam ${P.missing.length} dado(s) — vão aparecer marcados no contrato:`), h('span', { style: 'font-size:13.5px' }, P.missing.join(' · ')))
          : h('span', { class: 'ig-ok' }, '✓ Todos os dados preenchidos'),
        h('div', { class: 'actions' },
          h('a', { class: 'btn primary', href: `/contrato?client=${c.id}`, target: '_blank', rel: 'noopener' }, 'Gerar PDF do contrato'),
          h('button', { class: 'btn', onclick: () => openContractData(c) }, 'Editar dados')),
        h('span', { class: 'hint muted', style: 'font-size:12.5px' }, 'Abre o contrato pronto. Clique em "Salvar PDF", mande para o cliente assinar (gov.br, Clicksign, D4Sign…) e envie a versão assinada aqui embaixo.')),
      h('article', { class: 'card' },
        h('div', { class: 'eyebrow' }, 'Dados do contrato'),
        h('dl', { class: 'kv' },
          h('dt', {}, 'Contratante'), dd(k.nome || c.name),
          h('dt', {}, 'CPF/CNPJ'), dd(k.documento),
          h('dt', {}, 'Representante'), dd(k.representante),
          h('dt', {}, 'Mensalidade'), dd(c.monthly_fee_cents != null ? `${brl(c.monthly_fee_cents)}${c.due_day ? ` · vence dia ${c.due_day}` : ''}` : ''),
          h('dt', {}, 'Início'), dd(c.billing_start ? fmtDay(c.billing_start) : ''),
          h('dt', {}, 'Prazo'), dd(k.prazo_meses ? `${k.prazo_meses} meses` : '')),
        h('button', { class: 'btn sm', style: 'justify-self:start', onclick: () => openContractData(c) }, 'Editar dados'))),
    filesSection(c, 'contract', 'Contratos assinados e aditivos', 'Envie aqui o PDF assinado pelo cliente.'),
  ];
}
const fmtDay = (iso) => { const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}`; };

function openContractData(c) {
  const k = c.contract_data || {};
  const inp = (id, label, value, attrs = {}, hint) => {
    const el = h(attrs.tag || 'input', { id, value: value ?? '', ...attrs, tag: null });
    if (attrs.tag === 'textarea') el.value = value ?? '';
    return [el, h('div', { class: 'field' }, h('label', { for: id }, label), el, hint ? h('span', { class: 'hint' }, hint) : null)];
  };
  const [nome, fNome] = inp('k-nome', 'Nome ou razão social do contratante', k.nome || c.name);
  const [doc, fDoc] = inp('k-doc', 'CPF ou CNPJ', k.documento, { placeholder: '00.000.000/0001-00' });
  const [end, fEnd] = inp('k-end', 'Endereço completo', k.endereco, { placeholder: 'Rua, número, bairro, cidade/UF, CEP' });
  const [rep, fRep] = inp('k-rep', 'Representante (quem assina)', k.representante, { placeholder: 'Nome completo' });
  const [repCpf, fRepCpf] = inp('k-repcpf', 'CPF do representante', k.representante_cpf, { placeholder: '000.000.000-00' });
  const [qp, fQp] = inp('k-qp', 'Posts de feed por mês (foto + carrossel)', k.quota_posts, { type: 'number', min: 0, max: 999, placeholder: '8' });
  const [qr, fQr] = inp('k-qr', 'Reels por mês', k.quota_reels, { type: 'number', min: 0, max: 999, placeholder: '4' });
  const [qs, fQs] = inp('k-qs', 'Stories por mês (opcional)', k.quota_stories, { type: 'number', min: 0, max: 999, placeholder: '—' });
  const [entr, fEntr] = inp('k-entr', 'Entregas mensais (só sem cota)', k.entregas, { placeholder: 'o contrato usa a cota abaixo: 8 (oito) posts estáticos e 4 (quatro) Reels' });
  const [total, fTotal] = inp('k-total', 'Total de conteúdos/mês (só sem cota)', k.total_conteudos, { type: 'number', min: 1, max: 999, placeholder: 'soma da cota' });
  const [serv, fServ] = inp('k-serv', 'Serviços contratados (opcional)', k.servicos, { tag: 'textarea', style: 'min-height:80px', placeholder: 'Só se o seu modelo usar o campo "Serviços contratados".' });
  const [fee0, fFee] = inp('k-fee', 'Valor mensal (R$)', c.monthly_fee_cents != null ? (c.monthly_fee_cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '', { inputmode: 'decimal', placeholder: '1.500,00' });
  const [due, fDue] = inp('k-due', 'Dia do vencimento', c.due_day, { type: 'number', min: 1, max: 31, placeholder: '10' });
  const [start, fStart] = inp('k-start', 'Início do contrato', c.billing_start, { type: 'date' }, 'A cobrança mensal começa neste mês.');
  // Parcelas da mensalidade (ex.: 3 parcelas nos dias 4, 14 e 24)
  const centsOf = (v) => Math.round(Number(String(v || '').replace(/[R$\s]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.')) * 100);
  const reais = (cts) => (cts / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 });
  let parts = Array.isArray(c.installments) && c.installments.length > 1 ? c.installments.map((x) => ({ ...x })) : [];
  const nSel = h('select', { id: 'k-nparc', 'aria-label': 'Parcelas por mês' }, ...[1, 2, 3, 4].map((n) => h('option', { value: n, selected: (parts.length || 1) === n }, n === 1 ? '1 (à vista)' : `${n} parcelas`)));
  const partsBox = h('div', { class: 'parts' });
  const drawParts = () => {
    const n = Number(nSel.value);
    if (n === 1) { parts = []; partsBox.replaceChildren(); due.disabled = false; return; }
    due.disabled = true;
    const fee = centsOf(fee0.value) || 0;
    if (parts.length !== n) {
      const split = splitCents(fee, n), days = [Number(due.value) || 5, 15, 25, 28].slice(0, n);
      parts = split.map((cents, i) => ({ day: parts[i]?.day || (n === 3 ? [4, 14, 24][i] : days[i] || 10 + i * 10), cents }));
    }
    partsBox.replaceChildren(...parts.map((pt, i) => h('div', { class: 'part-row' },
      h('span', { class: 'muted' }, `${i + 1}ª`),
      h('label', {}, 'dia ', h('input', { type: 'number', min: 1, max: 31, value: pt.day, oninput: (e) => { pt.day = Number(e.target.value); } })),
      h('label', {}, 'R$ ', h('input', { inputmode: 'decimal', value: reais(pt.cents), onchange: (e) => { pt.cents = centsOf(e.target.value); check(); } })))),
      sumNote);
    check();
  };
  const sumNote = h('span', { class: 'hint' });
  const check = () => {
    const sum = parts.reduce((a, b) => a + (b.cents || 0), 0), fee = centsOf(fee0.value) || 0;
    sumNote.textContent = sum === fee ? `Soma ${brl(sum)} ✓` : `Atenção: as parcelas somam ${brl(sum)}, a mensalidade é ${brl(fee)}.`;
    sumNote.style.color = sum === fee ? '' : 'var(--s-fail)';
  };
  nSel.addEventListener('change', () => { parts = []; drawParts(); });
  const fParts = h('div', { class: 'field' }, h('label', { for: 'k-nparc' }, 'Como o cliente paga a mensalidade'), nSel, partsBox,
    h('span', { class: 'hint' }, 'Com parcelas, cada uma aparece no Financeiro com vencimento, status e comprovante próprios.'));
  const [retro, fRetro] = inp('k-retro', 'Substitui um contrato anterior? Início do serviço (opcional)', k.retroativo, { type: 'date' }, 'Preencha só se este contrato substitui outro: entram as cláusulas de retroatividade e de substituição.');
  const [prazo, fPrazo] = inp('k-prazo', 'Prazo (meses, opcional)', k.prazo_meses, { type: 'number', min: 1, max: 120, placeholder: 'vazio = indeterminado' });
  const [forma, fForma] = inp('k-forma', 'Forma de pagamento (opcional)', k.forma_pagamento, { tag: 'textarea', style: 'min-height:70px', placeholder: 'Pix' },
    'Escreva só o meio (Pix, boleto): o contrato monta "Via Pix, em 3 (três) parcelas mensais: R$ … no dia 4; …" com as parcelas acima. Uma frase com valores e dias substitui esse texto.');
  const close = drawer(`Dados do contrato · ${c.name}`, [
    h('div', { class: 'eyebrow' }, 'Contratante'), fNome, fDoc, fEnd, h('div', { class: 'grid-2 tight' }, fRep, fRepCpf),
    h('div', { class: 'eyebrow' }, 'Serviço e cobrança'), h('div', { class: 'grid-2 tight' }, fEntr, fTotal), fServ,
    h('div', { class: 'grid-2 tight' }, fFee, fDue), fParts, h('div', { class: 'grid-2 tight' }, fStart, fPrazo), fRetro, fForma,
    h('div', { class: 'eyebrow' }, 'Cota mensal (contador de entregas)'), h('div', { class: 'grid-2 tight' }, fQp, fQr), fQs,
  ], [h('span', { class: 'spacer' }), h('button', { class: 'btn primary', onclick: async (e) => {
    e.target.disabled = true;
    try {
      const saved = await api(`/api/clients?id=${c.id}`, { method: 'PATCH', body: {
        monthly_fee: fee0.value, due_day: due.value, billing_start: start.value, installments: parts.length > 1 ? parts : (c.installments ? [] : undefined),
        contract_data: { nome: nome.value, documento: doc.value, endereco: end.value, representante: rep.value, representante_cpf: repCpf.value, entregas: entr.value, total_conteudos: total.value, quota_posts: qp.value, quota_reels: qr.value, quota_stories: qs.value, servicos: serv.value, prazo_meses: prazo.value, forma_pagamento: forma.value, retroativo: retro.value },
      } });
      const i = S.clients.findIndex((x) => x.id === saved.id); if (i >= 0) S.clients[i] = saved;
      close(); toast('Dados do contrato salvos.');
      S.folder.preview = await api(`/api/pasta?r=contract&client=${c.id}`).catch(() => S.folder.preview);
      render();
    } catch (err) { toast(err.message, true); e.target.disabled = false; }
  } }, 'Salvar')]);
  drawParts(); fee0.addEventListener('change', () => { if (parts.length) { parts = []; drawParts(); } });
  nome.focus();
}

// ── Financeiro
function folderFinance(c) {
  if (!c.billing_start || c.monthly_fee_cents == null) {
    return [h('div', { class: 'empty' }, h('h3', {}, 'Defina a mensalidade'),
      h('p', { class: 'muted' }, 'Informe o valor, as parcelas/vencimento e o início do contrato. A partir daí cada mês aparece aqui como pago, em aberto ou atrasado.'),
      h('button', { class: 'btn primary', onclick: () => openContractData(c) }, 'Preencher dados'))];
  }
  ensureSettings();
  const months = billingMonths(c);
  const lateCents = months.reduce((s, m) => s + m.late_cents, 0);
  const lateParcels = months.flatMap((m) => m.parcels).filter((p) => p.status === 'late').length;
  const year = todayLocal().slice(0, 4);
  const paidYear = months.filter((m) => m.month.startsWith(year)).flatMap((m) => m.parcels).filter((p) => p.status === 'paid').reduce((s, p) => s + (p.cents || 0), 0);
  const plan = planOf(c);
  const fileName = (id) => S.folder.files.find((f) => f.id === id)?.name;
  const soon = new Set(dueSoon(months, todayLocal()).map((p) => `${p.month}#${p.n}`));
  const parcelChip = (m, p) => {
    const [label, cls] = PAY_LABEL[p.status];
    const pay = p.payment;
    return h('div', { class: `parcel${p.status === 'late' ? ' is-late' : ''}` },
      h('div', { class: 'parcel-top' },
        h('b', {}, p.of > 1 ? `${p.n}ª parcela` : 'Mensalidade'),
        h('span', { class: `pill ${cls}` }, label)),
      h('div', { class: 'muted parcel-sub' }, p.status === 'paid' ? `Pago${pay?.paid_at ? ` em ${fmtDay(pay.paid_at)}` : ''} · ${brl(p.cents)}`
        : p.status === 'waived' ? (pay?.note || 'Isento') : `Vence ${fmtDay(p.due)} · ${brl(p.cents)}`),
      h('div', { class: 'parcel-act' },
        pay?.file_id && fileName(pay.file_id) ? h('a', { class: 'btn ghost sm', href: `/api/pasta?r=files&id=${pay.file_id}&open=1`, target: '_blank', rel: 'noopener', title: fileName(pay.file_id) }, '📎')
          : pay?.receipt_url ? h('a', { class: 'btn ghost sm', href: pay.receipt_url, target: '_blank', rel: 'noopener', title: 'Comprovante do Pix' }, '📎') : null,
        S.setup?.asaas && ['open', 'late'].includes(p.status) ? h('button', { class: 'btn ghost sm', title: 'Gerar Pix com baixa automática', onclick: () => openPix(c, m, p) }, pay?.asaas_id ? 'Pix ✓' : 'Pix') : null,
        pay?.nf_status === 'authorized' ? h('a', { class: 'btn ghost sm', href: pay.nf_url || '#', target: '_blank', rel: 'noopener', title: 'Nota fiscal emitida' }, '🧾 NF')
          : pay?.nf_status === 'scheduled' ? h('span', { class: 'pill st-internal_review', title: 'A nota sai assim que a prefeitura autorizar' }, 'NF agendada')
          : p.status === 'paid' && pay?.asaas_id && S.setup?.asaas ? h('button', { class: `btn ${pay?.nf_status === 'error' ? 'danger ' : 'ghost '}sm`, title: pay?.nf_status === 'error' ? 'A prefeitura recusou: confira em Notas fiscais no Asaas e tente de novo' : 'Emitir nota fiscal desta parcela', onclick: async (e) => {
            e.target.disabled = true;
            try { await api('/api/pasta?r=nf', { method: 'POST', body: { client_id: c.id, month: m.month, n: p.n } }); pay.nf_status = 'scheduled'; toast('Nota fiscal enviada para emissão. O PDF chega na pasta quando a prefeitura autorizar.'); render(); }
            catch (err) { toast(err.message, true); e.target.disabled = false; }
          } }, pay?.nf_status === 'error' ? 'NF: tentar de novo' : 'Emitir NF') : null,
        soon.has(`${m.month}#${p.n}`) ? chargeButton(c, m, p) : null,
        h('button', { class: `btn sm${p.status === 'late' ? ' primary' : ''}`, onclick: () => openPayment(c, m, p) }, p.status === 'paid' || p.status === 'waived' ? 'Editar' : 'Registrar')));
  };
  return [
    h('div', { class: 'stats' },
      stat('Mensalidade', brl(c.monthly_fee_cents), plan.length > 1 ? `${plan.length} parcelas: dias ${plan.map((x) => x.day).join(', ')}` : c.due_day ? `vence todo dia ${c.due_day}` : 'vence no fim do mês'),
      stat('Em atraso', lateCents ? brl(lateCents) : 'Nada', lateParcels ? `${lateParcels} parcela(s)` : 'tudo em dia', lateCents ? 'bad' : 'good'),
      stat(`Recebido em ${year}`, brl(paidYear), 'pela marcação de pagos')),
    bulkOld(c, months),
    h('div', { class: 'months' }, ...months.map((m) => {
      const [label, cls] = PAY_LABEL[m.status];
      return h('div', { class: `month-block${m.status === 'late' ? ' is-late' : ''}` },
        h('div', { class: 'month-head' },
          h('div', { class: 'month-name' }, monthLabel(m.month)),
          h('span', { class: `pill ${cls}` }, label),
          h('span', { class: 'muted', style: 'font-size:13px' }, m.parcels.length > 1 ? `${m.paid_count}/${m.parcels.length} pagas · ${brl(m.amount_cents)}` : brl(m.amount_cents))),
        h('div', { class: `parcels n${m.parcels.length}` }, ...m.parcels.map((p) => parcelChip(m, p))));
    })),
    filesSection(c, 'receipt', 'Todos os comprovantes', 'Comprovantes enviados ao registrar pagamentos aparecem aqui. Também dá para enviar direto.', { month: true }),
    filesSection(c, 'invoice', 'Notas fiscais', 'Com a nota automática ligada (Ajustes → Pix automático), o PDF de cada nota autorizada chega aqui sozinho. O cliente também vê na área dele.', { month: true }),
  ];
}
// Cliente antigo cadastrado agora: marca de uma vez os meses anteriores como pagos.
function bulkOld(c, months) {
  const cur = todayLocal().slice(0, 7);
  const old = months.filter((m) => m.month < cur).flatMap((m) => m.parcels.filter((p) => p.status === 'late' || p.status === 'open').map((p) => ({ ref_month: m.month, installment: p.n, amount_cents: p.cents })));
  if (old.length < 3) return null;
  return h('div', { class: 'banner', style: 'display:flex;gap:10px;align-items:center;flex-wrap:wrap' },
    h('span', { style: 'flex:1;min-width:220px' }, `${old.length} parcelas antigas (antes de ${monthLabel(cur).toLowerCase()}) estão em aberto. Se o cliente já é antigo e pagou tudo, marque de uma vez.`),
    confirmButton('Marcar anteriores como pagas', `Confirmar: ${old.length} parcelas`, async () => {
      const rows = await api('/api/pasta?r=payments', { method: 'PUT', body: { client_id: c.id, status: 'paid', items: old, note: 'marcado em lote' } });
      const key = (x) => `${x.client_id}#${x.ref_month}#${x.installment || 1}`;
      const keys = new Set(rows.map(key));
      S.payments = S.payments.filter((x) => !keys.has(key(x))).concat(rows);
      render(); toast(`${rows.length} parcelas marcadas como pagas.`);
    }, 'btn sm'));
}
const stat = (label, value, sub, tone = '') => h('div', { class: `stat ${tone}` }, h('div', { class: 'eyebrow' }, label), h('div', { class: 'stat-v' }, value), h('div', { class: 'muted', style: 'font-size:13px' }, sub));

// Dados da agência (PIX para a cobrança). Carrega uma vez.
function ensureSettings() {
  if (S.settings !== undefined || !can('financeiro')) return;
  S.settings = null;
  api('/api/pasta?r=settings').then((v) => { S.settings = v; }).catch(() => { S.settings = false; }).finally(() => render());
}

// Mensagem de cobrança pronta (lembrete 2 dias antes ou aviso de atraso).
function chargeMessage(c, m, p) {
  const pix = S.settings?.agency?.pix;
  const what = p.of > 1 ? `a ${p.n}ª parcela (${brl(p.cents)}) da mensalidade de ${monthLabel(m.month).toLowerCase()}` : `a mensalidade de ${monthLabel(m.month).toLowerCase()} (${brl(p.cents)})`;
  const head = p.status === 'late' ? `Olá! Tudo bem? Passando para lembrar que ${what} venceu em ${fmtDay(p.due)} e ainda consta em aberto por aqui.` : `Olá! Tudo bem? Lembrete: ${what} vence em ${fmtDay(p.due)}.`;
  const auto = S.setup?.asaas && c.portal_url ? `\n\nPague com Pix por aqui (a baixa é automática): ${c.portal_url}` : pix ? `\n\nChave PIX: ${pix}` : '';
  return `${head}${auto}\n\nSe já pagou, pode desconsiderar${S.setup?.asaas ? '' : ' e, se puder, me mande o comprovante'}. Obrigado! 🙂`;
}
function chargeButton(c, m, p) {
  const msg = chargeMessage(c, m, p);
  if (c.contact_whatsapp) return h('a', { class: `btn wa sm`, href: waLink(c.contact_whatsapp, msg), target: '_blank', rel: 'noopener', title: 'Mandar lembrete de cobrança pelo WhatsApp' }, p.status === 'late' ? 'Cobrar' : 'Lembrar');
  return h('button', { class: 'btn sm', onclick: () => copyText(msg, 'Mensagem de cobrança copiada.') }, 'Copiar cobrança');
}

// Painel de cobranças: por cliente — atrasado somado + o que vence em até 2 dias.
function chargesCard() {
  if (!can('financeiro')) return null;
  ensureSettings();
  const rows = [];
  for (const c of S.clients) {
    if (!c.billing_start) continue;
    const list = dueSoon(billingMonths(c), todayLocal());
    const late = list.filter((p) => p.status === 'late'), soon = list.filter((p) => p.status !== 'late');
    if (late.length) rows.push({ c, late });
    for (const p of soon) rows.push({ c, p });
  }
  if (!rows.length) return null;
  const nLate = rows.filter((r) => r.late).length;
  const row = (r) => {
    if (r.late) {
      const total = r.late.reduce((s, p) => s + (p.cents || 0), 0);
      const msg = r.late.length === 1 ? chargeMessage(r.c, { month: r.late[0].month }, r.late[0])
        : `Olá! Tudo bem? Passando para lembrar que constam ${r.late.length} parcelas em aberto por aqui, somando ${brl(total)} (a mais antiga venceu em ${fmtDay(r.late[0].due)}).${S.settings?.agency?.pix ? `\n\nChave PIX: ${S.settings.agency.pix}` : ''}\n\nSe já pagou, me mande os comprovantes que eu atualizo. Obrigado! 🙂`;
      return h('div', { class: 'charge is-late' },
        h('div', { style: 'min-width:0' }, h('b', {}, r.c.name), h('div', { class: 'muted', style: 'font-size:13px' }, `${r.late.length} parcela(s) em atraso · ${brl(total)} · desde ${fmtDay(r.late[0].due)}`)),
        h('div', { class: 'actions' },
          r.c.contact_whatsapp ? h('a', { class: 'btn wa sm', href: waLink(r.c.contact_whatsapp, msg), target: '_blank', rel: 'noopener' }, 'Cobrar') : h('button', { class: 'btn sm', onclick: () => copyText(msg, 'Mensagem copiada.') }, 'Copiar cobrança'),
          h('a', { class: 'btn ghost sm', href: `#pasta/${r.c.id}`, onclick: () => { S.folder.tab = 'finance'; } }, 'Abrir')));
    }
    const p = r.p;
    return h('div', { class: 'charge' },
      h('div', { style: 'min-width:0' }, h('b', {}, r.c.name), h('div', { class: 'muted', style: 'font-size:13px' }, `${p.of > 1 ? `${p.n}ª parcela · ` : ''}${monthLabel(p.month)} · ${brl(p.cents)} · vence ${fmtDay(p.due)}`)),
      h('div', { class: 'actions' }, chargeButton(r.c, { month: p.month }, p), h('a', { class: 'btn ghost sm', href: `#pasta/${r.c.id}`, onclick: () => { S.folder.tab = 'finance'; } }, 'Abrir')));
  };
  const list = h('div', { class: 'charge-list' }, ...rows.slice(0, 6).map(row));
  const more = rows.length > 6 ? h('button', { class: 'btn ghost sm more-row', onclick: () => { list.replaceChildren(...rows.map(row)); more.remove(); } }, `Ver todas (${rows.length})`) : null;
  return h('section', { class: 'card charges' },
    h('div', {}, h('h3', {}, 'Cobranças'),
      h('span', { class: 'muted', style: 'font-size:13.5px' }, `${nLate ? `${nLate} cliente(s) com atraso · ` : ''}${rows.length - nLate} parcela(s) vencendo em até 2 dias. Cobrar/Lembrar abre o WhatsApp com a mensagem pronta.`)),
    list, more);
}

function openPayment(c, m, parcel) {
  const p = parcel.payment;
  const n = parcel.n;
  let status = p?.status === 'waived' ? 'waived' : 'paid';
  const paidAt = h('input', { type: 'date', id: 'p-date', value: p?.paid_at || todayLocal() });
  const amount = h('input', { id: 'p-amount', inputmode: 'decimal', value: ((p?.amount_cents ?? parcel.cents ?? 0) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 }) });
  const note = h('input', { id: 'p-note', value: p?.note || '', placeholder: 'Ex.: pago via PIX / mês de cortesia' });
  const file = h('input', { type: 'file', id: 'p-file', accept: ACCEPT });
  const allWaive = parcel.of > 1 ? h('label', { class: 'check' }, h('input', { type: 'checkbox', id: 'p-all' }), ' Isentar todas as parcelas deste mês') : null;
  const paidFields = h('div', { style: 'display:grid;gap:14px' },
    h('div', { class: 'grid-2 tight' },
      h('div', { class: 'field' }, h('label', { for: 'p-date' }, 'Data do pagamento'), paidAt),
      h('div', { class: 'field' }, h('label', { for: 'p-amount' }, 'Valor recebido (R$)'), amount)),
    h('div', { class: 'field' }, h('label', { for: 'p-file' }, p?.file_id ? 'Trocar comprovante (opcional)' : 'Comprovante (opcional)'), file,
      h('span', { class: 'hint' }, 'PDF ou print do PIX/boleto, até 4 MB. Fica guardado na pasta do cliente.')));
  const waiveFields = h('div', {}, allWaive);
  const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Situação' },
    ...[['paid', 'Pago'], ['waived', 'Isento / cortesia']].map(([k, l]) => h('button', { class: 'seg-btn', type: 'button', 'aria-pressed': String(status === k),
      onclick: (e) => { status = k; for (const b of seg.children) b.setAttribute('aria-pressed', String(b === e.currentTarget)); paidFields.hidden = k !== 'paid'; waiveFields.hidden = k !== 'waived'; } }, l)));
  paidFields.hidden = status !== 'paid'; waiveFields.hidden = status !== 'waived';
  const keyOf = (x) => `${x.client_id}#${x.ref_month}#${x.installment || 1}`;
  const save = h('button', { class: 'btn primary', onclick: async () => {
    save.disabled = true;
    try {
      let fileId = p?.file_id || null;
      if (status === 'paid' && file.files[0]) {
        const up = await uploadDoc(c, file.files[0], 'receipt', m.month);
        S.folder.files.unshift(up); fileId = up.id;
      }
      const cents = Math.round(Number(amount.value.replace(/[R$\s]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.')) * 100);
      if (status === 'paid' && !Number.isFinite(cents)) throw new Error('Valor inválido.');
      const targets = status === 'waived' && document.getElementById('p-all')?.checked ? m.parcels.map((x) => x.n) : [n];
      for (const k of targets) {
        const row = await api('/api/pasta?r=payments', { method: 'PUT', body: {
          client_id: c.id, ref_month: m.month, installment: k, status, note: note.value,
          ...(status === 'paid' ? { paid_at: paidAt.value || null, amount_cents: cents, file_id: fileId } : { file_id: null }),
        } });
        row.installment = row.installment || k;
        S.payments = S.payments.filter((x) => keyOf(x) !== keyOf(row)).concat(row);
      }
      const what = parcel.of > 1 && targets.length === 1 ? `${n}ª parcela de ${monthLabel(m.month).toLowerCase()}` : monthLabel(m.month);
      close(); render(); toast(status === 'paid' ? `${what} marcada como paga.` : `${what}: isento.`);
    } catch (e) { toast(e.message, true); save.disabled = false; }
  } }, 'Salvar');
  const foot = [];
  if (p) foot.push(confirmButton('Voltar para em aberto', 'Confirmar', async () => {
    await api(`/api/pasta?r=payments&client=${c.id}&month=${m.month}&n=${n}`, { method: 'DELETE' });
    S.payments = S.payments.filter((x) => !(x.client_id === c.id && x.ref_month === m.month && (x.installment || 1) === n));
    close(); render(); toast('Pagamento desfeito.');
  }, 'btn ghost'));
  foot.push(h('span', { class: 'spacer' }), save);
  const close = drawer(`${c.name} · ${monthLabel(m.month)}${parcel.of > 1 ? ` · ${n}ª parcela` : ''}`, [
    h('div', { class: 'muted', style: 'font-size:14px' }, `${parcel.of > 1 ? `Parcela ${n} de ${parcel.of}` : 'Mensalidade'}: ${brl(parcel.cents)}, vencimento em ${fmtDay(parcel.due)}.`),
    seg, paidFields, waiveFields,
    h('div', { class: 'field' }, h('label', { for: 'p-note' }, 'Observação'), note),
  ], foot);
}

// ── Relatórios e Outros
function folderReports(c) {
  return [igReports(c), filesSection(c, 'report', 'Outros relatórios (arquivos)', 'PDFs, prints ou planilhas que você queira guardar junto. Escolha o mês antes de enviar.', { month: true, group: true })];
}

// ── Relatórios do Instagram (gerados pelo app, com link em português para o cliente)
function reportMessage(c, r) {
  return `Olá! Segue o relatório de desempenho do Instagram de ${c.name} de ${monthLabel(r.ref_month).toLowerCase()}:\n${r.share_url}\n\nDá para baixar em PDF pelo botão no topo da página.`;
}
function igReports(c) {
  const F = S.folder;
  const card = (...kids) => h('section', { class: 'card' }, h('div', { class: 'files-head' },
    h('div', { style: 'flex:1;min-width:220px' }, h('h3', {}, 'Relatórios do Instagram'),
      h('span', { class: 'muted', style: 'font-size:13.5px' }, 'Alcance, curtidas, comentários, salvamentos, compartilhamentos, seguidores ganhos e os melhores posts do mês. Gerado automaticamente todo dia 3 para o mês anterior.'))), ...kids);
  if (F.reports === null) return card(h('div', { class: 'banner' }, 'Falta a atualização do banco para os relatórios. ', h('a', { href: '#ajustes' }, 'Ver em Ajustes'), '.'));
  if (!c.ig_connected) return card(h('div', { class: 'banner' }, 'Conecte o Instagram deste cliente para gerar relatórios. ', h('a', { href: `/api/ig/connect?client=${c.id}` }, 'Conectar agora')));
  const month = h('input', { type: 'month', class: 'month-in', value: shiftMonth(todayLocal().slice(0, 7), -1), max: todayLocal().slice(0, 7), 'aria-label': 'Mês do relatório' });
  const err = h('div');
  const gen = h('button', { class: 'btn primary sm', onclick: () => generate(month.value, gen) }, 'Gerar relatório');
  async function generate(m, btn) {
    if (!m) return toast('Escolha o mês.', true);
    const label = btn.textContent; btn.disabled = true; btn.textContent = 'Lendo o Instagram…'; err.replaceChildren();
    try {
      const r = await api('/api/pasta?r=reports', { method: 'POST', body: { client_id: c.id, ref_month: m } });
      F.reports = [r, ...(F.reports || []).filter((x) => x.id !== r.id)].sort((a, b) => b.ref_month.localeCompare(a.ref_month));
      render(); toast(`Relatório de ${monthLabel(m).toLowerCase()} pronto.`);
    } catch (e) {
      btn.disabled = false; btn.textContent = label;
      err.replaceChildren(h('div', { class: 'errorbox' }, h('b', {}, 'Não deu para gerar: '), e.message,
        e.status === 409 ? h('div', { style: 'margin-top:8px' }, h('a', { class: 'btn primary sm', href: `/api/ig/connect?client=${c.id}` }, 'Reconectar Instagram')) : null));
    }
  }
  const metric = (label, v, suffix = '') => h('div', { class: 'rmetric' }, h('b', {}, v == null ? '—' : `${v.toLocaleString('pt-BR')}${suffix}`), h('span', {}, label));
  const rows = (F.reports || []).map((r) => {
    const s = r.summary;
    return h('article', { class: 'report-row' },
      h('div', { class: 'report-top' },
        h('div', { style: 'min-width:0' }, h('div', { class: 'month-name' }, monthLabel(r.ref_month)),
          h('div', { class: 'muted', style: 'font-size:12.5px' }, `${r.partial ? 'Parcial · ' : ''}atualizado em ${fmtDay(partsInTz(r.updated_at, S.tz).date)}`)),
        h('div', { class: 'actions' },
          h('a', { class: 'btn primary sm', href: r.share_url, target: '_blank', rel: 'noopener' }, 'Abrir'),
          h('button', { class: 'btn sm', onclick: () => copyText(r.share_url, 'Link do relatório copiado.') }, 'Copiar link'),
          c.contact_whatsapp ? h('a', { class: 'btn wa sm', href: waLink(c.contact_whatsapp, reportMessage(c, r)), target: '_blank', rel: 'noopener' }, 'WhatsApp') : null,
          c.contact_email ? h('a', { class: 'btn sm', href: mailLink(c.contact_email, `Relatório de ${monthLabel(r.ref_month).toLowerCase()} · ${c.name}`, reportMessage(c, r)) }, 'E-mail') : null)),
      h('div', { class: 'rmetrics' },
        metric('alcance', s.reach), metric('curtidas', s.likes), metric('comentários', s.comments), metric('salvamentos', s.saves),
        metric('seguidores ganhos', s.followers_gained), metric('posts', s.posts), metric('engajamento', s.engagement, '%')),
      h('div', { class: 'actions' },
        h('button', { class: 'btn ghost sm', onclick: () => openReportNote(c, r) }, r.note ? '✎ Editar comentário' : '✎ Comentário para o cliente'),
        h('button', { class: 'btn ghost sm', onclick: (e) => generate(r.ref_month, e.currentTarget) }, '↻ Atualizar números'),
        confirmButton('Apagar', 'Confirmar: o link para de abrir', async () => {
          await api(`/api/pasta?r=reports&id=${r.id}`, { method: 'DELETE' });
          F.reports = F.reports.filter((x) => x.id !== r.id); render(); toast('Relatório apagado.');
        }, 'btn ghost sm danger')));
  });
  return card(h('div', { class: 'files-head' }, h('span', { class: 'muted', style: 'font-size:13.5px;flex:1' }, 'Gerar agora (o mês atual sai parcial):'), month, gen), err,
    rows.length ? h('div', { class: 'reports' }, ...rows) : h('p', { class: 'muted files-empty' }, 'Nenhum relatório ainda. Escolha o mês e clique em Gerar relatório.'));
}

function openReportNote(c, r) {
  const ta = h('textarea', { id: 'r-note', style: 'min-height:180px', placeholder: 'Ex.: Setembro teve o melhor alcance do ano, puxado pelo carrossel de frases. Para outubro vamos testar mais Reels às 19h.' });
  ta.value = r.note || '';
  const close = drawer(`Comentário · ${monthLabel(r.ref_month)}`, [
    h('div', { class: 'field' }, h('label', { for: 'r-note' }, 'Aparece no relatório do cliente, em "Comentários da agência"'), ta,
      h('span', { class: 'hint' }, 'Análise do mês, destaques e próximos passos. Deixe em branco para não mostrar.'))],
  [h('span', { class: 'spacer' }), h('button', { class: 'btn primary', onclick: async () => {
    try {
      const saved = await api('/api/pasta?r=reports', { method: 'PATCH', body: { id: r.id, note: ta.value } });
      S.folder.reports = S.folder.reports.map((x) => (x.id === saved.id ? saved : x)); close(); render(); toast('Comentário salvo.');
    } catch (e) { toast(e.message, true); }
  } }, 'Salvar')]);
  ta.focus();
}
function folderOther(c) {
  return [filesSection(c, 'other', 'Outros documentos', 'Briefing, manual de marca, notas fiscais, propostas, acessos documentados…')];
}

async function uploadDoc(c, file, category, refMonth) {
  if (file.size > 4 * 1024 * 1024) throw new Error(`"${file.name}" tem mais de 4 MB. Comprima e tente de novo.`);
  const qs = new URLSearchParams({ client: c.id, category });
  if (refMonth) qs.set('ref_month', refMonth);
  return api(`/api/pasta?r=files&${qs}`, { method: 'POST', raw: file, headers: { 'x-file-name': encodeURIComponent(file.name) } });
}

const FILE_ICON = (f) => (f.mime === 'application/pdf' ? 'PDF' : f.mime.startsWith('image/') ? 'IMG' : /sheet|excel|csv/.test(f.mime) ? 'XLS' : /word/.test(f.mime) ? 'DOC' : 'TXT');

function filesSection(c, category, title, hint, { month = false, group = false } = {}) {
  const list = S.folder.files.filter((f) => f.category === category);
  const monthInput = month ? h('input', { type: 'month', value: todayLocal().slice(0, 7), 'aria-label': 'Mês de referência', class: 'month-in' }) : null;
  const status = h('span', { class: 'muted', style: 'font-size:13px' });
  const input = h('input', { type: 'file', accept: ACCEPT, multiple: true, hidden: true, onchange: () => send([...input.files]) });
  async function send(files) {
    if (!files.length) return;
    let ok = 0;
    for (const [i, f] of files.entries()) {
      status.textContent = `Enviando ${i + 1} de ${files.length}…`;
      try { S.folder.files.unshift(await uploadDoc(c, f, category, monthInput?.value || null)); ok++; }
      catch (e) { toast(e.message, true); }
    }
    input.value = ''; status.textContent = '';
    if (ok) { toast(ok > 1 ? `${ok} arquivos guardados.` : 'Arquivo guardado.'); render(); }
  }
  const row = (f) => h('div', { class: 'file' },
    h('span', { class: `file-ic ic-${FILE_ICON(f).toLowerCase()}`, 'aria-hidden': 'true' }, FILE_ICON(f)),
    h('div', { class: 'file-main' },
      h('a', { class: 'file-name', href: `/api/pasta?r=files&id=${f.id}&open=1`, target: '_blank', rel: 'noopener' }, f.name),
      h('span', { class: 'muted' }, [f.ref_month && !group ? monthLabel(f.ref_month, true) : null, fileSize(f.size), `enviado em ${fmtDay(partsInTz(f.created_at, S.tz).date)}`].filter(Boolean).join(' · '))),
    h('div', { class: 'file-act' },
      h('a', { class: 'btn ghost sm', href: `/api/pasta?r=files&id=${f.id}&download=1`, title: 'Baixar' }, 'Baixar'),
      confirmButton('Apagar', 'Confirmar', async () => {
        await api(`/api/pasta?r=files&id=${f.id}`, { method: 'DELETE' });
        S.folder.files = S.folder.files.filter((x) => x.id !== f.id); render(); toast('Arquivo apagado.');
      }, 'btn ghost sm danger')));
  let content;
  if (!list.length) content = h('p', { class: 'muted files-empty' }, 'Nada aqui ainda. Arraste arquivos para cá ou clique em Enviar.');
  else if (group) {
    const by = new Map();
    for (const f of list) { const k = f.ref_month || 'sem-mes'; if (!by.has(k)) by.set(k, []); by.get(k).push(f); }
    content = h('div', { class: 'files' }, ...[...by.keys()].sort().reverse().map((k) => [
      h('div', { class: 'files-month eyebrow' }, k === 'sem-mes' ? 'Sem mês' : monthLabel(k)), ...by.get(k).map(row)]).flat());
  } else content = h('div', { class: 'files' }, ...list.map(row));
  const box = h('section', { class: 'card dropzone',
    ondragover: (e) => { e.preventDefault(); box.classList.add('over'); },
    ondragleave: () => box.classList.remove('over'),
    ondrop: (e) => { e.preventDefault(); box.classList.remove('over'); send([...e.dataTransfer.files]); } },
    h('div', { class: 'files-head' },
      h('div', { style: 'flex:1;min-width:200px' }, h('h3', {}, title), h('span', { class: 'muted', style: 'font-size:13.5px' }, hint)),
      monthInput, h('button', { class: 'btn primary sm', onclick: () => input.click() }, '+ Enviar arquivo'), input),
    status, content);
  return box;
}

// ── Área do cliente: link secreto em que o cliente vê só a pasta dele (contrato, relatórios e financeiro)
function portalMessage(c) {
  return `Olá! Este é o seu acesso exclusivo à área do cliente da agência: contrato, relatórios mensais do Instagram e financeiro, tudo em um só lugar.\n${c.portal_url}\n\nO link é pessoal, não compartilhe.`;
}
function openPortal(c) {
  const save = async (portal, msg) => {
    try {
      const saved = await api(`/api/clients?id=${c.id}`, { method: 'PATCH', body: { portal } });
      const i = S.clients.findIndex((x) => x.id === saved.id); if (i >= 0) S.clients[i] = saved;
      close(); render(); if (msg) toast(msg);
      if (saved.portal_url) openPortal(saved);
    } catch (e) {
      toast(/portal_token|column|schema/i.test(e.message) ? 'Falta a atualização do banco (veja Ajustes).' : e.message, true);
    }
  };
  const body = [h('p', { class: 'muted', style: 'margin:0;font-size:14px' },
    'O cliente abre pelo celular, sem senha, e vê só a pasta dele: contrato assinado, relatórios do Instagram, mensalidades com comprovantes e o atalho para aprovar posts. Ele não vê outros clientes, nem a seção "Outros" nem suas anotações.')];
  const foot = [];
  if (!c.portal_url) {
    foot.push(h('span', { class: 'spacer' }), h('button', { class: 'btn primary', onclick: () => save('enable', 'Link do cliente criado.') }, 'Criar link'));
  } else {
    body.push(h('div', { class: 'linkbox' }, h('code', { translate: 'no' }, c.portal_url), h('button', { class: 'btn sm', onclick: () => copyText(c.portal_url, 'Link copiado.') }, 'Copiar')),
      h('div', { class: 'actions' },
        h('a', { class: 'btn sm', href: c.portal_url, target: '_blank', rel: 'noopener' }, 'Ver como o cliente vê'),
        c.contact_whatsapp ? h('a', { class: 'btn wa sm', href: waLink(c.contact_whatsapp, portalMessage(c)), target: '_blank', rel: 'noopener' }, 'Enviar por WhatsApp') : null,
        c.contact_email ? h('a', { class: 'btn sm', href: mailLink(c.contact_email, `Sua área do cliente · ${c.name}`, portalMessage(c)) }, 'Enviar por e-mail') : null),
      onboardingBox(c),
      h('div', { class: 'card', style: 'gap:10px;padding:14px' }, h('b', {}, 'Segurança'),
        h('span', { class: 'muted', style: 'font-size:13.5px' }, 'Se o link vazou ou o contrato terminou, gere um novo (o antigo para de abrir) ou desative.'),
        h('div', { class: 'actions' },
          confirmButton('Gerar link novo', 'Confirmar: o antigo para de abrir', () => save('regenerate', 'Link novo gerado.'), 'btn sm'),
          confirmButton('Desativar', 'Confirmar desativar', () => save('disable', 'Link desativado.'), 'btn ghost sm danger'))));
  }
  const close = drawer(`Link do cliente · ${c.name}`, body, foot);
}

// ───────────────────────── histórico de aprovações (prova)
const EVENT_LABEL = { sent: 'Enviado para aprovação', reminded: 'Lembrete enviado', approved: 'Aprovado pelo cliente', changes_requested: 'Cliente pediu ajuste', approved_by_agency: 'Aprovado pela agência', published: 'Publicado no Instagram', failed: 'Falha ao publicar' };
const EVENT_TONE = { approved: 'st-approved', changes_requested: 'st-changes_requested', published: 'st-published', failed: 'st-failed', approved_by_agency: 'st-internal_review', sent: 'st-pending_approval', reminded: 'st-draft' };
function folderHistory(c) {
  const F = S.folder;
  if (F.history === undefined || F.historyFor !== c.id) {
    F.history = null; F.historyFor = c.id;
    api(`/api/pasta?r=history&client=${c.id}`).then((v) => { F.history = v; }).catch(() => { F.history = false; }).finally(() => render());
    return [h('p', { class: 'muted' }, 'Carregando o histórico…')];
  }
  if (F.history === false) return [h('div', { class: 'banner' }, 'O histórico precisa da atualização do banco. ', h('a', { href: '#ajustes' }, 'Ver em Ajustes'), '.')];
  if (!F.history) return [h('p', { class: 'muted' }, 'Carregando o histórico…')];
  const list = F.history;
  return [h('section', { class: 'card' },
    h('div', { class: 'files-head' },
      h('div', { style: 'flex:1;min-width:220px' }, h('h3', {}, 'Histórico de aprovações'),
        h('span', { class: 'muted', style: 'font-size:13.5px' }, 'Registro com data e hora de cada envio, lembrete, decisão do cliente e publicação. Serve de prova (cláusulas 5.3 e 5.5) e fica guardado mesmo se o post for apagado.')),
      h('a', { class: 'btn sm', href: `/historico?client=${c.id}`, target: '_blank', rel: 'noopener' }, 'Gerar PDF')),
    list.length ? h('div', { class: 'events' }, ...list.map((e) => h('div', { class: 'event' },
      e.snapshot?.image_url ? h('img', { src: e.snapshot.image_url, alt: '', loading: 'lazy' }) : h('span', { class: 'thumb-empty' }),
      h('div', { style: 'min-width:0' },
        h('div', {}, h('span', { class: `pill ${EVENT_TONE[e.type] || 'st-draft'}` }, EVENT_LABEL[e.type] || e.type), ' ',
          h('span', { class: 'muted', style: 'font-size:13px' }, `${fmtDay(partsInTz(e.created_at, S.tz).date)} às ${fmtTime(e.created_at, S.tz)}`)),
        h('div', { class: 'ev-cap' }, e.snapshot?.title || e.snapshot?.caption || 'Post'),
        e.note ? h('div', { class: 'muted', style: 'font-size:13px' }, `“${e.note}”`) : null))))
      : h('p', { class: 'muted files-empty' }, 'Ainda não há registros. Eles começam a aparecer nos próximos envios.'))];
}

// Agenda/Clientes: posts esperando o cliente há 2+ dias → lembrete pronto
function approvalReminders() {
  const limit = Date.now() - 2 * 864e5;
  const by = new Map();
  for (const p of S.posts) if (p.status === 'pending_approval' && p.sent_for_approval_at && new Date(p.sent_for_approval_at).getTime() < limit) by.set(p.client_id, [...(by.get(p.client_id) || []), p]);
  if (!by.size) return null;
  const log = (c, channel) => api('/api/posts', { method: 'POST', body: { remind_client: c.id, channel } }).catch(() => {});
  return h('section', { class: 'card charges' },
    h('h3', {}, 'Aprovações paradas'),
    h('span', { class: 'muted', style: 'font-size:13.5px' }, 'Posts esperando o cliente há mais de 2 dias. Sem resposta não é aprovação automática (cláusula 5.5): mande um lembrete; fica registrado no histórico.'),
    h('div', { class: 'charge-list' }, ...[...by.entries()].map(([cid, posts]) => {
      const c = clientById(cid); if (!c) return null;
      const days = Math.floor((Date.now() - Math.min(...posts.map((p) => new Date(p.sent_for_approval_at).getTime()))) / 864e5);
      const msg = `Oi! Passando para lembrar: ${posts.length > 1 ? `${posts.length} posts estão` : '1 post está'} esperando sua aprovação há ${days} dias.\n${c.approval_url}\n\nSem a aprovação eles não são publicados e o calendário precisa ser reorganizado. 🙂`;
      return h('div', { class: 'charge' },
        h('div', {}, h('b', {}, c.name), h('div', { class: 'muted', style: 'font-size:13px' }, `${posts.length} post(s) · há ${days} dias`)),
        h('div', { class: 'actions' },
          c.contact_whatsapp ? h('a', { class: 'btn wa sm', href: waLink(c.contact_whatsapp, msg), target: '_blank', rel: 'noopener', onclick: () => { log(c, 'whatsapp'); toast('Lembrete registrado no histórico.'); } }, 'Lembrar no WhatsApp') : null,
          c.contact_email ? h('a', { class: 'btn sm', href: mailLink(c.contact_email, `Posts de ${c.name} aguardando aprovação`, msg), onclick: () => log(c, 'e-mail') }, 'E-mail') : null,
          h('button', { class: 'btn ghost sm', onclick: () => { copyText(msg, 'Lembrete copiado.'); log(c, 'cópia'); } }, 'Copiar')));
    })));
}

// ───────────────────────── identidade da marca (equipe e admin)
function folderBrand(c) {
  const F = S.folder;
  if (F.brandFor !== c.id) {
    F.brandFor = c.id; F.brand = null;
    api(`/api/pasta?r=brand&client=${c.id}`).then((v) => { F.brand = v; }).catch(() => { F.brand = false; }).finally(() => render());
  }
  if (F.brand === false) return [h('div', { class: 'banner' }, 'A identidade da marca precisa da atualização do banco. ', S.role === 'admin' ? h('a', { href: '#ajustes' }, 'Ver em Ajustes') : 'Peça ao administrador.')];
  if (!F.brand) return [h('p', { class: 'muted' }, 'Carregando…')];
  const k = F.brand.brand_kit || {};
  let colors = [...(k.colors || [])];
  const colorsBox = h('div', { class: 'swatches' });
  const drawColors = () => colorsBox.replaceChildren(...colors.map((col, i) => h('div', { class: 'swatch' },
    h('input', { type: 'color', value: col, 'aria-label': `Cor ${i + 1}`, oninput: (e) => { colors[i] = e.target.value; e.target.nextSibling.textContent = e.target.value.toUpperCase(); } }),
    h('code', { translate: 'no' }, col.toUpperCase()),
    h('button', { type: 'button', class: 'linkish', 'aria-label': 'Remover cor', onclick: () => { colors.splice(i, 1); drawColors(); } }, '✕'))),
    colors.length < 8 ? h('button', { type: 'button', class: 'btn sm', onclick: () => { colors.push('#7A6200'); drawColors(); } }, '+ Cor') : null);
  drawColors();
  const ta = (id, label, val, ph, hint) => { const el = h('textarea', { id, placeholder: ph, style: 'min-height:70px' }); el.value = val || ''; return [el, h('div', { class: 'field' }, h('label', { for: id }, label), el, hint ? h('span', { class: 'hint' }, hint) : null)]; };
  const fonts = h('input', { id: 'b-fonts', value: k.fonts || '', placeholder: 'Ex.: títulos em Montserrat ExtraBold, textos em Inter' });
  const niche = h('select', { id: 'b-niche' }, h('option', { value: '' }, '— escolha —'), ...Object.entries(NICHES).map(([v, l]) => h('option', { value: v, selected: k.niche === v }, l)));
  const [voice, fVoice] = ta('b-voice', 'Tom de voz', F.brand.brand_voice, 'Ex.: próximo, carinhoso com os pets, divertido sem ser bobo. Fala com tutores de 25–45.', 'A IA de legendas usa isto.');
  const [style, fStyle] = ta('b-style', 'Estilo visual e posicionamento', k.style, 'Ex.: fotos claras e naturais, muito pet real (nada de banco de imagens), fundos limpos.');
  const [dos, fDos] = ta('b-dos', 'Sempre', k.dos, 'Ex.: mostrar o nome do pet, usar emojis de patinha, citar o endereço nos posts de promoção.');
  const [donts, fDonts] = ta('b-donts', 'Nunca', k.donts, 'Ex.: falar de preço sem aprovação, usar a palavra "barato", fotos de pets tristes.', 'A IA evita estes temas e palavras.');
  const [refs, fRefs] = ta('b-refs', 'Referências (links)', k.references, 'Perfis, pastas do Drive, Pinterest…');
  const [notes, fNotes] = ta('b-notes', 'Outras observações', k.notes, 'Datas importantes, produtos-estrela, concorrentes…');
  const [insp, fInsp] = ta('b-insp', 'Marcas, perfis e criadores que admira', k.inspirations, 'E o que chama a atenção na comunicação deles.');
  const [avoid, fAvoid] = ta('b-avoid', 'O que não associar à marca', k.avoid, 'Conteúdos, linguagens, tendências ou abordagens a evitar.', 'A IA evita isto.');
  const [comp, fComp] = ta('b-comp', 'Concorrentes', k.competitors, 'Quem são e o que fazem bem ou deixam de fazer no digital.');
  const [perc, fPerc] = ta('b-perc', 'Percepção desejada', k.perception, 'O que as pessoas devem sentir/associar no primeiro contato com o perfil.', 'Guia o tom das legendas e do planejamento.');
  const save = h('button', { class: 'btn primary', onclick: async () => {
    save.disabled = true;
    try {
      const r = await api('/api/pasta?r=brand', { method: 'PUT', body: { client_id: c.id, brand_voice: voice.value, brand_kit: { niche: niche.value || null, inspirations: insp.value, avoid: avoid.value, competitors: comp.value, perception: perc.value, colors, fonts: fonts.value, style: style.value, dos: dos.value, donts: donts.value, references: refs.value, notes: notes.value } } });
      F.brand = { ...F.brand, ...r };
      const i = S.clients.findIndex((x) => x.id === c.id); if (i >= 0) S.clients[i] = { ...S.clients[i], brand_voice: r.brand_voice, brand_kit: r.brand_kit };
      toast('Identidade da marca salva.');
    } catch (e) { toast(e.message, true); }
    save.disabled = false;
  } }, 'Salvar identidade');
  return [
    h('section', { class: 'card' },
      h('div', { class: 'eyebrow' }, 'Manual rápido da marca'), h('h3', {}, `Identidade de ${c.name}`),
      h('div', { class: 'field' }, h('label', { for: 'b-niche' }, 'Nicho'), niche, h('span', { class: 'hint' }, 'Define as datas comemorativas do calendário, os alertas do Início e o planejamento com IA.')),
      h('div', { class: 'field' }, h('span', { class: 'label' }, 'Paleta de cores'), colorsBox),
      h('div', { class: 'field' }, h('label', { for: 'b-fonts' }, 'Tipografia'), fonts),
      fVoice, h('div', { class: 'grid-2 tight' }, fStyle, fRefs), h('div', { class: 'grid-2 tight' }, fDos, fDonts), fNotes,
      h('div', { class: 'eyebrow', style: 'margin-top:6px' }, 'Marca no digital (vem do questionário)'),
      h('div', { class: 'grid-2 tight' }, fInsp, fAvoid), h('div', { class: 'grid-2 tight' }, fComp, fPerc),
      h('div', { class: 'actions' }, save)),
    onboardingAnswers(c, k.onboarding),
    filesSection(c, 'brand', 'Logo e referências visuais', 'Logo em PNG/PDF, fontes, fotos de referência, manual da marca.'),
  ];
}

// ───────────────────────── pedidos do cliente (vindos da área do cliente)
const REQ_LABEL = { open: ['Novo', 'st-pending_approval'], doing: ['Em andamento', 'st-internal_review'], done: ['Concluído', 'st-approved'] };
function folderRequests(c) {
  const F = S.folder;
  if (F.reqFor !== c.id) {
    F.reqFor = c.id; F.reqs = null;
    api(`/api/pasta?r=requests&client=${c.id}`).then((v) => { F.reqs = v; }).catch(() => { F.reqs = false; }).finally(() => render());
  }
  if (F.reqs === false) return [h('div', { class: 'banner' }, 'Os pedidos precisam da atualização do banco.')];
  if (!F.reqs) return [h('p', { class: 'muted' }, 'Carregando…')];
  const setStatus = async (r, status) => {
    try {
      const row = await api('/api/pasta?r=requests', { method: 'PATCH', body: { id: r.id, status } });
      Object.assign(r, row); S.requests = (S.requests || []).filter((x) => x.id !== r.id).concat(status === 'done' ? [] : [{ ...r }]);
      render();
    } catch (e) { toast(e.message, true); }
  };
  return [h('section', { class: 'card' },
    h('div', {}, h('h3', {}, 'Pedidos do cliente'),
      h('span', { class: 'muted', style: 'font-size:13.5px' }, c.portal_url !== undefined ? 'O cliente envia pela área do cliente (link exclusivo): ideias, fotos, datas e promoções.' : 'Pedidos enviados pelo cliente na área exclusiva dele.')),
    F.reqs.length ? h('div', { class: 'reqs' }, ...F.reqs.map((r) => {
      const [label, cls] = REQ_LABEL[r.status];
      return h('article', { class: `req${r.status === 'done' ? ' done' : ''}` },
        h('div', { class: 'req-top' }, h('span', { class: `pill ${cls}` }, label),
          h('span', { class: 'muted', style: 'font-size:12.5px' }, `enviado ${fmtDay(partsInTz(r.created_at, S.tz).date)}${r.wanted_date ? ` · para ${fmtDay(r.wanted_date)}` : ''}`)),
        h('p', { class: 'req-text' }, r.text),
        r.files?.length ? h('div', { class: 'req-files' }, ...r.files.map((f) => h('a', { class: 'btn ghost sm', href: `/api/pasta?r=files&id=${f.id}&open=1`, target: '_blank', rel: 'noopener' }, `📎 ${f.name}`))) : null,
        h('div', { class: 'actions' },
          h('button', { class: 'btn sm', onclick: () => openPost(null, { stage: 'idea', client: c.id, title: r.text.split('\n')[0].slice(0, 120), notes: `Pedido do cliente (${fmtDay(partsInTz(r.created_at, S.tz).date)}):\n${r.text}`, date: r.wanted_date || undefined }) }, '💡 Virar ideia de post'),
          r.status !== 'doing' && r.status !== 'done' ? h('button', { class: 'btn ghost sm', onclick: () => setStatus(r, 'doing') }, 'Em andamento') : null,
          r.status !== 'done' ? h('button', { class: 'btn ghost sm', onclick: () => setStatus(r, 'done') }, '✓ Concluir') : h('button', { class: 'btn ghost sm', onclick: () => setStatus(r, 'open') }, 'Reabrir')));
    })) : h('p', { class: 'muted files-empty' }, 'Nenhum pedido ainda. Mande o link da área do cliente para ele usar.')),
    filesSection(c, 'briefing', 'Arquivos enviados pelo cliente', 'Fotos e documentos que vieram junto com os pedidos.')];
}

// Clientes: caixa de entrada de pedidos novos
function requestsInbox() {
  const open = (S.requests || []).filter((r) => r.status === 'open');
  if (!open.length) return null;
  return h('section', { class: 'card' },
    h('h3', {}, `Pedidos novos dos clientes (${open.length})`),
    h('div', { class: 'charge-list' }, ...open.slice(0, 6).map((r) => h('div', { class: 'charge' },
      h('div', { style: 'min-width:0;flex:1' }, h('b', {}, clientName(r.client_id)), h('div', { class: 'muted clamp2', style: 'font-size:13px' }, r.text)),
      h('a', { class: 'btn sm', href: `#pasta/${r.client_id}`, onclick: () => { S.folder.tab = 'requests'; S.folder.reqFor = null; } }, 'Ver')))));
}

// ───────────────────────── Ajustes → equipe
function settingsTeam() {
  if (S.team === undefined) {
    S.team = null;
    api('/api/pasta?r=users').then((v) => { S.team = v; }).catch(() => { S.team = false; }).finally(() => { if (S.view === 'ajustes') render(); });
  }
  const head = h('div', { class: 'page-head', style: 'margin-top:12px' }, h('div', {}, h('div', { class: 'eyebrow' }, 'Acessos'), h('h2', { style: 'font-size:22px' }, 'Equipe')),
    h('div', { class: 'spacer' }), S.team ? h('button', { class: 'btn primary sm', onclick: () => openMember() }, '+ Adicionar pessoa') : null);
  if (S.team === false) return [head, h('p', { class: 'muted' }, 'Disponível depois da atualização do banco de dados.')];
  if (!S.team) return [head, h('p', { class: 'muted' }, 'Carregando…')];
  return [head, h('article', { class: 'card' },
    h('span', { class: 'muted', style: 'font-size:13.5px' }, 'Cada pessoa entra com o próprio e-mail e senha. Em "Editar" você escolhe exatamente o que ela acessa (posts, IA, marca, relatórios, financeiro, vendas…) e de quais clientes. "Administrador" vê tudo, inclusive Ajustes. Você (senha principal) é sempre administrador.'),
    S.team.length ? h('div', { class: 'charge-list' }, ...S.team.map((u) => h('div', { class: 'charge' },
      h('div', {}, h('b', {}, u.name), ' ', h('span', { class: `pill ${u.active ? (u.role === 'admin' ? 'st-published' : 'st-internal_review') : 'st-draft'}` }, u.active ? (u.role === 'admin' ? 'Administrador' : 'Equipe') : 'Desativado'),
        h('div', { class: 'muted', style: 'font-size:13px' }, u.email),
        u.role !== 'admin' ? h('div', { class: 'perm-sum' }, ...PERMS.filter(([k]) => (u.perms || TEAM_DEFAULT)[k]).map(([, l]) => h('span', { class: 'pill st-draft' }, l)),
          h('span', { class: 'pill st-pending_approval' }, u.client_ids?.length ? `${u.client_ids.length} cliente(s)` : 'Todos os clientes')) : null),
      h('button', { class: 'btn sm', onclick: () => openMember(u) }, 'Editar'))))
      : h('p', { class: 'muted files-empty' }, 'Só você por enquanto.'))];
}
function openMember(u = null) {
  const name = h('input', { id: 'u-name', value: u?.name || '', placeholder: 'Nome' });
  const email = h('input', { id: 'u-email', type: 'email', value: u?.email || '', placeholder: 'pessoa@email.com', disabled: Boolean(u) });
  const pw = h('input', { id: 'u-pw', type: 'password', autocomplete: 'new-password', placeholder: u ? 'deixe em branco para manter' : 'mínimo 8 caracteres' });
  let role = u?.role || 'team';
  const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Papel' }, ...[['team', 'Equipe'], ['admin', 'Administrador']].map(([k, l]) => h('button', { type: 'button', class: 'seg-btn', 'aria-pressed': String(role === k),
    onclick: (e) => { role = k; for (const b of seg.children) b.setAttribute('aria-pressed', String(b === e.currentTarget)); drawPerms(); } }, l)));
  // permissões (só para "Equipe")
  const perms = { ...TEAM_DEFAULT, ...(u?.perms || {}) };
  let onlySome = Boolean(u?.client_ids?.length);
  const chosen = new Set(u?.client_ids || []);
  const permBox = h('div', { class: 'perm-box' });
  const drawPerms = () => {
    permBox.hidden = role === 'admin';
    permBox.replaceChildren(
      h('div', { class: 'perm-head' }, h('b', {}, 'O que pode fazer'), h('span', { class: 'muted' }, 'Marque só o que a pessoa precisa.')),
      ...PERMS.map(([k, label, hint]) => h('label', { class: 'perm' }, h('input', { type: 'checkbox', checked: perms[k], onchange: (e) => { perms[k] = e.target.checked; if (k === 'conteudo' && !e.target.checked) { perms.enviar = false; perms.apagar = false; drawPerms(); } } }),
        h('span', {}, h('b', {}, label), hint ? h('small', {}, hint) : null))),
      h('div', { class: 'perm-head', style: 'margin-top:8px' }, h('b', {}, 'Quais clientes')),
      h('div', { class: 'seg', role: 'group' }, ...[[false, 'Todos os clientes'], [true, 'Só alguns']].map(([v, l]) => h('button', { type: 'button', class: 'seg-btn', 'aria-pressed': String(onlySome === v), onclick: () => { onlySome = v; drawPerms(); } }, l))),
      onlySome ? h('div', { class: 'pick' }, ...S.clients.map((c) => h('button', { type: 'button', class: 'chip', 'aria-pressed': String(chosen.has(c.id)), onclick: () => { if (chosen.has(c.id)) chosen.delete(c.id); else chosen.add(c.id); drawPerms(); } }, c.name))) : null,
      onlySome ? h('span', { class: 'hint muted' }, 'A pessoa só vê posts, calendário, pastas e pedidos desses clientes.') : null);
  };
  const access = () => (role === 'admin' ? {} : { perms, client_ids: onlySome ? [...chosen] : null });
  const done = (row, msg) => { S.team = [...S.team.filter((x) => x.id !== row.id), row].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')); close(); render(); toast(msg); };
  const foot = [];
  if (u) foot.push(
    confirmButton('Excluir', 'Confirmar exclusão', async () => { await api(`/api/pasta?r=users&id=${u.id}`, { method: 'DELETE' }); S.team = S.team.filter((x) => x.id !== u.id); close(); render(); toast('Conta excluída.'); }, 'btn ghost danger'),
    h('button', { class: 'btn ghost', onclick: async () => { try { done(await api('/api/pasta?r=users', { method: 'PATCH', body: { id: u.id, active: !u.active } }), u.active ? 'Acesso desativado.' : 'Acesso reativado.'); } catch (e) { toast(e.message, true); } } }, u.active ? 'Desativar' : 'Reativar'));
  foot.push(h('span', { class: 'spacer' }), h('button', { class: 'btn primary', onclick: async () => {
    try {
      const row = u
        ? await api('/api/pasta?r=users', { method: 'PATCH', body: { id: u.id, name: name.value, role, password: pw.value || undefined, ...access() } })
        : await api('/api/pasta?r=users', { method: 'POST', body: { name: name.value, email: email.value, role, password: pw.value, ...access() } });
      if (onlySome && role !== 'admin' && !chosen.size) return toast('Escolha pelo menos um cliente ou marque "Todos os clientes".', true);
      done(row, u ? 'Conta atualizada. Vale no próximo clique da pessoa (se estiver logada, ela só precisa atualizar a página).' : `Conta criada. Mande o e-mail e a senha para ${row.name} entrar.`);
    } catch (e) { toast(e.message, true); }
  } }, u ? 'Salvar' : 'Criar conta'));
  const close = drawer(u ? `Equipe · ${u.name}` : 'Nova pessoa na equipe', [
    h('div', { class: 'field' }, h('label', { for: 'u-name' }, 'Nome'), name),
    h('div', { class: 'field' }, h('label', { for: 'u-email' }, 'E-mail (login)'), email),
    h('div', { class: 'field' }, h('label', { for: 'u-pw' }, u ? 'Nova senha' : 'Senha inicial'), pw, h('span', { class: 'hint' }, 'Combine a senha com a pessoa por um canal seguro.')),
    h('div', { class: 'field' }, h('span', { class: 'label' }, 'Papel'), seg, h('span', { class: 'hint' }, 'Administrador vê e faz tudo, inclusive Ajustes e as contas da equipe.')),
    permBox,
  ], foot);
  drawPerms();
  name.focus();
}

// ───────────────────────── prévia da grade do feed (painel)
async function openFeedPreview(clientId, current) {
  const c = clientById(clientId);
  const grid = h('div', { class: 'g-grid' }, h('p', { class: 'muted' }, 'Buscando o feed…'));
  drawer(`Feed · ${c?.name || ''}`, [h('span', { class: 'muted', style: 'font-size:13.5px' }, 'Os posts com borda são os programados (na ordem em que vão sair). O post que você está editando fica destacado.'), grid], []);
  const [feed, upcoming] = await Promise.all([
    api(`/api/pasta?r=feed&client=${clientId}`).catch(() => []),
    api(`/api/posts?client=${clientId}&status=pending_approval,approved,changes_requested,draft,internal_review&from=${encodeURIComponent(new Date().toISOString())}`).catch(() => []),
  ]);
  const list = upcoming.filter((p) => p.image_url && p.media_type !== 'STORY' && p.scheduled_at && p.id !== current.id);
  if (current.image_url) list.push({ ...current, scheduled_at: current.scheduled_at || new Date(Date.now() + 365 * 864e5).toISOString(), _current: true });
  list.sort((a, b) => new Date(b.scheduled_at) - new Date(a.scheduled_at));
  const tile = (src, cls, tag) => h('div', { class: `g-tile ${cls}` }, h('img', { src, alt: '', loading: 'lazy' }), tag ? h('span', { class: 'g-tag' }, tag) : null);
  grid.replaceChildren(
    ...list.map((p) => tile(p.image_url, `new ${p._current ? 'current' : p.status}`, p._current ? 'este post' : p.scheduled_at ? fmtDay(partsInTz(p.scheduled_at, S.tz).date).slice(0, 5) : '')),
    ...feed.slice(0, Math.max(0, 15 - list.length)).map((f) => tile(f.thumb, 'old', f.type === 'REELS' ? '▶' : f.type === 'CAROUSEL' ? '❐' : null)));
  if (!list.length && !feed.length) grid.replaceChildren(h('p', { class: 'muted' }, 'Sem posts para mostrar ainda.'));
}

// ───────────────────────── INÍCIO: a "entrada" do MC DIGITAL (clique na logo)
function viewHome() {
  if (can('financeiro')) ensureSettings();
  const today = todayLocal();
  const hour = Number(partsInTz(new Date().toISOString(), S.tz).time.slice(0, 2));
  const hello = hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite';
  const who = S.userName && S.userName !== 'Dono' ? S.userName.split(' ')[0] : (S.settings?.agency?.representante || '').split(' ')[0];
  const ld = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: S.tz }).format(new Date());
  const longDate = ld.charAt(0).toUpperCase() + ld.slice(1);
  const month = today.slice(0, 7);
  const posts = S.posts.filter((p) => p.scheduled_at);
  const todays = posts.filter((p) => dayKey(p.scheduled_at, S.tz) === today && p.status !== 'idea').sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at));
  const week = posts.filter((p) => { const t = new Date(p.scheduled_at).getTime(); return t > Date.now() && t < Date.now() + 7 * 864e5 && !['idea'].includes(p.status); });
  const waiting = S.posts.filter((p) => p.status === 'pending_approval').length;
  const newReqs = (S.requests || []).filter((r) => r.status === 'open').length;

  const hero = h('section', { class: 'home-hero' },
    h('div', { class: 'home-mark', 'aria-hidden': 'true' }, h('img', { src: '/brand/logo-claro.png', alt: '' })),
    h('div', { class: 'home-hello' },
      h('div', { class: 'eyebrow' }, longDate),
      h('h1', {}, `${hello}${who ? `, ${who}` : ''}.`),
      h('p', { class: 'muted' }, todays.length ? `Hoje saem ${todays.length} publicaç${todays.length > 1 ? 'ões' : 'ão'}.` : 'Nenhuma publicação marcada para hoje.',
        waiting ? ` ${waiting} post${waiting > 1 ? 's' : ''} esperando aprovação dos clientes.` : '')),
    h('div', { class: 'home-quick' },
      can('conteudo') ? h('button', { class: 'btn primary', onclick: () => openPost() }, '+ Novo post') : null,
      h('a', { class: 'btn', href: '#calendario' }, 'Calendário'),
      h('a', { class: 'btn', href: '#fluxo' }, 'Fluxo'),
      can('vendas') ? h('button', { class: 'btn', onclick: () => openProposal() }, '+ Proposta') : null));

  // números
  const tiles = [];
  if (can('financeiro')) {
    let mrr = 0, received = 0, toReceive = 0, late = 0, active = 0;
    const parts = [], missing = [], future = [];
    for (const c of S.clients) {
      if (!c.billing_start || !c.monthly_fee_cents) { if (c.monthly_fee_cents || c.billing_start || c.contract_data) missing.push(c.name); continue; }
      if (c.billing_start.slice(0, 10) <= today) { mrr += c.monthly_fee_cents; active++; parts.push(`${c.name} ${brl(c.monthly_fee_cents)}`); }
      else future.push(`${c.name} começa ${fmtDay(c.billing_start.slice(0, 10))}`);
      for (const m of billingMonths(c)) {
        late += m.late_cents;
        if (m.month === month) { received += m.parcels.filter((p) => p.status === 'paid').reduce((x, p) => x + (p.cents || 0), 0); toReceive += m.open_cents - m.late_cents; }
      }
    }
    tiles.push(
      kpi('Receita mensal', brl(mrr), [
        active <= 4 && parts.length ? parts.join(' · ') : `${active} contrato${active === 1 ? '' : 's'} ativo${active === 1 ? '' : 's'}`,
        future.length ? ` · fora da conta: ${future.join(', ')}` : '',
        missing.length ? ` · sem valor ou início: ${missing.join(', ')}` : '',
      ].join(''), missing.length ? 'warn' : ''),
      kpi(`Recebido em ${monthLabel(month, true)}`, brl(received), 'parcelas marcadas como pagas', 'good'),
      kpi('A receber no mês', brl(toReceive), 'ainda no prazo'),
      kpi('Em atraso', late ? brl(late) : 'Nada', late ? 'veja Cobranças abaixo' : 'tudo em dia', late ? 'bad' : 'good'));
  }
  tiles.push(
    kpi('Publicações hoje', String(todays.length), `${week.length} nos próximos 7 dias`),
    kpi('Aguardando clientes', String(waiting), 'posts para aprovar', waiting ? 'warn' : ''),
    kpi('Pedidos novos', String(newReqs), 'vindos da área do cliente', newReqs ? 'warn' : ''),
    kpi('Clientes', `${S.clients.length}`, `${S.clients.filter((c) => c.ig_connected).length} com Instagram conectado`));

  // hoje
  const todayCard = h('section', { class: 'card' }, h('div', { class: 'home-card-head' }, h('h3', {}, 'Hoje'), h('a', { href: '#agenda', class: 'muted' }, 'Agenda completa →')),
    todays.length ? h('div', { class: 'home-today' }, ...todays.map((p) => h('button', { class: 'ht', onclick: () => openPost(p) },
      thumb(p, 'ht-img'), h('span', { class: 'mono' }, fmtTime(p.scheduled_at, S.tz)),
      h('span', { class: 'ht-main' }, h('b', {}, clientName(p.client_id)), ' ', typeBadge(p), h('span', { class: 'muted ht-cap' }, p.title || p.caption || '')),
      h('span', { class: `pill st-${p.status}` }, STATUS_LABEL[p.status]))))
      : h('p', { class: 'muted', style: 'margin:0' }, 'Nada programado para hoje. Que tal adiantar a semana?'));

  // atenção
  const alerts = [];
  const failed = S.posts.filter((p) => p.status === 'failed');
  if (failed.length) alerts.push(alertRow('bad', `${failed.length} post${failed.length > 1 ? 's' : ''} não publicou`, 'Abra e tente de novo', () => openPost(failed[0])));
  for (const c of S.clients) {
    const exp = c.ig_token_expires_at ? Math.round((new Date(c.ig_token_expires_at) - Date.now()) / 864e5) : null;
    if (!c.ig_connected) alerts.push(alertRow('warn', `${c.name}: Instagram não conectado`, 'Sem conexão, nada publica', null, `#clientes`));
    else if (exp !== null && exp <= 5) alerts.push(alertRow('warn', `${c.name}: conexão do Instagram vence em ${Math.max(0, exp)} dia(s)`, 'Reconecte', null, '#clientes'));
  }
  if (can('vendas') && Array.isArray(S.proposals)) {
    for (const p of S.proposals.filter((x) => x.status === 'accepted' && x.accepted_at && Date.now() - new Date(x.accepted_at) < 10 * 864e5)) {
      alerts.push(alertRow('good', `🎉 ${p.client_name} aceitou a proposta`, 'Gere o contrato e conecte o Instagram', null, p.client_id ? `#pasta/${p.client_id}` : '#propostas'));
    }
    for (const p of S.proposals.filter((x) => x.status === 'sent' && Date.now() - new Date(x.updated_at || x.created_at) > 5 * 864e5)) {
      alerts.push(alertRow('', `${p.client_name}: proposta sem resposta há ${Math.floor((Date.now() - new Date(p.updated_at || p.created_at)) / 864e5)} dias`, 'Que tal um follow-up?', null, '#propostas'));
    }
  }
  if (can('vendas') && Array.isArray(S.leads)) {
    const due = S.leads.filter((l) => !['fechado', 'perdido'].includes(l.stage) && (l.wants_contact && l.stage === 'novo' || (l.next_action_at && l.next_action_at <= today)));
    for (const l of due.slice(0, 4)) alerts.push(alertRow(l.wants_contact ? 'bad' : 'warn', `${l.wants_contact ? '🔥 ' : ''}Follow-up: ${l.name}${l.instagram ? ` (@${l.instagram})` : ''}`, l.next_action || 'Retomar o contato', () => openLead(l)));
    if (due.length > 4) alerts.push(alertRow('', `+${due.length - 4} follow-ups para hoje`, 'Veja em Vendas', null, '#vendas'));
  }
  const dAlerts = commemorativeAlerts();
  for (const a of dAlerts.slice(0, 6)) alerts.push(alertRow(a.in_days <= 5 ? 'warn' : '', `${a.name} em ${a.in_days} dia${a.in_days > 1 ? 's' : ''} — sem post planejado para ${a.client}`, `${fmtDay(a.date)} · clique para criar a ideia`, () => openPost(null, { client: a.client_id, date: shiftDay(a.date, a.in_days > 1 ? -1 : 0), title: a.name, stage: 'idea' })));
  if (dAlerts.length > 6) alerts.push(alertRow('', `+${dAlerts.length - 6} datas comemorativas sem post`, 'Veja no calendário', null, '#calendario'));
  const attention = h('section', { class: 'card' }, h('h3', {}, 'Precisa da sua atenção'),
    alerts.length ? h('div', { class: 'alerts' }, ...alerts) : h('p', { class: 'muted', style: 'margin:0' }, 'Tudo certo por aqui ✓'));

  // entregas do mês
  const rows = S.clients.map((c) => ({ c, d: S.deliv?.[c.id] })).filter(({ d }) => d && (d.posts.quota != null || d.reels.quota != null || d.posts.planned || d.reels.planned));
  const [y, mo] = month.split('-').map(Number);
  const frac = Number(today.slice(8)) / new Date(Date.UTC(y, mo, 0)).getUTCDate();
  const pace = (x) => {
    if (x.quota == null) return null;
    if (x.planned >= x.quota) return h('span', { class: 'pace ok' }, 'completo ✓');
    if (x.planned < Math.floor(x.quota * frac)) return h('span', { class: 'pace bad' }, `faltam ${x.quota - x.planned}`);
    return h('span', { class: 'pace' }, `faltam ${x.quota - x.planned}`);
  };
  const delivCard = h('section', { class: 'card' }, h('div', { class: 'home-card-head' }, h('h3', {}, `Entregas de ${monthLabel(month).toLowerCase()}`), h('span', { class: 'muted', style: 'font-size:12.5px' }, 'programados / cota')),
    rows.length ? h('div', { class: 'dtable' }, ...rows.map(({ c, d }) => h('div', { class: 'drow' },
      h('b', {}, c.name),
      h('div', {}, h('span', { class: 'mono' }, d.posts.quota != null ? `${d.posts.planned}/${d.posts.quota}` : d.posts.planned), ' posts ', pace(d.posts)),
      h('div', {}, h('span', { class: 'mono' }, d.reels.quota != null ? `${d.reels.planned}/${d.reels.quota}` : d.reels.planned), ' Reels ', pace(d.reels)))))
      : h('p', { class: 'muted', style: 'margin:0' }, S.role === 'admin' ? 'Defina a cota de cada cliente em Pasta → Contrato → Editar dados.' : 'Sem cotas definidas.'));

  // reajustes (aniversário do contrato)
  let reaj = null;
  if (can('financeiro')) {
    const list = S.clients.filter((c) => c.billing_start && c.billing_start.slice(5, 7) === month.slice(5, 7) && c.billing_start.slice(0, 4) < month.slice(0, 4));
    if (list.length) reaj = h('section', { class: 'card' }, h('h3', {}, 'Reajustes do mês'),
      h('span', { class: 'muted', style: 'font-size:13.5px' }, 'Contratos que fazem aniversário este mês: hora de aplicar o IPCA de 12 meses (cláusula 6.4) e avisar o cliente.'),
      h('div', { class: 'alerts' }, ...list.map((c) => alertRow('', `${c.name} · ${Number(month.slice(0, 4)) - Number(c.billing_start.slice(0, 4))} ano(s) de contrato`, `Mensalidade atual ${brl(c.monthly_fee_cents)}`, null, `#pasta/${c.id}`))));
  }

  if (!S.clients.length) return [hero, noClients()];
  return [hero, pushPrompt(), h('div', { class: 'home-kpis' }, ...tiles),
    h('div', { class: 'home-grid' }, h('div', { class: 'home-col' }, todayCard, attention, chargesCard()), h('div', { class: 'home-col' }, delivCard, upcomingDatesCard(), reaj, approvalReminders(), requestsInbox()))].filter(Boolean);
}
const kpi = (label, value, sub, tone = '') => h('div', { class: `stat ${tone}` }, h('div', { class: 'eyebrow' }, label), h('div', { class: 'stat-v' }, value), h('div', { class: 'muted', style: 'font-size:12.5px' }, sub));
function alertRow(tone, title, sub, onclick, href) {
  const inner = [h('span', { class: `dot ${tone}` }), h('span', { class: 'al-main' }, h('b', {}, title), h('span', { class: 'muted' }, sub)), h('span', { class: 'muted' }, '→')];
  return href ? h('a', { class: 'alert', href }, ...inner) : h('button', { class: 'alert', type: 'button', onclick }, ...inner);
}

// ───────────────────────── PROPOSTAS comerciais
const PROP_LABEL = { draft: ['Rascunho', 'st-draft'], sent: ['Enviada', 'st-pending_approval'], accepted: ['Aceita', 'st-approved'], declined: ['Recusada', 'st-failed'] };
function viewProposals() {
  if (S.proposals === undefined) { S.proposals = null; api('/api/pasta?r=proposals').then((v) => { S.proposals = v; }).catch(() => { S.proposals = false; }).finally(() => render()); }
  const head = h('div', { class: 'page-head' }, h('div', {}, h('div', { class: 'eyebrow' }, 'Comercial'), h('h1', {}, 'Propostas')), h('div', { class: 'spacer' }),
    h('button', { class: 'btn primary', onclick: () => openProposal() }, '+ Nova proposta'));
  if (S.proposals === false) return [head, h('div', { class: 'banner' }, 'As propostas precisam da atualização do banco. ', h('a', { href: '#ajustes' }, 'Ver em Ajustes'), '.')];
  if (!S.proposals) return [head, h('p', { class: 'muted' }, 'Carregando…')];
  if (!S.proposals.length) return [head, h('div', { class: 'empty' }, h('h3', {}, 'Nenhuma proposta ainda'),
    h('p', { class: 'muted' }, 'Monte a proposta, mande o link pelo WhatsApp e, quando o cliente aceitar, o cadastro, a pasta, o contrato e a área do cliente já ficam prontos.'),
    h('button', { class: 'btn primary', onclick: () => openProposal() }, '+ Nova proposta'))];
  const sent = S.proposals.filter((p) => p.status === 'sent').reduce((s, p) => s + p.monthly_fee_cents, 0);
  const won = S.proposals.filter((p) => p.status === 'accepted');
  return [head,
    h('div', { class: 'stats' },
      stat('Em negociação', brl(sent), `${S.proposals.filter((p) => p.status === 'sent').length} proposta(s) enviada(s) / mês`),
      stat('Fechadas', String(won.length), `${brl(won.reduce((s, p) => s + p.monthly_fee_cents, 0))} / mês`, 'good'),
      stat('Conversão', S.proposals.filter((p) => p.status !== 'draft').length ? `${Math.round(100 * won.length / S.proposals.filter((p) => ['sent', 'accepted', 'declined'].includes(p.status)).length)}%` : '—', 'aceitas ÷ enviadas')),
    h('div', { class: 'grid-clients' }, ...S.proposals.map((p) => {
      const [label, cls] = PROP_LABEL[p.status];
      const msg = `Olá${p.contact?.name ? `, ${p.contact.name.split(' ')[0]}` : ''}! Segue a nossa proposta para o Instagram de ${p.client_name}:\n${p.url}\n\nPor lá você vê tudo o que está incluso e já pode aceitar. Qualquer dúvida, me chama! 🙂`;
      return h('article', { class: 'card' },
        h('div', { style: 'display:flex;align-items:center;gap:10px' }, h('h3', { style: 'flex:1;min-width:0' }, p.client_name), h('span', { class: `pill ${cls}` }, label)),
        h('div', { class: 'stat-v', style: 'font-size:24px' }, brl(p.monthly_fee_cents), h('span', { class: 'muted', style: 'font-size:14px;font-weight:600' }, ' /mês')),
        h('div', { class: 'muted', style: 'font-size:13px' }, [p.entregas, p.valid_until ? `válida até ${fmtDay(p.valid_until)}` : null, p.accepted_at ? `aceita em ${fmtDay(partsInTz(p.accepted_at, S.tz).date)}` : null].filter(Boolean).join(' · ')),
        p.status === 'declined' && p.accepted?.reason ? h('div', { class: 'feedback' }, h('b', {}, 'Motivo:'), h('span', {}, p.accepted.reason)) : null,
        h('div', { class: 'actions' },
          h('a', { class: 'btn sm', href: p.url, target: '_blank', rel: 'noopener' }, p.status === 'draft' ? 'Pré-visualizar' : 'Abrir'),
          p.status === 'sent' ? h('button', { class: 'btn sm', onclick: () => copyText(p.url, 'Link copiado.') }, 'Copiar link') : null,
          p.status === 'sent' && p.contact?.whatsapp ? h('a', { class: 'btn wa sm', href: waLink(p.contact.whatsapp, msg), target: '_blank', rel: 'noopener' }, 'WhatsApp') : null,
          p.status === 'accepted' && p.client_id ? h('a', { class: 'btn primary sm', href: `#pasta/${p.client_id}` }, 'Abrir pasta do cliente') : null,
          p.status !== 'accepted' ? h('button', { class: 'btn sm', onclick: () => openProposal(p) }, 'Editar') : null,
          h('button', { class: 'btn ghost sm', onclick: () => openProposal({ ...p, id: null, status: 'draft', client_name: `${p.client_name} (cópia)` }) }, 'Duplicar'),
          Object.assign(confirmButton('Apagar', 'Confirmar exclusão', async () => {
            try { await api(`/api/pasta?r=proposals&id=${p.id}`, { method: 'DELETE' }); S.proposals = S.proposals.filter((x) => x.id !== p.id); render(); toast(p.status === 'accepted' ? 'Proposta apagada. O cliente e o contrato continuam.' : 'Proposta apagada.'); }
            catch (e) { toast(e.message, true); }
          }, 'btn ghost danger sm'), { style: 'margin-left:auto' })));
    }))];
}

const DEFAULT_ITEMS = [
  { title: 'Planejamento editorial mensal', desc: 'Calendário com temas, formatos e datas alinhados aos objetivos do mês.' },
  { title: 'Criação de artes e vídeos', desc: 'Posts, carrosséis e Reels com a identidade visual da marca.' },
  { title: 'Legendas e hashtags', desc: 'Textos estratégicos no tom de voz da marca.' },
  { title: 'Aprovação pelo celular', desc: 'Você aprova ou pede ajuste em um link, sem baixar nada.' },
  { title: 'Publicação automática', desc: 'Tudo sai sozinho no melhor horário para o seu público.' },
  { title: 'Relatório mensal', desc: 'Alcance, interações, seguidores e os melhores posts do mês.' },
];
function openProposal(p = null) {
  const isNew = !p?.id;
  const v = (x) => x ?? '';
  const inp = (id, label, value, attrs = {}) => { const el = h(attrs.tag || 'input', { id, ...attrs, tag: null }); el.value = v(value); return [el, h('div', { class: 'field' }, h('label', { for: id }, label), el)]; };
  const [name, fName] = inp('pp-name', 'Cliente (empresa ou perfil)', p?.client_name, { placeholder: 'Ex.: MY PET' });
  const [cname, fCname] = inp('pp-cname', 'Nome do contato', p?.contact?.name, { placeholder: 'Ex.: Christina' });
  const [cwa, fCwa] = inp('pp-cwa', 'WhatsApp do contato', p?.contact?.whatsapp ? p.contact.whatsapp.replace(/^55/, '') : '', { type: 'tel', placeholder: '65 99999-9999' });
  const [cmail, fCmail] = inp('pp-cmail', 'E-mail do contato', p?.contact?.email, { type: 'email' });
  const [intro, fIntro] = inp('pp-intro', 'Mensagem de abertura (opcional)', p?.intro, { tag: 'textarea', style: 'min-height:80px', placeholder: 'Se deixar em branco, o app escreve uma abertura padrão com o nome do cliente.' });
  const [qp, fQp] = inp('pp-qp', 'Posts de feed por mês', p?.quota_posts ?? 8, { type: 'number', min: 0 });
  const [qr, fQr] = inp('pp-qr', 'Reels por mês', p?.quota_reels ?? 4, { type: 'number', min: 0 });
  const [entr, fEntr] = inp('pp-entr', 'Entregas (texto que vai no contrato)', p?.entregas, { placeholder: 'calculado automaticamente' });
  const [fee, fFee] = inp('pp-fee', 'Valor mensal (R$)', p?.monthly_fee_cents ? (p.monthly_fee_cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '', { inputmode: 'decimal', placeholder: '1.300,00' });
  const [days, fDays] = inp('pp-days', 'Vencimento(s): dia(s) do mês', (p?.installments || [{ day: 10 }]).map((x) => x.day).join(', '), { placeholder: '10  ou  4, 14, 24 (parcelado)' });
  const [forma, fForma] = inp('pp-forma', 'Forma de pagamento', p?.forma_pagamento ?? 'via Pix', {});
  const [valid, fValid] = inp('pp-valid', 'Válida até', p?.valid_until || new Date(Date.now() + 15 * 864e5).toISOString().slice(0, 10), { type: 'date' });
  const [notes, fNotes] = inp('pp-notes', 'Observações para o cliente (opcional)', p?.notes, { tag: 'textarea', style: 'min-height:70px', placeholder: 'Ex.: gravações presenciais 1x por mês incluídas; tráfego pago é orçado à parte.' });
  let items = (p?.items?.length ? p.items : DEFAULT_ITEMS).map((x) => ({ ...x }));
  const itemsBox = h('div', { class: 'pp-items' });
  const drawItems = () => itemsBox.replaceChildren(...items.map((it, i) => h('div', { class: 'pp-item' },
    h('input', { value: it.title, placeholder: 'Item', oninput: (e) => { it.title = e.target.value; } }),
    h('input', { value: it.desc || '', placeholder: 'Descrição curta', oninput: (e) => { it.desc = e.target.value; } }),
    h('button', { type: 'button', class: 'linkish', 'aria-label': 'Remover item', onclick: () => { items.splice(i, 1); drawItems(); } }, '✕'))),
    items.length < 12 ? h('button', { type: 'button', class: 'btn sm', onclick: () => { items.push({ title: '', desc: '' }); drawItems(); } }, '+ Item') : null);
  drawItems();
  const autoEntregas = () => { const a = Number(qp.value) || 0, b = Number(qr.value) || 0; return [a ? `${a} posts no feed` : null, b ? `${b} Reels` : null].filter(Boolean).join(' e ') + (a + b ? ` por mês (até ${a + b} conteúdos)` : ''); };
  entr.placeholder = autoEntregas();
  [qp, qr].forEach((el) => el.addEventListener('input', () => { entr.placeholder = autoEntregas(); }));
  const payload = () => {
    const cents = Math.round(Number(fee.value.replace(/[R$\s]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.')) * 100);
    const ds = days.value.split(/[,;\s]+/).map(Number).filter((n) => n >= 1 && n <= 31).slice(0, 6);
    const split = ds.length ? splitCents(cents || 0, ds.length) : [];
    return {
      client_name: name.value, contact: { name: cname.value, whatsapp: cwa.value, email: cmail.value }, intro: intro.value,
      items: items.filter((i) => i.title.trim()), quota_posts: qp.value, quota_reels: qr.value, entregas: entr.value || autoEntregas(),
      monthly_fee: fee.value, installments: ds.length ? ds.map((d, i) => ({ day: d, cents: split[i] })) : [{ day: 10, cents }],
      forma_pagamento: forma.value, valid_until: valid.value, notes: notes.value,
    };
  };
  const save = async (sendIt) => {
    try {
      const body = { ...payload(), send: sendIt, lead_id: p?.lead_id || undefined };
      const row = isNew ? await api('/api/pasta?r=proposals', { method: 'POST', body }) : await api('/api/pasta?r=proposals', { method: 'PATCH', body: { ...body, id: p.id } });
      S.proposals = [row, ...(S.proposals || []).filter((x) => x.id !== row.id)];
      close(); render();
      toast(sendIt ? 'Proposta pronta para enviar. Copie o link ou mande pelo WhatsApp.' : 'Rascunho salvo.');
      if (location.hash !== '#propostas') location.hash = '#propostas';
    } catch (e) { toast(e.message, true); }
  };
  const foot = [];
  if (!isNew) foot.push(confirmButton('Apagar', 'Confirmar exclusão', async () => { await api(`/api/pasta?r=proposals&id=${p.id}`, { method: 'DELETE' }); S.proposals = S.proposals.filter((x) => x.id !== p.id); close(); render(); toast('Proposta apagada.'); }, 'btn ghost danger'));
  foot.push(h('span', { class: 'spacer' }), h('button', { class: 'btn', onclick: () => save(false) }, 'Salvar rascunho'), h('button', { class: 'btn primary', onclick: () => save(true) }, p?.status === 'sent' ? 'Salvar' : 'Salvar e liberar link'));
  const close = drawer(isNew ? 'Nova proposta' : `Proposta · ${p.client_name}`, [
    h('div', { class: 'eyebrow' }, 'Para quem'), fName, h('div', { class: 'grid-2 tight' }, fCname, fCwa), fCmail, fIntro,
    h('div', { class: 'eyebrow' }, 'O que está incluso'), itemsBox,
    h('div', { class: 'eyebrow' }, 'Entregas e investimento'), h('div', { class: 'grid-2 tight' }, fQp, fQr), fEntr,
    h('div', { class: 'grid-2 tight' }, fFee, fDays), h('div', { class: 'grid-2 tight' }, fForma, fValid), fNotes,
    h('p', { class: 'hint muted', style: 'margin:0' }, 'Quando o cliente aceitar, o app cria o cadastro com esses valores, a cota de entregas, as parcelas, os dados do contrato e o link da área do cliente.'),
  ], foot);
  name.focus();
}

// ───────────────────────── Pix automático (Asaas)
function openPix(c, m, p) {
  const box = h('div', { class: 'pix-box' }, h('p', { class: 'muted' }, 'Gerando o Pix…'));
  drawer(`Pix · ${c.name}`, [box], []);
  api('/api/pasta?r=pix', { method: 'POST', body: { client_id: c.id, month: m.month, n: p.n } }).then((r) => {
    const msg = `Olá! Segue o Pix ${r.label.toLowerCase()} (${brl(r.value_cents)}), vencimento ${fmtDay(r.due)}.\n\nPix copia e cola:\n${r.payload}\n\nAssim que pagar, a baixa é automática por aqui. Obrigado! 🙂`;
    box.replaceChildren(
      h('div', { class: 'eyebrow' }, r.label),
      h('div', { class: 'stat-v' }, brl(r.value_cents)),
      h('span', { class: 'muted', style: 'font-size:13.5px' }, `Vencimento ${fmtDay(r.due)} · cobrança exclusiva desta parcela: quando o cliente pagar, ela é baixada sozinha e o comprovante fica no financeiro.`),
      r.image ? h('img', { class: 'pix-qr', src: r.image, alt: 'QR Code do Pix' }) : null,
      h('div', { class: 'linkbox' }, h('code', { translate: 'no' }, r.payload), h('button', { class: 'btn sm', onclick: () => copyText(r.payload, 'Pix copia e cola copiado.') }, 'Copiar')),
      h('div', { class: 'actions' },
        c.contact_whatsapp ? h('a', { class: 'btn wa', href: waLink(c.contact_whatsapp, msg), target: '_blank', rel: 'noopener' }, 'Enviar no WhatsApp') : null,
        h('button', { class: 'btn', onclick: () => copyText(msg, 'Mensagem copiada.') }, 'Copiar mensagem')));
    const i = S.payments.findIndex((x) => x.client_id === c.id && x.ref_month === m.month && (x.installment || 1) === p.n);
    const row = { client_id: c.id, ref_month: m.month, installment: p.n, status: 'pending', amount_cents: r.value_cents, asaas_id: r.asaas_id, pix_payload: r.payload };
    if (i >= 0) S.payments[i] = { ...S.payments[i], ...row }; else S.payments.push(row);
  }).catch((e) => box.replaceChildren(h('div', { class: 'errorbox' }, e.message)));
}

function settingsPix() {
  const st = S.setup || {};
  const head = h('div', { class: 'page-head', style: 'margin-top:12px' }, h('div', {}, h('div', { class: 'eyebrow' }, 'Financeiro'), h('h2', { style: 'font-size:22px' }, 'Pix automático')));
  if (!st.asaas) {
    return [head, h('article', { class: 'card' },
      h('span', { class: 'ig-warn' }, '• Desligado'),
      h('span', { class: 'muted', style: 'font-size:14px' }, 'Com o Pix automático, cada parcela ganha um Pix exclusivo (QR Code e copia-e-cola). Quando o cliente paga, o app dá baixa sozinho e guarda o comprovante. Usa o Asaas como cobrador (o Nubank não tem integração de Pix): R$ 1,99 por Pix recebido (R$ 0,99 nos 3 primeiros meses), sem custo para gerar.'),
      h('ol', { style: 'margin:0;padding-left:18px;display:grid;gap:6px;font-size:14px' },
        h('li', {}, 'Crie a conta PJ no asaas.com com o CNPJ da agência e cadastre uma chave Pix dentro do Asaas.'),
        h('li', {}, 'No Asaas, ative a transferência automática do saldo para a sua conta Nubank (assim o dinheiro chega lá sozinho).'),
        h('li', {}, 'Em Integrações → Chave de API, gere a chave e copie.'),
        h('li', {}, 'Na Vercel, adicione a variável ASAAS_API_KEY com essa chave e faça Redeploy. Volte aqui para ligar o aviso automático.')),
      h('span', { class: 'hint muted' }, 'Quer testar antes sem dinheiro de verdade? Use uma chave do sandbox do Asaas (começa com $aact_hmlg_). Depois troque pela de produção.'))];
  }
  if (S.pixStatus === undefined) { S.pixStatus = null; api('/api/pasta?r=pix').then((v) => { S.pixStatus = v; }).catch((e) => { S.pixStatus = { error: e.message }; }).finally(() => { if (S.view === 'ajustes') render(); }); }
  const ps = S.pixStatus;
  const email = h('input', { type: 'email', id: 'asaas-mail', value: S.settings?.agency?.email || '', placeholder: 'e-mail para avisos de falha' });
  const hookOk = ps?.webhook?.enabled && !ps.webhook.interrupted;
  return [head, h('article', { class: 'card' },
    ps === null ? h('span', { class: 'muted' }, 'Verificando a conexão com o Asaas…')
      : ps.error ? h('div', { class: 'errorbox' }, h('b', {}, 'Asaas: '), ps.error)
      : h('span', { class: 'ig-ok' }, `✓ Conectado ao Asaas (${st.asaas.env === 'sandbox' ? 'modo teste/sandbox' : 'produção'})${ps.account?.balance != null ? ` · saldo ${brl(Math.round(ps.account.balance * 100))}` : ''}`),
    ps && !ps.error ? (hookOk ? h('span', { class: 'ig-ok' }, '✓ Baixa automática ligada') : h('span', { class: 'ig-warn' }, ps.webhook?.interrupted ? '• Aviso automático pausado pelo Asaas (falhas seguidas) — ligue de novo' : '• Baixa automática ainda não ligada')) : null,
    h('div', { class: 'field' }, h('label', { for: 'asaas-mail' }, 'E-mail para o Asaas avisar se algo falhar'), email),
    h('div', { class: 'actions' },
      h('button', { class: `btn ${hookOk ? '' : 'primary'} sm`, onclick: async (e) => {
        e.target.disabled = true;
        try { await api('/api/pasta?r=pix&setup=1', { method: 'POST', body: { email: email.value } }); S.pixStatus = undefined; toast('Baixa automática ligada.'); render(); }
        catch (err) { toast(err.message, true); e.target.disabled = false; }
      } }, hookOk ? 'Reconfigurar aviso' : 'Ligar baixa automática')),
    h('span', { class: 'muted', style: 'font-size:13px' }, 'Como usar: no Financeiro de cada cliente aparece o botão "Pix" nas parcelas em aberto; na área do cliente aparece "Pagar com Pix". As mensagens de cobrança já levam o link. Se você der baixa manual numa parcela com Pix gerado, o app cancela a cobrança no Asaas.')), nfCard()];
}

// ───────────────────────── datas comemorativas (Início)
const shiftDay = (day, n) => new Date(new Date(`${day}T12:00:00Z`).getTime() + n * 864e5).toISOString().slice(0, 10);
function postDaysOf(clientId) {
  return [...S.posts, ...S.cal.posts].filter((p) => p.client_id === clientId && p.scheduled_at).map((p) => dayKey(p.scheduled_at, S.tz));
}
const dismissedDates = () => { try { return new Set(JSON.parse(localStorage.getItem('mc_dates_off') || '[]')); } catch { return new Set(); } };
function commemorativeAlerts() {
  const clients = S.clients.map((c) => ({ id: c.id, name: c.name, niche: c.brand_kit?.niche || null }));
  const off = dismissedDates();
  return dateAlerts(clients, postDaysOf, todayLocal()).filter((a) => !off.has(`${a.client_id}:${a.date}`));
}
function upcomingDatesCard() {
  const today = todayLocal();
  const niches = new Set(S.clients.map((c) => c.brand_kit?.niche).filter(Boolean));
  const list = datesBetween(shiftDay(today, 1), shiftDay(today, 45)).filter((d) => d.major || d.tags.some((t) => niches.has(t))).slice(0, 7);
  if (!list.length) return null;
  return h('section', { class: 'card' }, h('div', { class: 'home-card-head' }, h('h3', {}, 'Datas que vêm aí'), h('a', { href: '#calendario', class: 'muted' }, 'Calendário →')),
    h('div', { class: 'dates-list' }, ...list.map((d) => {
      const target = S.clients.filter((c) => relevantFor(d, c.brand_kit?.niche));
      const covered = target.filter((c) => [0, 1, 2, 3].some((n) => postDaysOf(c.id).includes(shiftDay(d.date, -n))));
      const n = daysBetween(today, d.date);
      return h('div', { class: 'date-row' },
        h('span', { class: 'date-day mono' }, fmtDay(d.date).slice(0, 5)),
        h('span', { class: 'date-name' }, h('b', {}, d.name), h('span', { class: 'muted' }, ` · em ${n} dia${n > 1 ? 's' : ''}`)),
        target.length ? h('span', { class: `pill ${covered.length === target.length ? 'st-approved' : 'st-pending_approval'}`, title: target.filter((c) => !covered.includes(c)).map((c) => c.name).join(', ') || 'Todos com post' }, `${covered.length}/${target.length} com post`) : h('span', { class: 'muted', style: 'font-size:12.5px' }, 'nicho'));
    })),
    h('span', { class: 'hint muted' }, 'Defina o nicho de cada cliente em Pasta → Marca para ver as datas do segmento dele (Dia dos Animais, Dia do Dentista…).'));
}

// ───────────────────────── notificações no celular (Web Push) e app instalável
const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const b64ToBytes = (b64) => { const s = atob(b64.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (b64.length % 4)) % 4)); return Uint8Array.from(s, (c) => c.charCodeAt(0)); };
const deviceName = () => { const ua = navigator.userAgent; return `${/iphone/i.test(ua) ? 'iPhone' : /ipad/i.test(ua) ? 'iPad' : /android/i.test(ua) ? 'Android' : /mac/i.test(ua) ? 'Mac' : /windows/i.test(ua) ? 'Windows' : 'Navegador'}${isStandalone() ? ' (app)' : ''}`; };
async function loadPushState() {
  if (!pushSupported()) return (S.push = isIOS() && !isStandalone() ? 'ios-install' : 'unsupported');
  try {
    const reg = await navigator.serviceWorker.getRegistration('/');
    const sub = reg ? await reg.pushManager.getSubscription() : null;
    S.push = sub ? 'on' : Notification.permission === 'denied' ? 'denied' : 'off';
  } catch { S.push = 'off'; }
  return S.push;
}
async function enablePush() {
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('As notificações foram bloqueadas. Libere nas configurações do navegador (cadeado ao lado do endereço) e tente de novo.');
  const reg = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;
  const { public_key } = await api('/api/pasta?r=push');
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(public_key) });
  await api('/api/pasta?r=push', { method: 'POST', body: { subscription: sub.toJSON(), device: deviceName() } });
  S.push = 'on';
}
async function disablePush() {
  const reg = await navigator.serviceWorker.getRegistration('/');
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  if (sub) { await api('/api/pasta?r=push', { method: 'DELETE', body: { endpoint: sub.endpoint } }).catch(() => {}); await sub.unsubscribe(); }
  S.push = 'off';
}
function pushControls({ compact = false } = {}) {
  if (S.push === undefined) { S.push = null; loadPushState().finally(() => render()); }
  const st = S.push;
  const go = async (e, fn, msg) => { e.target.disabled = true; try { await fn(); toast(msg); } catch (err) { toast(err.message, true); } e.target.disabled = false; render(); };
  if (st === null) return [h('span', { class: 'muted' }, 'Verificando…')];
  if (st === 'ios-install') return [h('span', { class: 'ig-warn' }, '• No iPhone, primeiro instale o app'),
    h('ol', { class: 'steps-ol' }, h('li', {}, 'Abra este painel no Safari.'), h('li', {}, 'Toque em Compartilhar (quadrado com seta) → "Adicionar à Tela de Início".'), h('li', {}, 'Abra o MC DIGITAL pelo ícone novo e volte aqui para ativar.'))];
  if (st === 'unsupported') return [h('span', { class: 'muted' }, 'Este navegador não recebe notificações. Use Chrome, Edge, Firefox ou Safari atualizado.')];
  if (st === 'denied') return [h('span', { class: 'ig-warn' }, '• Notificações bloqueadas neste aparelho'), h('span', { class: 'muted', style: 'font-size:13.5px' }, 'Libere nas configurações do navegador (cadeado ao lado do endereço → Notificações → Permitir) e recarregue a página.')];
  if (st === 'on') return [h('span', { class: 'ig-ok' }, '✓ Este aparelho recebe os avisos'),
    h('div', { class: 'actions' }, h('button', { class: 'btn sm', onclick: (e) => go(e, () => api('/api/pasta?r=push&test=1', { method: 'POST' }), 'Notificação de teste enviada.') }, 'Enviar teste'),
      compact ? null : h('button', { class: 'btn ghost sm', onclick: (e) => go(e, disablePush, 'Notificações desligadas neste aparelho.') }, 'Desligar neste aparelho'))];
  return [h('button', { class: 'btn primary sm', style: 'justify-self:start', onclick: (e) => go(e, enablePush, 'Pronto! Este aparelho vai receber os avisos.') }, '🔔 Ativar notificações neste aparelho')];
}
function pushPrompt() {
  if (S.push === undefined) { S.push = null; loadPushState().finally(() => render()); }
  let off = false; try { off = localStorage.getItem('mc_push_prompt') === 'off'; } catch { /* ok */ }
  if (off || !['off', 'ios-install'].includes(S.push)) return null;
  return h('section', { class: 'card push-prompt' },
    h('div', { class: 'push-ico', 'aria-hidden': 'true' }, '🔔'),
    h('div', { style: 'display:grid;gap:8px;min-width:0' },
      h('b', {}, 'Receba os avisos no celular'),
      h('span', { class: 'muted', style: 'font-size:13.5px' }, 'Cliente aprovou, pediu ajuste, mandou pedido, aceitou proposta, pagou o Pix ou um post falhou: você fica sabendo na hora, sem abrir o painel.'),
      ...pushControls({ compact: true })),
    h('button', { class: 'btn ghost sm', 'aria-label': 'Agora não', onclick: () => { try { localStorage.setItem('mc_push_prompt', 'off'); } catch { /* ok */ } render(); } }, '✕'));
}
function settingsDevice() {
  return [h('div', { class: 'page-head', style: 'margin-top:12px' }, h('div', {}, h('div', { class: 'eyebrow' }, 'Celular'), h('h2', { style: 'font-size:22px' }, 'App e notificações'))),
    h('div', { class: 'grid-clients' },
      h('article', { class: 'card' }, h('div', { class: 'eyebrow' }, 'Avisos na hora'), h('h3', {}, 'Notificações neste aparelho'),
        h('span', { class: 'muted', style: 'font-size:13.5px' }, 'Ative em cada aparelho (celular e computador). Avisa: cliente aprovou ou pediu ajuste, pedido novo, proposta aceita, Pix recebido, nota fiscal e post que falhou.'),
        ...pushControls()),
      h('article', { class: 'card' }, h('div', { class: 'eyebrow' }, 'Tela de início'), h('h3', {}, 'Instalar o MC DIGITAL'),
        isStandalone() ? h('span', { class: 'ig-ok' }, '✓ Você está usando o app instalado') : null,
        h('ol', { class: 'steps-ol' },
          h('li', {}, h('b', {}, 'iPhone: '), 'no Safari, Compartilhar → "Adicionar à Tela de Início".'),
          h('li', {}, h('b', {}, 'Android: '), 'no Chrome, menu ⋮ → "Instalar app" (ou "Adicionar à tela inicial").'),
          h('li', {}, h('b', {}, 'Computador: '), 'no Chrome/Edge, ícone de instalar na barra de endereço.')),
        h('span', { class: 'hint muted' }, 'Abre em tela cheia, com ícone próprio, como um aplicativo.')))];
}

// ───────────────────────── verificação em duas etapas
function loadScript(src) { return new Promise((ok, bad) => { if (document.querySelector(`script[src="${src}"]`)) return ok(); const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = bad; document.head.append(s); }); }
function settingsSecurity() {
  if (S.sec === undefined) { S.sec = null; api('/api/pasta?r=security').then((v) => { S.sec = v; }).catch(() => { S.sec = false; }).finally(() => { if (S.view === 'ajustes') render(); }); }
  const head = h('div', { class: 'page-head', style: 'margin-top:12px' }, h('div', {}, h('div', { class: 'eyebrow' }, 'Segurança'), h('h2', { style: 'font-size:22px' }, 'Verificação em duas etapas')));
  const card = h('article', { class: 'card' });
  if (S.sec === false) card.append(h('span', { class: 'muted' }, 'Disponível depois da atualização do banco de dados.'));
  else if (!S.sec) card.append(h('span', { class: 'muted' }, 'Carregando…'));
  else if (S.sec.enabled) {
    const code = h('input', { class: 'mono otp', inputmode: 'numeric', maxlength: 7, placeholder: '000000', 'aria-label': 'Código atual' });
    card.append(h('span', { class: 'ig-ok' }, '✓ Ligada: para entrar, além da senha, pede o código do app autenticador'),
      S.sec.disabled_by_env ? h('div', { class: 'errorbox' }, 'A variável DISABLE_2FA=1 está ativa na Vercel: o código não está sendo pedido. Apague-a e faça Redeploy assim que recuperar o acesso.') : null,
      h('span', { class: 'muted', style: 'font-size:13.5px' }, 'Perdeu o celular? Na Vercel, crie a variável DISABLE_2FA com valor 1, faça Redeploy, entre só com a senha, desligue e ative de novo no celular novo. Depois apague a variável.'),
      h('div', { class: 'actions' }, code, h('button', { class: 'btn ghost sm', onclick: async (e) => {
        e.target.disabled = true;
        try { S.sec = await api('/api/pasta?r=security', { method: 'DELETE', body: { code: code.value } }); toast('Verificação em duas etapas desligada.'); render(); }
        catch (err) { toast(err.message, true); e.target.disabled = false; }
      } }, 'Desligar')));
  } else {
    const box = h('div', { style: 'display:grid;gap:12px' });
    card.append(h('span', { class: 'ig-warn' }, '• Desligada'),
      h('span', { class: 'muted', style: 'font-size:13.5px' }, 'Protege o painel (financeiro, contratos, dados dos clientes) mesmo se alguém descobrir a sua senha: para entrar, também é preciso o código de 6 números que muda a cada 30 segundos no seu celular. Use Google Authenticator, Microsoft Authenticator ou Authy (grátis).'),
      box);
    const start = h('button', { class: 'btn primary sm', style: 'justify-self:start', onclick: async () => {
      start.disabled = true;
      try {
        const r = await api('/api/pasta?r=security', { method: 'POST', body: { start: 1 } });
        const qr = h('div', { class: 'qr' });
        const code = h('input', { class: 'mono otp', inputmode: 'numeric', maxlength: 7, placeholder: '000000', 'aria-label': 'Código de 6 números' });
        box.replaceChildren(
          h('ol', { class: 'steps-ol' }, h('li', {}, 'No app autenticador, toque em + e escaneie o QR Code.'), h('li', {}, 'Digite abaixo o código de 6 números que apareceu para MC DIGITAL.')),
          qr, h('div', { class: 'linkbox' }, h('code', { translate: 'no' }, r.secret.replace(/(.{4})/g, '$1 ').trim()), h('button', { class: 'btn sm', onclick: () => copyText(r.secret, 'Chave copiada.') }, 'Copiar chave')),
          h('div', { class: 'actions' }, code, h('button', { class: 'btn primary sm', onclick: async (e) => {
            e.target.disabled = true;
            try { S.sec = await api('/api/pasta?r=security', { method: 'POST', body: { code: code.value } }); S.sec = { ...S.sec, enabled: true }; toast('Verificação em duas etapas ligada. No próximo login o app pede o código.'); render(); }
            catch (err) { toast(err.message, true); e.target.disabled = false; }
          } }, 'Confirmar e ligar')));
        try { await loadScript('https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js'); new window.QRCode(qr, { text: r.otpauth, width: 180, height: 180, correctLevel: window.QRCode.CorrectLevel.M }); }
        catch { qr.append(h('span', { class: 'muted' }, 'Não consegui desenhar o QR Code: no app, escolha "inserir chave" e cole a chave abaixo.')); }
        code.focus();
      } catch (e) { toast(e.message, true); start.disabled = false; }
    } }, 'Ativar no meu celular');
    box.append(start);
  }
  return [head, h('div', { class: 'grid-clients' }, card)];
}

// ───────────────────────── e-mails automáticos
function settingsMail() {
  const st = S.setup || {};
  const head = h('div', { class: 'page-head', style: 'margin-top:12px' }, h('div', {}, h('div', { class: 'eyebrow' }, 'Clientes'), h('h2', { style: 'font-size:22px' }, 'E-mails automáticos')));
  if (!st.mail_ready) {
    return [head, h('article', { class: 'card' }, h('span', { class: 'ig-warn' }, '• Desligados'),
      h('span', { class: 'muted', style: 'font-size:14px' }, 'O app manda sozinho, para o e-mail de cada cliente: posts esperando aprovação (agrupados), lembrete quando o post sai em 48 h sem aprovação, lembrete de mensalidade (2 dias antes e no dia seguinte ao vencimento, com o Pix) e "seu relatório do mês está pronto".'),
      h('ol', { class: 'steps-ol' },
        h('li', {}, 'Crie uma conta grátis em resend.com (3.000 e-mails/mês grátis).'),
        h('li', {}, 'Em Domains, adicione o domínio da agência e copie os registros DNS que ele mostrar para o seu provedor de domínio (sem domínio próprio, o Resend só entrega para o seu próprio e-mail — dá para testar).'),
        h('li', {}, 'Em API Keys, crie uma chave. Na Vercel, adicione RESEND_API_KEY com ela e MAIL_FROM com o remetente, ex.: MC DIGITAL <contato@seudominio.com.br>. Faça Redeploy.')))];
  }
  if (S.mail === undefined) { S.mail = null; api('/api/pasta?r=mailcfg').then((v) => { S.mail = v; }).catch(() => { S.mail = false; }).finally(() => { if (S.view === 'ajustes') render(); }); }
  if (!S.mail) return [head, h('article', { class: 'card' }, h('span', { class: 'muted' }, S.mail === false ? 'Disponível depois da atualização do banco de dados.' : 'Carregando…'))];
  const labels = { approval: 'Posts enviados para aprovação', reminder: 'Lembrete de aprovação (post sai em 48 h)', charge: 'Lembrete de mensalidade', report: 'Relatório do mês pronto' };
  const to = h('input', { type: 'email', value: S.settings?.agency?.email || '', placeholder: 'seu@email.com', 'aria-label': 'E-mail para teste' });
  return [head, h('article', { class: 'card' },
    h('span', { class: 'ig-ok' }, `✓ Ligados · remetente ${S.mail.from}`),
    h('div', { class: 'toggles' }, ...Object.entries(labels).map(([k, l]) => h('label', { class: 'toggle' },
      h('input', { type: 'checkbox', checked: S.mail.settings[k], onchange: async (e) => {
        try { S.mail = { ...S.mail, ...(await api('/api/pasta?r=mailcfg', { method: 'PUT', body: { [k]: e.target.checked } })) }; toast('Salvo.'); } catch (err) { toast(err.message, true); e.target.checked = !e.target.checked; }
      } }), h('span', {}, l)))),
    h('span', { class: 'hint muted' }, 'Vai para o e-mail cadastrado em cada cliente (Clientes → Editar). As respostas chegam no e-mail da agência.'),
    h('div', { class: 'actions' }, to, h('button', { class: 'btn sm', onclick: async (e) => {
      e.target.disabled = true;
      try { await api('/api/pasta?r=mailcfg', { method: 'POST', body: { to: to.value } }); toast('E-mail de teste enviado. Confira a caixa de entrada (e o spam).'); } catch (err) { toast(err.message, true); }
      e.target.disabled = false;
    } }, 'Enviar e-mail de teste')),
    S.mail.recent?.length ? h('details', {}, h('summary', { class: 'muted' }, `Últimos envios (${S.mail.recent.length})`),
      h('ul', { class: 'mail-log' }, ...S.mail.recent.map((m) => h('li', {}, h('span', { class: 'mono' }, `${fmtDate(m.sent_at, S.tz)} ${fmtTime(m.sent_at, S.tz)}`), ' ', ({ approval: 'aprovação', reminder: 'lembrete de aprovação', charge: 'cobrança', report: 'relatório' })[m.key.split(':')[0]] || m.key.split(':')[0], ' · ', clientName(m.key.split(':')[1]))))) : null)];
}

// ───────────────────────── backup
function settingsBackup() {
  if (S.backups === undefined) { S.backups = null; api('/api/pasta?r=backup').then((v) => { S.backups = v; }).catch(() => { S.backups = false; }).finally(() => { if (S.view === 'ajustes') render(); }); }
  const head = h('div', { class: 'page-head', style: 'margin-top:12px' }, h('div', {}, h('div', { class: 'eyebrow' }, 'Proteção dos dados'), h('h2', { style: 'font-size:22px' }, 'Backup')));
  const list = S.backups || [];
  const last = list[0];
  const age = last ? Math.floor((Date.now() - new Date(last.at)) / 864e5) : null;
  return [head, h('article', { class: 'card' },
    S.backups === null ? h('span', { class: 'muted' }, 'Carregando…')
      : last ? h('span', { class: age <= 8 ? 'ig-ok' : 'ig-warn' }, `${age <= 8 ? '✓' : '•'} Último backup ${age === 0 ? 'hoje' : `há ${age} dia${age > 1 ? 's' : ''}`} · ${last.rows} registros`)
      : h('span', { class: 'ig-warn' }, '• Nenhum backup ainda (o primeiro sai sozinho na próxima rodada do agendador)'),
    h('span', { class: 'muted', style: 'font-size:13.5px' }, 'Toda semana o app copia sozinho todos os dados (clientes, posts, contratos, pagamentos, relatórios, propostas…) para um arquivo no cofre privado. Ficam as 8 últimas cópias. Baixe uma de vez em quando e guarde no seu Google Drive: se algo der errado no Supabase, os dados voltam a partir dele.'),
    list.length ? h('div', { class: 'backup-list' }, ...list.map((b) => h('div', { class: 'backup-row' },
      h('span', {}, h('b', {}, `${fmtDate(b.at, S.tz)} ${fmtTime(b.at, S.tz)}`), h('span', { class: 'muted' }, ` · ${b.reason === 'manual' ? 'manual' : 'automático'} · ${fileSize(b.size)}`)),
      h('a', { class: 'btn sm', href: `/api/pasta?r=backup&path=${encodeURIComponent(b.path)}` }, 'Baixar')))) : null,
    h('button', { class: 'btn sm', style: 'justify-self:start', onclick: async (e) => {
      e.target.disabled = true;
      try { const b = await api('/api/pasta?r=backup', { method: 'POST' }); S.backups = [b, ...(S.backups || []).filter((x) => x.path !== b.path)].slice(0, 8); toast('Backup feito.'); render(); }
      catch (err) { toast(err.message, true); e.target.disabled = false; }
    } }, 'Fazer backup agora'),
    h('span', { class: 'hint muted' }, 'O arquivo tem dados sensíveis (contratos, tokens do Instagram): guarde em lugar seguro e não compartilhe.'))];
}

// ───────────────────────── nota fiscal automática (dentro de Pix automático)
function nfCard() {
  if (S.nf === undefined) { S.nf = null; api('/api/pasta?r=nf').then((v) => { S.nf = v; }).catch(() => { S.nf = false; }).finally(() => { if (S.view === 'ajustes') render(); }); }
  if (!S.nf) return null;
  const n = S.nf.settings;
  const inp = (id, label, value, ph, hint) => { const el = h('input', { id, value: value ?? '', placeholder: ph }); return [el, h('div', { class: 'field' }, h('label', { for: id }, label), el, hint ? h('span', { class: 'hint' }, hint) : null)]; };
  const [desc, fDesc] = inp('nf-desc', 'Descrição do serviço na nota', n.service_description, 'Gestão de redes sociais (social media)');
  const [code, fCode] = inp('nf-code', 'Código do serviço municipal', n.municipal_service_code, 'Ex.: 17.06', 'Item da lista de serviços (LC 116) usado pela sua prefeitura. Para social media costuma ser 17.06 ou 17.01 — confirme com o contador.');
  const [name, fName] = inp('nf-name', 'Nome do serviço municipal (opcional)', n.municipal_service_name, 'Propaganda e publicidade…');
  const [iss, fIss] = inp('nf-iss', 'Alíquota de ISS (%)', String(n.iss ?? 0), '2', 'No Simples Nacional/MEI, use a que o contador indicar.');
  const [obs, fObs] = inp('nf-obs', 'Observações (opcional)', n.observations, 'Deixe em branco para "Mensalidade MM/AAAA"');
  const enabled = h('input', { type: 'checkbox', checked: n.enabled });
  return h('article', { class: 'card', style: 'margin-top:12px' },
    h('div', { class: 'eyebrow' }, 'Nota fiscal automática'), h('h3', {}, 'Emitir NFS-e quando o Pix cair'),
    h('span', { class: 'muted', style: 'font-size:13.5px' }, 'Quando o cliente paga o Pix, o Asaas emite a nota de serviço na prefeitura e o PDF autorizado vai sozinho para a pasta do cliente (Financeiro → Notas fiscais) e para a área dele. Antes, configure a emissão no Asaas: Notas fiscais → Configurações (dados da prefeitura, regime e certificado/senha, conforme a cidade).'),
    h('label', { class: 'toggle' }, enabled, h('span', {}, 'Emitir a nota automaticamente a cada Pix recebido')),
    fDesc, h('div', { class: 'grid-2 tight' }, fCode, fIss), fName, fObs,
    h('button', { class: 'btn primary sm', style: 'justify-self:start', onclick: async (e) => {
      e.target.disabled = true;
      try { S.nf = { ...S.nf, ...(await api('/api/pasta?r=nf', { method: 'PUT', body: { enabled: enabled.checked, service_description: desc.value, municipal_service_code: code.value, municipal_service_name: name.value, iss: iss.value, observations: obs.value } })) }; toast('Nota fiscal salva.'); render(); }
      catch (err) { toast(err.message, true); e.target.disabled = false; }
    } }, 'Salvar'),
    h('span', { class: 'hint muted' }, 'Depois de salvar, clique em "Reconfigurar aviso" acima uma vez, para o Asaas também avisar quando a nota for autorizada.'));
}

// ───────────────────────── planejamento do mês com IA
function openPlan({ client, month } = {}) {
  if (!S.clients.length) return toast('Cadastre um cliente primeiro.', true);
  if (!S.setup?.ai_ready && S.role === 'admin') return toast('A IA ainda não está ligada. Veja a aba Ajustes → Inteligência Artificial.', true);
  const cur = todayLocal().slice(0, 7);
  const sel = h('select', { id: 'pl-client' }, ...S.clients.map((c) => h('option', { value: c.id, selected: c.id === (client || S.fClient || S.clients[0].id) }, c.name)));
  const mIn = h('input', { type: 'month', id: 'pl-month', value: month && month >= cur ? month : (Number(todayLocal().slice(8)) > 20 ? shiftMonth(cur, 1) : cur) });
  const extra = h('textarea', { id: 'pl-extra', style: 'min-height:70px', placeholder: 'Opcional. Ex.: lançamento do plano de banho mensal no dia 15; evitar promoções; 2 Reels de bastidores.' });
  const out = h('div', { class: 'plan-out' });
  const info = h('div', { class: 'muted', style: 'font-size:13.5px' });
  const drawInfo = () => {
    const c = clientById(sel.value); const k = c?.contract_data || {};
    info.replaceChildren(`A IA usa a marca (${c?.brand_kit?.niche ? NICHES[c.brand_kit.niche] : 'nicho não definido'}), o tom de voz, a cota (${k.quota_posts ?? '—'} posts · ${k.quota_reels ?? '—'} Reels por mês), os melhores posts dos relatórios, os melhores horários e as datas comemorativas. Planeja só o que falta no calendário do mês.`);
  };
  sel.addEventListener('change', drawInfo); drawInfo();
  let plan = null; const chosen = new Set();
  const gen = h('button', { class: 'btn ai', onclick: run }, '✨ Gerar planejamento');
  const create = h('button', { class: 'btn primary', hidden: true, onclick: createIdeas }, 'Criar ideias no Fluxo');
  async function run() {
    gen.disabled = true; create.hidden = true;
    out.replaceChildren(h('div', { class: 'plan-wait' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), h('span', {}, 'Estudando a marca, os resultados e as datas do mês… leva uns 30 segundos.')));
    try {
      plan = await api('/api/pasta?r=plan', { method: 'POST', body: { client_id: sel.value, month: mIn.value, extra: extra.value } });
      chosen.clear(); plan.items.forEach((_, i) => chosen.add(i));
      drawPlan();
    } catch (e) { out.replaceChildren(h('div', { class: 'errorbox' }, e.message)); }
    gen.disabled = false; gen.textContent = '↻ Gerar de novo';
  }
  function drawPlan() {
    const fmtD = (d) => new Intl.DateTimeFormat('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', timeZone: 'UTC' }).format(new Date(`${d}T12:00:00Z`));
    out.replaceChildren(
      plan.strategy ? h('div', { class: 'feedback' }, h('b', {}, 'Linha do mês:'), h('span', {}, plan.strategy)) : null,
      h('div', { class: 'plan-list' }, ...plan.items.map((it, i) => h('label', { class: `plan-item${chosen.has(i) ? ' on' : ''}` },
        h('input', { type: 'checkbox', checked: chosen.has(i), onchange: (e) => { if (e.target.checked) chosen.add(i); else chosen.delete(i); e.target.closest('.plan-item').classList.toggle('on', e.target.checked); create.textContent = `Criar ${chosen.size} ideia${chosen.size === 1 ? '' : 's'} no Fluxo`; } }),
        h('div', { class: 'plan-main' },
          h('div', { class: 'plan-top' }, h('span', { class: 'mono' }, `${fmtD(it.date)} · ${it.time}`), h('span', { class: 'type-badge' }, it.format_label), it.pillar ? h('span', { class: 'muted' }, it.pillar) : null, it.date_hook ? h('span', { class: 'cal-date major' }, it.date_hook) : null),
          h('b', {}, it.title),
          h('span', { class: 'muted plan-idea' }, it.idea),
          it.caption ? h('details', {}, h('summary', { class: 'muted' }, 'Rascunho de legenda'), h('p', { style: 'margin:6px 0 0;white-space:pre-line' }, it.caption), h('p', { class: 'mono', style: 'margin:4px 0 0;font-size:12.5px;color:var(--accent)' }, it.hashtags.join(' '))) : null)))),
      h('span', { class: 'hint muted' }, 'As ideias entram no Fluxo com data, formato, roteiro (nas notas da equipe) e rascunho de legenda. É só produzir a arte e seguir o fluxo normal de aprovação.'));
    create.hidden = false; create.textContent = `Criar ${chosen.size} ideia${chosen.size === 1 ? '' : 's'} no Fluxo`;
  }
  async function createIdeas() {
    if (!chosen.size) return toast('Marque pelo menos uma ideia.', true);
    create.disabled = true;
    try {
      const rows = await api('/api/pasta?r=plan', { method: 'POST', body: { client_id: sel.value, create: true, items: plan.items.filter((_, i) => chosen.has(i)) } });
      rows.forEach((p) => upsert(p, false));
      close(); S.fClient = sel.value; S.cal.month = null; location.hash = '#calendario'; render();
      toast(`${rows.length} ideias criadas para ${clientName(sel.value)}. Estão no calendário e no Fluxo.`);
    } catch (e) { toast(e.message, true); create.disabled = false; }
  }
  const close = drawer('Planejar o mês com IA', [
    h('div', { class: 'grid-2 tight' }, h('div', { class: 'field' }, h('label', { for: 'pl-client' }, 'Cliente'), sel), h('div', { class: 'field' }, h('label', { for: 'pl-month' }, 'Mês'), mIn)),
    h('div', { class: 'field' }, h('label', { for: 'pl-extra' }, 'Pedido para este mês'), extra), info, gen, out,
  ], [h('span', { class: 'spacer' }), create]);
}

// ───────────────────────── duplicar semana
function openDuplicate() {
  const today = todayLocal();
  const t = new Date(`${today}T12:00:00Z`);
  const sunday = shiftDay(today, -t.getUTCDay());
  const from = h('input', { type: 'date', id: 'dp-from', value: shiftDay(sunday, -7) });
  const to = h('input', { type: 'date', id: 'dp-to', value: sunday });
  const sel = h('select', { id: 'dp-client' }, h('option', { value: '' }, 'Todos os clientes'), ...S.clients.map((c) => h('option', { value: c.id, selected: c.id === S.fClient }, c.name)));
  const preview = h('div', { class: 'muted', style: 'font-size:13.5px' });
  const upd = () => {
    const a = from.value, b = to.value; if (!a || !b) return;
    const shift = daysBetween(a, b);
    const n = [...S.posts, ...S.cal.posts].filter((p, i, arr) => arr.findIndex((x) => x.id === p.id) === i && p.scheduled_at && (!sel.value || p.client_id === sel.value)).filter((p) => { const d = dayKey(p.scheduled_at, S.tz); return d >= a && d < shiftDay(a, 7); }).length;
    preview.replaceChildren(shift < 1 ? 'A semana de destino precisa ser depois da semana copiada.' : `${n} post${n === 1 ? '' : 's'} de ${fmtDay(a)} a ${fmtDay(shiftDay(a, 6))} → mesmos dias e horários a partir de ${fmtDay(b)} (+${shift} dias). Viram rascunhos "Em produção" (ideias continuam ideias), com as mesmas artes e legendas para você ajustar.`);
  };
  [from, to, sel].forEach((el) => el.addEventListener('change', upd)); upd();
  const go = h('button', { class: 'btn primary', onclick: async () => {
    const shift = daysBetween(from.value, to.value);
    if (shift < 1) return toast('Escolha uma semana de destino depois da copiada.', true);
    go.disabled = true;
    try {
      const rows = await api('/api/pasta?r=duplicate', { method: 'POST', body: { from: from.value, days: 7, shift, client_id: sel.value || undefined } });
      rows.forEach((p) => upsert(p, false));
      close(); if (S.view === 'calendario') await loadMonth(S.cal.month, true); render();
      toast(`${rows.length} post${rows.length === 1 ? '' : 's'} duplicado${rows.length === 1 ? '' : 's'}.`);
    } catch (e) { toast(e.message, true); go.disabled = false; }
  } }, 'Duplicar');
  const close = drawer('Duplicar semana', [
    h('div', { class: 'grid-2 tight' }, h('div', { class: 'field' }, h('label', { for: 'dp-from' }, 'Copiar a semana que começa em'), from), h('div', { class: 'field' }, h('label', { for: 'dp-to' }, 'Colar na semana que começa em'), to)),
    h('div', { class: 'field' }, h('label', { for: 'dp-client' }, 'Cliente'), sel), preview,
  ], [h('span', { class: 'spacer' }), go]);
}

// ───────────────────────── banco de mídia
async function loadBank(clientId) { return api(`/api/pasta?r=media&client=${clientId}`); }
async function uploadToBank(clientId, files, onStep) {
  const added = [];
  for (const [i, f] of files.entries()) {
    onStep?.(`Enviando ${i + 1} de ${files.length}…`);
    try {
      const img = await prepareImage(f);
      const up = await api(`/api/upload?client=${clientId}`, { method: 'POST', raw: img.blob });
      added.push(await api('/api/pasta?r=media', { method: 'POST', body: { client_id: clientId, url: up.image_url, path: up.image_path, name: f.name } }));
    } catch (e) { toast(`${f.name}: ${e.message}`, true); }
  }
  return added;
}
function bankGrid(items, { onPick, onDelete } = {}) {
  return h('div', { class: 'bank-grid' }, ...items.map((m) => h('figure', { class: 'bank-item' },
    h('img', { src: m.url, alt: m.name || '', loading: 'lazy' }),
    h('figcaption', {},
      onPick ? h('button', { class: 'btn sm primary', type: 'button', onclick: () => onPick(m) }, 'Usar') : null,
      onDelete ? confirmButton('✕', 'Apagar?', () => onDelete(m), 'btn ghost sm') : null))));
}
function openBankPicker(clientId, onPick) {
  const box = h('div', { style: 'display:grid;gap:12px' }, h('p', { class: 'muted' }, 'Carregando…'));
  const input = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true });
  let close;
  const draw = (items) => box.replaceChildren(
    h('div', { class: 'actions' }, h('button', { class: 'btn sm', type: 'button', onclick: () => input.click() }, '+ Enviar fotos para o banco'), input),
    items.length ? bankGrid(items, { onPick: (m) => { onPick(m); close(); } }) : h('p', { class: 'muted', style: 'margin:0' }, 'Nenhuma foto no banco deste cliente ainda. Envie as fotos do cliente (produtos, equipe, espaço) e reaproveite em vários posts.'));
  input.addEventListener('change', async () => {
    const added = await uploadToBank(clientId, [...input.files], (t) => toast(t));
    input.value = ''; if (added.length) toast(`${added.length} foto(s) no banco.`);
    draw(await loadBank(clientId).catch(() => []));
  });
  loadBank(clientId).then(draw).catch((e) => box.replaceChildren(h('div', { class: 'errorbox' }, /media_bank|relation|schema/i.test(e.message) ? 'O banco de mídia precisa da atualização do banco de dados (veja Ajustes).' : e.message)));
  close = drawer(`Banco de mídia · ${clientName(clientId)}`, [box], []);
}
function folderMedia(c) {
  const F = S.folder;
  if (F.mediaFor !== c.id) { F.mediaFor = c.id; F.media = null; loadBank(c.id).then((v) => { F.media = v; }).catch(() => { F.media = false; }).finally(() => render()); }
  if (F.media === false) return [h('div', { class: 'banner' }, 'O banco de mídia precisa da atualização do banco. ', S.role === 'admin' ? h('a', { href: '#ajustes' }, 'Ver em Ajustes') : 'Peça ao administrador.')];
  if (!F.media) return [h('p', { class: 'muted' }, 'Carregando…')];
  const status = h('span', { class: 'muted', style: 'font-size:13px' });
  const input = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true, onchange: async () => {
    const added = await uploadToBank(c.id, [...input.files], (t) => { status.textContent = t; });
    F.media = [...added, ...F.media]; status.textContent = ''; input.value = ''; render(); if (added.length) toast(`${added.length} foto(s) no banco.`);
  } });
  const drop = h('div', { class: 'drop', tabindex: 0, role: 'button', onclick: () => input.click() }, h('b', {}, 'Enviar fotos do cliente'), h('span', { class: 'muted' }, 'Arraste aqui ou clique. Produtos, equipe, espaço, bastidores… viram JPEG otimizado para o Instagram.'));
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', async (e) => { e.preventDefault(); drop.classList.remove('over'); const fs = [...e.dataTransfer.files].filter((f) => f.type.startsWith('image/')); if (!fs.length) return; const added = await uploadToBank(c.id, fs, (t) => { status.textContent = t; }); F.media = [...added, ...F.media]; status.textContent = ''; render(); });
  return [h('section', { class: 'card' },
    h('div', { class: 'eyebrow' }, `${F.media.length} foto${F.media.length === 1 ? '' : 's'}`), h('h3', {}, `Banco de mídia de ${c.name}`),
    h('span', { class: 'muted', style: 'font-size:13.5px' }, 'Fotos do cliente para reaproveitar: no post, clique em "🗂 Banco de mídia" e escolha. Apagar daqui não tira a foto dos posts que já usam.'),
    drop, input, status,
    F.media.length ? bankGrid(F.media, {
      onPick: (m) => openPost(null, { client: c.id, image: m }),
      onDelete: async (m) => { await api(`/api/pasta?r=media&id=${m.id}`, { method: 'DELETE' }); F.media = F.media.filter((x) => x.id !== m.id); render(); toast('Foto removida do banco.'); },
    }) : null)];
}

// ───────────────────────── modelos de legenda e grupos de hashtags
const SNIP_KIND = { caption: 'Modelo de legenda', hashtags: 'Grupo de hashtags' };
function snippetBar(getClient, cap, upd) {
  const bar = h('div', { class: 'snip-bar' });
  let loadedFor = null;
  const insertAt = (text) => { const a = cap.selectionStart ?? cap.value.length; cap.setRangeText(text, a, cap.selectionEnd ?? a, 'end'); cap.focus(); upd(); };
  const addTags = (text) => {
    const have = new Set((cap.value.match(/#[\p{L}\p{N}_]+/gu) || []).map((t) => t.toLowerCase()));
    const add = text.split(/\s+/).filter((t) => t && !have.has(t.toLowerCase()));
    if (!add.length) return toast('Essas hashtags já estão na legenda.');
    cap.value = `${cap.value.trimEnd()}${cap.value.trim() ? '\n\n' : ''}${add.join(' ')}`; upd(); toast(`${add.length} hashtag(s) adicionada(s).`);
  };
  const draw = async () => {
    const cid = getClient();
    if (loadedFor === cid) return; loadedFor = cid;
    let list = [];
    try { list = await api(`/api/pasta?r=snippets&client=${cid}`); } catch { bar.replaceChildren(); return; }
    const caps = list.filter((x) => x.kind === 'caption'), tags = list.filter((x) => x.kind === 'hashtags');
    const nameIn = h('input', { placeholder: 'Nome do modelo', maxlength: 60, class: 'snip-name' });
    const saveBox = h('div', { class: 'snip-save', hidden: true }, nameIn,
      h('button', { class: 'btn sm', type: 'button', onclick: async () => {
        try { await api('/api/pasta?r=snippets', { method: 'POST', body: { kind: 'caption', name: nameIn.value, text: cap.value, client_id: cid } }); loadedFor = null; toast('Modelo salvo para este cliente.'); draw(); }
        catch (e) { toast(e.message, true); }
      } }, 'Salvar'));
    bar.replaceChildren(
      caps.length ? h('div', { class: 'snip-row' }, h('span', { class: 'label' }, 'Modelos'), ...caps.map((x) => h('button', { type: 'button', class: 'chip', title: x.text, onclick: () => insertAt(x.text) }, x.name))) : null,
      tags.length ? h('div', { class: 'snip-row' }, h('span', { class: 'label' }, '# Hashtags'), ...tags.map((x) => h('button', { type: 'button', class: 'chip', title: x.text, onclick: () => addTags(x.text) }, x.name))) : null,
      h('div', { class: 'snip-row' },
        h('button', { type: 'button', class: 'linkish', onclick: () => { if (!cap.value.trim()) return toast('Escreva a legenda antes de salvar como modelo.', true); saveBox.hidden = !saveBox.hidden; if (!saveBox.hidden) nameIn.focus(); } }, '+ Salvar legenda como modelo'),
        h('a', { class: 'linkish', href: `#pasta/${cid}`, onclick: () => { S.folder.tab = 'snippets'; document.querySelectorAll('.drawer, .scrim').forEach((x) => x.remove()); } }, caps.length || tags.length ? 'Gerenciar modelos' : 'Criar grupos de hashtags')),
      saveBox);
  };
  draw();
  bar.addEventListener('mouseenter', draw); // trocou o cliente no post: recarrega
  return bar;
}
function folderSnippets(c) {
  const F = S.folder;
  if (F.snipFor !== c.id) { F.snipFor = c.id; F.snips = null; api(`/api/pasta?r=snippets&client=${c.id}`).then((v) => { F.snips = v; }).catch(() => { F.snips = false; }).finally(() => render()); }
  if (F.snips === false) return [h('div', { class: 'banner' }, 'Os modelos precisam da atualização do banco. ', S.role === 'admin' ? h('a', { href: '#ajustes' }, 'Ver em Ajustes') : 'Peça ao administrador.')];
  if (!F.snips) return [h('p', { class: 'muted' }, 'Carregando…')];
  const kind = h('select', { id: 'sn-kind' }, h('option', { value: 'hashtags' }, SNIP_KIND.hashtags), h('option', { value: 'caption' }, SNIP_KIND.caption));
  const name = h('input', { id: 'sn-name', placeholder: 'Ex.: Pet geral, CTA agendamento, Assinatura', maxlength: 60 });
  const text = h('textarea', { id: 'sn-text', style: 'min-height:80px', placeholder: 'Hashtags separadas por espaço (com ou sem #) ou o texto do modelo de legenda.' });
  const all = h('input', { type: 'checkbox', id: 'sn-all' });
  const add = h('button', { class: 'btn primary sm', style: 'justify-self:start', onclick: async () => {
    add.disabled = true;
    try { const row = await api('/api/pasta?r=snippets', { method: 'POST', body: { kind: kind.value, name: name.value, text: text.value, client_id: all.checked ? null : c.id } }); F.snips = [...F.snips, row].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')); toast('Modelo criado.'); render(); }
    catch (e) { toast(e.message, true); add.disabled = false; }
  } }, 'Adicionar');
  const section = (k) => {
    const list = F.snips.filter((x) => x.kind === k);
    return h('section', { class: 'card' }, h('h3', {}, k === 'hashtags' ? 'Grupos de hashtags' : 'Modelos de legenda'),
      list.length ? h('div', { class: 'snip-list' }, ...list.map((x) => h('div', { class: 'snip-item' },
        h('div', { class: 'snip-head' }, h('b', {}, x.name), x.client_id ? null : h('span', { class: 'pill st-draft' }, 'todos os clientes'),
          h('span', { class: 'spacer' }), h('button', { class: 'btn ghost sm', onclick: () => copyText(x.text, 'Copiado.') }, 'Copiar'),
          confirmButton('Apagar', 'Confirmar', async () => { await api(`/api/pasta?r=snippets&id=${x.id}`, { method: 'DELETE' }); F.snips = F.snips.filter((y) => y.id !== x.id); render(); }, 'btn ghost sm')),
        h('p', { class: k === 'hashtags' ? 'mono snip-text tags' : 'snip-text' }, x.text))))
        : h('p', { class: 'muted', style: 'margin:0' }, k === 'hashtags' ? 'Nenhum grupo ainda. Crie grupos por tema (ex.: "Pet geral", "Banho e tosa", "Cuiabá") e adicione com 1 clique na legenda.' : 'Nenhum modelo ainda. Bom para assinaturas, CTAs e formatos que se repetem.'));
  };
  return [h('section', { class: 'card' }, h('div', { class: 'eyebrow' }, 'Produtividade'), h('h3', {}, 'Novo modelo'),
    h('div', { class: 'grid-2 tight' }, h('div', { class: 'field' }, h('label', { for: 'sn-kind' }, 'Tipo'), kind), h('div', { class: 'field' }, h('label', { for: 'sn-name' }, 'Nome'), name)),
    h('div', { class: 'field' }, h('label', { for: 'sn-text' }, 'Texto'), text),
    h('label', { class: 'toggle' }, all, h('span', {}, 'Usar em todos os clientes (ex.: assinatura da agência)')), add),
  h('div', { class: 'grid-2' }, section('hashtags'), section('caption'))];
}

// ───────────────────────── agenda do dia (horários)
const STATUS_COLOR = { idea: '#6B4FC4', draft: 'var(--s-draft)', internal_review: 'var(--s-draft)', pending_approval: 'var(--s-wait)', changes_requested: 'var(--s-change)', approved: 'var(--s-ok)', publishing: 'var(--s-pub)', published: 'var(--s-pub)', failed: 'var(--s-fail)' };
const movable = (p) => !['publishing', 'published'].includes(p.status);
const fmtTime24 = (iso) => partsInTz(iso, S.tz).time;
async function reschedule(p, date, time) {
  try {
    const saved = await api(`/api/posts?id=${p.id}`, { method: 'PATCH', body: { scheduled_at: zonedToISO(date, time, S.tz) } });
    upsert(saved, false);
    const i = S.cal.posts.findIndex((x) => x.id === p.id); if (i >= 0) S.cal.posts[i] = { ...S.cal.posts[i], ...saved };
    render();
    toast(`Remarcado para ${fmtDay(date).slice(0, 5)} às ${time}.${['pending_approval', 'approved'].includes(saved.status) ? ' O status continua o mesmo.' : ''}`);
    return saved;
  } catch (e) { toast(e.message, true); return null; }
}
function openDay(d, special = []) {
  const title = fmtDate(zonedToISO(d, '12:00', S.tz), S.tz, true);
  const box = h('div', { class: 'dayplan' });
  let best = [];
  const dayPosts = () => S.cal.posts.filter((p) => p.scheduled_at && dayKey(p.scheduled_at, S.tz) === d && (!S.fClient || p.client_id === S.fClient))
    .sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at));
  const weekday = new Date(`${d}T12:00:00Z`).getUTCDay();
  const isPast = d < todayLocal();
  let openSlot = null;
  const draw = () => {
    const posts = dayPosts();
    const hours = new Set(Array.from({ length: 18 }, (_, i) => i + 6)); // 06h–23h
    posts.forEach((p) => hours.add(Number(fmtTime24(p.scheduled_at).slice(0, 2))));
    const bestHours = new Set(best.filter((b) => b.weekday === weekday).map((b) => b.hour));
    box.replaceChildren(
      special.length ? h('div', { class: 'dayplan-dates' }, ...special.map((x) => h('span', { class: `cal-date${x.major ? ' major' : ''}` }, `🎉 ${x.name}`))) : null,
      h('div', { class: 'muted', style: 'font-size:13px' }, posts.length ? `${posts.length} programaç${posts.length > 1 ? 'ões' : 'ão'} neste dia.` : 'Nada programado ainda.',
        bestHours.size ? ' ★ = melhor horário do perfil.' : '', ' Toque num horário para programar; arraste um post para outro horário.'),
      h('div', { class: 'slots' }, ...[...hours].sort((a, b) => a - b).map((hh) => {
        const hs = String(hh).padStart(2, '0');
        const inSlot = posts.filter((p) => Number(fmtTime24(p.scheduled_at).slice(0, 2)) === hh);
        const slot = h('div', { class: `slot${bestHours.has(hh) ? ' best' : ''}${openSlot === hh ? ' open' : ''}` },
          h('div', { class: 'slot-time mono' }, `${hs}:00`, bestHours.has(hh) ? h('span', { class: 'slot-star', title: 'Melhor horário do perfil' }, '★') : null),
          h('div', { class: 'slot-body' },
            ...inSlot.map((p) => h('button', { class: 'slot-post', style: `border-left-color:${STATUS_COLOR[p.status] || 'var(--line)'}`, type: 'button', draggable: movable(p) ? 'true' : null,
              ondragstart: (e) => { e.dataTransfer.setData('text/plain', p.id); e.dataTransfer.effectAllowed = 'move'; },
              onclick: () => { close(); openPost(p); } },
              p.image_url ? h('img', { src: p.image_url, alt: '' }) : h('span', { class: 'slot-noimg' }, p.status === 'idea' ? '💡' : '🖼'),
              h('span', { class: 'slot-main' }, h('b', {}, `${fmtTime24(p.scheduled_at)} · ${clientName(p.client_id)}`), h('span', {}, postLabel(p))),
              h('span', { class: `pill st-${p.status}` }, STATUS_LABEL[p.status]))),
            openSlot === hh ? slotForm(hh) : h('button', { class: 'slot-add', type: 'button', onclick: () => { openSlot = hh; draw(); box.querySelector('.slot-form textarea')?.focus(); } }, isPast ? '+' : `+ Programar às ${hs}:00`)));
        slot.addEventListener('dragover', (e) => { e.preventDefault(); slot.classList.add('drop-over'); });
        slot.addEventListener('dragleave', (e) => { if (!slot.contains(e.relatedTarget)) slot.classList.remove('drop-over'); });
        slot.addEventListener('drop', async (e) => {
          e.preventDefault(); slot.classList.remove('drop-over');
          const p = S.cal.posts.find((x) => x.id === e.dataTransfer.getData('text/plain'));
          if (!p || Number(fmtTime24(p.scheduled_at).slice(0, 2)) === hh) return;
          if (await reschedule(p, d, `${hs}:${fmtTime24(p.scheduled_at).slice(3)}`)) draw();
        });
        return slot;
      })));
  };
  function slotForm(hh) {
    const hs = String(hh).padStart(2, '0');
    const sel = h('select', { 'aria-label': 'Cliente' }, ...S.clients.map((c) => h('option', { value: c.id, selected: c.id === (S.fClient || S.lastClient || S.clients[0].id) }, c.name)));
    const min = h('select', { 'aria-label': 'Minutos' }, ...['00', '15', '30', '45'].map((m) => h('option', { value: m }, `${hs}:${m}`)));
    const ta = h('textarea', { rows: 2, maxlength: 140, placeholder: special[0] ? `Ex.: ${special[0].name}` : 'Pauta do post (ex.: Promoção de banho e tosa)' });
    const add = async (full) => {
      const time = `${hs}:${min.value}`;
      if (full) { close(); return openPost(null, { date: d, time, client: sel.value, title: ta.value.trim() || special[0]?.name }); }
      const title = ta.value.trim(); if (!title) return ta.focus();
      try {
        const saved = await api('/api/posts', { method: 'POST', body: { client_id: sel.value, title, stage: 'draft', scheduled_at: zonedToISO(d, time, S.tz) } });
        S.lastClient = sel.value; upsert(saved, false); if (!S.cal.posts.some((x) => x.id === saved.id)) S.cal.posts.push(saved);
        openSlot = null; draw(); render(); toast(`Programado: ${clientName(saved.client_id)} às ${time} (em produção).`);
      } catch (e) { toast(e.message, true); }
    };
    ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); add(false); } if (e.key === 'Escape') { openSlot = null; draw(); } });
    return h('div', { class: 'slot-form' }, h('div', { class: 'slot-form-row' }, sel, min), ta,
      h('div', { class: 'slot-form-row' }, h('button', { class: 'btn primary sm', type: 'button', onclick: () => add(false) }, 'Programar'),
        h('button', { class: 'btn sm', type: 'button', onclick: () => add(true) }, 'Abrir editor completo'),
        h('button', { class: 'linkish', type: 'button', onclick: () => { openSlot = null; draw(); } }, 'Cancelar')));
  }
  draw();
  const cid = S.fClient || (S.clients.length === 1 ? S.clients[0].id : null);
  if (cid) api(`/api/pasta?r=besttime&client=${cid}`).then((r) => { best = r.slots || []; draw(); }).catch(() => {});
  const close = drawer(title, [box], [h('span', { class: 'spacer' }), h('button', { class: 'btn primary', onclick: () => { close(); openPost(null, { date: d, title: special[0]?.name }); } }, '+ Novo post neste dia')]);
}

// ───────────────────────── onboarding (boas-vindas + questionário da marca)
const onboardingUrl = (c) => (c.portal_url ? c.portal_url.replace('/cliente?', '/boasvindas?') : null);
function welcomeMessage(c) {
  const first = (c.contract_data?.representante || '').trim().split(/\s+/)[0];
  return `Oi${first ? `, ${first}` : ''}! Seja muito bem-vindo(a) à MC Digital 🤍\n\nPreparei o seu manual de boas-vindas: lá você conhece como vamos trabalhar juntos e responde o questionário da sua marca (leva uns 15 minutos). Ele é a base de todo o seu planejamento:\n${onboardingUrl(c)}`;
}
function onboardingBox(c) {
  const url = onboardingUrl(c); if (!url) return null;
  const done = c.brand_kit?.onboarding?.submitted_at;
  return h('div', { class: 'card', style: 'gap:10px;padding:14px' }, h('b', {}, 'Boas-vindas e questionário'),
    h('span', { class: 'muted', style: 'font-size:13.5px' }, done ? `Respondido em ${fmtDate(done, S.tz)}. As respostas estão na aba Marca.` : 'Apresenta a MC Digital (fundadora, missão, valores, processo, checklist e aprovação) e termina no questionário. As respostas vão sozinhas para a Marca do cliente.'),
    h('div', { class: 'linkbox' }, h('code', { translate: 'no' }, url), h('button', { class: 'btn sm', onclick: () => copyText(url, 'Link copiado.') }, 'Copiar')),
    h('div', { class: 'actions' },
      h('a', { class: 'btn sm', href: url, target: '_blank', rel: 'noopener' }, 'Ver como o cliente vê'),
      c.contact_whatsapp ? h('a', { class: 'btn wa sm', href: waLink(c.contact_whatsapp, welcomeMessage(c)), target: '_blank', rel: 'noopener' }, 'Enviar boas-vindas no WhatsApp') : null,
      h('button', { class: 'btn sm', onclick: () => copyText(welcomeMessage(c), 'Mensagem copiada.') }, 'Copiar mensagem')));
}
function onboardingAnswers(c, onb) {
  if (!onb?.answers) {
    return h('section', { class: 'card' }, h('div', { class: 'eyebrow' }, 'Questionário de onboarding'), h('h3', {}, 'Ainda não respondido'),
      h('span', { class: 'muted', style: 'font-size:13.5px' }, c.portal_url ? 'Mande o link de boas-vindas para o cliente: as respostas aparecem aqui e preenchem os campos da marca.' : 'Crie o link do cliente (botão "Criar link do cliente" no topo da pasta) e envie as boas-vindas.'),
      c.portal_url ? h('div', { class: 'actions' }, c.contact_whatsapp ? h('a', { class: 'btn wa sm', href: waLink(c.contact_whatsapp, welcomeMessage(c)), target: '_blank', rel: 'noopener' }, 'Enviar boas-vindas no WhatsApp') : null,
        h('button', { class: 'btn sm', onclick: () => copyText(onboardingUrl(c), 'Link copiado.') }, 'Copiar link')) : null);
  }
  const text = ONB_SECTIONS.map((sec) => `${sec.title.toUpperCase()}\n${ONB_QUESTIONS.filter((q) => q.section === sec.id).map((q) => `${q.q}\n${onb.answers[q.id] || '—'}`).join('\n\n')}`).join('\n\n');
  return h('section', { class: 'card' },
    h('div', { class: 'home-card-head' }, h('div', {}, h('div', { class: 'eyebrow' }, 'Questionário de onboarding'), h('h3', {}, `Respostas de ${c.name}`)),
      h('button', { class: 'btn sm', onclick: () => copyText(text, 'Respostas copiadas.') }, 'Copiar tudo')),
    h('span', { class: 'muted', style: 'font-size:13px' }, `Respondido em ${fmtDate(onb.submitted_at, S.tz)} ${fmtTime(onb.submitted_at, S.tz)}. A IA de legendas e o planejamento usam estas respostas.`),
    ...ONB_SECTIONS.map((sec) => h('details', { class: 'onb-sec', open: sec.id === 'digital' || sec.id === 'publico' },
      h('summary', {}, sec.title),
      h('dl', { class: 'onb-dl' }, ...ONB_QUESTIONS.filter((q) => q.section === sec.id).flatMap((q) => [h('dt', {}, q.q), h('dd', {}, onb.answers[q.id] || '—')])))));
}
function settingsOnboarding() {
  if (S.onb === undefined) { S.onb = null; api('/api/pasta?r=onbcfg').then((v) => { S.onb = v; }).catch(() => { S.onb = false; }).finally(() => { if (S.view === 'ajustes') render(); }); }
  const head = h('div', { class: 'page-head', style: 'margin-top:12px' }, h('div', {}, h('div', { class: 'eyebrow' }, 'Novos clientes'), h('h2', { style: 'font-size:22px' }, 'Boas-vindas (onboarding)')));
  if (!S.onb) return [head, h('p', { class: 'muted' }, S.onb === false ? 'Indisponível agora.' : 'Carregando…')];
  const O = S.onb;
  const fields = {};
  const fld = (k, label, { area = false, rows = 3, hint } = {}) => {
    const el = h(area ? 'textarea' : 'input', { id: `on-${k}`, style: area ? `min-height:${rows * 26}px` : null });
    el.value = k === 'steps' ? (O.steps || []).join('\n') : (O[k] ?? '');
    fields[k] = el;
    return h('div', { class: 'field' }, h('label', { for: `on-${k}` }, label), el, hint ? h('span', { class: 'hint' }, hint) : null);
  };
  const photoIn = h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: async () => {
    const f = photoIn.files[0]; if (!f) return;
    try {
      const bmp = await createImageBitmap(f, { imageOrientation: 'from-image' });
      const sc = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
      const cv = document.createElement('canvas'); cv.width = Math.round(bmp.width * sc); cv.height = Math.round(bmp.height * sc);
      cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
      const blob = await new Promise((r) => cv.toBlob(r, 'image/jpeg', 0.88));
      S.onb = await api('/api/pasta?r=onbcfg&photo=1', { method: 'POST', raw: blob }); toast('Foto atualizada.'); render();
    } catch (e) { toast(e.message, true); }
  } });
  const sample = S.clients.find((c) => c.portal_url);
  return [head, h('article', { class: 'card' },
    h('span', { class: 'muted', style: 'font-size:13.5px' }, 'Depois que o cliente fecha, mande o link de boas-vindas (fica na pasta do cliente → "Link do cliente"). É o seu manual de onboarding em página: saudação com o nome dele, você, missão, valores, etapas, checklist que se marca sozinho, como funciona a aprovação e o questionário. As respostas vão para a aba Marca. Use **palavra** para destacar em negrito.'),
    h('div', { class: 'onb-photo' },
      O.founder_photo ? h('img', { src: O.founder_photo, alt: 'Foto da fundadora' }) : h('div', { class: 'onb-photo-empty' }, 'sem foto'),
      h('div', { style: 'display:grid;gap:8px' }, h('b', {}, 'Foto da fundadora'), h('span', { class: 'muted', style: 'font-size:13px' }, 'Vertical, como no manual (a de câmera na mão fica ótima).'),
        h('div', { class: 'actions' }, h('button', { class: 'btn sm', onclick: () => photoIn.click() }, O.founder_photo ? 'Trocar foto' : 'Enviar foto'), photoIn))),
    h('div', { class: 'grid-2 tight' }, fld('founder_name', 'Nome'), fld('founder_role', 'Cargo (aparece entre chaves)')),
    fld('founder_bio', 'Apresentação', { area: true, rows: 6 }),
    fld('hello_sub', 'Frase abaixo do "Oi, nome!"'),
    h('div', { class: 'grid-2 tight' }, fld('mission', 'Missão', { area: true, rows: 5 }), fld('values', 'Propósito e valores', { area: true, rows: 5 })),
    h('div', { class: 'grid-2 tight' }, fld('steps', 'Etapas do processo (uma por linha)', { area: true, rows: 9 }), fld('approval', 'Aprovação de conteúdo', { area: true, rows: 9 })),
    h('div', { class: 'grid-2 tight' }, fld('cta_title', 'Chamada do questionário'), fld('cta_strong', 'Pergunta em destaque')),
    fld('cta_text', 'Texto antes do questionário'),
    h('div', { class: 'grid-2 tight' }, fld('thanks_title', 'Encerramento'), fld('thanks_text', 'Frase final')),
    fld('instagram', 'Instagram da agência'),
    h('div', { class: 'actions' },
      h('button', { class: 'btn primary sm', onclick: async (e) => {
        e.target.disabled = true;
        try { S.onb = await api('/api/pasta?r=onbcfg', { method: 'PUT', body: Object.fromEntries(Object.entries(fields).map(([k, el]) => [k, el.value])) }); toast('Boas-vindas salvas.'); render(); }
        catch (err) { toast(err.message, true); e.target.disabled = false; }
      } }, 'Salvar textos'),
      sample ? h('a', { class: 'btn sm', href: onboardingUrl(sample), target: '_blank', rel: 'noopener' }, `Pré-visualizar (como ${sample.name})`) : h('span', { class: 'muted', style: 'font-size:13px' }, 'Crie o link de um cliente para pré-visualizar.')),
    h('span', { class: 'hint muted' }, 'Apagar um campo e salvar volta ao texto original do manual.'))];
}

// ───────────────────────── VENDAS (funil de leads) + diagnóstico grátis
const STAGES = [['novo', 'Novo lead'], ['contato', 'Em contato'], ['reuniao', 'Reunião'], ['proposta', 'Proposta'], ['fechado', 'Fechado ✓'], ['perdido', 'Perdido']];
const SRC_LABEL = { diagnostico: 'Diagnóstico', manual: 'Manual', indicacao: 'Indicação', instagram: 'Instagram', site: 'Site' };
// Sempre o endereço oficial (APP_URL), mesmo abrindo o painel por um link de teste da Vercel.
const diagUrl = () => `${S.setup?.app_url || location.origin}/diagnostico`;
const daysTo = (d) => daysBetween(todayLocal(), d);
function leadMessage(l) {
  const first = (l.name || '').split(' ')[0];
  if (l.stage === 'novo' && l.diagnosis) return `Oi, ${first}! Aqui é da MC Digital 🙂 Vi o diagnóstico que você fez do @${l.instagram} (nota ${l.diagnosis.score}/100). Separei algumas ideias práticas para o seu perfil, posso te mostrar em uma conversa rápida de 15 minutos?`;
  if (l.stage === 'proposta') return `Oi, ${first}! Conseguiu dar uma olhada na proposta? Fico à disposição para ajustar o que precisar 🙂`;
  if (l.stage === 'reuniao') return `Oi, ${first}! Confirmando a nossa conversa. Qual horário fica melhor para você?`;
  return `Oi, ${first}! Aqui é da MC Digital 🙂 Tudo bem?`;
}
function viewSales() {
  if (S.leads === undefined) { S.leads = null; api('/api/pasta?r=leads').then((v) => { S.leads = v; }).catch(() => { S.leads = false; }).finally(() => render()); }
  const head = h('div', { class: 'page-head' }, h('div', {}, h('div', { class: 'eyebrow' }, 'Comercial'), h('h1', {}, 'Vendas')), h('div', { class: 'spacer' }),
    h('div', { class: 'actions' },
      h('button', { class: 'btn sm', onclick: () => copyText(diagUrl(), 'Link do diagnóstico copiado. Coloque na bio e nos Stories!') }, '🎯 Copiar link do diagnóstico'),
      h('a', { class: 'btn sm', href: diagUrl(), target: '_blank', rel: 'noopener' }, 'Ver página'),
      h('button', { class: 'btn primary', onclick: () => openLead() }, '+ Novo lead')));
  if (S.leads === false) return [head, h('div', { class: 'banner' }, 'O funil de vendas precisa da atualização do banco. ', h('a', { href: '#ajustes' }, 'Ver em Ajustes'), '.')];
  if (!S.leads) return [head, h('p', { class: 'muted' }, 'Carregando…')];
  const L = S.leads;
  const open = L.filter((l) => !['fechado', 'perdido'].includes(l.stage));
  const month = todayLocal().slice(0, 7);
  const wonMonth = L.filter((l) => l.stage === 'fechado' && (l.updated_at || '').slice(0, 7) === month);
  const decided = L.filter((l) => ['fechado', 'perdido'].includes(l.stage));
  const stats = h('div', { class: 'stats' },
    stat('Em negociação', String(open.length), `${brl(open.reduce((s, l) => s + (l.value_cents || 0), 0))} / mês em propostas`),
    stat('Fechados no mês', String(wonMonth.length), `${brl(wonMonth.reduce((s, l) => s + (l.value_cents || 0), 0))} / mês`, 'good'),
    stat('Conversão', decided.length ? `${Math.round((100 * L.filter((l) => l.stage === 'fechado').length) / decided.length)}%` : '—', `${L.filter((l) => l.source === 'diagnostico').length} vieram do diagnóstico`));
  const board = h('div', { class: 'tboard' }, ...STAGES.map(([st, label]) => {
    const items = L.filter((l) => l.stage === st).sort((a, b) => (b.wants_contact - a.wants_contact) || String(a.next_action_at || '9').localeCompare(String(b.next_action_at || '9')));
    const col = h('section', { class: 'tlist droppable', 'data-col': st },
      h('header', { class: 'tlist-head' }, h('h2', {}, label), h('span', { class: 'tlist-n' }, String(items.length))),
      h('div', { class: 'tlist-cards' }, ...items.map(leadCard)),
      st === 'novo' ? h('div', { class: 'tadd' }, h('button', { class: 'tadd-btn', type: 'button', onclick: () => openLead() }, '+ Adicionar lead')) : null);
    col.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('over'); });
    col.addEventListener('dragleave', (e) => { if (!col.contains(e.relatedTarget)) col.classList.remove('over'); });
    col.addEventListener('drop', async (e) => {
      e.preventDefault(); col.classList.remove('over');
      const l = L.find((x) => x.id === e.dataTransfer.getData('text/plain'));
      if (!l || l.stage === st) return;
      if (st === 'perdido') return openLead(l, { lose: true });
      try { Object.assign(l, await api('/api/pasta?r=leads', { method: 'PATCH', body: { id: l.id, stage: st } })); render(); toast(`Movido para ${label}.`); } catch (err) { toast(err.message, true); }
    });
    return col;
  }));
  return [head, stats, h('div', { class: 'tboard-wrap' }, board),
    h('p', { class: 'muted', style: 'margin:0;font-size:13px' }, 'Arraste os cartões entre as etapas. Quem faz o diagnóstico grátis entra sozinho em "Novo lead"; quando a proposta é aceita, o lead vai para "Fechado".')];
}
function leadCard(l) {
  const d = l.next_action_at ? daysTo(l.next_action_at) : null;
  const card = h('article', { class: 'tcard', draggable: 'true', tabindex: 0, onclick: () => openLead(l), onkeydown: (e) => { if (e.key === 'Enter') openLead(l); } },
    h('div', { class: 'tcard-in' },
      h('div', { class: 'tlabels' },
        l.wants_contact && !['fechado', 'perdido'].includes(l.stage) ? h('span', { class: 'tlabel', style: '--lc:#F87168' }, '🔥 quer conversar') : null,
        h('span', { class: 'tlabel fmt' }, SRC_LABEL[l.source] || l.source),
        l.diagnosis?.score != null ? h('span', { class: 'tlabel', style: `--lc:${l.diagnosis.score >= 70 ? '#4BCE97' : l.diagnosis.score >= 45 ? '#F5CD47' : '#FEA362'}` }, `nota ${l.diagnosis.score}`) : null),
      h('div', { class: 'ttitle' }, h('b', {}, l.name), l.company ? ` · ${l.company}` : ''),
      l.instagram ? h('div', { class: 'muted', style: 'font-size:13px' }, `@${l.instagram}`) : null,
      h('div', { class: 'tbadges' },
        l.value_cents ? h('span', { class: 'tbadge' }, `${brl(l.value_cents)}/mês`) : null,
        d != null && !['fechado', 'perdido'].includes(l.stage) ? h('span', { class: `tbadge${d < 0 ? ' late' : d === 0 ? ' soon' : ''}`, title: l.next_action || 'Próximo contato' }, `📅 ${d < 0 ? `atrasado ${-d}d` : d === 0 ? 'hoje' : fmtDay(l.next_action_at).slice(0, 5)}`) : null,
        l.stage === 'perdido' && l.lost_reason ? h('span', { class: 'tbadge' }, l.lost_reason.slice(0, 40)) : null)));
  card.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', l.id); card.classList.add('dragging'); });
  card.addEventListener('dragend', () => card.classList.remove('dragging'));
  return card;
}
function openLead(l = null, { lose = false } = {}) {
  const isNew = !l;
  const v = (x) => x ?? '';
  const inp = (id, label, value, attrs = {}) => { const el = h(attrs.tag || 'input', { id, ...attrs, tag: null }); el.value = v(value); return [el, h('div', { class: 'field' }, h('label', { for: id }, label), el)]; };
  const [name, fName] = inp('ld-name', 'Nome do contato', l?.name);
  const [company, fCo] = inp('ld-co', 'Empresa', l?.company);
  const [ig, fIg] = inp('ld-ig', 'Instagram', l?.instagram ? `@${l.instagram}` : '', { placeholder: '@perfil' });
  const [wa, fWa] = inp('ld-wa', 'WhatsApp', l?.whatsapp ? l.whatsapp.replace(/^55/, '') : '', { type: 'tel', placeholder: '65 99999-9999' });
  const [email, fEm] = inp('ld-em', 'E-mail', l?.email, { type: 'email' });
  const [val, fVal] = inp('ld-val', 'Valor mensal estimado (R$)', l?.value_cents ? (l.value_cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '', { inputmode: 'decimal', placeholder: '1.500,00' });
  const [next, fNext] = inp('ld-next', 'Próximo passo', l?.next_action, { placeholder: 'Ex.: mandar proposta, ligar, marcar reunião' });
  const [nextAt, fNextAt] = inp('ld-nextat', 'Data do próximo contato', l?.next_action_at, { type: 'date' });
  const [notes, fNotes] = inp('ld-notes', 'Anotações', l?.notes, { tag: 'textarea', style: 'min-height:90px' });
  const src = h('select', { id: 'ld-src' }, ...Object.entries(SRC_LABEL).map(([k, t]) => h('option', { value: k, selected: (l?.source || 'manual') === k }, t)));
  const stage = h('select', { id: 'ld-stage' }, ...STAGES.map(([k, t]) => h('option', { value: k, selected: (l?.stage || 'novo') === k }, t)));
  const [lost, fLost] = inp('ld-lost', 'Motivo da perda', l?.lost_reason, { placeholder: 'Ex.: preço, timing, fechou com outra agência' });
  const syncLost = () => { fLost.hidden = stage.value !== 'perdido'; };
  stage.addEventListener('change', syncLost);
  if (lose) stage.value = 'perdido';
  syncLost();
  const quick = h('div', { class: 'actions' }, ...[['Hoje', 0], ['+1 dia', 1], ['+3 dias', 3], ['+1 semana', 7]].map(([t, n]) => h('button', { class: 'chip', type: 'button', onclick: () => { nextAt.value = shiftDay(todayLocal(), n); } }, t)));
  const body = [];
  if (l?.diagnosis) {
    const D = l.diagnosis;
    body.push(h('div', { class: 'card lead-diag' }, h('div', { class: 'eyebrow' }, `Diagnóstico · ${fmtDate(D.at, S.tz)}`),
      h('div', { style: 'display:flex;gap:14px;align-items:center' }, h('div', { class: 'stat-v' }, `${D.score}`, h('span', { class: 'muted', style: 'font-size:14px' }, '/100')), h('b', {}, D.headline)),
      D.profile ? h('span', { class: 'muted', style: 'font-size:13px' }, `${(D.profile.followers ?? 0).toLocaleString('pt-BR')} seguidores · ${D.profile.posts_per_week ?? '—'} posts/semana · engajamento ${D.profile.engagement_rate ?? '—'}%`) : null,
      h('div', { class: 'diag-areas' }, ...D.areas.map((a) => h('span', { class: 'pill st-draft' }, `${a.name}: ${a.score}`))),
      h('details', {}, h('summary', { class: 'muted' }, 'Ver análise e respostas'),
        h('ol', { style: 'margin:8px 0;padding-left:18px;display:grid;gap:6px;font-size:14px' }, ...D.actions.map((a) => h('li', {}, h('b', {}, a.title), ` — ${a.detail}`))),
        h('dl', { class: 'onb-dl' }, ...Object.entries(D.answers || {}).flatMap(([k, v2]) => [h('dt', {}, k.replace('_', ' ')), h('dd', {}, v2)])))));
  }
  body.push(h('div', { class: 'grid-2 tight' }, fName, fCo), h('div', { class: 'grid-2 tight' }, fIg, fWa), h('div', { class: 'grid-2 tight' }, fEm, fVal),
    h('div', { class: 'grid-2 tight' }, h('div', { class: 'field' }, h('label', { for: 'ld-stage' }, 'Etapa'), stage), h('div', { class: 'field' }, h('label', { for: 'ld-src' }, 'Origem'), src)),
    fLost, fNext, fNextAt, quick, fNotes);
  if (l && l.whatsapp) body.push(h('div', { class: 'actions' },
    h('a', { class: 'btn wa sm', href: waLink(l.whatsapp, leadMessage(l)), target: '_blank', rel: 'noopener' }, 'WhatsApp com mensagem pronta'),
    l.instagram ? h('a', { class: 'btn sm', href: `https://instagram.com/${l.instagram}`, target: '_blank', rel: 'noopener' }, 'Ver Instagram') : null));
  const payload = () => ({ name: name.value, company: company.value, instagram: ig.value, whatsapp: wa.value, email: email.value, value: val.value,
    next_action: next.value, next_action_at: nextAt.value, notes: notes.value, source: src.value, stage: stage.value, lost_reason: lost.value });
  const save = async () => {
    try {
      const row = isNew ? await api('/api/pasta?r=leads', { method: 'POST', body: payload() }) : await api('/api/pasta?r=leads', { method: 'PATCH', body: { ...payload(), id: l.id } });
      if (isNew && stage.value !== 'novo') Object.assign(row, await api('/api/pasta?r=leads', { method: 'PATCH', body: { id: row.id, stage: stage.value } }));
      S.leads = [row, ...(S.leads || []).filter((x) => x.id !== row.id)];
      close(); render(); toast(isNew ? 'Lead criado.' : 'Lead salvo.');
    } catch (e) { toast(e.message, true); }
  };
  const foot = [];
  if (!isNew) foot.push(confirmButton('Apagar', 'Confirmar exclusão', async () => { await api(`/api/pasta?r=leads&id=${l.id}`, { method: 'DELETE' }); S.leads = S.leads.filter((x) => x.id !== l.id); close(); render(); toast('Lead apagado.'); }, 'btn ghost danger'));
  foot.push(h('span', { class: 'spacer' }));
  if (l && !l.proposal_id && !['fechado', 'perdido'].includes(l.stage)) foot.push(h('button', { class: 'btn', onclick: () => { close(); openProposal({ id: null, status: 'draft', client_name: l.company || l.name, contact: { name: l.name, whatsapp: l.whatsapp, email: l.email }, lead_id: l.id, monthly_fee_cents: l.value_cents || undefined }); } }, 'Criar proposta'));
  if (l?.proposal_id) foot.push(h('a', { class: 'btn', href: '#propostas', onclick: () => close() }, 'Ver proposta'));
  foot.push(h('button', { class: 'btn primary', onclick: save }, isNew ? 'Criar lead' : 'Salvar'));
  const close = drawer(isNew ? 'Novo lead' : l.name, body, foot);
  if (lose) lost.focus(); else if (isNew) name.focus();
}
// "Fotos privadas": fecha o acesso público às fotos dos posts (links assinados que vencem em 7 dias).
function settingsPrivacy() {
  if (S.role !== 'admin') return [];
  if (S.priv === undefined) { S.priv = null; api('/api/pasta?r=privacy').then((v) => { S.priv = v; }).catch(() => { S.priv = false; }).finally(() => { if (S.view === 'ajustes') render(); }); }
  const head = h('div', { class: 'page-head', style: 'margin-top:12px' }, h('div', {}, h('div', { class: 'eyebrow' }, 'Segurança e LGPD'), h('h2', { style: 'font-size:22px' }, 'Fotos privadas')));
  if (!S.priv) return [head, h('p', { class: 'muted' }, S.priv === false ? 'Indisponível agora.' : 'Carregando…')];
  const on = S.priv.media_private;
  const go = h('button', { class: on ? 'btn sm' : 'btn primary sm', style: 'justify-self:start', onclick: async () => {
    if (on && !confirmDanger()) return;
    go.disabled = true;
    try { S.priv = await api('/api/pasta?r=privacy', { method: 'PUT', body: { media_private: !on } }); toast(S.priv.media_private ? 'Fotos privadas ligado. As imagens agora só abrem pelo app.' : 'Fotos privadas desligado.'); render(); }
    catch (err) { toast(err.message, true); go.disabled = false; }
  } }, on ? 'Desligar fotos privadas' : 'Ligar fotos privadas');
  function confirmDanger() { return window.confirm('Desligar deixa as fotos dos posts (inclusive de pacientes) abertas para quem tiver o link. Continuar?'); }
  return [head, h('article', { class: 'card' },
    on ? h('div', { class: 'okbox' }, '✓ Ligado. As fotos e vídeos dos posts só abrem por links temporários gerados pelo app (painel, aprovação, área do cliente e publicação na Meta).')
      : h('div', { class: 'errorbox' }, h('b', {}, 'Desligado. '), 'Qualquer pessoa com o link de uma foto consegue abrir a imagem, inclusive fotos de pacientes (antes e depois). Recomendado ligar.'),
    h('span', { class: 'muted', style: 'font-size:13.5px' }, 'Os links gerados valem 7 dias e se renovam sozinhos sempre que o app é aberto. Nada muda no seu dia a dia.'),
    go)];
}

// Mostra se a leitura de dados reais está funcionando e permite testar com um @.
function diagLookupBox(D) {
  if (!D.lookup_client_id) return null;
  const st = D.lookup_status;
  const status = h('div', { class: st?.ok ? 'okbox' : st ? 'errorbox' : 'hint' },
    !st ? 'Ainda não houve leitura. Teste com um @ comercial abaixo.'
      : st.ok ? `✓ Leitura de dados reais funcionando (último: @${st.handle}, ${fmtDate(st.at, S.tz)}).`
      : h('span', {}, h('b', {}, 'Leitura de dados reais não está funcionando. '), st.error, ` (último teste: @${st.handle}, ${fmtDate(st.at, S.tz)})`));
  const who = h('input', { id: 'dg-test', placeholder: '@perfilcomercial', autocapitalize: 'none', style: 'max-width:260px' });
  const go = h('button', { class: 'btn sm', type: 'button', onclick: async () => {
    go.disabled = true;
    try {
      const r = await api('/api/pasta?r=diagcfg', { method: 'POST', body: { handle: who.value } });
      toast(r.ok ? `Funcionou: @${r.handle} tem ${Number(r.followers || 0).toLocaleString('pt-BR')} seguidores.` : `Não funcionou: ${r.error}`, !r.ok);
      S.diag = await api('/api/pasta?r=diagcfg'); render();
    } catch (err) { toast(err.message, true); go.disabled = false; }
  } }, 'Testar leitura');
  return h('div', { class: 'field' }, status, h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;align-items:center' }, who, go));
}
function settingsDiag() {
  if (S.diag === undefined) { S.diag = null; api('/api/pasta?r=diagcfg').then((v) => { S.diag = v; }).catch(() => { S.diag = false; }).finally(() => { if (S.view === 'ajustes') render(); }); }
  const head = h('div', { class: 'page-head', style: 'margin-top:12px' }, h('div', {}, h('div', { class: 'eyebrow' }, 'Atrair clientes'), h('h2', { style: 'font-size:22px' }, 'Diagnóstico grátis')));
  if (!S.diag) return [head, h('p', { class: 'muted' }, S.diag === false ? 'Indisponível agora.' : 'Carregando…')];
  const D = S.diag;
  const en = h('input', { type: 'checkbox', checked: D.enabled });
  const wa = h('input', { id: 'dg-wa', type: 'tel', value: D.whatsapp ? D.whatsapp.replace(/^55/, '') : '', placeholder: '65 99999-9999' });
  const hl = h('input', { id: 'dg-hl', value: D.headline });
  const cta = h('input', { id: 'dg-cta', value: D.cta });
  const connected = S.clients.filter((c) => c.ig_connected);
  const acc = h('select', { id: 'dg-acc' }, h('option', { value: '' }, '— sem consulta de dados (só as respostas) —'), ...connected.map((c) => h('option', { value: c.id, selected: D.lookup_client_id === c.id }, `@${c.ig_username || c.name}`)));
  return [head, h('article', { class: 'card' },
    h('span', { class: 'muted', style: 'font-size:13.5px' }, 'Uma página pública onde a pessoa coloca o @ e recebe na hora uma análise do perfil feita pela IA (nota, o que está bom e 3 ações). Para ver, ela deixa nome e WhatsApp, e vira lead em Vendas, com aviso no seu celular. Coloque o link na bio, nos Stories e nos anúncios.'),
    h('div', { class: 'linkbox' }, h('code', { translate: 'no' }, diagUrl()), h('button', { class: 'btn sm', onclick: () => copyText(diagUrl(), 'Link copiado.') }, 'Copiar')),
    S.setup?.ai_ready ? null : h('div', { class: 'errorbox' }, S.setup?.app_url && !S.setup.app_url.endsWith(location.host)
      ? `Você está num endereço de teste (${location.host}), onde a IA não está ligada. O diagnóstico oficial em ${S.setup.app_url.replace(/^https?:\/\//, '')} não é afetado. Para ligar aqui também: Vercel → Settings → Environment Variables → ANTHROPIC_API_KEY → marque "Preview".`
      : 'Precisa da IA ligada (ANTHROPIC_API_KEY na Vercel). Sem ela, a página do diagnóstico fica fechada. Cada diagnóstico custa centavos de IA.'),
    h('label', { class: 'toggle' }, en, h('span', {}, 'Página do diagnóstico aberta')),
    h('div', { class: 'grid-2 tight' }, h('div', { class: 'field' }, h('label', { for: 'dg-wa' }, 'Seu WhatsApp (botão "Quero ajuda")'), wa), h('div', { class: 'field' }, h('label', { for: 'dg-cta' }, 'Texto do botão'), cta)),
    h('div', { class: 'field' }, h('label', { for: 'dg-hl' }, 'Título da página'), hl),
    h('div', { class: 'field' }, h('label', { for: 'dg-acc' }, 'Perfil usado para ler os dados públicos'), acc,
      h('span', { class: 'hint' }, 'Com um perfil conectado (o ideal é o da própria MC Digital), o app tenta ler seguidores, frequência e engajamento reais do @ informado. Se a Meta não liberar essa leitura, o diagnóstico usa só as respostas, sem avisar a pessoa.')),
    diagLookupBox(D),
    h('button', { class: 'btn primary sm', style: 'justify-self:start', onclick: async (e) => {
      e.target.disabled = true;
      try { S.diag = await api('/api/pasta?r=diagcfg', { method: 'PUT', body: { enabled: en.checked, whatsapp: wa.value, headline: hl.value, cta: cta.value, lookup_client_id: acc.value } }); toast('Diagnóstico salvo.'); render(); }
      catch (err) { toast(err.message, true); e.target.disabled = false; }
    } }, 'Salvar'))];
}
