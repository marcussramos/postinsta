// MC DIGITAL — painel da agência (JavaScript puro, sem build).
import { billingMonths as billingMonthsShared, dueSoon, splitCents, planOf } from '/billing.js';
import { h, api, toast, fmtDate, fmtTime, dayKey, zonedToISO, partsInTz, prepareImage, copyText, waLink, mailLink, blobToDataUrl, STATUS_LABEL, brl, monthLabel, fileSize, videoInfo, videoFrame, uploadVideo, MEDIA_LABEL } from '/shared.js';

const VIEWS = ['inicio', 'agenda', 'calendario', 'fluxo', 'clientes', 'propostas', 'ajustes'];
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
    Object.assign(S, { admin: s.admin, staff: s.staff ?? s.admin, role: s.role || (s.admin ? 'admin' : null), userName: s.name, tz: s.timezone, setup: s.setup || null });
  } catch { /* mostra o login */ }
  if (!S.staff) return renderLogin();
  if (S.role !== 'admin' && ['ajustes', 'propostas'].includes(S.view)) { S.view = 'inicio'; history.replaceState(null, '', '#inicio'); }
  await loadAll();
}

async function loadAll() {
  try {
    const [clients, posts] = await Promise.all([api('/api/clients'), api(`/api/posts?from=${encodeURIComponent(sinceISO())}`)]);
    S.clients = clients; S.posts = posts;
    if (S.role === 'admin') S.payments = await api('/api/pasta?r=payments').catch(() => []); // vazio até a atualização do banco
    await loadExtras();
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
  const [deliv, reqs] = await Promise.all([
    api(`/api/pasta?r=deliveries&month=${todayLocal().slice(0, 7)}`).catch(() => null),
    api('/api/pasta?r=requests&open=1').catch(() => null),
  ]);
  S.deliv = deliv || {}; S.requests = reqs || [];
  if (S.role === 'admin') S.proposals = await api('/api/pasta?r=proposals').catch(() => null);
}

// ───────────────────────── login
function renderLogin() {
  const email = h('input', { type: 'email', id: 'em', autocomplete: 'username', placeholder: 'só para contas da equipe' });
  const pw = h('input', { type: 'password', id: 'pw', autocomplete: 'current-password', required: true });
  const btn = h('button', { class: 'btn primary', type: 'submit' }, 'Entrar');
  root.replaceChildren(h('main', { class: 'login' },
    h('form', { onsubmit: async (e) => {
      e.preventDefault(); btn.disabled = true;
      try {
        const body = email.value.trim() ? { email: email.value.trim(), password: pw.value } : { password: pw.value };
        const s = await api('/api/session', { method: 'POST', body });
        S.admin = s.admin; S.staff = true; S.role = s.role; S.tz = s.timezone; await boot();
      } catch (err) { toast(err.message, true); btn.disabled = false; pw.select(); }
    } },
      brand(),
      h('h1', {}, 'Entrar no painel'),
      h('div', { class: 'field' }, h('label', { for: 'em' }, 'E-mail'), email, h('span', { class: 'hint' }, 'Administrador principal: deixe em branco e use a senha do painel.')),
      h('div', { class: 'field' }, h('label', { for: 'pw' }, 'Senha'), pw),
      btn,
    )));
  pw.focus();
}

const brand = () => h('a', { class: 'brand', href: '#inicio', 'aria-label': 'MC DIGITAL — Início', title: 'Início' }, h('span', { class: 'brand-mark', 'aria-hidden': 'true' }, 'MC'), h('span', {}, 'DIGITAL'));

// ───────────────────────── estrutura
function render() {
  const tab = (id, label) => h('a', { class: 'tab', href: `#${id}`, 'aria-current': S.view === id || (id === 'clientes' && S.view === 'pasta') ? 'page' : null }, label);
  const top = h('header', { class: 'topbar' }, h('div', { class: 'topbar-in' },
    brand(),
    h('nav', { class: 'tabs' }, tab('inicio', 'Início'), tab('agenda', 'Agenda'), tab('calendario', 'Calendário'), tab('fluxo', 'Fluxo'), tab('clientes', 'Clientes'), S.role === 'admin' ? tab('propostas', 'Propostas') : null, S.role === 'admin' ? tab('ajustes', 'Ajustes') : null),
    h('div', { class: 'spacer' }),
    h('button', { class: 'btn primary sm', onclick: () => openPost() }, '+ Novo post'),
    h('button', { class: 'btn ghost sm', onclick: logout, title: S.userName ? `Sair (${S.userName})` : 'Sair' }, 'Sair'),
  ));
  const page = h('main', { class: `page${S.view === 'fluxo' ? ' wide' : ''}` });
  if (['ajustes', 'propostas'].includes(S.view) && S.role !== 'admin') S.view = 'inicio';
  const pend = S.role === 'admin' ? setupPending() : [];
  if (pend.length && S.view !== 'ajustes') page.append(h('div', { class: 'banner' }, h('b', {}, 'Falta configurar: '), pend.join(' · '), ' — ', h('a', { href: '#ajustes' }, 'ver em Ajustes')));
  const views = { inicio: viewHome, clientes: viewClients, ajustes: viewSettings, calendario: viewCalendar, fluxo: viewBoard, agenda: viewAgenda, pasta: viewFolder, propostas: viewProposals };
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
    [['idea', 'draft', 'internal_review'], 'Em produção', '--s-draft'],
    [['failed'], 'Falharam', '--s-fail'],
  ];
  const key = (sts) => sts.join(',');
  const summary = h('div', { class: 'summary' }, ...cards.map(([sts, label, color]) =>
    h('button', { class: 'sum', 'aria-pressed': String(S.fStatus === key(sts)), onclick: () => { S.fStatus = S.fStatus === key(sts) ? '' : key(sts); render(); } },
      h('span', { class: 'eyebrow' }, h('span', { class: 'dot', style: `background:var(${color})` }), label),
      h('b', {}, String(relevant.filter((p) => sts.includes(p.status)).length)))));

  let list = relevant.filter((p) => !S.fStatus || S.fStatus.split(',').includes(p.status));
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
  const posts = S.cal.posts.filter((p) => p.scheduled_at && (!S.fClient || p.client_id === S.fClient));
  const byDay = new Map();
  for (const p of posts) { const k = dayKey(p.scheduled_at, S.tz); if (!byDay.has(k)) byDay.set(k, []); byDay.get(k).push(p); }

  const head = h('div', { class: 'page-head' },
    h('div', {}, h('div', { class: 'eyebrow' }, 'Planejamento'), h('h1', {}, label)),
    h('div', { class: 'spacer' }),
    h('div', { class: 'actions' },
      h('div', { class: 'seg', role: 'group', 'aria-label': 'Modo de exibição' },
        ...[['thumbs', 'Miniaturas'], ['list', 'Lista']].map(([k, l]) => h('button', { class: 'seg-btn', 'aria-pressed': String(S.cal.mode === k),
          onclick: () => { S.cal.mode = k; savePref('mc_cal_mode', k); render(); } }, l))),
      h('button', { class: 'btn sm', onclick: () => go(-1), 'aria-label': 'Mês anterior' }, '‹'),
      h('button', { class: 'btn sm', onclick: () => go(0) }, 'Hoje'),
      h('button', { class: 'btn sm', onclick: () => go(1), 'aria-label': 'Próximo mês' }, '›')));

  const week = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
  const grid = h('div', { class: `cal mode-${S.cal.mode}${S.cal.loading ? ' loading' : ''}`, role: 'grid', 'aria-label': `Calendário de ${label}` },
    ...week.map((w) => h('div', { class: 'cal-wd', role: 'columnheader' }, w)),
    ...monthGrid(m).map((d) => {
      const list = (byDay.get(d) || []).sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at));
      const out = d.slice(0, 7) !== m;
      const cell = h('div', { class: `cal-day${out ? ' out' : ''}${d === today ? ' today' : ''}${S.cal.day === d ? ' sel' : ''}`, role: 'gridcell', tabindex: 0,
        onclick: (e) => {
          if (e.target.closest('.cal-chip, .cal-tile, .cal-more')) return;
          if (window.matchMedia('(max-width: 640px)').matches) { S.cal.day = d; render(); return; }
          openPost(null, { date: d });
        },
        onkeydown: (e) => { if (e.key === 'Enter') openPost(null, { date: d }); } },
        h('div', { class: 'cal-num' }, String(Number(d.slice(8)))),
        h('div', { class: 'cal-dots', 'aria-hidden': 'true' }, ...list.slice(0, 4).map((p) => h('span', { class: `dot st-${p.status}` }))),
        // celular, modo miniaturas: a 1ª imagem do dia + quantos posts tem
        list.length ? h('div', { class: 'cal-mini', 'aria-hidden': 'true' },
          list[0].image_url ? h('img', { src: list[0].image_url, alt: '' }) : h('span', { class: 'thumb-empty' }),
          list.length > 1 ? h('span', { class: 'cal-badge' }, String(list.length)) : null) : null,
        S.cal.mode === 'thumbs'
          ? h('div', { class: 'cal-thumbs' },
              ...list.slice(0, 4).map((p, i) => h('button', { class: `cal-tile st-${p.status}`, title: `${fmtTime(p.scheduled_at, S.tz)} · ${clientName(p.client_id)} · ${STATUS_LABEL[p.status]}`,
                onclick: () => (i === 3 && list.length > 4 ? (S.cal.day = d, render()) : openPost(p)) },
                p.image_url ? h('img', { src: p.image_url, alt: postLabel(p), loading: 'lazy' }) : h('span', { class: 'cal-tile-empty' }, postLabel(p)),
                h('span', { class: 'cal-tile-time mono' }, `${{ REELS: '▶ ', CAROUSEL: '❐ ', STORY: '◷ ' }[p.media_type] || ''}${fmtTime(p.scheduled_at, S.tz)}`),
                h('span', { class: 'cal-tile-dot', 'aria-hidden': 'true' }),
                i === 3 && list.length > 4 ? h('span', { class: 'cal-tile-more' }, `+${list.length - 3}`) : null)))
          : h('div', { class: 'cal-list' },
              ...list.slice(0, 4).map((p) => h('button', { class: `cal-chip st-${p.status}`, title: `${clientName(p.client_id)} · ${STATUS_LABEL[p.status]}`, onclick: () => openPost(p) },
                h('span', { class: 'cal-chip-dot', 'aria-hidden': 'true' }),
                h('span', { class: 'mono' }, fmtTime(p.scheduled_at, S.tz)),
                h('span', { class: 'cal-chip-t' }, S.fClient ? postLabel(p) : `${clientName(p.client_id)} · ${postLabel(p)}`))),
              list.length > 4 ? h('button', { class: 'cal-more', onclick: () => { S.cal.day = d; render(); } }, `+${list.length - 4} mais`) : null));
      return cell;
    }));

  const out = [head, clientFilter(), grid,
    h('p', { class: 'muted hint-desk', style: 'margin:0;font-size:13.5px' }, 'Clique num dia vazio para criar um post nessa data.')];
  if (S.cal.day) {
    const list = byDay.get(S.cal.day) || [];
    out.push(h('section', { class: 'day' },
      h('div', { class: 'day-head' }, h('h2', {}, fmtDate(zonedToISO(S.cal.day, '12:00', S.tz), S.tz, true)), h('span', { class: 'rule' }),
        h('button', { class: 'btn sm', onclick: () => openPost(null, { date: S.cal.day }) }, '+ Post neste dia')),
      ...(list.length ? list.map(rowPost) : [h('p', { class: 'muted', style: 'margin:0' }, 'Nenhum post neste dia.')])));
  }
  return out;
}

