// Pauta — painel da agência (JavaScript puro, sem build).
import { h, api, toast, fmtDate, fmtTime, dayKey, zonedToISO, partsInTz, prepareImage, copyText, waLink, STATUS_LABEL } from '/shared.js';

const S = { admin: false, tz: 'America/Cuiaba', setup: null, clients: [], posts: [], view: 'agenda', fClient: '', fStatus: '' };
const viewFromHash = () => ({ '#clientes': 'clientes', '#ajustes': 'ajustes' })[location.hash] || 'agenda';
const root = document.getElementById('app');

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
  const from = new Date(Date.now() - 7 * 86400e3).toISOString();
  try {
    const [clients, posts] = await Promise.all([api('/api/clients'), api(`/api/posts?from=${encodeURIComponent(from)}`)]);
    S.clients = clients; S.posts = posts;
  } catch (e) {
    if (e.status === 401) { S.admin = false; return renderLogin(); }
    toast(e.message, true);
  }
  render();
}

window.addEventListener('hashchange', () => { S.view = viewFromHash(); render(); });

// Mantém a agenda em dia com as decisões dos clientes: atualiza ao voltar para a aba e a cada minuto.
async function refresh() {
  if (!S.admin || document.hidden || document.querySelector('.drawer')) return;
  const from = new Date(Date.now() - 7 * 86400e3).toISOString();
  try {
    const [clients, posts] = await Promise.all([api('/api/clients'), api(`/api/posts?from=${encodeURIComponent(from)}`)]);
    const changed = JSON.stringify(posts) !== JSON.stringify(S.posts) || JSON.stringify(clients) !== JSON.stringify(S.clients);
    S.clients = clients; S.posts = posts;
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
      h('div', { class: 'brand' }, h('span', { class: 'brand-mark' }), 'Pauta'),
      h('h1', {}, 'Entrar no painel'),
      h('div', { class: 'field' }, h('label', { for: 'pw' }, 'Senha'), pw),
      btn,
    )));
  pw.focus();
}

// ───────────────────────── estrutura
function render() {
  const tab = (id, label) => h('a', { class: 'tab', href: `#${id}`, 'aria-current': S.view === id ? 'page' : null }, label);
  const top = h('header', { class: 'topbar' }, h('div', { class: 'topbar-in' },
    h('div', { class: 'brand' }, h('span', { class: 'brand-mark' }), h('span', {}, 'Pauta')),
    h('nav', { class: 'tabs' }, tab('agenda', 'Agenda'), tab('clientes', 'Clientes'), tab('ajustes', 'Ajustes')),
    h('div', { class: 'spacer' }),
    h('button', { class: 'btn primary sm', onclick: () => openPost() }, '+ Novo post'),
    h('button', { class: 'btn ghost sm', onclick: logout, title: 'Sair' }, 'Sair'),
  ));
  const page = h('main', { class: 'page' });
  const pend = setupPending();
  if (pend.length && S.view !== 'ajustes') page.append(h('div', { class: 'banner' }, h('b', {}, 'Falta configurar: '), pend.join(' · '), ' — ', h('a', { href: '#ajustes' }, 'ver em Ajustes')));
  page.append(...(S.view === 'clientes' ? viewClients() : S.view === 'ajustes' ? viewSettings() : viewAgenda()));
  root.replaceChildren(top, page);
}

async function logout() { await api('/api/session', { method: 'DELETE' }).catch(() => {}); location.href = '/'; }

const clientName = (id) => S.clients.find((c) => c.id === id)?.name || '—';

