// MC DIGITAL — Capa de Reels: uma tela só, em 3 toques (foto → texto → modelo), com prévia ao vivo.
//  • foto: escolher uma imagem, puxar um quadro do próprio vídeo ou tocar numa foto do banco do cliente;
//    enquadrar (subir/descer) e escurecer o fundo para o texto ler bem
//  • texto: prévia muda enquanto digita; tocar numa palavra liga/desliga o destaque; IA opcional dá 3 ideias
//  • modelos: miniaturas da própria capa (com a sua foto e o seu texto) para tocar e escolher
//  • prévia como no Reels (9:16) e como fica na grade do perfil (4:5); baixar ou compartilhar
//  • cliente cadastrado (cores, fontes e fotos dele) ou "de fora" (3 cores + fonte, lembrados no aparelho)
//  • "mesmo estilo da última capa" deste cliente, para a grade do perfil ficar com cara de série
import { h, api, toast } from '/shared.js';
import { S, can, render, savedPref, savePref } from './core.js';
import { renderPiece, loadPhotos, STYLES } from './artes.js';
import { MODELOS } from './modelos.js';

const FONTS = ['Playfair Display', 'Cormorant Garamond', 'DM Serif Display', 'Montserrat', 'Poppins', 'Inter', 'Lato', 'Anton'];
const SERIF = ['Playfair Display', 'Cormorant Garamond', 'DM Serif Display'];
const readJSON = (k, d) => { try { return JSON.parse(savedPref(k, '')) || d; } catch { return d; } };

const cs = () => (S.capa ||= {
  client: '', ext: readJSON('mc_capa_ext', { name: '', handle: '', colors: ['#1D1A1A', '#F3EFEA', '#7B1F31'], font: 'Playfair Display' }),
  text: '', em: [], sub: '', kicker: '', style: 'editorial', photo: null, src: null, focus: 0.3, dim: 0.15,
  bank: null, bankFor: null, preview: null, thumbs: {}, ideas: [], busy: false,
});

function clientOf(c) {
  if (c.client !== 'fora') return S.clients.find((x) => x.id === c.client) || null;
  const e = c.ext;
  return { id: 'fora', name: e.name || 'Cliente', ig_username: (e.handle || '').replace(/^@/, '') || null,
    brand_kit: { colors: e.colors, fonts: `Títulos: ${e.font}. Corpo: ${SERIF.includes(e.font) || e.font === 'Anton' ? 'Montserrat' : e.font}` } };
}

// ───────────────────────── foto: recorta em 9:16 na altura escolhida e escurece (vira a "foto pronta" da capa)
async function prepared(c) {
  if (!c.src) return null;
  const img = c.src, W = 1080, H = 1920;
  const r = Math.max(W / img.width, H / img.height);
  const iw = img.width * r, ih = img.height * r;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const x = cv.getContext('2d');
  x.drawImage(img, (W - iw) / 2, (H - ih) * c.focus, iw, ih);
  if (c.dim) { x.fillStyle = `rgba(0,0,0,${c.dim})`; x.fillRect(0, 0, W, H); }
  const out = new Image(); out.src = cv.toDataURL('image/jpeg', 0.9); await out.decode();
  return out;
}

let timer = null, thumbTimer = null, seq = 0;
function schedule(full = true) {
  clearTimeout(timer); timer = setTimeout(() => draw(), 180);
  if (full) { clearTimeout(thumbTimer); thumbTimer = setTimeout(() => drawThumbs(), 700); }
}
// o texto fica limpo no campo; as palavras destacadas ficam em c.em e viram *palavra* só para o desenho
const marked = (c) => joinWords(String(c.text || '').split(/\s+/).filter(Boolean).map((w) => ({ w, em: c.em.includes(w.toLowerCase()) })));
const piece = (c) => ({ format: 'COVER', headline: marked(c) || 'Escreva o texto da capa', support: c.sub, hooks: [marked(c)] });

async function draw() {
  const c = cs(); const client = clientOf(c); if (!client) return;
  const my = ++seq;
  const photo = await prepared(c);
  const { arts } = await renderPiece({ piece: piece(c), hook: marked(c), client, style: c.style, photos: photo ? [photo] : [], eyebrow: c.kicker });
  if (my !== seq) return URL.revokeObjectURL(arts[0].url);
  if (c.preview) URL.revokeObjectURL(c.preview.url);
  c.preview = arts[0];
  document.querySelectorAll('[data-capa-prev]').forEach((el) => { el.src = c.preview.url; });
}
async function drawThumbs() {
  const c = cs(); const client = clientOf(c); if (!client) return;
  const my = seq;
  const photo = await prepared(c);
  for (const m of MODELOS) {
    if (seq - my > 3) return; // o texto mudou bastante: a próxima rodada redesenha
    const { arts } = await renderPiece({ piece: piece(c), hook: marked(c), client, style: m.key, photos: photo ? [photo] : [], eyebrow: c.kicker });
    if (c.thumbs[m.key]) URL.revokeObjectURL(c.thumbs[m.key]);
    c.thumbs[m.key] = arts[0].url;
    const el = document.querySelector(`[data-capa-thumb="${m.key}"]`); if (el) el.src = arts[0].url;
  }
}