// ───────────────────────── fluxo (quadro do workflow)
const COLUMNS = [
  { id: 'idea', label: 'Ideia', drop: 'to_idea', next: ['to_production', 'Produzir'] },
  { id: 'draft', label: 'Em produção', drop: 'to_production', next: ['to_review', 'Revisar'] },
  { id: 'internal_review', label: 'Revisão interna', drop: 'to_review', next: ['send', 'Enviar ao cliente'] },
  { id: 'pending_approval', label: 'Aguardando cliente', drop: 'send' },
  { id: 'changes_requested', label: 'Ajuste pedido' },
  { id: 'approved', label: 'Aprovado', drop: 'approve', also: ['publishing', 'failed'] },
  { id: 'published', label: 'Publicado' },
];

function viewBoard() {
  if (!S.clients.length) return [h('div', { class: 'page-head' }, h('h1', {}, 'Fluxo')), noClients()];
  const posts = S.posts.filter((p) => !S.fClient || p.client_id === S.fClient)
    .filter((p) => p.status !== 'published' || Date.now() - new Date(p.published_at || p.scheduled_at) < 7 * 86400e3);
  const board = h('div', { class: 'board' }, ...COLUMNS.map((col) => {
    const items = posts.filter((p) => p.status === col.id || col.also?.includes(p.status));
    const colEl = h('section', { class: 'col', 'data-col': col.id, 'aria-label': col.label },
      h('header', { class: 'col-head' },
        h('span', { class: `pill st-${col.id}` }, col.label), h('span', { class: 'eyebrow' }, String(items.length)),
        col.id === 'idea' ? h('button', { class: 'btn ghost sm', style: 'margin-left:auto', onclick: () => openPost(null, { stage: 'idea' }) }, '+ Ideia') : null),
      h('div', { class: 'col-body' }, ...items.map((p) => boardCard(p, col)),
        items.length ? null : h('p', { class: 'muted col-empty' }, col.drop ? 'Arraste um post para cá' : 'Nada aqui')));
    if (col.drop) {
      colEl.addEventListener('dragover', (e) => { e.preventDefault(); colEl.classList.add('over'); });
      colEl.addEventListener('dragleave', (e) => { if (!colEl.contains(e.relatedTarget)) colEl.classList.remove('over'); });
      colEl.addEventListener('drop', async (e) => {
        e.preventDefault(); colEl.classList.remove('over');
        const id = e.dataTransfer.getData('text/plain');
        const p = S.posts.find((x) => x.id === id);
        if (!p || p.status === col.id) return;
        await movePost(p, col.drop, `Movido para ${col.label}.`);
      });
    }
    return colEl;
  }));
  return [
    h('div', { class: 'page-head' }, h('div', {}, h('div', { class: 'eyebrow' }, 'Workflow de criação e aprovação'), h('h1', {}, 'Fluxo'))),
    clientFilter(),
    h('p', { class: 'muted', style: 'margin:0;font-size:13.5px' }, 'Arraste os cards entre as etapas ou use o botão de avançar. Para ir ao cliente ou à fila, o post precisa de imagem e data.'),
    h('div', { class: 'board-wrap' }, board),
  ];
}

