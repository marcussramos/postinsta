// MC DIGITAL — painel da agência (JavaScript puro, sem build).
import { h, api, toast, fmtDate, fmtTime, dayKey, zonedToISO, partsInTz, prepareImage, copyText, waLink, mailLink, blobToDataUrl, STATUS_LABEL, brl, monthLabel, fileSize } from '/shared.js';

const VIEWS = ['agenda', 'calendario', 'fluxo', 'clientes', 'ajustes'];
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
  return VIEWS.includes(v) ? v : 'agenda';
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
    Object.assign(S, { admin: s.admin, tz: s.timezone, setup: s.setup || null });
  } catch { /* mostra o login */ }
  if (!S.admin) return renderLogin();
  await loadAll();
}

async function loadAll() {
  try {
    const [clients, posts] = await Promise.all([api('/api/clients'), api(`/api/posts?from=${encodeURIComponent(sinceISO())}`)]);
    S.clients = clients; S.posts = posts;
    S.payments = await api('/api/pasta?r=payments').catch(() => []); // vazio até a atualização do banco
  } catch (e) {
    if (e.status === 401) { S.admin = false; return renderLogin(); }
    toast(e.message, true);
  }
  render();
}

window.addEventListener('hashchange', () => { S.view = viewFromHash(); render(); });

// Mantém tudo em dia com as decisões dos clientes: atualiza ao voltar para a aba e a cada minuto.
async function refresh() {
  if (!S.admin || document.hidden || document.querySelector('.drawer')) return;
  try {
    const [clients, posts] = await Promise.all([api('/api/clients'), api(`/api/posts?from=${encodeURIComponent(sinceISO())}`)]);
    const changed = JSON.stringify(posts) !== JSON.stringify(S.posts) || JSON.stringify(clients) !== JSON.stringify(S.clients);
    S.clients = clients; S.posts = posts;
    if (S.view === 'calendario') await loadMonth(S.cal.month, true);
    if (changed) render();
  } catch { /* tenta de novo na próxima */ }
}
document.addEventListener('visibilitychange', refresh);
setInterval(refresh, 60_000);

// ───────────────────────── login
function renderLogin() {
  const pw = h('input', { type: 'password', id: 'pw', autocomplete: 'current-password', required: true });
  const btn = h('button', { class: 'btn primary', type: 'submit' }, 'Entrar');
  root.replaceChildren(h('main', { class: 'login' },
    h('form', { onsubmit: async (e) => {
      e.preventDefault(); btn.disabled = true;
      try {
        const s = await api('/api/session', { method: 'POST', body: { password: pw.value } });
        S.admin = true; S.tz = s.timezone; await boot();
      } catch (err) { toast(err.message, true); btn.disabled = false; pw.select(); }
    } },
      brand(),
      h('h1', {}, 'Entrar no painel'),
      h('div', { class: 'field' }, h('label', { for: 'pw' }, 'Senha'), pw),
      btn,
    )));
  pw.focus();
}

const brand = () => h('div', { class: 'brand', 'aria-label': 'MC DIGITAL' }, h('span', { class: 'brand-mark', 'aria-hidden': 'true' }, 'MC'), h('span', {}, 'DIGITAL'));

