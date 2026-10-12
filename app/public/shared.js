// Funções compartilhadas pelo painel e pela página de aprovação.

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

export async function api(path, { method = 'GET', body, raw } = {}) {
  const init = { method, headers: {}, credentials: 'same-origin' };
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