function boardCard(p, col) {
  const card = h('article', { class: 'bcard', draggable: 'true', tabindex: 0, onclick: (e) => { if (!e.target.closest('button')) openPost(p); },
    onkeydown: (e) => { if (e.key === 'Enter') openPost(p); } },
    h('div', { class: 'bcard-top' }, thumb(p, 'bthumb'),
      h('div', { class: 'bcard-txt' },
        h('b', {}, postLabel(p)),
        h('span', { class: 'muted' }, clientName(p.client_id)),
        h('span', { class: 'mono muted', style: 'font-size:12px' }, p.scheduled_at ? `${fmtDate(p.scheduled_at, S.tz)} · ${fmtTime(p.scheduled_at, S.tz)}` : 'sem data'))),
    p.status === 'changes_requested' && p.client_feedback ? h('div', { class: 'note' }, `“${p.client_feedback}”`) : null,
    p.status === 'failed' ? h('div', { class: 'note fail' }, `Falhou: ${p.last_error || ''}`) : null,
    p.status === 'publishing' ? h('span', { class: 'pill st-publishing' }, 'Publicando') : null,
    col.next ? h('button', { class: 'btn sm', onclick: () => movePost(p, col.next[0], col.next[0] === 'send' ? 'Enviado ao cliente.' : 'Avançou de etapa.') }, `${col.next[1]} →`) : null,
    p.status === 'changes_requested' ? h('button', { class: 'btn sm', onclick: () => openPost(p) }, 'Ajustar') : null);
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
  let img = post?.image_url ? { url: post.image_url } : null; // { blob, url, note } quando trocada

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
    onclick: () => { if (mtype === k) return; if (['REELS', 'STORY'].includes(mtype) || k === 'STORY') { img = null; video = null; } mtype = k; mediaDirty = true; syncCaption(); if (k === 'CAROUSEL' && img && !items.length) items = [{ ...img }]; if (k === 'IMAGE' && items[0] && !img) img = { ...items[0] }; drawSeg(); drawImage(); },
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
    if (!video) return imgBox.replaceChildren(dropZone('Escolha o vídeo do Reels', 'MP4 ou MOV, vertical 9:16, de 3 s a 15 min, até 50 MB.', () => videoIn.click(), (fs) => takeVideo(fs[0])), videoIn);
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
    if (!img && !video) return imgBox.replaceChildren(dropZone('Escolha a foto ou o vídeo do Story', 'Vertical 9:16 (1080×1920). Vídeo de até 60 s e 50 MB. O texto vai na própria arte: Story não tem legenda.', () => storyIn.click(), (fs) => takeStory(fs[0])), storyIn);
    const view = video ? h('video', { src: video.url, controls: true, playsinline: true, muted: true, class: 'reel-video', poster: img?.url || null }) : h('img', { src: img.url, alt: 'Story', class: 'story-img' });
    imgBox.replaceChildren(h('div', { class: 'reel-wrap' }, view,
      h('div', { class: 'reel-side' },
        h('span', { class: 'hint muted' }, video ? `Vídeo de ${Math.round(video.duration || 0)} s.` : 'Foto em tela cheia.', ' Fica 24 h no ar a partir do horário marcado.'),
        locked ? null : h('button', { class: 'btn sm', type: 'button', onclick: () => storyIn.click() }, 'Trocar'))), storyIn);
  };
  const takeStory = async (f) => {
    try {
      if (f.type.startsWith('image/')) { img = await videoFrameFromImage(f); video = null; }
      else {
        if (f.size > 50 * 1024 * 1024) throw new Error(`Vídeo com ${fileSize(f.size)}: o máximo é 50 MB.`);
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
      if (f.size > 50 * 1024 * 1024) throw new Error(`Vídeo com ${fileSize(f.size)}: o máximo é 50 MB. Exporte em 1080p no CapCut/celular e tente de novo.`);
      const info = await videoInfo(f);
      if (info.duration < 3) throw new Error('O Reels precisa ter pelo menos 3 segundos.');
      if (info.duration > 900) throw new Error('O Reels pode ter no máximo 15 minutos.');
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

  // Data: post existente usa a dele; dia clicado no calendário; ideia começa sem data; resto = amanhã 19h.
  const when = post?.scheduled_at ? partsInTz(post.scheduled_at, S.tz)
    : opts.date ? { date: opts.date, time: '19:00' }
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
  if (post) {
    body.push(h('div', { style: 'display:flex;gap:10px;align-items:center;flex-wrap:wrap' },
      h('span', { class: `pill st-${post.status}` }, STATUS_LABEL[post.status]),
      post.decided_at && ['approved', 'changes_requested'].includes(post.status) ? h('span', { class: 'muted', style: 'font-size:13px' }, `decidido em ${fmtDate(post.decided_at, S.tz)} ${fmtTime(post.decided_at, S.tz)}`) : null,
      post.ig_permalink ? h('a', { href: post.ig_permalink, target: '_blank', rel: 'noopener' }, 'Ver no Instagram ↗') : null));
    if (post.status === 'changes_requested' && post.client_feedback) body.push(h('div', { class: 'feedback' }, h('b', {}, 'O cliente pediu:'), h('span', {}, post.client_feedback)));
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
      locked ? null : h('div', { class: 'canva-row' },
        h('a', { class: 'btn sm canva', href: 'https://www.canva.com/', target: '_blank', rel: 'noopener' }, h('span', { class: 'canva-dot', 'aria-hidden': 'true' }, 'C'), 'Abrir Canva'),
        h('span', { class: 'hint' }, 'Feed 1080×1350 · Reels 1080×1920. Baixe e arraste aqui.'))),
    h('div', { class: 'field' }, h('label', { for: 'f-cap' }, 'Legenda'), capNote, cap, counter, locked ? null : aiPanel()),
    h('div', { class: 'two' },
      h('div', { class: 'field' }, h('label', { for: 'f-date' }, 'Data'), dIn),
      h('div', { class: 'field' }, h('label', { for: 'f-time' }, 'Hora'), tIn)),
    locked ? null : bestBox,
    h('div', { class: 'field' }, h('label', { for: 'f-notes' }, 'Notas da equipe'), notes),
    h('div', { class: 'field' }, h('label', { for: 'f-alt' }, 'Texto alternativo (opcional)'), alt, h('span', { class: 'hint' }, 'Descrição da imagem para pessoas com deficiência visual.')),
  );

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
  // mode: 'idea' | 'production' | 'review' | 'send' | 'approve' | 'save'
  async function save(mode) {
    const data = collect();
    const needsComplete = mode === 'send' || mode === 'approve';
    if (needsComplete && mtype === 'CAROUSEL' && items.length < 2) return toast('O carrossel precisa de pelo menos 2 imagens.', true);
    if (needsComplete && mtype === 'REELS' && !video) return toast('Escolha o vídeo do Reels.', true);
    if (needsComplete && mtype === 'STORY' && !img && !video) return toast('Escolha a foto ou o vídeo do Story.', true);
    if (needsComplete && !['CAROUSEL', 'STORY'].includes(mtype) && !img) return toast(mtype === 'REELS' ? 'Falta a capa do Reels.' : 'Para enviar ou aprovar, o post precisa de imagem.', true);
    if (needsComplete && !data.scheduled_at) return toast('Para enviar ou aprovar, escolha a data e a hora.', true);
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
  const footBtns = foot.filter((b) => b instanceof HTMLButtonElement);
  if (post && ['pending_approval', 'approved'].includes(post.status) && !locked) {
    body.push(h('p', { class: 'hint muted', style: 'margin:0;font-size:13px' }, 'Mudar imagem, legenda ou texto alternativo volta o post para produção, para o cliente aprovar a versão nova. Mudar só data, hora, pauta ou notas mantém o status.'));
  }
  const close0 = drawer(isNew ? (st === 'idea' ? 'Nova ideia' : 'Novo post') : 'Post', body, foot);
  const close = () => { document.removeEventListener('paste', onPaste); close0(); };
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
    S.role === 'admin' ? h('button', { class: 'btn primary', onclick: () => openClient() }, '+ Novo cliente') : null)];
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
    h('div', { style: 'display:flex;align-items:center;gap:10px' }, h('h3', { style: 'flex:1;min-width:0' }, c.name),
      pend ? h('span', { class: 'pill st-pending_approval' }, `${pend} aguardando`) : null,
      lateCount(c) ? h('span', { class: 'pill st-failed', title: 'Mensalidades vencidas sem pagamento' }, `${lateCount(c)} em atraso`) : null),
    deliveryLine(c.id),
    h('dl', { class: 'kv' },
      h('dt', {}, 'Instagram'), h('dd', {}, ig),
      h('dt', {}, 'WhatsApp'), h('dd', {}, c.contact_whatsapp ? `+${c.contact_whatsapp}` : h('span', { class: 'muted' }, '—')),
      h('dt', {}, 'E-mail'), h('dd', {}, c.contact_email || h('span', { class: 'muted' }, '—')),
      h('dt', {}, 'Tom de voz'), h('dd', {}, c.brand_voice ? h('span', { class: 'clamp2' }, c.brand_voice) : h('span', { class: 'muted' }, '— (usado pela IA)'))),
    h('div', { class: 'field' }, h('span', { class: 'eyebrow' }, 'Link fixo de aprovação'),
      h('div', { class: 'linkbox' }, h('code', { translate: 'no' }, c.approval_url), h('button', { class: 'btn sm', onclick: () => copyText(c.approval_url, 'Link copiado.') }, 'Copiar'))),
    h('div', { class: 'actions' },
      c.ig_connected && !expired || S.role !== 'admin' ? null : h('a', { class: 'btn primary sm', href: `/api/ig/connect?client=${c.id}` }, c.ig_connected ? 'Reconectar Instagram' : 'Conectar Instagram'),
      c.contact_whatsapp ? h('a', { class: 'btn wa sm', href: waLink(c.contact_whatsapp, approvalMessage(c)), target: '_blank', rel: 'noopener' }, 'WhatsApp') : null,
      c.contact_email ? h('a', { class: 'btn sm', href: mailLink(c.contact_email, approvalSubject(c), approvalMessage(c)) }, 'E-mail') : null,
      S.role === 'admin' ? h('a', { class: 'btn sm', href: `#pasta/${c.id}` }, '🔒 Pasta') : h('a', { class: 'btn sm', href: `#pasta/${c.id}` }, 'Marca e pedidos'),
      S.role === 'admin' ? h('button', { class: 'btn sm', onclick: () => openClient(c) }, 'Editar') : null));
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
  const codeBox = (text, label) => h('div', { style: 'display:grid;gap:8px' },
    h('pre', { class: 'mono notranslate', translate: 'no', style: 'margin:0;white-space:pre-wrap;overflow-wrap:anywhere;background:var(--surface-2);border:1px solid var(--line);border-radius:10px;padding:12px;font-size:12.5px;max-height:260px;overflow:auto' }, text),
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
        h('span', { class: 'muted', style: 'font-size:14px' }, 'Política de privacidade (para a Meta):'),
        st.app_url ? codeBox(`${st.app_url}/privacidade`, 'link') : null),
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
          ? [h('span', { class: 'muted', style: 'font-size:14px' }, 'No Supabase, abra SQL Editor → New query, cole o comando abaixo e clique em Run. Ele já vem com o seu endereço e o código secreto; não precisa mudar nada.'),
             codeBox(st.cron_sql, 'comando')]
          : h('span', { class: 'muted' }, 'Aparece aqui depois que o banco de dados estiver configurado.'),
        h('button', { class: 'btn sm', style: 'justify-self:start', onclick: async () => { const s = await api('/api/session'); S.setup = s.setup; render(); toast('Atualizado.'); } }, 'Verificar de novo')),
    ),
    ...settingsTeam(),
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
    h('div', { class: 'eyebrow' }, S.settings.template_is_default ? 'Modelo provisório' : 'Seu modelo'), h('h3', {}, 'Modelo de contrato'),
    h('span', { class: 'muted', style: 'font-size:13.5px' }, 'Cole o texto do seu contrato e troque os dados variáveis pelos campos abaixo (clique num campo para inseri-lo onde está o cursor). Linha começando com "# " vira título, "## " vira cláusula, **texto** fica em negrito, linhas começando com "|" viram tabela (| RÓTULO | valor), ">> " alinha à direita e {{assinaturas}} sozinho numa linha cria as linhas de assinatura.'),
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
      S.settings.template_is_default ? null : confirmButton('Voltar ao modelo provisório', 'Confirmar: apaga o seu modelo', async () => {
        S.settings = await api('/api/pasta?r=settings', { method: 'PUT', body: { contract_template: '' } }); render(); toast('Modelo provisório restaurado.');
      }, 'btn ghost sm')));
  return [head, h('div', { class: 'grid-clients' }, agencyCard, tplCard)];
}