async function setSource(img, label) {
  const c = cs(); c.src = img; c.srcLabel = label; c.focus = 0.3; render(); schedule();
}
async function bankPhotos(c) {
  if (c.client === 'fora' || !c.client) return [];
  if (c.bankFor === c.client && c.bank) return c.bank;
  const [bank, posts] = await Promise.all([
    api(`/api/pasta?r=media&client=${c.client}`).catch(() => []),
    api(`/api/posts?client=${c.client}&status=published,approved,pending_approval`).catch(() => []),
  ]);
  const urls = [...new Set([...bank.map((b) => b.url), ...posts.flatMap((x) => [x.image_url, ...(x.media || []).filter((m) => m.kind !== 'video').map((m) => m.url)])].filter(Boolean))];
  c.bank = await loadPhotos(urls, 12); c.bankFor = c.client;
  return c.bank;
}

// quadro do vídeo: o vídeo abre ali mesmo, a barrinha escolhe o momento
function videoPicker(file) {
  const url = URL.createObjectURL(file);
  const v = h('video', { src: url, muted: true, playsinline: true, preload: 'auto', class: 'capa-video' });
  const range = h('input', { type: 'range', min: 0, max: 1000, value: 0, 'aria-label': 'Momento do vídeo', oninput: () => { if (v.duration) v.currentTime = (range.value / 1000) * v.duration; } });
  const use = h('button', { class: 'btn primary', type: 'button', onclick: async () => {
    const cv = document.createElement('canvas'); cv.width = v.videoWidth; cv.height = v.videoHeight;
    cv.getContext('2d').drawImage(v, 0, 0);
    const img = new Image(); img.src = cv.toDataURL('image/jpeg', 0.92); await img.decode();
    box.remove(); URL.revokeObjectURL(url);
    setSource(img, `quadro de ${file.name}`);
  } }, 'Usar este quadro');
  const box = h('div', { class: 'capa-videobox' }, v, range, h('div', { class: 'actions' }, h('button', { class: 'btn ghost', type: 'button', onclick: () => { box.remove(); URL.revokeObjectURL(url); } }, 'Cancelar'), use));
  v.addEventListener('loadedmetadata', () => { v.currentTime = Math.min(0.5, v.duration / 2); });
  document.querySelector('.capa-photo-tools')?.after(box);
}

// texto: cada palavra vira um botão; tocar liga/desliga o destaque (*palavra*)
function wordsOf(text) {
  const out = []; let em = false;
  for (const part of String(text).split('*')) { for (const w of part.split(/\s+/).filter(Boolean)) out.push({ w, em }); em = !em; }
  return out;
}
function joinWords(ws) {
  let s = '';
  ws.forEach((t, i) => {
    const prevEm = i > 0 && ws[i - 1].em;
    if (t.em && !prevEm) s += `${i ? ' ' : ''}*${t.w}`;
    else s += `${i ? ' ' : ''}${t.w}`;
    if (t.em && !(ws[i + 1]?.em)) s += '*';
  });
  return s;
}

async function ideas() {
  const c = cs(); const client = clientOf(c);
  if (!can('ia')) return toast('Sem permissão para usar a IA.', true);
  if ((c.text || '').trim().length < 3) return toast('Escreva o tema do vídeo no campo do texto e toque de novo.', true);
  c.busy = true; render();
  try {
    const body = c.client === 'fora'
      ? { client_id: 'avulso', client: { name: client.name, ig_username: client.ig_username }, format: 'COVER', topic: c.text }
      : { client_id: c.client, format: 'COVER', topic: c.text };
    const r = await api('/api/pasta?r=studio', { method: 'POST', body });
    c.ideas = [...new Set([r.piece.headline, ...r.piece.hooks].filter(Boolean))].slice(0, 4);
  } catch (e) { toast(e.message, true); }
  c.busy = false; render();
}

function lastStyleKey(c) { return `mc_capa_last_${c.client}`; }
function remember(c) { savePref(lastStyleKey(c), JSON.stringify({ style: c.style, dim: c.dim, kicker: c.kicker })); if (c.client === 'fora') savePref('mc_capa_ext', JSON.stringify(c.ext)); }