// ───────────────────────── agenda
function viewAgenda() {
  const now = Date.now();
  const relevant = S.posts.filter((p) => !S.fClient || p.client_id === S.fClient);
  const count = (st) => relevant.filter((p) => p.status === st).length;
  const cards = [
    ['pending_approval', 'Aguardando cliente', '--s-wait'],
    ['changes_requested', 'Ajuste pedido', '--s-change'],
    ['approved', 'Aprovados na fila', '--s-ok'],
    ['draft', 'Rascunhos', '--s-draft'],
    ['failed', 'Falharam', '--s-fail'],
  ];
  const summary = h('div', { class: 'summary' }, ...cards.map(([st, label, color]) =>
    h('button', { class: 'sum', 'aria-pressed': String(S.fStatus === st), onclick: () => { S.fStatus = S.fStatus === st ? '' : st; render(); } },
      h('span', { class: 'eyebrow' }, h('span', { class: 'dot', style: `background:var(${color})` }), label),
      h('b', {}, String(count(st))))));

  const filters = h('div', { class: 'filters' },
    h('span', { class: 'eyebrow' }, 'Cliente'),
    h('button', { class: 'chip', 'aria-pressed': String(!S.fClient), onclick: () => { S.fClient = ''; render(); } }, 'Todos'),
    ...S.clients.map((c) => h('button', { class: 'chip', 'aria-pressed': String(S.fClient === c.id), onclick: () => { S.fClient = c.id; render(); } }, c.name)));

  let list = relevant.filter((p) => !S.fStatus || p.status === S.fStatus);
  // publicados há mais de 1 dia somem da agenda (continuam no Instagram, claro)
  list = list.filter((p) => p.status !== 'published' || now - new Date(p.published_at || p.scheduled_at) < 86400e3 || S.fStatus === 'published');

  const out = [h('div', { class: 'page-head' }, h('div', {}, h('div', { class: 'eyebrow' }, 'Próximas publicações'), h('h1', {}, 'Agenda')))];
  if (!S.clients.length) {
    out.push(h('div', { class: 'empty' }, h('h3', {}, 'Comece cadastrando um cliente'),
      h('p', { class: 'muted' }, 'Cada cliente tem o próprio Instagram conectado e um link fixo de aprovação.'),
      h('a', { class: 'btn primary', href: '#clientes' }, 'Ir para Clientes')));
    return out;
  }
  out.push(summary, filters);
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
  const late = ['pending_approval', 'draft', 'changes_requested'].includes(p.status) && new Date(p.scheduled_at) < Date.now();
  const note = p.status === 'changes_requested' && p.client_feedback ? h('div', { class: 'note' }, `“${p.client_feedback}”`)
    : p.status === 'failed' && p.last_error ? h('div', { class: 'note fail' }, p.last_error) : null;
  return h('button', { class: 'row', onclick: () => openPost(p) },
    h('img', { class: 'thumb', src: p.image_url, alt: '', loading: 'lazy' }),
    h('div', { class: 'time' }, fmtTime(p.scheduled_at, S.tz)),
    h('div', { class: 'main' }, h('div', { class: 'client' }, clientName(p.client_id)), h('div', { class: 'cap' }, p.caption || 'Sem legenda'), note),
    h('div', { class: 'side' }, h('span', { class: `pill st-${p.status}` }, STATUS_LABEL[p.status]), late ? h('span', { class: 'late' }, 'Horário já passou') : null));
}

