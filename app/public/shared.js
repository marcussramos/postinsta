// Funções compartilhadas pelo painel e pela página de aprovação.
// replaceChildren ignorando null/false (evita aparecer o texto "null" na tela)
if (!Element.prototype.__mcSafe) { const rc = Element.prototype.replaceChildren; Element.prototype.replaceChildren = function (...k) { return rc.apply(this, k.flat().filter((x) => x != null && x !== false)); }; Element.prototype.__mcSafe = true; }

export const STATUS_LABEL = {
  idea: 'Ideia',
  draft: 'Em produção',
  internal_review: 'Revisão interna',
  pending_approval: 'Aguardando cliente',
  approved: 'Aprovado',
  changes_requested: 'Ajuste pedido',
  publishing: 'Publicando',
  published: 'Publicado',
  failed: 'Falhou',
};

const PROPS = new Set(['value', 'checked', 'selected', 'disabled', 'hidden', 'required', 'readOnly']);

// h('button', { class: 'btn', onclick: fn }, 'Texto', outroElemento)
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (PROPS.has(k)) el[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export async function api(path, { method = 'GET', body, raw, headers = {} } = {}) {
  const init = { method, headers: { ...headers }, credentials: 'same-origin' };
  if (raw) { init.body = raw; init.headers['Content-Type'] = 'application/octet-stream'; }
  else if (body !== undefined) { init.body = JSON.stringify(body); init.headers['Content-Type'] = 'application/json'; }
  let res;
  try { res = await fetch(path, init); }
  catch { throw Object.assign(new Error('Sem conexão. Confira a internet e tente de novo.'), { status: 0 }); }
  const text = await res.text();
  let data = null; try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!res.ok) throw Object.assign(new Error(data?.error || `Erro ${res.status}.`), { status: res.status });
  return data;
}

let toastTimer;
export function toast(msg, isError = false) {
  document.querySelector('.toast')?.remove();
  const t = h('div', { class: `toast${isError ? ' err' : ''}`, role: isError ? 'alert' : 'status' }, msg);
  document.body.append(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.remove(), isError ? 6000 : 3500);
}

// ── datas no fuso da agência
function tzParts(ts, tz) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const o = {}; for (const p of f.formatToParts(ts)) o[p.type] = p.value;
  return o;
}
function tzOffset(ts, tz) {
  const o = tzParts(ts, tz);
  return Date.UTC(+o.year, +o.month - 1, +o.day, +o.hour % 24, +o.minute, +o.second) - Math.floor(ts / 1000) * 1000;
}
// "2026-10-13" + "19:00" no fuso tz → ISO em UTC
export function zonedToISO(date, time, tz) {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  let t = guess - tzOffset(guess, tz);
  const off2 = tzOffset(t, tz);
  if (guess - off2 !== t) t = guess - off2; // virada de horário de verão
  return new Date(t).toISOString();
}
export function partsInTz(iso, tz) {
  const o = tzParts(new Date(iso).getTime(), tz);
  return { date: `${o.year}-${o.month}-${o.day}`, time: `${o.hour}:${o.minute}` };
}
export const dayKey = (iso, tz) => partsInTz(iso, tz).date;

export function fmtTime(iso, tz) { return partsInTz(iso, tz).time.replace(':', 'h'); }