async function share(c) {
  if (!c.preview) return;
  remember(c);
  const file = new File([c.preview.blob], `capa-reels-${(clientOf(c)?.name || 'cliente').replace(/\s+/g, '-').toLowerCase()}.jpg`, { type: 'image/jpeg' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], text: 'Capa do Reels pronta ✅' }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  download(c); toast('Este aparelho não compartilha arquivo direto: baixei a capa. Mande pelo WhatsApp Web anexando o arquivo.');
}
function download(c) {
  if (!c.preview) return;
  remember(c);
  const a = h('a', { href: c.preview.url, download: `capa-reels-${(clientOf(c)?.name || 'cliente').replace(/\s+/g, '-').toLowerCase()}.jpg` });
  document.body.append(a); a.click(); a.remove();
}

// ───────────────────────── tela
function viewCapa() {
  const c = cs();
  if (!c.client) c.client = S.clients[0]?.id || 'fora';
  const client = clientOf(c);
  const sel = h('select', { 'aria-label': 'Cliente', onchange: (e) => { c.client = e.target.value; c.thumbs = {}; c.ideas = []; c.src = null; render(); loadClient(); } },
    ...S.clients.map((x) => h('option', { value: x.id, selected: x.id === c.client }, x.name)),
    h('option', { value: 'fora', selected: c.client === 'fora' }, '✦ Cliente de fora do app'));
  const ext = c.client === 'fora' ? h('div', { class: 'studio-avulso' },
    h('div', { class: 'studio-2col' },
      h('input', { value: c.ext.name, placeholder: 'Nome', oninput: (e) => { c.ext.name = e.target.value; schedule(); } }),
      h('input', { value: c.ext.handle, placeholder: '@ (opcional)', oninput: (e) => { c.ext.handle = e.target.value; schedule(); } })),
    h('div', { class: 'studio-avulso-row' }, h('span', { class: 'label' }, 'Cores'),
      ...c.ext.colors.map((col, i) => h('input', { type: 'color', value: col, title: ['Escura', 'Clara', 'Destaque'][i], oninput: (e) => { c.ext.colors[i] = e.target.value; schedule(); } })),
      h('select', { 'aria-label': 'Fonte', onchange: (e) => { c.ext.font = e.target.value; schedule(); } }, ...FONTS.map((f) => h('option', { value: f, selected: f === c.ext.font }, f))))) : null;

  const last = readJSON(lastStyleKey(c), null);
  const lastBtn = last && last.style !== c.style ? h('button', { class: 'btn ghost sm', type: 'button', onclick: () => { Object.assign(c, { style: last.style, dim: last.dim ?? c.dim, kicker: last.kicker ?? c.kicker }); render(); schedule(); } }, `↺ Mesmo estilo da última capa (${STYLES[last.style]?.[0] || last.style})`) : null;

  // 1 · foto
  const imgIn = h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: async (e) => { const f = e.target.files?.[0]; if (!f) return; const img = new Image(); img.src = URL.createObjectURL(f); await img.decode().catch(() => null); if (img.width) setSource(img, f.name); } });
  const vidIn = h('input', { type: 'file', accept: 'video/*', hidden: true, onchange: (e) => { const f = e.target.files?.[0]; if (f) videoPicker(f); } });
  const bankRow = c.bankFor === c.client && c.bank?.length ? h('div', { class: 'capa-bank' }, ...c.bank.map((img) => h('button', { type: 'button', class: `capa-bank-it${c.src === img ? ' on' : ''}`, onclick: () => setSource(img, 'banco de mídia'), 'aria-label': 'Usar esta foto' }, h('img', { src: img.src, alt: '' })))) : null;
  const photoCard = h('section', { class: 'card capa-step' },
    h('div', { class: 'capa-step-h' }, h('b', {}, '1'), h('h3', {}, 'Foto')),
    h('div', { class: 'capa-photo-tools' },
      h('button', { class: 'btn', type: 'button', onclick: () => imgIn.click() }, '🖼 Escolher foto'),
      h('button', { class: 'btn', type: 'button', onclick: () => vidIn.click() }, '🎞 Quadro do vídeo'), imgIn, vidIn),
    bankRow,
    c.src ? h('div', { class: 'capa-adjust' },
      h('label', {}, 'Enquadrar', h('input', { type: 'range', min: 0, max: 100, value: Math.round(c.focus * 100), oninput: (e) => { c.focus = e.target.value / 100; schedule(false); }, onchange: () => schedule() })),
      h('label', {}, 'Escurecer', h('input', { type: 'range', min: 0, max: 70, value: Math.round(c.dim * 100), oninput: (e) => { c.dim = e.target.value / 100; schedule(false); }, onchange: () => schedule() }))) : h('p', { class: 'muted', style: 'margin:0;font-size:13px' }, 'Dica: "Quadro do vídeo" abre o próprio Reels para você escolher o melhor momento.'));

  // 2 · texto
  const words = String(c.text || '').split(/\s+/).filter(Boolean).map((w) => ({ w, em: c.em.includes(w.toLowerCase()) }));
  const textCard = h('section', { class: 'card capa-step' },
    h('div', { class: 'capa-step-h' }, h('b', {}, '2'), h('h3', {}, 'Texto'),
      h('button', { class: 'btn ghost sm', type: 'button', disabled: c.busy, onclick: ideas, style: 'margin-left:auto' }, c.busy ? 'Pensando…' : '💡 Me dá 3 ideias')),
    h('input', { class: 'capa-text', value: c.text, placeholder: 'Ex.: Banho e tosa em 30 minutos', oninput: (e) => { c.text = e.target.value; schedule(); }, onchange: () => render() }),
    c.ideas.length ? h('div', { class: 'capa-ideas' }, ...c.ideas.map((t) => h('button', { type: 'button', class: 'capa-idea', onclick: () => { c.em = wordsOf(t).filter((x) => x.em).map((x) => x.w.toLowerCase()); c.text = t.replace(/\*/g, ''); c.ideas = []; render(); schedule(); } }, t.replace(/\*/g, '')))) : null,
    words.length ? h('div', { class: 'capa-words' }, h('span', { class: 'muted' }, 'Toque para destacar:'),
      ...words.map((t, i) => h('button', { type: 'button', class: `capa-word${t.em ? ' on' : ''}`, onclick: () => { const k = t.w.toLowerCase(); c.em = c.em.includes(k) ? c.em.filter((x) => x !== k) : [...c.em, k]; render(); schedule(); } }, t.w))) : null,
    h('div', { class: 'studio-2col' },
      h('input', { value: c.kicker, placeholder: 'Chamada pequena (opcional)', oninput: (e) => { c.kicker = e.target.value; schedule(); } }),
      h('input', { value: c.sub, placeholder: 'Apoio (opcional)', oninput: (e) => { c.sub = e.target.value; schedule(); } })));

  // 3 · modelo
  const modelCard = h('section', { class: 'card capa-step' },
    h('div', { class: 'capa-step-h' }, h('b', {}, '3'), h('h3', {}, 'Modelo'), lastBtn),
    h('div', { class: 'capa-thumbs' }, ...MODELOS.map((m) => h('button', { type: 'button', class: `capa-thumb${c.style === m.key ? ' on' : ''}`, onclick: () => { c.style = m.key; render(); schedule(false); } },
      h('img', { 'data-capa-thumb': m.key, src: c.thumbs[m.key] || '', alt: '' }), h('span', {}, m.nome)))));

  // prévia
  const prev = h('aside', { class: 'capa-preview' },
    h('div', { class: 'capa-phones' },
      h('figure', {}, h('div', { class: 'capa-phone' }, h('img', { 'data-capa-prev': '', src: c.preview?.url || '', alt: 'Prévia da capa no Reels' })), h('figcaption', {}, 'No Reels')),
      h('figure', {}, h('div', { class: 'capa-grid' }, h('img', { 'data-capa-prev': '', src: c.preview?.url || '', alt: 'Prévia na grade do perfil' })), h('figcaption', {}, 'Na grade do perfil'))),
    h('div', { class: 'capa-actions' },
      h('button', { class: 'btn primary', type: 'button', onclick: () => download(c) }, '⬇ Baixar capa'),
      h('button', { class: 'btn', type: 'button', onclick: () => share(c) }, '📲 Mandar para o cliente')),
    !c.src ? h('p', { class: 'muted', style: 'margin:0;font-size:12.5px' }, 'Sem foto, a capa sai só com tipografia nas cores da marca.') : null);

  setTimeout(() => { if (!c.preview || !document.querySelector('[data-capa-prev]')?.getAttribute('src')) schedule(); else if (!Object.keys(c.thumbs).length) schedule(); }, 0);
  return h('div', { class: 'capa' },
    h('div', { class: 'capa-left' },
      h('section', { class: 'card capa-who' }, h('span', { class: 'label' }, 'Cliente'), sel, ext),
      photoCard, textCard, modelCard),
    prev);
}

async function loadClient() {
  const c = cs();
  const last = readJSON(lastStyleKey(c), null);
  if (last) Object.assign(c, { style: last.style, dim: last.dim ?? c.dim, kicker: last.kicker ?? '' });
  const photos = await bankPhotos(c);
  if (!c.src && photos.length) { c.src = photos[0]; c.srcLabel = 'banco de mídia'; }
  render(); schedule();
}
let booted = false;
function capaBoot() { if (booted) return; booted = true; loadClient(); }

export { viewCapa, capaBoot };