// ───────────────────────── painel lateral
function drawer(title, body, foot) {
  const close = () => { scrim.remove(); panel.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const scrim = h('div', { class: 'scrim', onclick: close });
  const panel = h('aside', { class: 'drawer', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div', { class: 'drawer-head' }, h('h2', {}, title), h('button', { class: 'btn ghost sm', onclick: close, 'aria-label': 'Fechar' }, '✕')),
    h('div', { class: 'drawer-body' }, ...body), h('div', { class: 'drawer-foot' }, ...foot));
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
function openPost(post = null) {
  if (!S.clients.length) { location.hash = '#clientes'; return toast('Cadastre um cliente primeiro.'); }
  const isNew = !post;
  const locked = post && ['publishing', 'published'].includes(post.status);
  let img = post ? { url: post.image_url } : null; // { blob, url, note } quando trocada

  const clientSel = h('select', { id: 'f-client', disabled: !isNew },
    ...S.clients.map((c) => h('option', { value: c.id, selected: (post?.client_id || S.fClient || S.clients[0].id) === c.id }, c.name)));

  const fileIn = h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: () => fileIn.files[0] && takeFile(fileIn.files[0]) });
  const imgBox = h('div', {});
  const drawImage = () => {
    if (!img) {
      const drop = h('div', { class: 'drop', tabindex: 0, role: 'button', onclick: () => fileIn.click(), onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileIn.click(); } } },
        h('b', {}, 'Escolha a imagem do post'), h('span', { class: 'muted' }, 'Arraste aqui, cole (Ctrl+V) ou clique. JPEG, PNG ou WebP.'));
      drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
      drop.addEventListener('dragleave', () => drop.classList.remove('over'));
      drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); const f = e.dataTransfer.files[0]; if (f) takeFile(f); });
      return imgBox.replaceChildren(drop, fileIn);
    }
    imgBox.replaceChildren(h('div', { class: 'preview' }, h('img', { src: img.url, alt: 'Prévia do post' }),
      h('div', { style: 'display:grid;gap:8px' },
        img.note ? h('span', { class: 'hint muted' }, img.note) : h('span', { class: 'hint muted' }, 'Como vai aparecer no feed.'),
        locked ? null : h('button', { class: 'btn sm', type: 'button', onclick: () => fileIn.click() }, 'Trocar imagem'))), fileIn);
  };
  const takeFile = async (f) => {
    try { img = await prepareImage(f); drawImage(); } catch (e) { toast(e.message, true); }
  };
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

  const when = post ? partsInTz(post.scheduled_at, S.tz) : (() => { const d = partsInTz(new Date(Date.now() + 86400e3).toISOString(), S.tz); return { date: d.date, time: '19:00' }; })();
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
    if (post.status === 'pending_approval') body.push(notifyBox(S.clients.find((c) => c.id === post.client_id)));
  }
  body.push(
    h('div', { class: 'field' }, h('label', { for: 'f-client' }, 'Cliente'), clientSel),
    h('div', { class: 'field' }, h('span', { class: 'label' }, 'Imagem'), imgBox),
    h('div', { class: 'field' }, h('label', { for: 'f-cap' }, 'Legenda'), cap, counter),
    h('div', { class: 'two' },
      h('div', { class: 'field' }, h('label', { for: 'f-date' }, 'Data'), dIn),
      h('div', { class: 'field' }, h('label', { for: 'f-time' }, 'Hora'), tIn)),
    h('div', { class: 'field' }, h('label', { for: 'f-alt' }, 'Texto alternativo (opcional)'), alt, h('span', { class: 'hint' }, 'Descrição da imagem para pessoas com deficiência visual.')),
  );

  const collect = () => ({ caption: cap.value, alt_text: alt.value.trim(), scheduled_at: zonedToISO(dIn.value, tIn.value, S.tz) });

  async function save(mode) { // mode: 'draft' | 'send' | 'approve' | 'save'
    const data = collect();
    if (!img) return toast('Escolha a imagem do post.', true);
    if (!dIn.value || !tIn.value) return toast('Escolha a data e a hora.', true);
    if (new Date(data.scheduled_at) < Date.now() + 60e3 && mode !== 'draft') {
      if (!confirmLate) { confirmLate = true; return toast('Esse horário já passou: o post sai na próxima rodada (até 5 min). Clique de novo para confirmar.'); }
    }
    footBtns.forEach((b) => (b.disabled = true));
    try {
      if (img.blob) {
        const up = await api(`/api/upload?client=${clientSel.value}`, { method: 'POST', raw: img.blob });
        Object.assign(data, up);
      }
      let saved;
      if (isNew) {
        saved = await api('/api/posts', { method: 'POST', body: { ...data, client_id: clientSel.value, send: mode === 'send', approved: mode === 'approve' } });
      } else {
        // Manda só o que mudou: assim, mexer só no horário não tira o post da fila.
        const diff = {};
        if (data.caption !== (post.caption || '')) diff.caption = data.caption;
        if (data.alt_text !== (post.alt_text || '')) diff.alt_text = data.alt_text;
        if (new Date(data.scheduled_at).getTime() !== new Date(post.scheduled_at).getTime()) diff.scheduled_at = data.scheduled_at;
        if (data.image_url) Object.assign(diff, { image_url: data.image_url, image_path: data.image_path });
        saved = Object.keys(diff).length
          ? await api(`/api/posts?id=${post.id}`, { method: 'PATCH', body: { ...diff, send: mode === 'send' } })
          : post;
        if (mode === 'send' && saved.status !== 'pending_approval') saved = await api(`/api/posts?id=${post.id}`, { method: 'PATCH', body: { action: 'send' } });
        if (mode === 'approve' && saved.status !== 'approved') saved = await api(`/api/posts?id=${post.id}`, { method: 'PATCH', body: { action: 'approve' } });
        if (mode === 'save' && saved === post) { close(); return toast('Nada mudou.'); }
      }
      upsert(saved); close();
      toast(mode === 'send' ? 'Enviado para aprovação. O cliente já vê no link dele.' : mode === 'approve' ? 'Aprovado. Publica sozinho no horário.' : 'Salvo.');
      if (mode === 'send') maybeNotify(saved);
    } catch (e) {
      toast(e.message, true);
    } finally { footBtns.forEach((b) => (b.disabled = false)); }
  }
  let confirmLate = false;

  async function action(a, msg) {
    try { upsert(await api(`/api/posts?id=${post.id}`, { method: 'PATCH', body: { action: a } })); close(); toast(msg); }
    catch (e) { toast(e.message, true); }
  }

  const B = (label, cls, fn) => h('button', { class: `btn ${cls}`, type: 'button', onclick: fn }, label);
  let foot;
  if (isNew) foot = [B('Salvar rascunho', '', () => save('draft')), B('Aprovar direto', 'ghost', () => save('approve')), B('Enviar para aprovação', 'primary', () => save('send'))];
  else if (locked) foot = post.status === 'published'
    ? [confirmButton('Remover do painel', 'Confirmar remoção', async () => { await api(`/api/posts?id=${post.id}`, { method: 'DELETE' }); S.posts = S.posts.filter((x) => x.id !== post.id); close(); render(); toast('Removido do painel. No Instagram continua publicado.'); })]
    : [h('span', { class: 'muted' }, 'Publicando agora…')];
  else {
    const del = confirmButton('Apagar', 'Confirmar exclusão', async () => { await api(`/api/posts?id=${post.id}`, { method: 'DELETE' }); S.posts = S.posts.filter((x) => x.id !== post.id); close(); render(); toast('Post apagado.'); });
    const st = post.status;
    foot = [del, h('span', { class: 'spacer' })];
    if (st === 'draft') foot.push(B('Salvar', '', () => save('save')), B('Aprovar direto', 'ghost', () => save('approve')), B('Enviar para aprovação', 'primary', () => save('send')));
    if (st === 'pending_approval') foot.push(B('Voltar p/ rascunho', 'ghost', () => action('to_draft', 'Voltou para rascunho.')), B('Salvar', '', () => save('save')), B('Aprovar direto', 'primary', () => save('approve')));
    if (st === 'changes_requested') foot.push(B('Aprovar assim mesmo', 'ghost', () => save('approve')), B('Salvar e reenviar', 'primary', () => save('send')));
    if (st === 'approved') foot.push(B('Tirar da fila', 'ghost', () => action('to_draft', 'Saiu da fila: virou rascunho.')), B('Salvar', 'primary', () => save('save')));
    if (st === 'failed') foot.push(B('Voltar p/ rascunho', 'ghost', () => action('to_draft', 'Voltou para rascunho.')), B('Tentar de novo', 'primary', () => action('retry', 'Na fila de novo. Sai em até 5 minutos.')));
  }
  const footBtns = foot.filter((b) => b instanceof HTMLButtonElement);
  if (post && ['pending_approval', 'approved'].includes(post.status) && !locked) {
    body.push(h('p', { class: 'hint muted', style: 'margin:0;font-size:13px' }, 'Mudar imagem, legenda ou texto alternativo volta o post para rascunho, para o cliente aprovar a versão nova. Mudar só data e hora mantém o status.'));
  }
  const close0 = drawer(isNew ? 'Novo post' : 'Post', body, foot);
  const close = () => { document.removeEventListener('paste', onPaste); close0(); };
}

