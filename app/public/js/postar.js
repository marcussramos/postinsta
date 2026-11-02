// MC DIGITAL — Publicação assistida e posts que ficaram para trás.
//  • "Postar agora": para cliente sem Instagram conectado (ou com a conexão caída). Abre pelo aviso no celular
//    (#postar/<id>), pela faixa Hoje ou pelo post. Prepara as mídias, copia a legenda e manda para o Instagram
//    pelo compartilhar do celular; no fim, "Postei ✓" registra como publicado.
//  • "Ficou para trás": posts com a data vencida que não saíram. Cada um tem a saída certa: postar agora,
//    já saiu, entregar (só produção) ou remarcar.
import { h, api, toast, fmtDate, fmtTime, copyText } from '/shared.js';
import { S, can, clientName, drawer, confirmButton, typeBadge, render } from './core.js';
import { openPost, upsert } from './post.js';
import { connectionDead } from './clientes.js';

const BEHIND = ['draft', 'internal_review', 'pending_approval', 'changes_requested', 'approved', 'failed'];
const clientOf = (p) => S.clients.find((c) => c.id === p.client_id) || {};
// o app não publica sozinho por este cliente (e não é "só produção", em que o cliente posta)
const isAssisted = (c) => Boolean(c && c.id) && !c.production_only && (!c.ig_connected || connectionDead(c));
const canAssist = (p) => ['approved', 'failed'].includes(p.status) && isAssisted(clientOf(p)) && mediaOf(p).length > 0;

function mediaOf(p) {
  if (Array.isArray(p.media) && p.media.length) return p.media.filter((m) => m && m.url && !m.cover);
  return p.image_url ? [{ url: p.image_url, kind: 'image' }] : [];
}
const extOf = (m, type) => {
  const e = (String(m.url).split('?')[0].match(/\.([a-z0-9]{3,4})$/i) || [])[1];
  return (e || (type.startsWith('video') ? 'mp4' : 'jpg')).toLowerCase();
};
const slug = (s) => String(s || 'post').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 40) || 'post';

