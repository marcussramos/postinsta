// MC DIGITAL — editor de post, roteiro de vídeo, avisos ao cliente e prévia do feed.
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
import { monthOf } from './calendario.js';
const CAR_MAX = 20; // limite do Instagram para carrossel (fotos e vídeos)
import { S, can, clientById, clientName, confirmButton, drawer, render } from './core.js';
import { fmtDay, openBankPicker, snippetBar, todayLocal, uploadDoc } from './pasta.js';

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
  // itens do carrossel: { kind: 'image'|'video', url, path, blob?, file?, duration?, poster? } — vídeo usa a 1ª imagem do vídeo como miniatura/capa
  let items = mtype === 'CAROUSEL' ? (post.media || []).map((m, i) => ({ kind: m.kind === 'video' ? 'video' : 'image', url: m.url, path: m.path,
    poster: m.kind === 'video' && i === 0 && post.image_url ? { url: post.image_url, path: post.image_path } : null })) : [];
  let video = ['REELS', 'STORY'].includes(mtype) ? ((post.media || []).find((m) => m.kind === 'video') || null) : null; // { url, path } ou { file, url, duration }
  let coverT = 1;
  const carCover = () => (items[0]?.kind === 'video' ? items[0].poster : items[0]) || null; // imagem que representa o carrossel
  const fileIn = h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: () => fileIn.files[0] && takeFile(fileIn.files[0]) });
  const multiIn = h('input', { type: 'file', accept: 'image/*,video/mp4,video/quicktime,.mp4,.mov,.m4v', multiple: true, hidden: true, onchange: () => addItems([...multiIn.files]) });
  const videoIn = h('input', { type: 'file', accept: 'video/mp4,video/quicktime,.mp4,.mov,.m4v', hidden: true, onchange: () => videoIn.files[0] && takeVideo(videoIn.files[0]) });
  const imgBox = h('div', { class: 'media-box' });
  const typeSeg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Formato do post' });
  const drawSeg = () => typeSeg.replaceChildren(...Object.entries(MEDIA_LABEL).map(([k, l]) => h('button', {
    type: 'button', class: 'seg-btn', 'aria-pressed': String(mtype === k), disabled: locked,
    onclick: () => { if (mtype === k) return; if (['REELS', 'STORY'].includes(mtype) || k === 'STORY') { img = null; video = null; } mtype = k; mediaDirty = true; syncCaption(); if (k === 'CAROUSEL' && img && !items.length) items = [{ kind: 'image', ...img }]; if (k === 'IMAGE' && carCover() && !img) img = { ...carCover() }; drawSeg(); drawImage(); drawScriptBox?.(); },
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
    const tiles = items.map((it, i) => h('div', { class: `car-item${it.kind === 'video' ? ' is-video' : ''}` },
      it.kind === 'video'
        ? h('video', { src: it.url, poster: it.poster?.url || null, muted: true, playsinline: true, preload: 'metadata', 'aria-label': `Vídeo ${i + 1}`, onmouseenter: (e) => e.target.play().catch(() => {}), onmouseleave: (e) => { e.target.pause(); } })
        : h('img', { src: it.url, alt: `Imagem ${i + 1}` }),
      h('span', { class: 'car-n' }, String(i + 1)),
      it.kind === 'video' ? h('span', { class: 'car-vid' }, `▶ ${it.duration ? `${Math.round(it.duration)} s` : 'vídeo'}`) : null,
      locked ? null : h('div', { class: 'car-act' },
        h('button', { type: 'button', title: 'Mover para a esquerda', disabled: i === 0, onclick: () => move(i, -1) }, '←'),
        h('button', { type: 'button', title: 'Remover', onclick: () => { items.splice(i, 1); mediaDirty = true; drawImage(); } }, '✕'),
        h('button', { type: 'button', title: 'Mover para a direita', disabled: i === items.length - 1, onclick: () => move(i, 1) }, '→'))));
    const add = items.length < CAR_MAX && !locked ? h('button', { type: 'button', class: 'car-add', onclick: () => multiIn.click() }, h('b', {}, '+'), h('span', {}, items.length ? 'Adicionar' : 'Escolher fotos ou vídeos')) : null;
    const box = h('div', { class: 'car-grid' }, ...tiles, add);
    box.addEventListener('dragover', (e) => e.preventDefault());
    box.addEventListener('drop', (e) => { e.preventDefault(); if (e.dataTransfer.files.length) addItems([...e.dataTransfer.files]); });
    imgBox.replaceChildren(box, h('span', { class: 'hint muted' }, `${items.length}/${CAR_MAX} itens · fotos e vídeos (MP4/MOV de 3 a 60 s) · o 1º é a capa · o Instagram usa a proporção do 1º em todos (use o mesmo formato, de preferência 4:5).`), multiIn);
  };
  const addItems = async (files) => {
    if (files.length > CAR_MAX - items.length) toast(`O carrossel aceita até ${CAR_MAX} itens: entraram só ${Math.max(0, CAR_MAX - items.length)}.`, true);
    for (const f0 of files.slice(0, CAR_MAX - items.length)) {
      try {
        if ((f0.type || '').startsWith('video/') || /\.(mp4|mov|m4v)$/i.test(f0.name || '')) {
          let f = f0, info = await videoInfo(f);
          if (info.duration < 3) throw new Error(`"${f.name}": vídeo de carrossel precisa ter pelo menos 3 segundos.`);
          if (info.duration > 60.5) throw new Error(`"${f.name}": vídeo de carrossel pode ter no máximo 60 segundos (para vídeos maiores, use Reels).`);
          if (f.size > VIDEO_MAX) { URL.revokeObjectURL(info.url); f = await shrink(f); info = await videoInfo(f); }
          const poster = await videoFrame(info.url, Math.min(1, info.duration / 2));
          items.push({ kind: 'video', file: f, url: info.url, duration: info.duration, poster });
        } else items.push({ kind: 'image', ...(await prepareImage(f0)) });
        mediaDirty = true;
      } catch (e) { toast(e.message, true); }
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
    if (mtype === 'CAROUSEL') { if (items.length >= CAR_MAX) return toast(`O carrossel já tem ${CAR_MAX} itens.`, true); items.push({ kind: 'image', ...it }); }
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
      h('button', { type: 'button', class: 'btn ghost sm', style: 'justify-self:start', onclick: () => openFeedPreview([...picked][0], { image_url: (mtype === 'CAROUSEL' ? carCover()?.url : img?.url) || null, scheduled_at: collect().scheduled_at, id: post?.id || 'novo', media_type: mtype }) }, '▦ Ver no feed do cliente'),
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
    const up = await uploadDoc({ id: p.client_id }, f, 'other');
    return api('/api/pasta?r=script', { method: 'PUT', body: { post_id: p.id, script: { file: { id: up.id } } } });
  }
  async function attachScript(f) {
    if (f.size > 50 * 1024 * 1024) return toast('Arquivo grande demais (máx. 50 MB). Exporte o PDF menor e tente de novo.', true);
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
        const aiImg = mtype === 'CAROUSEL' ? carCover() : img;
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
      image: mtype !== 'CAROUSEL' ? await sizeOf(img?.url) : null, items: mtype === 'CAROUSEL' ? (await Promise.all(items.map((it) => (it.kind === 'video' ? vidSize(it.url) : sizeOf(it.url))))).filter(Boolean) : null,
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
        const aiImg = mtype === 'CAROUSEL' ? carCover() : img;
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
    if (needsComplete && mtype === 'CAROUSEL' && items.length < 2) return toast('O carrossel precisa de pelo menos 2 itens (fotos ou vídeos).', true);
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
        for (const [i, it] of items.entries()) {
          if (it.kind === 'video' && it.file) { const v = await uploadVideo(it.file, cid, (pr) => toast(`Enviando vídeo ${i + 1} de ${items.length}… ${Math.round(pr * 100)}%`)); Object.assign(it, { url: v.url, path: v.path, file: null }); }
          else if (it.blob) { toast(`Enviando imagem ${i + 1} de ${items.length}…`); const r = await up(it.blob); Object.assign(it, { url: r.image_url, path: r.image_path, blob: null }); }
        }
        data.media = items.map((it) => ({ url: it.url, path: it.path, kind: it.kind === 'video' ? 'video' : 'image' }));
        const first = items[0];
        if (first?.kind === 'video') { // capa = um quadro do vídeo (miniaturas, aprovação e feed)
          if (first.poster?.blob) { const r = await up(first.poster.blob); first.poster = { url: r.image_url, path: r.image_path }; }
          if (first.poster?.url) Object.assign(data, { image_url: first.poster.url, image_path: first.poster.path ?? null });
        } else if (first) Object.assign(data, { image_url: first.url, image_path: first.path });
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
    if (['approved', 'failed', 'pending_approval', 'changes_requested'].includes(st)) foot.splice(2, 0, confirmButton('Já postei manualmente', 'Confirmar: já está no Instagram', () => action('mark_published', 'Marcado como publicado.'), 'btn ghost'));
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

export { openPost, scriptMessage, SCRIPT_PILL, wantsScript, scriptBadge, openScript, upsert, approvalMessage, approvalSubject, notifyBox, maybeNotify, openFeedPreview };