// ───────────────────────── estrutura
function render() {
  const tab = (id, label) => h('a', { class: 'tab', href: `#${id}`, 'aria-current': S.view === id || (id === 'clientes' && S.view === 'pasta') ? 'page' : null }, label);
  const top = h('header', { class: 'topbar' }, h('div', { class: 'topbar-in' },
    brand(),
    h('nav', { class: 'tabs' }, tab('agenda', 'Agenda'), tab('calendario', 'Calendário'), tab('fluxo', 'Fluxo'), tab('clientes', 'Clientes'), tab('ajustes', 'Ajustes')),
    h('div', { class: 'spacer' }),
    h('button', { class: 'btn primary sm', onclick: () => openPost() }, '+ Novo post'),
    h('button', { class: 'btn ghost sm', onclick: logout, title: 'Sair' }, 'Sair'),
  ));
  const page = h('main', { class: `page${S.view === 'fluxo' ? ' wide' : ''}` });
  const pend = setupPending();
  if (pend.length && S.view !== 'ajustes') page.append(h('div', { class: 'banner' }, h('b', {}, 'Falta configurar: '), pend.join(' · '), ' — ', h('a', { href: '#ajustes' }, 'ver em Ajustes')));
  const views = { clientes: viewClients, ajustes: viewSettings, calendario: viewCalendar, fluxo: viewBoard, agenda: viewAgenda, pasta: viewFolder };
  page.append(...views[S.view]().filter(Boolean));
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
    h('div', { class: 'main' }, h('div', { class: 'client' }, clientName(p.client_id)), h('div', { class: 'cap' }, p.title ? p.title : (p.caption || 'Sem legenda')), note),
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
                h('span', { class: 'cal-tile-time mono' }, fmtTime(p.scheduled_at, S.tz)),
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
  const picked = new Set([post?.client_id || S.fClient || S.clients[0].id]);
  const clientBox = h('div', { class: 'pick' });
  const drawClients = () => clientBox.replaceChildren(...S.clients.map((c) => h('button', {
    type: 'button', class: 'chip', 'aria-pressed': String(picked.has(c.id)), disabled: !isNew,
    onclick: () => { if (picked.has(c.id) && picked.size > 1) picked.delete(c.id); else picked.add(c.id); drawClients(); },
  }, c.name)));
  drawClients();

  const title = h('input', { type: 'text', id: 'f-title', value: post?.title || '', disabled: locked, placeholder: 'Ex.: Frase motivacional de segunda', maxlength: 140 });
  const notes = h('textarea', { id: 'f-notes', disabled: locked, placeholder: 'Briefing, referências, observações para a equipe. O cliente não vê.', style: 'min-height:70px' }, post?.notes || '');

  const fileIn = h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: () => fileIn.files[0] && takeFile(fileIn.files[0]) });
  const imgBox = h('div', {});
  const drawImage = () => {
    if (!img) {
      const drop = h('div', { class: 'drop', tabindex: 0, role: 'button', onclick: () => !locked && fileIn.click(), onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileIn.click(); } } },
        h('b', {}, 'Escolha a imagem do post'), h('span', { class: 'muted' }, 'Arraste aqui, cole (Ctrl+V) ou clique. Pode deixar para depois se ainda é ideia.'));
      drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
      drop.addEventListener('dragleave', () => drop.classList.remove('over'));
      drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); const f = e.dataTransfer.files[0]; if (f) takeFile(f); });
      return imgBox.replaceChildren(drop, fileIn);
    }
    imgBox.replaceChildren(h('div', { class: 'preview' }, h('img', { src: img.url, alt: 'Prévia do post' }),
      h('div', { style: 'display:grid;gap:8px' },
        h('span', { class: 'hint muted' }, img.note || 'Como vai aparecer no feed.'),
        locked ? null : h('button', { class: 'btn sm', type: 'button', onclick: () => fileIn.click() }, 'Trocar imagem'))), fileIn);
  };
  const takeFile = async (f) => { try { img = await prepareImage(f); drawImage(); } catch (e) { toast(e.message, true); } };
  const onPaste = (e) => { const f = [...(e.clipboardData?.files || [])][0]; if (f && !locked) takeFile(f); };
  document.addEventListener('paste', onPaste);
  drawImage();

  const cap = h('textarea', { id: 'f-cap', disabled: locked, placeholder: 'Legenda, emojis e hashtags…' }, post?.caption || '');
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
    h('div', { class: 'field' }, h('span', { class: 'label' }, 'Imagem'), imgBox),
    h('div', { class: 'field' }, h('label', { for: 'f-cap' }, 'Legenda'), cap, counter, locked ? null : aiPanel()),
    h('div', { class: 'two' },
      h('div', { class: 'field' }, h('label', { for: 'f-date' }, 'Data'), dIn),
      h('div', { class: 'field' }, h('label', { for: 'f-time' }, 'Hora'), tIn)),
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
        if (img?.blob) payload.image_base64 = await blobToDataUrl(img.blob);
        else if (img?.url) payload.image_url = img.url;
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
    if (needsComplete && !img) return toast('Para enviar ou aprovar, o post precisa de imagem.', true);
    if (needsComplete && !data.scheduled_at) return toast('Para enviar ou aprovar, escolha a data e a hora.', true);
    if (needsComplete && new Date(data.scheduled_at) < Date.now() + 60e3 && !confirmLate) {
      confirmLate = true; return toast('Esse horário já passou: o post sai na próxima rodada (até 5 min). Clique de novo para confirmar.');
    }
    footBtns.forEach((b) => (b.disabled = true));
    try {
      if (img?.blob) Object.assign(data, await api(`/api/upload?client=${[...picked][0]}`, { method: 'POST', raw: img.blob }));
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
        if (data.image_url) Object.assign(diff, { image_url: data.image_url, image_path: data.image_path });
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
    h('button', { class: 'btn primary', onclick: () => openClient() }, '+ Novo cliente'))];
  if (!S.clients.length) {
    out.push(h('div', { class: 'empty' }, h('h3', {}, 'Nenhum cliente ainda'),
      h('p', { class: 'muted' }, 'Cadastre o cliente, conecte o Instagram dele e mande o link de aprovação.'),
      h('button', { class: 'btn primary', onclick: () => openClient() }, '+ Novo cliente')));
    return out;
  }
  out.push(h('div', { class: 'grid-clients' }, ...S.clients.map(cardClient)));
  return out;
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
    h('dl', { class: 'kv' },
      h('dt', {}, 'Instagram'), h('dd', {}, ig),
      h('dt', {}, 'WhatsApp'), h('dd', {}, c.contact_whatsapp ? `+${c.contact_whatsapp}` : h('span', { class: 'muted' }, '—')),
      h('dt', {}, 'E-mail'), h('dd', {}, c.contact_email || h('span', { class: 'muted' }, '—')),
      h('dt', {}, 'Tom de voz'), h('dd', {}, c.brand_voice ? h('span', { class: 'clamp2' }, c.brand_voice) : h('span', { class: 'muted' }, '— (usado pela IA)'))),
    h('div', { class: 'field' }, h('span', { class: 'eyebrow' }, 'Link fixo de aprovação'),
      h('div', { class: 'linkbox' }, h('code', { translate: 'no' }, c.approval_url), h('button', { class: 'btn sm', onclick: () => copyText(c.approval_url, 'Link copiado.') }, 'Copiar'))),
    h('div', { class: 'actions' },
      c.ig_connected && !expired ? null : h('a', { class: 'btn primary sm', href: `/api/ig/connect?client=${c.id}` }, c.ig_connected ? 'Reconectar Instagram' : 'Conectar Instagram'),
      c.contact_whatsapp ? h('a', { class: 'btn wa sm', href: waLink(c.contact_whatsapp, approvalMessage(c)), target: '_blank', rel: 'noopener' }, 'WhatsApp') : null,
      c.contact_email ? h('a', { class: 'btn sm', href: mailLink(c.contact_email, approvalSubject(c), approvalMessage(c)) }, 'E-mail') : null,
      h('a', { class: 'btn sm', href: `#pasta/${c.id}` }, '🔒 Pasta'),
      h('button', { class: 'btn sm', onclick: () => openClient(c) }, 'Editar')));
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
  const fields = [['razao_social', 'Razão social', 'MC Digital Ltda'], ['cnpj', 'CNPJ', '00.000.000/0001-00'], ['endereco', 'Endereço', 'Rua, número, bairro, cidade/UF, CEP'],
    ['cidade', 'Cidade/UF (foro e assinatura)', 'Cuiabá/MT'], ['representante', 'Representante legal', 'Marcus Ramos'], ['email', 'E-mail', 'contato@…'], ['pix', 'Chave PIX', '']];
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
    h('span', { class: 'muted', style: 'font-size:13.5px' }, 'Cole o texto do seu contrato e troque os dados variáveis pelos campos abaixo (clique num campo para inseri-lo onde está o cursor). Linha começando com "# " vira título, "## " vira cláusula, **texto** fica em negrito e {{assinaturas}} sozinho numa linha cria as linhas de assinatura.'),
    h('div', { class: 'pick tpl-fields' }, ...Object.entries({ ...S.settings.fields, assinaturas: 'Linhas de assinatura' }).map(([k, label]) =>
      h('button', { class: 'chip', type: 'button', title: label, onclick: () => insert(k) }, label))),
    ta,
    h('div', { class: 'actions' },
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
const FOLDER_TABS = [['contract', 'Contrato'], ['finance', 'Financeiro'], ['report', 'Relatórios'], ['other', 'Outros']];
const ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx,.csv,.txt';
const todayLocal = () => partsInTz(new Date().toISOString(), S.tz).date;
const nextMonth = (m) => shiftMonth(m, 1);

// Situação de cada mês desde o início da cobrança: paid | waived | open (ainda no prazo) | late (venceu)
function billingMonths(c) {
  if (!c.billing_start) return [];
  const today = todayLocal(), cur = today.slice(0, 7);
  const pays = new Map(S.payments.filter((p) => p.client_id === c.id).map((p) => [p.ref_month, p]));
  let last = cur; for (const k of pays.keys()) if (k > last) last = k;
  const out = [];
  for (let m = c.billing_start.slice(0, 7); m <= last && out.length < 240; m = nextMonth(m)) {
    const [y, mo] = m.split('-').map(Number);
    const lastDay = new Date(Date.UTC(y, mo, 0)).getUTCDate();
    const due = `${m}-${String(Math.min(c.due_day || lastDay, lastDay)).padStart(2, '0')}`;
    const p = pays.get(m) || null;
    const st = p?.status === 'paid' ? 'paid' : p?.status === 'waived' ? 'waived' : today > due ? 'late' : 'open';
    out.push({ month: m, due, payment: p, status: st });
  }
  return out.reverse();
}
const lateCount = (c) => billingMonths(c).filter((m) => m.status === 'late').length;
const PAY_LABEL = { paid: ['Pago', 'st-approved'], waived: ['Isento', 'st-draft'], open: ['Em aberto', 'st-pending_approval'], late: ['Atrasado', 'st-failed'] };

async function loadFolder(id) {
  try {
    const [files, payments, preview] = await Promise.all([
      api(`/api/pasta?r=files&client=${id}`), api('/api/pasta?r=payments'), api(`/api/pasta?r=contract&client=${id}`)]);
    Object.assign(S.folder, { files, preview, loading: false, error: null }); S.payments = payments;
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
    h('span', { class: 'lock', title: 'Os arquivos ficam num cofre privado. Cada link abre por 2 minutos e só com você logado.' }, '🔒 Pasta privada · só você vê'));
  const tabs = h('div', { class: 'seg folder-tabs', role: 'group', 'aria-label': 'Seções da pasta' },
    ...FOLDER_TABS.map(([k, l]) => {
      const n = k === 'finance' ? late : k === 'contract' ? count('contract') : count(k);
      return h('button', { class: 'seg-btn', 'aria-pressed': String(F.tab === k), onclick: () => { F.tab = k; render(); } },
        l, n ? h('span', { class: `seg-n${k === 'finance' ? ' bad' : ''}` }, String(n)) : null);
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
  const body = { contract: folderContract, finance: folderFinance, report: folderReports, other: folderOther }[F.tab](c);
  return [head, tabs, ...body];
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
  const [rep, fRep] = inp('k-rep', 'Representante (quem assina)', k.representante, { placeholder: 'Nome e CPF' });
  const [serv, fServ] = inp('k-serv', 'Serviços contratados', k.servicos, { tag: 'textarea', style: 'min-height:110px', placeholder: 'Ex.: Gestão do Instagram com 12 posts por mês (arte + legenda), agendamento, aprovação e relatório mensal.' });
  const [fee, fFee] = inp('k-fee', 'Valor mensal (R$)', c.monthly_fee_cents != null ? (c.monthly_fee_cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '', { inputmode: 'decimal', placeholder: '1.500,00' });
  const [due, fDue] = inp('k-due', 'Dia do vencimento', c.due_day, { type: 'number', min: 1, max: 31, placeholder: '10' });
  const [start, fStart] = inp('k-start', 'Início do contrato', c.billing_start, { type: 'date' }, 'A cobrança mensal começa neste mês.');
  const [prazo, fPrazo] = inp('k-prazo', 'Prazo (meses)', k.prazo_meses, { type: 'number', min: 1, max: 120, placeholder: '12' });
  const [forma, fForma] = inp('k-forma', 'Forma de pagamento', k.forma_pagamento, { placeholder: 'PIX ou boleto' });
  const close = drawer(`Dados do contrato · ${c.name}`, [
    h('div', { class: 'eyebrow' }, 'Contratante'), fNome, fDoc, fEnd, fRep,
    h('div', { class: 'eyebrow' }, 'Serviço e cobrança'), fServ,
    h('div', { class: 'grid-2 tight' }, fFee, fDue), h('div', { class: 'grid-2 tight' }, fStart, fPrazo), fForma,
  ], [h('span', { class: 'spacer' }), h('button', { class: 'btn primary', onclick: async (e) => {
    e.target.disabled = true;
    try {
      const saved = await api(`/api/clients?id=${c.id}`, { method: 'PATCH', body: {
        monthly_fee: fee.value, due_day: due.value, billing_start: start.value,
        contract_data: { nome: nome.value, documento: doc.value, endereco: end.value, representante: rep.value, servicos: serv.value, prazo_meses: prazo.value, forma_pagamento: forma.value },
      } });
      const i = S.clients.findIndex((x) => x.id === saved.id); if (i >= 0) S.clients[i] = saved;
      close(); toast('Dados do contrato salvos.');
      S.folder.preview = await api(`/api/pasta?r=contract&client=${c.id}`).catch(() => S.folder.preview);
      render();
    } catch (err) { toast(err.message, true); e.target.disabled = false; }
  } }, 'Salvar')]);
  nome.focus();
}

// ── Financeiro
function folderFinance(c) {
  if (!c.billing_start || c.monthly_fee_cents == null) {
    return [h('div', { class: 'empty' }, h('h3', {}, 'Defina a mensalidade'),
      h('p', { class: 'muted' }, 'Informe o valor, o dia do vencimento e o início do contrato. A partir daí cada mês aparece aqui como pago, em aberto ou atrasado.'),
      h('button', { class: 'btn primary', onclick: () => openContractData(c) }, 'Preencher dados'))];
  }
  const months = billingMonths(c);
  const late = months.filter((m) => m.status === 'late');
  const paidYear = months.filter((m) => m.status === 'paid' && m.month.startsWith(todayLocal().slice(0, 4)))
    .reduce((s, m) => s + (m.payment.amount_cents ?? c.monthly_fee_cents), 0);
  const fileName = (id) => S.folder.files.find((f) => f.id === id)?.name;
  return [
    h('div', { class: 'stats' },
      stat('Mensalidade', brl(c.monthly_fee_cents), c.due_day ? `vence todo dia ${c.due_day}` : 'vence no fim do mês'),
      stat('Em atraso', late.length ? brl(late.length * c.monthly_fee_cents) : 'Nada', late.length ? `${late.length} mês(es)` : 'tudo em dia', late.length ? 'bad' : 'good'),
      stat(`Recebido em ${todayLocal().slice(0, 4)}`, brl(paidYear), 'pela marcação de pagos')),
    h('div', { class: 'months' }, ...months.map((m) => {
      const [label, cls] = PAY_LABEL[m.status];
      const p = m.payment;
      const sub = m.status === 'paid' ? `Pago${p.paid_at ? ` em ${fmtDay(p.paid_at)}` : ''} · ${brl(p.amount_cents ?? c.monthly_fee_cents)}`
        : m.status === 'waived' ? (p.note || 'Sem cobrança neste mês')
        : `Vence ${fmtDay(m.due)} · ${brl(c.monthly_fee_cents)}`;
      return h('div', { class: `month-row${m.status === 'late' ? ' is-late' : ''}` },
        h('div', { class: 'month-name' }, monthLabel(m.month)),
        h('span', { class: `pill ${cls}` }, label),
        h('div', { class: 'month-sub muted' }, sub, p?.note && m.status === 'paid' ? ` · ${p.note}` : ''),
        h('div', { class: 'month-act' },
          p?.file_id && fileName(p.file_id) ? h('a', { class: 'btn ghost sm', href: `/api/pasta?r=files&id=${p.file_id}&open=1`, target: '_blank', rel: 'noopener', title: fileName(p.file_id) }, '📎 Comprovante') : null,
          h('button', { class: `btn sm${m.status === 'late' ? ' primary' : ''}`, onclick: () => openPayment(c, m) }, m.status === 'paid' || m.status === 'waived' ? 'Editar' : 'Registrar pagamento')));
    })),
    filesSection(c, 'receipt', 'Todos os comprovantes', 'Comprovantes enviados ao registrar pagamentos aparecem aqui. Também dá para enviar direto.', { month: true }),
  ];
}
const stat = (label, value, sub, tone = '') => h('div', { class: `stat ${tone}` }, h('div', { class: 'eyebrow' }, label), h('div', { class: 'stat-v' }, value), h('div', { class: 'muted', style: 'font-size:13px' }, sub));

function openPayment(c, m) {
  const p = m.payment;
  let status = p?.status === 'waived' ? 'waived' : 'paid';
  const paidAt = h('input', { type: 'date', id: 'p-date', value: p?.paid_at || todayLocal() });
  const amount = h('input', { id: 'p-amount', inputmode: 'decimal', value: ((p?.amount_cents ?? c.monthly_fee_cents) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 }) });
  const note = h('input', { id: 'p-note', value: p?.note || '', placeholder: status === 'waived' ? 'Ex.: mês de cortesia' : 'Ex.: pago via PIX' });
  const file = h('input', { type: 'file', id: 'p-file', accept: ACCEPT });
  const paidFields = h('div', { style: 'display:grid;gap:14px' },
    h('div', { class: 'grid-2 tight' },
      h('div', { class: 'field' }, h('label', { for: 'p-date' }, 'Data do pagamento'), paidAt),
      h('div', { class: 'field' }, h('label', { for: 'p-amount' }, 'Valor recebido (R$)'), amount)),
    h('div', { class: 'field' }, h('label', { for: 'p-file' }, p?.file_id ? 'Trocar comprovante (opcional)' : 'Comprovante (opcional)'), file,
      h('span', { class: 'hint' }, 'PDF ou print do PIX/boleto, até 4 MB. Fica guardado na pasta do cliente.')));
  const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Situação' },
    ...[['paid', 'Pago'], ['waived', 'Isento / cortesia']].map(([k, l]) => h('button', { class: 'seg-btn', type: 'button', 'aria-pressed': String(status === k),
      onclick: (e) => { status = k; for (const b of seg.children) b.setAttribute('aria-pressed', String(b === e.currentTarget)); paidFields.hidden = k !== 'paid'; } }, l)));
  paidFields.hidden = status !== 'paid';
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
      const row = await api('/api/pasta?r=payments', { method: 'PUT', body: {
        client_id: c.id, ref_month: m.month, status, note: note.value,
        ...(status === 'paid' ? { paid_at: paidAt.value || null, amount_cents: cents, file_id: fileId } : { file_id: null }),
      } });
      S.payments = S.payments.filter((x) => !(x.client_id === c.id && x.ref_month === m.month)).concat(row);
      close(); render(); toast(status === 'paid' ? `${monthLabel(m.month)} marcado como pago.` : `${monthLabel(m.month)} marcado como isento.`);
    } catch (e) { toast(e.message, true); save.disabled = false; }
  } }, 'Salvar');
  const foot = [];
  if (p) foot.push(confirmButton('Voltar para em aberto', 'Confirmar', async () => {
    await api(`/api/pasta?r=payments&client=${c.id}&month=${m.month}`, { method: 'DELETE' });
    S.payments = S.payments.filter((x) => !(x.client_id === c.id && x.ref_month === m.month));
    close(); render(); toast('Pagamento desfeito.');
  }, 'btn ghost'));
  foot.push(h('span', { class: 'spacer' }), save);
  const close = drawer(`${c.name} · ${monthLabel(m.month)}`, [
    h('div', { class: 'muted', style: 'font-size:14px' }, `Mensalidade de ${brl(c.monthly_fee_cents)} com vencimento em ${fmtDay(m.due)}.`),
    seg, paidFields,
    h('div', { class: 'field' }, h('label', { for: 'p-note' }, 'Observação'), note),
  ], foot);
}

// ── Relatórios e Outros
function folderReports(c) {
  return [filesSection(c, 'report', 'Relatórios mensais', 'Envie o relatório de cada mês (PDF de desempenho, prints de métricas, planilhas). Escolha o mês antes de enviar.', { month: true, group: true })];
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