function upsert(p) {
  const i = S.posts.findIndex((x) => x.id === p.id);
  if (i >= 0) S.posts[i] = { ...S.posts[i], ...p }; else S.posts.push(p);
  S.posts.sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at));
  render();
}

function approvalMessage(c) {
  return `Olá! Os posts de ${c.name} estão prontos para sua aprovação:\n${c.approval_url}\n\nÉ só abrir, ver cada post e tocar em Aprovar ou Pedir ajuste. Depois de aprovado, ele publica sozinho no horário. 🙂`;
}

function notifyBox(c) {
  if (!c) return null;
  return h('div', { class: 'card', style: 'gap:10px;padding:14px' },
    h('b', {}, 'Avisar o cliente'),
    h('span', { class: 'muted', style: 'font-size:13.5px' }, `Todos os posts aguardando aparecem no link fixo de ${c.name}.`),
    h('div', { class: 'actions' },
      c.contact_whatsapp ? h('a', { class: 'btn wa sm', href: waLink(c.contact_whatsapp, approvalMessage(c)), target: '_blank', rel: 'noopener' }, 'Mandar no WhatsApp') : null,
      h('button', { class: 'btn sm', type: 'button', onclick: () => copyText(approvalMessage(c), 'Mensagem com o link copiada.') }, 'Copiar mensagem')));
}