// ───────────────────────── pasta privada do cliente (contrato, financeiro, relatórios)
const FOLDER_TABS = [['contract', 'Contrato'], ['finance', 'Financeiro'], ['report', 'Relatórios'], ['history', 'Aprovações'], ['requests', 'Pedidos'], ['brand', 'Marca'], ['other', 'Outros']];
const ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx,.csv,.txt';
const todayLocal = () => partsInTz(new Date().toISOString(), S.tz).date;
const nextMonth = (m) => shiftMonth(m, 1);

// Situação de cada mês (com parcelas) — mesma regra do servidor e da área do cliente (/billing.js)
const billingMonths = (c) => billingMonthsShared(c, S.payments.filter((p) => p.client_id === c.id), todayLocal());
const lateCount = (c) => billingMonths(c).filter((m) => m.status === 'late').length;
const PAY_LABEL = { paid: ['Pago', 'st-approved'], waived: ['Isento', 'st-draft'], open: ['Em aberto', 'st-pending_approval'], late: ['Atrasado', 'st-failed'] };

async function loadFolder(id) {
  if (S.role !== 'admin') { // equipe: só marca e pedidos
    try { S.folder.files = await api(`/api/pasta?r=files&client=${id}`); S.folder.error = null; } catch (e) { S.folder.error = e.message; }
    S.folder.loading = false; if (!['brand', 'requests'].includes(S.folder.tab)) S.folder.tab = 'requests';
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
      h('span', { class: 'lock', title: 'Os arquivos ficam num cofre privado. Cada link abre por 2 minutos e só com você logado.' }, S.role === 'admin' ? '🔒 Pasta privada' : '🔒 Marca e pedidos'),
      S.role === 'admin' ? h('button', { class: `btn sm${c.portal_url ? '' : ' primary'}`, onclick: () => openPortal(c) }, c.portal_url ? '🔗 Link do cliente' : '🔗 Criar link do cliente') : null));
  const tabs = h('div', { class: 'seg folder-tabs', role: 'group', 'aria-label': 'Seções da pasta' },
    ...FOLDER_TABS.filter(([k]) => S.role === 'admin' || ['requests', 'brand'].includes(k)).map(([k, l]) => {
      const n = k === 'finance' ? late : k === 'report' ? count('report') + (F.reports?.length || 0)
        : k === 'requests' ? (S.requests || []).filter((r) => r.client_id === c.id && r.status !== 'done').length
        : ['history', 'brand'].includes(k) ? 0 : count(k);
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
  const body = { contract: folderContract, finance: folderFinance, report: folderReports, other: folderOther, history: folderHistory, brand: folderBrand, requests: folderRequests }[F.tab](c);
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
  const [entr, fEntr] = inp('k-entr', 'Entregas mensais', k.entregas, { placeholder: '8 (oito) posts estáticos e 4 (quatro) Reels' });
  const [total, fTotal] = inp('k-total', 'Total de conteúdos/mês', k.total_conteudos, { type: 'number', min: 1, max: 999, placeholder: '12' });
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
  const [prazo, fPrazo] = inp('k-prazo', 'Prazo (meses, opcional)', k.prazo_meses, { type: 'number', min: 1, max: 120, placeholder: 'vazio = indeterminado' });
  const [forma, fForma] = inp('k-forma', 'Forma de pagamento', k.forma_pagamento, { tag: 'textarea', style: 'min-height:70px', placeholder: 'via Pix, em 3 (três) parcelas mensais: R$ 433,34 no dia 4; R$ 433,33 no dia 14; e R$ 433,33 no dia 24 de cada mês' },
    'Escreva começando com letra minúscula: entra no meio da frase do contrato.');
  const close = drawer(`Dados do contrato · ${c.name}`, [
    h('div', { class: 'eyebrow' }, 'Contratante'), fNome, fDoc, fEnd, h('div', { class: 'grid-2 tight' }, fRep, fRepCpf),
    h('div', { class: 'eyebrow' }, 'Serviço e cobrança'), h('div', { class: 'grid-2 tight' }, fEntr, fTotal), fServ,
    h('div', { class: 'grid-2 tight' }, fFee, fDue), fParts, h('div', { class: 'grid-2 tight' }, fStart, fPrazo), fForma,
    h('div', { class: 'eyebrow' }, 'Cota mensal (contador de entregas)'), h('div', { class: 'grid-2 tight' }, fQp, fQr), fQs,
  ], [h('span', { class: 'spacer' }), h('button', { class: 'btn primary', onclick: async (e) => {
    e.target.disabled = true;
    try {
      const saved = await api(`/api/clients?id=${c.id}`, { method: 'PATCH', body: {
        monthly_fee: fee0.value, due_day: due.value, billing_start: start.value, installments: parts.length > 1 ? parts : (c.installments ? [] : undefined),
        contract_data: { nome: nome.value, documento: doc.value, endereco: end.value, representante: rep.value, representante_cpf: repCpf.value, entregas: entr.value, total_conteudos: total.value, quota_posts: qp.value, quota_reels: qr.value, quota_stories: qs.value, servicos: serv.value, prazo_meses: prazo.value, forma_pagamento: forma.value },
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
        pay?.file_id && fileName(pay.file_id) ? h('a', { class: 'btn ghost sm', href: `/api/pasta?r=files&id=${pay.file_id}&open=1`, target: '_blank', rel: 'noopener', title: fileName(pay.file_id) }, '📎') : null,
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
  if (S.settings !== undefined || S.role !== 'admin') return;
  S.settings = null;
  api('/api/pasta?r=settings').then((v) => { S.settings = v; }).catch(() => { S.settings = false; }).finally(() => render());
}

// Mensagem de cobrança pronta (lembrete 2 dias antes ou aviso de atraso).
function chargeMessage(c, m, p) {
  const pix = S.settings?.agency?.pix;
  const what = p.of > 1 ? `a ${p.n}ª parcela (${brl(p.cents)}) da mensalidade de ${monthLabel(m.month).toLowerCase()}` : `a mensalidade de ${monthLabel(m.month).toLowerCase()} (${brl(p.cents)})`;
  const head = p.status === 'late' ? `Olá! Tudo bem? Passando para lembrar que ${what} venceu em ${fmtDay(p.due)} e ainda consta em aberto por aqui.` : `Olá! Tudo bem? Lembrete: ${what} vence em ${fmtDay(p.due)}.`;
  return `${head}${pix ? `\n\nChave PIX: ${pix}` : ''}\n\nSe já pagou, pode desconsiderar e, se puder, me mande o comprovante. Obrigado! 🙂`;
}
function chargeButton(c, m, p) {
  const msg = chargeMessage(c, m, p);
  if (c.contact_whatsapp) return h('a', { class: `btn wa sm`, href: waLink(c.contact_whatsapp, msg), target: '_blank', rel: 'noopener', title: 'Mandar lembrete de cobrança pelo WhatsApp' }, p.status === 'late' ? 'Cobrar' : 'Lembrar');
  return h('button', { class: 'btn sm', onclick: () => copyText(msg, 'Mensagem de cobrança copiada.') }, 'Copiar cobrança');
}

// Painel de cobranças: por cliente — atrasado somado + o que vence em até 2 dias.
function chargesCard() {
  if (S.role !== 'admin') return null;
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
    colors.length < 8 ? h('button', { type: 'button', class: 'btn sm', onclick: () => { colors.push('#2443C9'); drawColors(); } }, '+ Cor') : null);
  drawColors();
  const ta = (id, label, val, ph, hint) => { const el = h('textarea', { id, placeholder: ph, style: 'min-height:70px' }); el.value = val || ''; return [el, h('div', { class: 'field' }, h('label', { for: id }, label), el, hint ? h('span', { class: 'hint' }, hint) : null)]; };
  const fonts = h('input', { id: 'b-fonts', value: k.fonts || '', placeholder: 'Ex.: títulos em Montserrat ExtraBold, textos em Inter' });
  const [voice, fVoice] = ta('b-voice', 'Tom de voz', F.brand.brand_voice, 'Ex.: próximo, carinhoso com os pets, divertido sem ser bobo. Fala com tutores de 25–45.', 'A IA de legendas usa isto.');
  const [style, fStyle] = ta('b-style', 'Estilo visual e posicionamento', k.style, 'Ex.: fotos claras e naturais, muito pet real (nada de banco de imagens), fundos limpos.');
  const [dos, fDos] = ta('b-dos', 'Sempre', k.dos, 'Ex.: mostrar o nome do pet, usar emojis de patinha, citar o endereço nos posts de promoção.');
  const [donts, fDonts] = ta('b-donts', 'Nunca', k.donts, 'Ex.: falar de preço sem aprovação, usar a palavra "barato", fotos de pets tristes.', 'A IA evita estes temas e palavras.');
  const [refs, fRefs] = ta('b-refs', 'Referências (links)', k.references, 'Perfis, pastas do Drive, Pinterest…');
  const [notes, fNotes] = ta('b-notes', 'Outras observações', k.notes, 'Datas importantes, produtos-estrela, concorrentes…');
  const save = h('button', { class: 'btn primary', onclick: async () => {
    save.disabled = true;
    try {
      const r = await api('/api/pasta?r=brand', { method: 'PUT', body: { client_id: c.id, brand_voice: voice.value, brand_kit: { colors, fonts: fonts.value, style: style.value, dos: dos.value, donts: donts.value, references: refs.value, notes: notes.value } } });
      F.brand = { ...F.brand, ...r };
      const i = S.clients.findIndex((x) => x.id === c.id); if (i >= 0) S.clients[i] = { ...S.clients[i], brand_voice: r.brand_voice };
      toast('Identidade da marca salva.');
    } catch (e) { toast(e.message, true); }
    save.disabled = false;
  } }, 'Salvar identidade');
  return [
    h('section', { class: 'card' },
      h('div', { class: 'eyebrow' }, 'Manual rápido da marca'), h('h3', {}, `Identidade de ${c.name}`),
      h('div', { class: 'field' }, h('span', { class: 'label' }, 'Paleta de cores'), colorsBox),
      h('div', { class: 'field' }, h('label', { for: 'b-fonts' }, 'Tipografia'), fonts),
      fVoice, h('div', { class: 'grid-2 tight' }, fStyle, fRefs), h('div', { class: 'grid-2 tight' }, fDos, fDonts), fNotes,
      h('div', { class: 'actions' }, save)),
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
    h('span', { class: 'muted', style: 'font-size:13.5px' }, 'Cada pessoa entra com o próprio e-mail e senha. "Equipe" cria e edita posts, usa a agenda, a IA, a marca e os pedidos dos clientes, mas não vê financeiro, contratos, relatórios, pastas nem Ajustes. "Administrador" vê tudo. Você (senha principal) é sempre administrador.'),
    S.team.length ? h('div', { class: 'charge-list' }, ...S.team.map((u) => h('div', { class: 'charge' },
      h('div', {}, h('b', {}, u.name), ' ', h('span', { class: `pill ${u.active ? (u.role === 'admin' ? 'st-published' : 'st-internal_review') : 'st-draft'}` }, u.active ? (u.role === 'admin' ? 'Administrador' : 'Equipe') : 'Desativado'),
        h('div', { class: 'muted', style: 'font-size:13px' }, u.email)),
      h('button', { class: 'btn sm', onclick: () => openMember(u) }, 'Editar'))))
      : h('p', { class: 'muted files-empty' }, 'Só você por enquanto.'))];
}
function openMember(u = null) {
  const name = h('input', { id: 'u-name', value: u?.name || '', placeholder: 'Nome' });
  const email = h('input', { id: 'u-email', type: 'email', value: u?.email || '', placeholder: 'pessoa@email.com', disabled: Boolean(u) });
  const pw = h('input', { id: 'u-pw', type: 'password', autocomplete: 'new-password', placeholder: u ? 'deixe em branco para manter' : 'mínimo 8 caracteres' });
  let role = u?.role || 'team';
  const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Papel' }, ...[['team', 'Equipe'], ['admin', 'Administrador']].map(([k, l]) => h('button', { type: 'button', class: 'seg-btn', 'aria-pressed': String(role === k),
    onclick: (e) => { role = k; for (const b of seg.children) b.setAttribute('aria-pressed', String(b === e.currentTarget)); } }, l)));
  const done = (row, msg) => { S.team = [...S.team.filter((x) => x.id !== row.id), row].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')); close(); render(); toast(msg); };
  const foot = [];
  if (u) foot.push(
    confirmButton('Excluir', 'Confirmar exclusão', async () => { await api(`/api/pasta?r=users&id=${u.id}`, { method: 'DELETE' }); S.team = S.team.filter((x) => x.id !== u.id); close(); render(); toast('Conta excluída.'); }, 'btn ghost danger'),
    h('button', { class: 'btn ghost', onclick: async () => { try { done(await api('/api/pasta?r=users', { method: 'PATCH', body: { id: u.id, active: !u.active } }), u.active ? 'Acesso desativado.' : 'Acesso reativado.'); } catch (e) { toast(e.message, true); } } }, u.active ? 'Desativar' : 'Reativar'));
  foot.push(h('span', { class: 'spacer' }), h('button', { class: 'btn primary', onclick: async () => {
    try {
      const row = u
        ? await api('/api/pasta?r=users', { method: 'PATCH', body: { id: u.id, name: name.value, role, password: pw.value || undefined } })
        : await api('/api/pasta?r=users', { method: 'POST', body: { name: name.value, email: email.value, role, password: pw.value } });
      done(row, u ? 'Conta atualizada.' : `Conta criada. Mande o e-mail e a senha para ${row.name} entrar.`);
    } catch (e) { toast(e.message, true); }
  } }, u ? 'Salvar' : 'Criar conta'));
  const close = drawer(u ? `Equipe · ${u.name}` : 'Nova pessoa na equipe', [
    h('div', { class: 'field' }, h('label', { for: 'u-name' }, 'Nome'), name),
    h('div', { class: 'field' }, h('label', { for: 'u-email' }, 'E-mail (login)'), email),
    h('div', { class: 'field' }, h('label', { for: 'u-pw' }, u ? 'Nova senha' : 'Senha inicial'), pw, h('span', { class: 'hint' }, 'Combine a senha com a pessoa por um canal seguro.')),
    h('div', { class: 'field' }, h('span', { class: 'label' }, 'Papel'), seg),
  ], foot);
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
  if (S.role === 'admin') ensureSettings();
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
    h('div', { class: 'home-mark', 'aria-hidden': 'true' }, 'MC'),
    h('div', { class: 'home-hello' },
      h('div', { class: 'eyebrow' }, longDate),
      h('h1', {}, `${hello}${who ? `, ${who}` : ''}.`),
      h('p', { class: 'muted' }, todays.length ? `Hoje saem ${todays.length} publicaç${todays.length > 1 ? 'ões' : 'ão'}.` : 'Nenhuma publicação marcada para hoje.',
        waiting ? ` ${waiting} post${waiting > 1 ? 's' : ''} esperando aprovação dos clientes.` : '')),
    h('div', { class: 'home-quick' },
      h('button', { class: 'btn primary', onclick: () => openPost() }, '+ Novo post'),
      h('a', { class: 'btn', href: '#calendario' }, 'Calendário'),
      h('a', { class: 'btn', href: '#fluxo' }, 'Fluxo'),
      S.role === 'admin' ? h('button', { class: 'btn', onclick: () => openProposal() }, '+ Proposta') : null));

  // números
  const tiles = [];
  if (S.role === 'admin') {
    let mrr = 0, received = 0, toReceive = 0, late = 0, active = 0;
    for (const c of S.clients) {
      if (!c.billing_start || c.monthly_fee_cents == null) continue;
      if (c.billing_start.slice(0, 10) <= today) { mrr += c.monthly_fee_cents; active++; }
      for (const m of billingMonths(c)) {
        late += m.late_cents;
        if (m.month === month) { received += m.parcels.filter((p) => p.status === 'paid').reduce((x, p) => x + (p.cents || 0), 0); toReceive += m.open_cents - m.late_cents; }
      }
    }
    tiles.push(
      kpi('Receita mensal', brl(mrr), `${active} contrato${active === 1 ? '' : 's'} ativo${active === 1 ? '' : 's'}`),
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
  if (S.role === 'admin' && Array.isArray(S.proposals)) {
    for (const p of S.proposals.filter((x) => x.status === 'accepted' && x.accepted_at && Date.now() - new Date(x.accepted_at) < 10 * 864e5)) {
      alerts.push(alertRow('good', `🎉 ${p.client_name} aceitou a proposta`, 'Gere o contrato e conecte o Instagram', null, p.client_id ? `#pasta/${p.client_id}` : '#propostas'));
    }
    for (const p of S.proposals.filter((x) => x.status === 'sent' && Date.now() - new Date(x.updated_at || x.created_at) > 5 * 864e5)) {
      alerts.push(alertRow('', `${p.client_name}: proposta sem resposta há ${Math.floor((Date.now() - new Date(p.updated_at || p.created_at)) / 864e5)} dias`, 'Que tal um follow-up?', null, '#propostas'));
    }
  }
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
  if (S.role === 'admin') {
    const list = S.clients.filter((c) => c.billing_start && c.billing_start.slice(5, 7) === month.slice(5, 7) && c.billing_start.slice(0, 4) < month.slice(0, 4));
    if (list.length) reaj = h('section', { class: 'card' }, h('h3', {}, 'Reajustes do mês'),
      h('span', { class: 'muted', style: 'font-size:13.5px' }, 'Contratos que fazem aniversário este mês: hora de aplicar o IPCA de 12 meses (cláusula 6.4) e avisar o cliente.'),
      h('div', { class: 'alerts' }, ...list.map((c) => alertRow('', `${c.name} · ${Number(month.slice(0, 4)) - Number(c.billing_start.slice(0, 4))} ano(s) de contrato`, `Mensalidade atual ${brl(c.monthly_fee_cents)}`, null, `#pasta/${c.id}`))));
  }

  if (!S.clients.length) return [hero, noClients()];
  return [hero, h('div', { class: 'home-kpis' }, ...tiles),
    h('div', { class: 'home-grid' }, h('div', { class: 'home-col' }, todayCard, attention, chargesCard()), h('div', { class: 'home-col' }, delivCard, reaj, approvalReminders(), requestsInbox()))];
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
          h('button', { class: 'btn ghost sm', onclick: () => openProposal({ ...p, id: null, status: 'draft', client_name: `${p.client_name} (cópia)` }) }, 'Duplicar')));
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
      const body = { ...payload(), send: sendIt };
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