export function fmtDate(iso, tz, relative = false) {
  const label = new Intl.DateTimeFormat('pt-BR', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short' })
    .format(new Date(iso)).replace(/\./g, '').replace(/,/, '');
  if (!relative) return label;
  const k = dayKey(iso, tz);
  const today = dayKey(new Date().toISOString(), tz);
  const tomorrow = dayKey(new Date(Date.now() + 86400e3).toISOString(), tz);
  const yesterday = dayKey(new Date(Date.now() - 86400e3).toISOString(), tz);
  const rel = k === today ? 'Hoje' : k === tomorrow ? 'Amanhã' : k === yesterday ? 'Ontem' : null;
  return rel ? `${rel} · ${label}` : label.charAt(0).toUpperCase() + label.slice(1);
}

// ── imagem: deixa no padrão do Instagram (JPEG, proporção entre 4:5 e 1,91:1, até 1440 px)
export async function prepareImage(file) {
  if (!file.type.startsWith('image/')) throw new Error('Escolha um arquivo de imagem.');
  let src;
  try { src = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch {
    src = await new Promise((ok, bad) => {
      const i = new Image(); i.onload = () => ok(i);
      i.onerror = () => bad(new Error('Não consegui abrir essa imagem. Se for HEIC (iPhone), exporte como JPEG.'));
      i.src = URL.createObjectURL(file);
    });
  }
  const W = src.width, H = src.height;
  let sx = 0, sy = 0, sw = W, sh = H, note = '';
  const r = W / H;
  if (r < 0.8) { sh = Math.round(W / 0.8); sy = Math.round((H - sh) / 2); note = 'Cortada no centro para 4:5, a proporção mais alta que o feed aceita.'; }
  else if (r > 1.91) { sw = Math.round(H * 1.91); sx = Math.round((W - sw) / 2); note = 'Cortada no centro para 1,91:1, a proporção mais larga que o feed aceita.'; }
  const scale = Math.min(1, 1440 / sw);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(sw * scale); canvas.height = Math.round(sh * scale);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); // PNG transparente vira fundo branco
  ctx.drawImage(src, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  let q = 0.9, blob;
  do {
    blob = await new Promise((ok) => canvas.toBlob(ok, 'image/jpeg', q));
    q -= 0.1;
  } while (blob.size > 3.5 * 1024 * 1024 && q > 0.5);
  if (canvas.width < 320) note = (note ? note + ' ' : '') + 'Atenção: imagem pequena, pode ficar com baixa qualidade.';
  return { blob, url: URL.createObjectURL(blob), note };
}

export async function copyText(text, okMsg = 'Copiado.') {
  try { await navigator.clipboard.writeText(text); return toast(okMsg); }
  catch {
    const ta = h('textarea', { style: 'position:fixed;opacity:0' }, text);
    document.body.append(ta); ta.select();
    const ok = document.execCommand && document.execCommand('copy');
    ta.remove();
    toast(ok ? okMsg : 'Não deu para copiar automaticamente. Selecione e copie o texto.', !ok);
  }
}

export const waLink = (number, text) => `https://wa.me/${String(number || '').replace(/\D/g, '')}?text=${encodeURIComponent(text)}`;

export const mailLink = (to, subject, body) => `mailto:${encodeURIComponent(to || '')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

export function blobToDataUrl(blob) {
  return new Promise((ok, bad) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = bad; r.readAsDataURL(blob); });
}

// ── dinheiro e meses
export const brl = (cents) => (cents == null ? '—' : (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
export function monthLabel(ym, short = false) { // '2026-10' → 'outubro de 2026' / 'out/26'
  const [y, m] = ym.split('-').map(Number);
  if (short) return `${MESES[m - 1].slice(0, 3)}/${String(y).slice(2)}`;
  const t = `${MESES[m - 1]} de ${y}`;
  return t.charAt(0).toUpperCase() + t.slice(1);
}
export function fileSize(n) { return n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1048576).toFixed(1).replace('.', ',')} MB`; }

// ── vídeo (Reels): lê duração/tamanho, tira um quadro para a capa e envia direto ao armazenamento
export function videoInfo(file) {
  return new Promise((ok, bad) => {
    if (!/^video\//.test(file.type) && !/\.(mp4|mov|m4v)$/i.test(file.name)) return bad(new Error('Escolha um vídeo MP4 ou MOV.'));
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    v.preload = 'metadata'; v.muted = true; v.playsInline = true;
    v.onloadedmetadata = () => ok({ url, duration: v.duration, width: v.videoWidth, height: v.videoHeight });
    v.onerror = () => bad(new Error('Não consegui abrir esse vídeo. Use MP4 (H.264) ou MOV.'));
    v.src = url;
  });
}

// Capa do Reels: quadro do vídeo no segundo t, em JPEG (até 1080 px de largura, sem cortar).
export function videoFrame(url, t = 0) {
  return new Promise((ok, bad) => {
    const v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.preload = 'auto'; v.crossOrigin = 'anonymous';
    v.onloadeddata = () => { v.currentTime = Math.min(Math.max(0, t), Math.max(0, v.duration - 0.1)); };
    v.onseeked = async () => {
      const scale = Math.min(1, 1080 / v.videoWidth);
      const c = document.createElement('canvas');
      c.width = Math.round(v.videoWidth * scale); c.height = Math.round(v.videoHeight * scale);
      c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
      let q = 0.9, blob;
      do { blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', q)); q -= 0.1; } while (blob && blob.size > 3.5 * 1024 * 1024 && q > 0.5);
      if (!blob) return bad(new Error('Não consegui gerar a capa.'));
      ok({ blob, url: URL.createObjectURL(blob) });
    };
    v.onerror = () => bad(new Error('Não consegui ler o vídeo para a capa.'));
    v.src = url;
  });
}

// Vídeos acima do limite do armazenamento (50 MB) são comprimidos no próprio navegador antes de subir:
// 1080 de largura, H.264, taxa calculada para caber. O áudio é copiado sem perda quando possível.
export const VIDEO_MAX = 50 * 1024 * 1024;
const VIDEO_TARGET = 46 * 1024 * 1024;
export async function compressVideo(file, onProgress = () => {}) {
  if (typeof VideoEncoder === 'undefined') throw new Error('Este navegador não consegue comprimir vídeo. Use o Chrome ou Safari atualizado, ou exporte o vídeo menor (até 50 MB).');
  const mb = await import('https://cdn.jsdelivr.net/npm/mediabunny@1.60.0/+esm');
  const input = new mb.Input({ source: new mb.BlobSource(file), formats: mb.ALL_FORMATS });
  const dur = await input.computeDuration();
  const vt = await input.getPrimaryVideoTrack();
  if (!vt) throw new Error('Não encontrei a imagem do vídeo neste arquivo.');
  const at = await input.getPrimaryAudioTrack();
  const audioBits = at ? 192e3 : 0; // reserva para o áudio (copiado ou recodificado)
  const videoBitrate = Math.round(Math.max(1.2e6, Math.min(10e6, (VIDEO_TARGET * 8 * 0.93) / dur - audioBits)));
  const out = new mb.Output({ format: new mb.Mp4OutputFormat({ fastStart: 'in-memory' }), target: new mb.BufferTarget() });
  const width = Math.min(vt.displayWidth > vt.displayHeight ? 1920 : 1080, vt.displayWidth);
  const conv = await mb.Conversion.init({ input, output: out, video: { width: width - (width % 2), codec: 'avc', bitrate: videoBitrate } });
  if (at && conv.discardedTracks?.some((d) => d.track?.type === 'audio' || d.track?.isAudioTrack?.())) throw new Error('Este navegador não conseguiu manter o áudio do vídeo. Tente pelo Google Chrome ou exporte o vídeo menor (até 50 MB).');
  if (!conv.isValid) throw new Error('Não consegui comprimir este vídeo aqui. Exporte em 1080p (até 50 MB) e tente de novo.');
  conv.onProgress = (p) => onProgress(p);
  await conv.execute();
  const blob = new Blob([out.target.buffer], { type: 'video/mp4' });
  if (blob.size > VIDEO_MAX) throw new Error(`Mesmo comprimido o vídeo ficou com ${fileSize(blob.size)}. Corte um pouco ou exporte em 1080p e tente de novo.`);
  return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.mp4', { type: 'video/mp4' });
}

// Envia o vídeo direto ao Supabase com um link assinado (não passa pelo limite de 4,5 MB da Vercel).
export async function uploadVideo(file, clientId, onProgress = () => {}) {
  const ext = (file.name.split('.').pop() || 'mp4').toLowerCase();
  const sig = await api(`/api/upload?kind=video&ext=${encodeURIComponent(ext)}&client=${clientId}`, { method: 'POST' });
  await new Promise((ok, bad) => {
    const x = new XMLHttpRequest();
    x.open('PUT', sig.upload_url);
    x.setRequestHeader('Content-Type', file.type || 'video/mp4');
    x.setRequestHeader('x-upsert', 'false');
    x.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    x.onload = () => (x.status < 300 ? ok() : bad(new Error(x.status === 413 ? 'Vídeo grande demais para o armazenamento (máx. 50 MB).' : `Falha ao enviar o vídeo (${x.status}).`)));
    x.onerror = () => bad(new Error('Sem conexão ao enviar o vídeo.'));
    x.send(file);
  });
  return { url: sig.url, path: sig.path, kind: 'video' };
}

export const MEDIA_LABEL = { IMAGE: 'Foto', CAROUSEL: 'Carrossel', REELS: 'Reels', STORY: 'Story' };
