// Página pública de aprovação do cliente.
import { h, api, toast, fmtDate, fmtTime } from '/shared.js';

const token = new URLSearchParams(location.search).get('t') || '';
const root = document.getElementById('ap');
let D = null;

const sp = new URLSearchParams(location.search);
if (sp.get('ig')) {
  toast(sp.get('msg') || 'Pronto.', sp.get('ig') !== 'ok');
  history.replaceState(null, '', `/aprovar?t=${encodeURIComponent(token)}`);
}
load();

async function load() {
  try { D = await api(`/api/approval?t=${encodeURIComponent(token)}`); render(); }
  catch (e) {
    root.replaceChildren(h('div', { class: 'state' }, h('h1', { style: 'font-size:22px' }, 'Link indisponível'), h('p', { class: 'muted' }, e.message)));
  }
}

const when = (iso) => `${fmtDate(iso, D.timezone)} às ${fmtTime(iso, D.timezone)}`;

function render() {
  const open = D.posts.filter((p) => p.status === 'pending_approval');
  const decided = D.posts.filter((p) => ['approved', 'changes_requested'].includes(p.status));
  const out = D.posts.filter((p) => ['publishing', 'published'].includes(p.status));
  const handle = D.client.ig_username ? `@${D.client.ig_username}` : D.client.name;

  root.replaceChildren(...[
    h('header', { class: 'ap-head' },
      h('div', { class: 'eyebrow' }, `Aprovação · ${D.client.name}`),
      h('h1', {}, open.length ? 'Posts para você aprovar' : 'Tudo em dia'),
      h('p', {}, open.length
        ? 'Veja cada post como vai aparecer no Instagram. Aprovado, ele publica sozinho no horário marcado.'
        : 'Não há posts aguardando sua decisão. Quando a agência enviar novos, eles aparecem neste mesmo link.'),
      open.length ? h('div', { class: 'count' }, h('span', { class: 'pill st-pending_approval' }, `${open.length} aguardando sua decisão`)) : null),
    D.client.ig_connected ? null : h('div', { class: 'card', style: 'gap:10px' },
      h('b', {}, 'Conecte seu Instagram'),
      h('span', { class: 'muted' }, 'Para os posts aprovados saírem sozinhos no seu perfil, autorize a publicação uma vez. Você entra direto no Instagram; a agência não vê sua senha.'),
      h('a', { class: 'btn primary', href: `/api/ig/connect?t=${encodeURIComponent(token)}` }, 'Conectar Instagram')),
    ...open.map((p) => card(p, handle)),
    decided.length ? h('div', { class: 'eyebrow section-title' }, 'Já decididos (ainda dá para mudar)') : null,
    ...decided.map((p) => card(p, handle)),
    out.length ? h('div', { class: 'eyebrow section-title' }, 'Publicados') : null,
    ...out.map((p) => card(p, handle)),
    h('footer', { class: 'eyebrow', style: 'text-align:center;margin-top:12px' }, 'Gestão de conteúdo · MC DIGITAL'),
  ].filter(Boolean));
}

function card(p, handle) {
  const capEl = h('div', { class: 'cap clamp' }, h('b', {}, `${handle.replace('@', '')} `), p.caption || '');
  const more = (p.caption || '').length > 160 ? h('button', { class: 'more', type: 'button', onclick: () => { capEl.classList.remove('clamp'); more.remove(); } }, 'ver legenda completa') : null;
  return h('article', { class: 'post', id: `p-${p.id}` },
    h('div', { class: 'ig' }, h('span', { class: 'av' }, (handle.replace('@', '')[0] || 'P')), h('span', {}, handle)),
    h('img', { src: p.image_url, alt: p.alt_text || 'Imagem do post', loading: 'lazy' }),
    capEl, more,
    h('div', { class: 'when eyebrow' }, p.status === 'published' ? 'Publicado' : `Publica ${when(p.scheduled_at)}`),
    decision(p));
}

function decision(p) {
  if (p.status === 'published' || p.status === 'publishing') {
    return h('div', { class: 'decide' }, p.ig_permalink ? h('a', { href: p.ig_permalink, target: '_blank', rel: 'noopener' }, 'Ver no Instagram ↗') : h('span', { class: 'muted' }, p.status === 'publishing' ? 'Publicando agora…' : 'No ar.'));
  }
  if (p.status === 'approved' || p.status === 'changes_requested') {
    const ok = p.status === 'approved';
    return h('div', { class: 'decide' },
      h('div', { class: 'done' },
        h('b', { class: ok ? 'ok-txt' : 'ch-txt' }, ok ? '✓ Aprovado' : '✎ Ajuste pedido'),
        h('span', { class: 'muted' }, ok ? `Vai ao ar sozinho ${when(p.scheduled_at)}.` : 'A agência vai ajustar e te mandar de novo.'),
        p.client_feedback ? h('span', {}, `Seu comentário: “${p.client_feedback}”`) : null),
      h('button', { class: 'linkish', type: 'button', onclick: (e) => e.target.closest('.decide').replaceWith(form(p, true)) }, 'Mudar minha decisão'));
  }
  return form(p);
}

function form(p, changing = false) {
  const ta = h('textarea', { id: `fb-${p.id}`, placeholder: 'Ex.: trocar a frase, mudar a cor, outro horário…', style: 'min-height:90px' });
  const fbBox = h('div', { class: 'field', hidden: true }, h('label', { for: `fb-${p.id}` }, 'O que você quer mudar?'), ta,
    h('button', { class: 'btn primary', type: 'button', onclick: () => decide(p, 'changes', ta.value, box) }, 'Enviar pedido de ajuste'));
  const box = h('div', { class: 'decide' },
    changing ? h('span', { class: 'muted' }, 'Escolha de novo:') : null,
    h('div', { class: 'btns' },
      h('button', { class: 'btn primary', type: 'button', onclick: () => decide(p, 'approve', '', box) }, 'Aprovar'),
      h('button', { class: 'btn', type: 'button', onclick: () => { fbBox.hidden = false; ta.focus(); } }, 'Pedir ajuste')),
    fbBox);
  return box;
}

async function decide(p, decision, feedback, box) {
  if (decision === 'changes' && !feedback.trim()) return toast('Escreva o que você quer mudar.', true);
  box.querySelectorAll('button').forEach((b) => (b.disabled = true));
  try {
    const r = await api('/api/approval', { method: 'POST', body: { t: token, post_id: p.id, decision, feedback } });
    Object.assign(p, r);
    toast(decision === 'approve' ? 'Aprovado! Ele publica sozinho no horário.' : 'Pedido de ajuste enviado para a agência.');
    render();
    // leva para o próximo post pendente
    const next = D.posts.find((x) => x.status === 'pending_approval');
    if (next) document.getElementById(`p-${next.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (e) {
    toast(e.message, true);
    box.querySelectorAll('button').forEach((b) => (b.disabled = false));
    if (e.status === 409) load();
  }
}
