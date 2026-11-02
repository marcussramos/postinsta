// MC DIGITAL — Gerador de artes do Estúdio: monta as lâminas (1080×1350) com as cores e fontes do cliente,
// direto no navegador (canvas), sem Canva. Sai em JPEG, pronto para anexar ao post ou baixar.
// Estilos: "claro" (fundo claro da marca), "escuro" (fundo escuro) e "foto" (capa com foto + lâminas claras).

const W = 1080, H = 1350, M = 96;

// ───────────────────────── marca: cores e fontes do kit do cliente
const FONT_MAP = [
  [/playfair|didot|bodoni/i, 'Playfair Display'], [/cormorant|cherston|garamond/i, 'Cormorant Garamond'], [/dm serif/i, 'DM Serif Display'],
  [/libre baskerville|baskerville/i, 'Libre Baskerville'], [/\blora\b/i, 'Lora'], [/montserrat/i, 'Montserrat'], [/poppins/i, 'Poppins'],
  [/\binter\b/i, 'Inter'], [/raleway/i, 'Raleway'], [/gill|humanist|\blato\b/i, 'Lato'], [/bebas/i, 'Bebas Neue'], [/oswald/i, 'Oswald'],
  [/great vibes/i, 'Great Vibes'], [/allura/i, 'Allura'], [/yellowtail/i, 'Yellowtail'], [/dm sans/i, 'DM Sans'], [/nunito/i, 'Nunito'],
];
const SCRIPTS = ['Great Vibes', 'Allura', 'Yellowtail']; // manuscritas não servem para títulos longos
const SERIFS = ['Playfair Display', 'Cormorant Garamond', 'DM Serif Display', 'Libre Baskerville', 'Lora'];

function findFont(text, skipScripts = true) {
  for (const [re, name] of FONT_MAP) if (re.test(text) && !(skipScripts && SCRIPTS.includes(name))) return name;
  return null;
}
export function brandFonts(raw) {
  const t = String(raw || '');
  const titlePart = (t.match(/t[íi]tulos?\s*:?([^·.\n]*)/i) || [])[1] || '';
  const bodyPart = (t.match(/(corpo|textos?|apoio)[^:]*:?([^·\n]*)/i) || [])[2] || '';
  const title = findFont(titlePart) || findFont(t) || 'Montserrat';
  const body = findFont(bodyPart) || (title !== 'Montserrat' && /montserrat/i.test(t) ? 'Montserrat' : null) || (SERIFS.includes(title) ? 'Montserrat' : title);
  return { title, body };
}