// ───────────────────────── Postar agora
function openAssist(post) {
  const c = clientOf(post);
  const items = mediaOf(post);
  const caption = post.media_type === 'STORY' ? '' : String(post.caption || '');
  let files = null; // File[] quando tudo baixou
  const status = h('p', { class: 'muted assist-status' }, items.length ? `Preparando ${items.length} arquivo${items.length > 1 ? 's' : ''}…` : 'Este post não tem mídia.');
  const shareBtn = h('button', { class: 'btn primary assist-share', type: 'button', disabled: true, onclick: share }, '📲 Copiar legenda e abrir no Instagram');
  const dl = h('div', { class: 'assist-dl' });

  // baixa antes do toque: o "compartilhar" do celular precisa ser chamado logo depois do toque
  (async () => {
    try {
      const base = `${slug(c.name)}-${slug(post.title)}`;
      files = await Promise.all(items.map(async (m, i) => {
        const r = await fetch(m.url);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const b = await r.blob();
        const type = b.type || (m.kind === 'video' ? 'video/mp4' : 'image/jpeg');
        return new File([b], `${base}${items.length > 1 ? `-${i + 1}` : ''}.${extOf(m, type)}`, { type });
      }));
      dl.replaceChildren(...files.map((f, i) => h('a', { class: 'btn sm', href: URL.createObjectURL(f), download: f.name }, `⬇ ${items.length > 1 ? `Arquivo ${i + 1}` : 'Baixar mídia'}`)));
      const shareable = navigator.canShare && navigator.canShare({ files });
      status.textContent = shareable
        ? 'Pronto. Toque no botão, escolha Instagram e cole a legenda.'
        : 'Pronto. Neste aparelho o Instagram não abre direto: baixe as mídias, copie a legenda e poste pelo app.';
      shareBtn.disabled = false;
      if (!shareable) shareBtn.textContent = '📋 Copiar legenda';
    } catch {
      status.textContent = 'Não deu para preparar as mídias aqui. Abra pelo celular com internet ou baixe pelo post.';
      shareBtn.disabled = false; shareBtn.textContent = '📋 Copiar legenda';
    }
  })();

  async function share() {
    // copia primeiro (a legenda não vai junto com as fotos para o Instagram)
    if (caption) { try { await navigator.clipboard.writeText(caption); } catch { await copyText(caption, 'Legenda copiada.'); } }
    if (files && navigator.canShare && navigator.canShare({ files })) {
      try { await navigator.share({ files }); toast(caption ? 'Legenda copiada. No Instagram, cole na legenda e publique.' : 'Agora é só publicar no Instagram.'); }
      catch (e) { if (e.name !== 'AbortError') toast('O compartilhar não abriu. Use os botões de baixar.', true); }
    } else if (caption) toast('Legenda copiada.');
  }

  const when = post.scheduled_at ? `${fmtDate(post.scheduled_at, S.tz)} às ${fmtTime(post.scheduled_at, S.tz)}` : 'sem data';
  const late = post.scheduled_at && new Date(post.scheduled_at) < Date.now();
  const body = [
    h('div', { class: 'assist-head' },
      h('b', {}, c.name || clientName(post.client_id)), typeBadge(post),
      h('span', { class: `pill ${late ? 'st-failed' : 'st-approved'}` }, late ? `era para ${when}` : when)),
    post.title ? h('p', { class: 'assist-title' }, post.title) : null,
    h('div', { class: 'assist-media' }, ...items.map((m) => m.kind === 'video'
      ? h('video', { src: m.url, muted: true, playsinline: true, preload: 'metadata', controls: true })
      : h('img', { src: m.url, alt: '', loading: 'lazy' }))),
    caption ? h('div', { class: 'assist-cap' },
      h('div', { class: 'assist-cap-head' }, h('span', { class: 'eyebrow' }, 'Legenda'), h('button', { class: 'btn ghost sm', type: 'button', onclick: () => copyText(caption, 'Legenda copiada.') }, 'Copiar')),
      h('pre', {}, caption)) : null,
    h('ol', { class: 'assist-steps' },
      h('li', {}, caption ? 'Toque no botão: a legenda é copiada e o compartilhar abre.' : 'Toque no botão: o compartilhar abre.'),
      h('li', {}, post.media_type === 'STORY' ? 'Escolha Instagram → Story e publique.' : `Escolha Instagram → ${post.media_type === 'REELS' ? 'Reels' : 'Feed'}${caption ? ', cole a legenda' : ''} e publique.`),
      h('li', {}, 'Volte aqui e toque em "Postei ✓".')),
    status, shareBtn, dl,
    !c.ig_connected || connectionDead(c) ? h('p', { class: 'hint muted', style: 'margin:0;font-size:13px' }, `O app não publica sozinho por ${c.name || 'este cliente'} porque o Instagram ${c.ig_connected ? 'desconectou' : 'não está conectado'}. Quando reconectar, volta a sair no horário.`) : null,
  ];
  const foot = [
    h('button', { class: 'btn ghost', type: 'button', onclick: () => { close(); openPost(post); } }, 'Abrir o post'),
    h('span', { class: 'spacer' }),
    can('conteudo') ? confirmButton('Postei ✓', 'Confirmar: já está no Instagram', async () => {
      try { done(await api(`/api/posts?id=${post.id}`, { method: 'PATCH', body: { action: 'mark_published' } })); close(); toast('Marcado como publicado.'); }
      catch (e) { toast(e.message, true); }
    }, 'btn primary') : null,
  ].filter(Boolean);
  const close = drawer('Postar agora', body, foot);
}

function done(p) {
  S.behindOld = (S.behindOld || []).filter((x) => x.id !== p.id);
  upsert(p);
}

// aviso no celular abre /equipe#postar/<id>
async function openAssistById(id) {
  let p = S.posts.find((x) => x.id === id) || (S.behindOld || []).find((x) => x.id === id);
  if (!p) {
    try { p = (await api(`/api/posts?status=approved,failed&from=${encodeURIComponent(new Date(Date.now() - 30 * 864e5).toISOString())}`)).find((x) => x.id === id); } catch { /* sem rede */ }
  }
  if (!p) return toast('Esse post não está mais na fila.', true);
  if (p.status === 'published') return toast('Esse post já está marcado como publicado ✓');
  openAssist(p);
}