function maybeNotify(p) {
  const c = S.clients.find((x) => x.id === p.client_id);
  if (!c) return;
  drawer(`Avisar ${c.name}`, [notifyBox(c), h('p', { class: 'muted', style: 'margin:0' }, 'Dica: envie vários posts para aprovação e avise o cliente uma vez só. O link sempre mostra tudo o que está pendente.')], []);
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
  const ig = !c.ig_connected ? h('span', { class: 'ig-off' }, 'Não conectado')
    : exp !== null && exp <= 0 ? h('span', { class: 'ig-off' }, `@${c.ig_username} · conexão expirou`)
    : h('span', { class: exp !== null && exp < 5 ? 'ig-warn' : 'ig-ok' }, `@${c.ig_username || 'conectado'}`);
  return h('article', { class: 'card' },
    h('div', { style: 'display:flex;align-items:center;gap:10px' }, h('h3', { style: 'flex:1;min-width:0' }, c.name),
      pend ? h('span', { class: 'pill st-pending_approval' }, `${pend} aguardando`) : null),
    h('dl', { class: 'kv' },
      h('dt', {}, 'Instagram'), h('dd', {}, ig),
      h('dt', {}, 'WhatsApp'), h('dd', {}, c.contact_whatsapp ? `+${c.contact_whatsapp}` : h('span', { class: 'muted' }, '—')),
      h('dt', {}, 'E-mail'), h('dd', {}, c.contact_email || h('span', { class: 'muted' }, '—'))),
    h('div', { class: 'field' }, h('span', { class: 'eyebrow' }, 'Link fixo de aprovação'),
      h('div', { class: 'linkbox' }, h('code', { translate: 'no' }, c.approval_url), h('button', { class: 'btn sm', onclick: () => copyText(c.approval_url, 'Link copiado.') }, 'Copiar'))),
    h('div', { class: 'actions' },
      c.ig_connected && !(exp !== null && exp <= 0)
        ? null
        : h('a', { class: 'btn primary sm', href: `/api/ig/connect?client=${c.id}` }, c.ig_connected ? 'Reconectar Instagram' : 'Conectar Instagram'),
      c.contact_whatsapp ? h('a', { class: 'btn wa sm', href: waLink(c.contact_whatsapp, approvalMessage(c)), target: '_blank', rel: 'noopener' }, 'Mandar link') : null,
      h('button', { class: 'btn sm', onclick: () => openClient(c) }, 'Editar')));
}

function openClient(c = null) {
  const name = h('input', { type: 'text', id: 'c-name', value: c?.name || '', placeholder: 'Ex.: Padaria Pão Quente', required: true });
  const wa = h('input', { type: 'tel', id: 'c-wa', value: c?.contact_whatsapp ? c.contact_whatsapp.replace(/^55/, '') : '', placeholder: '65 99999-9999', inputmode: 'tel' });
  const email = h('input', { type: 'email', id: 'c-email', value: c?.contact_email || '', placeholder: 'cliente@empresa.com.br' });
  const body = [
    h('div', { class: 'field' }, h('label', { for: 'c-name' }, 'Nome do cliente'), name),
    h('div', { class: 'field' }, h('label', { for: 'c-wa' }, 'WhatsApp de quem aprova'), wa, h('span', { class: 'hint' }, 'Com DDD. Usado no botão "Mandar link".')),
    h('div', { class: 'field' }, h('label', { for: 'c-email' }, 'E-mail (opcional)'), email),
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
    const payload = { name: name.value, contact_whatsapp: wa.value, contact_email: email.value, ...extra };
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
  if (c) foot.push(confirmButton('Remover cliente', 'Confirmar: apaga os posts dele', async () => {
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
    h('div', { class: 'grid-clients' },
      h('article', { class: 'card' },
        h('div', { class: 'eyebrow' }, 'Etapa 2 · App no ar'),
        h('h3', {}, 'Endereço e banco de dados'),
        ok(!st.missing_env?.length, 'Banco de dados e senha configurados', `Faltam: ${(st.missing_env || []).join(', ')}`),
        st.app_url ? h('div', { class: 'linkbox' }, h('code', { translate: 'no' }, st.app_url), h('button', { class: 'btn sm', onclick: () => copyText(st.app_url, 'Endereço copiado.') }, 'Copiar')) : null),
      h('article', { class: 'card' },
        h('div', { class: 'eyebrow' }, 'Etapa 3 · Meta'),
        h('h3', {}, 'App do Instagram'),
        ok(st.ig_ready, 'IG_APP_ID e IG_APP_SECRET configurados', 'Falta colocar IG_APP_ID e IG_APP_SECRET na Vercel'),
        h('span', { class: 'muted', style: 'font-size:14px' }, 'Cole este endereço em "URLs de redirecionamento OAuth" no app da Meta:'),
        st.redirect_uri ? codeBox(st.redirect_uri, 'endereço') : null,
        h('span', { class: 'muted', style: 'font-size:14px' }, 'Política de privacidade (para a Meta):'),
        st.app_url ? codeBox(`${st.app_url}/privacidade`, 'link') : null),
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
  ];
}
