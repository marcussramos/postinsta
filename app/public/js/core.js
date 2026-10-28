// MC DIGITAL — estado, sessão, estrutura da tela e painel lateral.
// Parte do painel (public/app.js é a entrada). Módulos importam uns dos outros só funções e constantes usadas dentro de funções.
import { billingMonths as billingMonthsShared, dueSoon, splitCents, planOf } from '/billing.js';
import { QUESTIONS as ONB_QUESTIONS, SECTIONS as ONB_SECTIONS } from '/onboarding-perguntas.js';
import { reviewPost, applyFix } from '/revisor.js';
import { PERMS, TEAM_DEFAULT } from '/permissoes.js';
import { TEMPLATES, DURATIONS, NICHE_RULES, SCRIPT_STATUS, checkScript } from '/roteiro.js';
import { NICHES, datesBetween, dateAlerts, relevantFor, daysBetween } from '/dates.js';
import { officeCard, AGENTS } from '/escritorio.js';
import { weekMissions, weekLevel, isDone, missionXp } from '/missoes.js';
import { h, api, toast, fmtDate, fmtTime, dayKey, zonedToISO, partsInTz, prepareImage, copyText, waLink, mailLink, blobToDataUrl, STATUS_LABEL, brl, brlRaw, isMoneyHidden, setMoneyHidden, monthLabel, fileSize, videoInfo, videoFrame, uploadVideo, MEDIA_LABEL, compressVideo, VIDEO_MAX } from '/shared.js';
import { viewAgenda } from './agenda.js';
import { setupPending, viewSettings } from './ajustes.js';
import { loadMonth, viewCalendar } from './calendario.js';
import { viewClients } from './clientes.js';
import { viewBoard } from './fluxo.js';
import { viewHome } from './inicio.js';
import { approvalReminders, requestsInbox, todayLocal, viewFolder } from './pasta.js';
import { openPost } from './post.js';
import { viewProposals, viewSales } from './vendas.js';

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



async function boot() {
  const p = new URLSearchParams(location.search);
  if (p.get('ig')) {
    toast(p.get('msg') || 'Pronto.', p.get('ig') !== 'ok');
    history.replaceState(null, '', `${location.pathname}${location.hash || '#clientes'}`);
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
const THEMES = { light: ['☀', 'Tema: claro (padrão da marca)'], dark: ['☾', 'Tema: escuro'], auto: ['◐', 'Tema: automático (segue o aparelho)'] };
function currentTheme() { try { const t = localStorage.getItem('mc-theme'); return THEMES[t] ? t : 'light'; } catch { return 'light'; } }
function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  try { if (t === 'light') localStorage.removeItem('mc-theme'); else localStorage.setItem('mc-theme', t); } catch { /* sem armazenamento: vale só nesta aba */ }
}
const EYE = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_OFF = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.6 5.1A10.8 10.8 0 0 1 12 5c6.5 0 10 7 10 7a17.6 17.6 0 0 1-2.6 3.5M6.6 6.6C3.9 8.4 2 12 2 12s3.5 7 10 7c1.9 0 3.6-.6 5-1.5"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/><path d="M3 3l18 18"/></svg>';
function moneyButton() {
  const hidden = isMoneyHidden();
  const b = h('button', { class: 'btn ghost sm theme-btn money-btn', type: 'button', 'aria-pressed': String(hidden),
    title: hidden ? 'Mostrar valores' : 'Esconder valores', 'aria-label': hidden ? 'Mostrar valores em reais' : 'Esconder valores em reais',
    onclick: () => { setMoneyHidden(!isMoneyHidden()); render(); toast(isMoneyHidden() ? 'Valores escondidos.' : 'Valores à mostra.'); } });
  b.innerHTML = hidden ? EYE_OFF : EYE;
  return b;
}
function themeButton() {
  const b = h('button', { class: 'btn ghost sm theme-btn', type: 'button' });
  const draw = () => { const t = currentTheme(); b.textContent = THEMES[t][0]; b.title = THEMES[t][1]; b.setAttribute('aria-label', `${THEMES[t][1]}. Clique para trocar.`); };
  b.onclick = () => { const order = ['light', 'dark', 'auto']; const next = order[(order.indexOf(currentTheme()) + 1) % 3]; applyTheme(next); draw(); toast(THEMES[next][1]); };
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
    can('financeiro') ? moneyButton() : null,
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

async function logout() { await api('/api/session', { method: 'DELETE' }).catch(() => {}); location.href = '/equipe'; }

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

export { VIEWS, S, savedPref, savePref, viewFromHash, root, can, sinceISO, boot, loadAll, refresh, loadExtras, THEMES, currentTheme, applyTheme, EYE, EYE_OFF, moneyButton, themeButton, renderLogin, brand, render, logout, clientById, clientName, postLabel, isLate, clientFilter, deliveryLine, typeBadge, thumb, noClients, drawer, confirmButton };