// ───────────────────────── Ficou para trás
async function loadBehind() {
  try {
    const from = new Date(Date.now() - 30 * 864e5).toISOString();
    const to = new Date(Date.now() - 7 * 864e5).toISOString(); // os últimos 7 dias já vêm em S.posts
    S.behindOld = await api(`/api/posts?status=${BEHIND.join(',')}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
  } catch { S.behindOld = S.behindOld || []; }
}

function behindPosts() {
  const now = Date.now();
  const seen = new Set();
  return [...S.posts, ...(S.behindOld || [])].filter((p) => {
    if (seen.has(p.id) || !BEHIND.includes(p.status) || !p.scheduled_at) return false;
    seen.add(p.id);
    const t = new Date(p.scheduled_at).getTime();
    if (t >= now) return false;
    const c = clientOf(p);
    if (c.own && p.status !== 'approved') return false;
    // aprovado de cliente conectado: o agendador ainda pode estar publicando
    if (p.status === 'approved' && !isAssisted(c) && !c.production_only) return now - t > 30 * 60e3;
    return true;
  }).sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at));
}

function behindRow(p) {
  const c = clientOf(p);
  const B = (label, cls, fn) => h('button', { class: `btn sm ${cls}`, type: 'button', onclick: fn }, label);
  const act = async (action, msg) => {
    try { done(await api(`/api/posts?id=${p.id}`, { method: 'PATCH', body: { action } })); toast(msg); }
    catch (e) { toast(e.message, true); }
  };
  const why = p.status === 'approved' ? (c.production_only ? 'aprovado · falta entregar' : isAssisted(c) ? 'aprovado · postar à mão' : 'aprovado · não saiu')
    : p.status === 'failed' ? 'não publicou'
      : p.status === 'pending_approval' ? 'cliente não aprovou'
        : p.status === 'changes_requested' ? 'ajuste pedido' : 'ainda em produção';
  const actions = [];
  if (canAssist(p)) actions.push(B('📲 Postar agora', 'primary', () => openAssist(p)));
  if (c.production_only && can('conteudo')) actions.push(confirmButton('Já entreguei', 'Confirmar entrega', () => act('deliver', 'Marcado como entregue.'), 'btn sm'));
  else if (can('conteudo')) actions.push(confirmButton('Já saiu', 'Confirmar: está no Instagram', () => act('mark_published', 'Marcado como publicado.'), 'btn sm'));
  actions.push(B('Nova data', 'ghost', () => openPost(p)));
  const src = p.image_url || mediaOf(p).find((m) => m.kind !== 'video')?.url;
  return h('div', { class: 'behind-row' },
    src ? h('img', { class: 'behind-thumb', src, alt: '', loading: 'lazy' }) : h('span', { class: 'behind-thumb thumb-empty', 'aria-hidden': 'true' }, '🖼'),
    h('div', { class: 'behind-main' },
      h('b', {}, `${c.name || clientName(p.client_id)} · ${p.title || 'Post'}`),
      h('span', { class: 'muted' }, `${fmtDate(p.scheduled_at, S.tz)} ${fmtTime(p.scheduled_at, S.tz)} · ${why}`)),
    h('div', { class: 'behind-actions' }, ...actions));
}

function behindCard() {
  const list = behindPosts();
  if (!list.length) return null;
  const MAX = 5;
  const box = h('div', { class: 'behind-list' });
  const draw = (all) => {
    box.replaceChildren(...(all ? list : list.slice(0, MAX)).map(behindRow),
      !all && list.length > MAX ? h('button', { class: 'btn ghost sm', type: 'button', onclick: () => draw(true) }, `Ver mais ${list.length - MAX}`) : '');
  };
  draw(false);
  return h('section', { class: 'card behind-card' },
    h('div', { class: 'home-card-head' }, h('h3', {}, `Ficou para trás · ${list.length}`), h('span', { class: 'muted' }, 'A data passou e o post não saiu')),
    h('p', { class: 'muted', style: 'margin:0;font-size:13px' }, 'Resolva cada um: postar agora, marcar que já saiu ou escolher nova data. Assim o relatório do mês sai certo.'),
    box);
}

export { openAssist, openAssistById, isAssisted, canAssist, loadBehind, behindPosts, behindCard };