const hexRgb = (h) => { const x = String(h).replace('#', ''); const n = parseInt(x.length === 3 ? x.split('').map((c) => c + c).join('') : x, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const lum = (h) => { const [r, g, b] = hexRgb(h).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const sat = (h) => { const [r, g, b] = hexRgb(h); const mx = Math.max(r, g, b), mn = Math.min(r, g, b); return mx === 0 ? 0 : (mx - mn) / mx; };
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

export function brandColors(list) {
  const cs = (Array.isArray(list) ? list : []).filter((c) => /^#?[0-9a-f]{3,6}$/i.test(String(c).trim())).map((c) => `#${String(c).trim().replace('#', '')}`);
  if (cs.length < 2) return { light: '#ECEAE7', dark: '#1D1A1A', accent: '#7B1F31' }; // padrão MC DIGITAL
  const byLum = [...cs].sort((a, b) => lum(a) - lum(b));
  const dark = byLum[0];
  // fundo claro: o mais claro que não seja branco puro (fica mais elegante); se só houver branco, usa branco
  const light = byLum.slice().reverse().find((c) => lum(c) < 0.97 && lum(c) > 0.6) || byLum[byLum.length - 1];
  const mid = cs.filter((c) => c !== dark && c !== light);
  const accent = mid.sort((a, b) => sat(b) - sat(a))[0] || dark;
  return { light, dark, accent: contrast(accent, light) >= 3 ? accent : dark };
}

// ───────────────────────── fontes do Google carregadas sob demanda
const loaded = new Set();
async function loadFonts(names) {
  const todo = names.filter((n) => n && !loaded.has(n));
  if (todo.length) {
    const fam = todo.map((n) => `family=${n.replace(/ /g, '+')}:wght@300;400;500;600;700;800`).join('&');
    await new Promise((ok) => {
      const l = document.createElement('link');
      l.rel = 'stylesheet'; l.href = `https://fonts.googleapis.com/css2?${fam}&display=swap`;
      l.onload = ok; l.onerror = ok; document.head.append(l);
    });
    todo.forEach((n) => loaded.add(n));
  }
  await Promise.all(names.flatMap((n) => [`400 40px "${n}"`, `700 40px "${n}"`].map((f) => document.fonts.load(f).catch(() => null))));
}

// ───────────────────────── texto
function wrap(ctx, text, maxW) {
  const out = [];
  for (const para of String(text || '').split('\n')) {
    let line = '';
    for (const w of para.split(/\s+/).filter(Boolean)) {
      const test = line ? `${line} ${w}` : w;
      if (ctx.measureText(test).width > maxW && line) { out.push(line); line = w; } else line = test;
    }
    out.push(line);
  }
  return out.filter((l, i, a) => l || (i > 0 && i < a.length - 1));
}
// maior tamanho que cabe na caixa
function fit(ctx, text, fontAt, maxW, maxH, from, to, lh) {
  for (let s = from; s >= to; s -= 2) {
    ctx.font = fontAt(s);
    const lines = wrap(ctx, text, maxW);
    if (lines.length * s * lh <= maxH && lines.every((l) => ctx.measureText(l).width <= maxW)) return { size: s, lines };
  }
  ctx.font = fontAt(to);
  return { size: to, lines: wrap(ctx, text, maxW) };
}
function drawLines(ctx, lines, x, y, size, lh) { lines.forEach((l, i) => ctx.fillText(l, x, y + i * size * lh)); return y + lines.length * size * lh; }
function spaced(ctx, text, x, y, spacing) { // caixa alta com espaçamento (canvas antigo não tem letterSpacing)
  if ('letterSpacing' in ctx) { ctx.letterSpacing = `${spacing}px`; ctx.fillText(text, x, y); ctx.letterSpacing = '0px'; return; }
  let cx = x; for (const ch of text) { ctx.fillText(ch, cx, y); cx += ctx.measureText(ch).width + spacing; }
}

// ───────────────────────── lâminas
function theme(style, brand, kind) {
  const { light, dark, accent } = brand;
  if (kind === 'cta') return { bg: accent === dark ? dark : accent, ink: light, soft: light, line: light };
  if (style === 'escuro') return { bg: dark, ink: light, soft: light, line: contrast(accent, dark) >= 3 ? accent : light };
  return { bg: light, ink: dark, soft: dark, line: accent };
}

function frame(ctx, t, brand, fonts, handle, page, total) {
  ctx.fillStyle = t.bg; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = t.soft; ctx.globalAlpha = 0.7; ctx.textBaseline = 'alphabetic';
  ctx.font = `600 24px "${fonts.body}"`;
  if (handle) spaced(ctx, handle.toUpperCase(), M, H - 70, 4);
  if (total > 1) { const p = `${page}/${total}`; ctx.font = `600 24px "${fonts.body}"`; ctx.fillText(p, W - M - ctx.measureText(p).width, H - 70); }
  ctx.globalAlpha = 1;
}

const titleFont = (fonts) => (s) => `${SERIFS.includes(fonts.title) ? 600 : 800} ${s}px "${fonts.title}"`;
const bodyFont = (fonts) => (s) => `400 ${s}px "${fonts.body}"`;

function drawCover(ctx, { hook, sub, photo, style, brand, fonts, handle, total }) {
  const t = theme(style, brand, 'cover');
  frame(ctx, t, brand, fonts, handle, 1, total);
  const maxW = W - M * 2;
  if (photo) {
    const r = Math.max(W / photo.width, H / photo.height);
    const pw = photo.width * r, ph = photo.height * r;
    ctx.drawImage(photo, (W - pw) / 2, (H - ph) / 2, pw, ph);
    const g = ctx.createLinearGradient(0, H * 0.35, 0, H);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.82)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    const tf = fit(ctx, hook, titleFont(fonts), maxW, 420, 104, 56, 1.08);
    const subF = sub ? fit(ctx, sub, bodyFont(fonts), maxW, 120, 38, 28, 1.3) : null;
    let y = H - 150 - (subF ? subF.lines.length * subF.size * 1.3 + 24 : 0) - (tf.lines.length - 1) * tf.size * 1.08;
    ctx.fillStyle = '#FFFFFF'; ctx.font = titleFont(fonts)(tf.size);
    y = drawLines(ctx, tf.lines, M, y, tf.size, 1.08);
    if (subF) { ctx.font = bodyFont(fonts)(subF.size); ctx.globalAlpha = 0.9; drawLines(ctx, subF.lines, M, y + 8, subF.size, 1.3); ctx.globalAlpha = 1; }
    ctx.font = `600 24px "${fonts.body}"`; ctx.fillStyle = '#FFFFFF'; ctx.globalAlpha = 0.85;
    if (handle) spaced(ctx, handle.toUpperCase(), M, H - 70, 4);
    if (total > 1) spaced(ctx, 'ARRASTE →', W - M - 190, H - 70, 4);
    ctx.globalAlpha = 1;
    return;
  }
  // sem foto: título grande, linha de destaque e convite para arrastar
  ctx.fillStyle = t.line; ctx.fillRect(M, 210, 120, 8);
  const tf = fit(ctx, hook, titleFont(fonts), maxW, 640, 128, 60, 1.06);
  ctx.fillStyle = t.ink; ctx.font = titleFont(fonts)(tf.size);
  let y = drawLines(ctx, tf.lines, M, 300 + tf.size, tf.size, 1.06);
  if (sub) {
    const sf = fit(ctx, sub, bodyFont(fonts), maxW, 200, 42, 30, 1.3);
    ctx.font = bodyFont(fonts)(sf.size); ctx.globalAlpha = 0.8; drawLines(ctx, sf.lines, M, y + 40, sf.size, 1.3); ctx.globalAlpha = 1;
  }
  if (total > 1) { ctx.fillStyle = t.line; ctx.font = `700 26px "${fonts.body}"`; spaced(ctx, 'ARRASTE PARA O LADO →', M, H - 150, 5); }
}

function drawInner(ctx, { n, title, text, style, brand, fonts, handle, total }) {
  const t = theme(style, brand, 'inner');
  frame(ctx, t, brand, fonts, handle, n, total);
  const maxW = W - M * 2;
  ctx.fillStyle = t.line; ctx.font = `${SERIFS.includes(fonts.title) ? 600 : 800} 120px "${fonts.title}"`;
  ctx.fillText(String(n).padStart(2, '0'), M, 250);
  ctx.fillRect(M, 300, 80, 6);
  const tf = fit(ctx, title || '', titleFont(fonts), maxW, 330, 86, 50, 1.1);
  ctx.fillStyle = t.ink; ctx.font = titleFont(fonts)(tf.size);
  let y = drawLines(ctx, tf.lines, M, 380 + tf.size, tf.size, 1.1);
  if (text) {
    const bf = fit(ctx, text, bodyFont(fonts), maxW, H - y - 220, 48, 30, 1.4);
    ctx.font = bodyFont(fonts)(bf.size); ctx.globalAlpha = 0.85;
    drawLines(ctx, bf.lines, M, y + 50 + bf.size * 0.4, bf.size, 1.4); ctx.globalAlpha = 1;
  }
}

function drawCta(ctx, { n, title, text, brand, fonts, handle, total }) {
  const t = theme('claro', brand, 'cta');
  frame(ctx, t, brand, fonts, handle, n, total);
  const maxW = W - M * 2;
  const tf = fit(ctx, title || '', titleFont(fonts), maxW, 480, 110, 56, 1.08);
  const bf = text ? fit(ctx, text, bodyFont(fonts), maxW, 260, 46, 30, 1.35) : null;
  const block = tf.lines.length * tf.size * 1.08 + (bf ? 50 + bf.lines.length * bf.size * 1.35 : 0);
  let y = (H - block) / 2 + tf.size * 0.85;
  ctx.fillStyle = t.ink; ctx.font = titleFont(fonts)(tf.size);
  y = drawLines(ctx, tf.lines, M, y, tf.size, 1.08);
  if (bf) { ctx.font = bodyFont(fonts)(bf.size); ctx.globalAlpha = 0.9; drawLines(ctx, bf.lines, M, y + 50, bf.size, 1.35); ctx.globalAlpha = 1; }
  ctx.fillRect(M, y + (bf ? bf.lines.length * bf.size * 1.35 + 110 : 70), 120, 6);
}

const toBlob = (cv) => new Promise((ok) => cv.toBlob(ok, 'image/jpeg', 0.92));

// Gera todas as lâminas da peça. Devolve [{ blob, url }] (url = prévia local).
export async function renderPiece({ piece, hook, client, style, photo }) {
  const brand = brandColors(client?.brand_kit?.colors);
  const fonts = brandFonts(client?.brand_kit?.fonts);
  await loadFonts([...new Set([fonts.title, fonts.body])]);
  const handle = client?.ig_username ? `@${client.ig_username}` : (client?.name || '');
  const pages = piece.format === 'IMAGE'
    ? [{ kind: 'cover', hook: piece.headline || hook, sub: piece.support }]
    : piece.slides.map((sl, i, a) => (i === 0 ? { kind: 'cover', hook, sub: sl.text } : i === a.length - 1 ? { kind: 'cta', title: sl.title, text: sl.text } : { kind: 'inner', title: sl.title, text: sl.text }));
  const total = pages.length;
  const out = [];
  for (const [i, p] of pages.entries()) {
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');
    const base = { style: style === 'foto' ? 'claro' : style, brand, fonts, handle, total, n: i + 1 };
    if (p.kind === 'cover') drawCover(ctx, { ...base, hook: p.hook, sub: p.sub, photo: style === 'foto' ? photo : null });
    else if (p.kind === 'cta') drawCta(ctx, { ...base, title: p.title, text: p.text });
    else drawInner(ctx, { ...base, title: p.title, text: p.text });
    const blob = await toBlob(cv);
    out.push({ blob, url: URL.createObjectURL(blob) });
  }
  return { arts: out, brand, fonts };
}
