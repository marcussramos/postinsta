// MC DIGITAL — Gerador de artes do Estúdio (v2): lâminas 1080×1350 em JPEG, no navegador, com a marca do cliente.
// Três direções de arte:
//   • editorial — foto do cliente em tela cheia na capa, lâminas com foto + painel, moldura fina, palavra-chave em itálico
//   • revista   — fundo claro com textura, foto em arco, numeral gigante, moldura e foto redonda
//   • impacto   — cor sólida, caixa alta pesada, palavra-chave com marca-texto, foto em círculo e formas
// Fotos: do banco de mídia / posts do cliente (ou escolhidas na hora). Palavras entre *asteriscos* viram destaque.

const W = 1080, H = 1350;

// ───────────────────────── marca
const FONT_MAP = [
  [/playfair|didot|bodoni/i, 'Playfair Display'], [/cormorant|cherston|garamond/i, 'Cormorant Garamond'], [/dm serif/i, 'DM Serif Display'],
  [/libre baskerville|baskerville/i, 'Libre Baskerville'], [/\blora\b/i, 'Lora'], [/montserrat/i, 'Montserrat'], [/poppins/i, 'Poppins'],
  [/\binter\b/i, 'Inter'], [/raleway/i, 'Raleway'], [/gill|humanist|\blato\b/i, 'Lato'], [/bebas/i, 'Bebas Neue'], [/oswald/i, 'Oswald'],
  [/great vibes/i, 'Great Vibes'], [/allura/i, 'Allura'], [/yellowtail/i, 'Yellowtail'], [/dm sans/i, 'DM Sans'], [/nunito/i, 'Nunito'],
];
const SCRIPTS = ['Great Vibes', 'Allura', 'Yellowtail'];
const SERIFS = ['Playfair Display', 'Cormorant Garamond', 'DM Serif Display', 'Libre Baskerville', 'Lora'];
const findFont = (t) => { for (const [re, n] of FONT_MAP) if (re.test(t) && !SCRIPTS.includes(n)) return n; return null; };
const findScript = (t) => { for (const [re, n] of FONT_MAP) if (re.test(t) && SCRIPTS.includes(n)) return n; return null; };

export function brandFonts(raw) {
  const t = String(raw || '');
  const titlePart = (t.match(/t[íi]tulos?\s*:?([^·.\n]*)/i) || [])[1] || '';
  const bodyPart = (t.match(/(corpo|textos?|apoio)[^:]*:?([^·\n]*)/i) || [])[2] || '';
  const title = findFont(titlePart) || findFont(t) || 'Playfair Display';
  let body = findFont(bodyPart) || (/montserrat/i.test(t) ? 'Montserrat' : null) || 'Montserrat';
  if (body === title && SERIFS.includes(title)) body = 'Montserrat';
  return { title, body, script: findScript(t) || null };
}

const hexRgb = (h) => { const x = String(h).replace('#', ''); const n = parseInt(x.length === 3 ? x.split('').map((c) => c + c).join('') : x, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const lum = (h) => { const [r, g, b] = hexRgb(h).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const sat = (h) => { const [r, g, b] = hexRgb(h); const mx = Math.max(r, g, b), mn = Math.min(r, g, b); return mx === 0 ? 0 : (mx - mn) / mx; };
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const rgba = (h, a) => `rgba(${hexRgb(h).join(',')},${a})`;

export function brandColors(list) {
  const cs = [...new Set((Array.isArray(list) ? list : []).filter((c) => /^#?[0-9a-f]{3,6}$/i.test(String(c).trim())).map((c) => `#${String(c).trim().replace('#', '').toUpperCase()}`))];
  if (cs.length < 2) return { paper: '#F3EFEA', ink: '#1D1A1A', deep: '#1D1A1A', deco: '#7B1F31', emph: '#7B1F31' };
  const byLum = [...cs].sort((a, b) => lum(a) - lum(b));
  // papel: o claro mais "quente" (creme/bege) em vez de branco puro
  const paper = byLum.slice().reverse().find((c) => lum(c) > 0.55 && lum(c) < 0.96) || byLum[byLum.length - 1];
  // tinta: o escuro da marca (marrom, vinho) antes do preto puro
  const darks = byLum.filter((c) => lum(c) < 0.12);
  const ink = darks.find((c) => sat(c) > 0.2) || darks[0] || byLum[0];
  const deep = darks.slice().sort((a, b) => sat(b) - sat(a))[0] || ink; // fundo escuro com cor
  const mids = cs.filter((c) => c !== paper && c !== ink && !['#FFFFFF', '#000000'].includes(c));
  const deco = mids.slice().sort((a, b) => sat(b) - sat(a))[0] || deep;            // formas, linhas, molduras
  const emph = [deco, deep, ink].find((c) => contrast(c, paper) >= 3.2) || ink;     // palavra-chave sobre o papel
  return { paper, ink, deep, deco, emph };
}

// ───────────────────────── fontes (Google) sob demanda
const loaded = new Set();
const FAMILY_AXES = { 'Anton': '', 'Yellowtail': '', 'Allura': '', 'Great Vibes': '', 'Cormorant Garamond': 'ital,wght@0,400;0,500;0,600;0,700;1,400;1,500', 'Playfair Display': 'ital,wght@0,400;0,600;0,700;0,800;1,400;1,600', 'Montserrat': 'ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;0,900;1,400', 'Lato': 'ital,wght@0,300;0,400;0,700;0,900;1,400' };
async function loadFonts(names) {
  for (const n of names.filter((x) => x && !loaded.has(x))) {
    const axes = n in FAMILY_AXES ? FAMILY_AXES[n] : (SCRIPTS.includes(n) ? '' : 'ital,wght@0,400;0,700;1,400');
    await new Promise((ok) => {
      const l = document.createElement('link');
      l.rel = 'stylesheet'; l.href = `https://fonts.googleapis.com/css2?family=${n.replace(/ /g, '+')}${axes ? `:${axes}` : ''}&display=swap`;
      l.onload = ok; l.onerror = ok; document.head.append(l);
    });
    loaded.add(n);
  }
  const probes = names.filter(Boolean).flatMap((n) => [`400 40px "${n}"`, `700 40px "${n}"`, `italic 400 40px "${n}"`, `800 40px "${n}"`]);
  await Promise.all(probes.map((f) => document.fonts.load(f).catch(() => null)));
}

// ───────────────────────── texto rico: *destaque*
function tokens(text, autoEmph = false) {
  const s = String(text || '').trim();
  const out = [];
  let em = false;
  for (const part of s.split('*')) { for (const w of part.split(/\s+/).filter(Boolean)) out.push({ w, em }); em = !em; }
  if (autoEmph && !s.includes('*') && out.length > 3) { // sem marcação: destaca as 2 últimas palavras
    out.slice(-2).forEach((t) => { t.em = true; });
  }
  return out;
}
const plain = (text) => String(text || '').replace(/\*/g, '');
function wrapRich(ctx, toks, maxW, font) {
  const lines = [[]]; let w = 0;
  ctx.font = font(false); const space = ctx.measureText(' ').width;
  for (const t of toks) {
    ctx.font = font(t.em); const tw = ctx.measureText(t.w).width;
    const cur = lines[lines.length - 1];
    if (cur.length && w + space + tw > maxW) { lines.push([{ ...t, width: tw }]); w = tw; } else { cur.push({ ...t, width: tw }); w += (cur.length > 1 ? space : 0) + tw; }
  }
  return { lines, space };
}
function fitRich(ctx, toks, fontAt, maxW, maxH, from, to, lh) {
  for (let s = from; s >= to; s -= 2) {
    const r = wrapRich(ctx, toks, maxW, (em) => fontAt(s, em));
    const widest = Math.max(...r.lines.map((l) => l.reduce((a, t) => a + t.width, 0) + (l.length - 1) * r.space));
    if (r.lines.length * s * lh <= maxH && widest <= maxW) return { ...r, size: s };
  }
  return { ...wrapRich(ctx, toks, maxW, (em) => fontAt(to, em)), size: to };
}
// desenha; devolve o y da próxima linha. opts.align: left|center; opts.mark: cor do marca-texto atrás do destaque
function drawRich(ctx, fitted, x, y, fontAt, color, emColor, lh, opts = {}) {
  const { lines, space, size } = fitted;
  lines.forEach((line, i) => {
    const lw = line.reduce((a, t) => a + t.width, 0) + (line.length - 1) * space;
    let cx = opts.align === 'center' ? x - lw / 2 : x;
    const by = y + i * size * lh;
    if (opts.mark) { // marca-texto contínuo atrás das palavras destacadas
      let sx = cx;
      line.forEach((t, j) => {
        if (t.em) { ctx.fillStyle = opts.mark; ctx.fillRect(sx - 10, by - size * 0.78, t.width + 20 + (line[j + 1]?.em ? space : 0), size * 0.98); }
        sx += t.width + space;
      });
    }
    line.forEach((t) => { ctx.font = fontAt(size, t.em); ctx.fillStyle = t.em ? emColor : color; ctx.fillText(t.w, cx, by); cx += t.width + space; });
  });
  return y + lines.length * size * lh;
}
function spaced(ctx, text, x, y, spacing, align = 'left') {
  const chars = [...text];
  const width = chars.reduce((a, c) => a + ctx.measureText(c).width, 0) + spacing * (chars.length - 1);
  let cx = align === 'right' ? x - width : align === 'center' ? x - width / 2 : x;
  for (const c of chars) { ctx.fillText(c, cx, y); cx += ctx.measureText(c).width + spacing; }
  return width;
}
function paragraph(ctx, text, x, y, maxW, maxH, family, from, to, color, lh = 1.42, weight = 400) {
  const f = fitRich(ctx, tokens(text), (s, em) => `${em ? 600 : weight} ${s}px "${family}"`, maxW, maxH, from, to, lh);
  return drawRich(ctx, f, x, y + f.size, (s, em) => `${em ? 600 : weight} ${s}px "${family}"`, color, color, lh);
}

// ───────────────────────── imagem
function cover(ctx, img, x, y, w, h, focusY = 0.35) {
  const r = Math.max(w / img.width, h / img.height);
  const iw = img.width * r, ih = img.height * r;
  ctx.drawImage(img, x + (w - iw) / 2, y + (h - ih) * focusY, iw, ih);
}
function clipped(ctx, path, fn) { ctx.save(); ctx.beginPath(); path(); ctx.clip(); fn(); ctx.restore(); }
const arch = (ctx, x, y, w, h) => { const r = w / 2; ctx.moveTo(x, y + h); ctx.lineTo(x, y + r); ctx.arc(x + r, y + r, r, Math.PI, 0); ctx.lineTo(x + w, y + h); ctx.closePath(); };
const circle = (ctx, cx, cy, r) => ctx.arc(cx, cy, r, 0, Math.PI * 2);
function rounded(ctx, x, y, w, h, r) { ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }

let grainTile = null;
function grain(ctx, alpha = 0.06) {
  if (!grainTile) {
    grainTile = document.createElement('canvas'); grainTile.width = grainTile.height = 160;
    const g = grainTile.getContext('2d'); const d = g.createImageData(160, 160);
    for (let i = 0; i < d.data.length; i += 4) { const v = Math.random() * 255; d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 255; }
    g.putImageData(d, 0, 0);
  }
  ctx.save(); ctx.globalAlpha = alpha; ctx.globalCompositeOperation = 'overlay';
  ctx.fillStyle = ctx.createPattern(grainTile, 'repeat'); ctx.fillRect(0, 0, W, H); ctx.restore();
}
function pill(ctx, text, x, y, font, bg, fg, padX = 34, h = 76) {
  ctx.font = font; const tw = ctx.measureText(text).width;
  ctx.fillStyle = bg; ctx.beginPath(); rounded(ctx, x, y, tw + padX * 2, h, h / 2); ctx.fill();
  ctx.fillStyle = fg; ctx.fillText(text, x + padX, y + h / 2 + parseInt(font.match(/(\d+)px/)[1], 10) * 0.35);
  return tw + padX * 2;
}
function footer(ctx, B, F, handle, n, total, color, alpha = 0.75) {
  ctx.save(); ctx.globalAlpha = alpha; ctx.fillStyle = color; ctx.font = `600 22px "${F.body}"`;
  if (handle) spaced(ctx, handle.toUpperCase(), 80, H - 64, 4);
  if (total > 1) spaced(ctx, `${String(n).padStart(2, '0')} / ${String(total).padStart(2, '0')}`, W - 80, H - 64, 3, 'right');
  ctx.restore();
}

// ───────────────────────── direção 1: EDITORIAL (foto)
const ED = {
  title: (F) => (s, em) => (SERIFS.includes(F.title) ? `${em ? 'italic 400' : '600'} ${s}px "${F.title}"` : `${em ? 'italic 500' : '800'} ${s}px "${F.title}"`),
  cover(ctx, d) {
    const { B, F, photo } = d;
    ctx.fillStyle = B.deep; ctx.fillRect(0, 0, W, H);
    if (photo) cover(ctx, photo, 0, 0, W, H, 0.3);
    const g = ctx.createLinearGradient(0, H * 0.28, 0, H);
    g.addColorStop(0, rgba(B.deep, 0)); g.addColorStop(0.55, rgba(B.deep, 0.72)); g.addColorStop(1, rgba(B.deep, 0.95));
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = 2; ctx.strokeRect(40, 40, W - 80, H - 80);
    ctx.fillStyle = '#FFFFFF'; ctx.font = `600 22px "${F.body}"`;
    if (d.eyebrow) spaced(ctx, d.eyebrow.toUpperCase(), 84, 112, 6);
    const tf = fitRich(ctx, tokens(d.hook, true), ED.title(F), W - 168, 520, 124, 64, 1.04);
    const h = tf.lines.length * tf.size * 1.04;
    let y = H - 200 - h - (d.sub ? 100 : 0);
    y = drawRich(ctx, tf, 84, y + tf.size, ED.title(F), '#FFFFFF', lum(B.deco) > 0.25 ? B.deco : '#F4E6D0', 1.04);
    if (d.sub) { ctx.globalAlpha = 0.88; paragraph(ctx, d.sub, 84, y + 6, W - 168, 110, F.body, 34, 26, '#FFFFFF', 1.35, 400); ctx.globalAlpha = 1; }
    ctx.fillStyle = '#FFFFFF'; ctx.font = `700 22px "${F.body}"`; ctx.globalAlpha = 0.9;
    if (d.handle) spaced(ctx, d.handle.toUpperCase(), 84, H - 92, 4);
    if (d.total > 1) spaced(ctx, 'ARRASTE  →', W - 84, H - 92, 5, 'right');
    ctx.globalAlpha = 1;
    grain(ctx, 0.07);
  },
  inner(ctx, d) {
    const { B, F, photo } = d;
    ctx.fillStyle = B.paper; ctx.fillRect(0, 0, W, H);
    const ph = photo ? 600 : 0;
    if (photo) { clipped(ctx, () => ctx.rect(0, 0, W, ph), () => cover(ctx, photo, 0, 0, W, ph, 0.3)); ctx.fillStyle = rgba(B.deep, 0.12); ctx.fillRect(0, 0, W, ph); }
    // numeral em círculo, cavalgando a borda da foto
    const cy = photo ? ph : 230, r = 74;
    ctx.fillStyle = B.emph; ctx.beginPath(); circle(ctx, 84 + r, cy, r); ctx.fill();
    ctx.fillStyle = B.paper; ctx.font = `${SERIFS.includes(F.title) ? 'italic 500' : '800'} 70px "${F.title}"`;
    const num = String(d.n).padStart(2, '0'); ctx.fillText(num, 84 + r - ctx.measureText(num).width / 2, cy + 24);
    let y = cy + r + 60;
    const tf = fitRich(ctx, tokens(d.title), ED.title(F), W - 168, photo ? 230 : 420, photo ? 76 : 100, 48, 1.08);
    y = drawRich(ctx, tf, 84, y + tf.size * 0.85, ED.title(F), B.ink, B.emph, 1.08);
    ctx.fillStyle = B.deco; ctx.fillRect(84, y + 18, 90, 4);
    if (d.text) paragraph(ctx, d.text, 84, y + 56, W - 168, H - y - 56 - 150, F.body, 40, 28, rgba(B.ink, 0.86), 1.45);
    footer(ctx, B, F, d.handle, d.n, d.total, B.ink, 0.6);
    grain(ctx, 0.05);
  },
  cta(ctx, d) {
    const { B, F, photo } = d;
    ctx.fillStyle = B.deep; ctx.fillRect(0, 0, W, H);
    if (photo) { ctx.globalAlpha = 0.28; cover(ctx, photo, 0, 0, W, H, 0.3); ctx.globalAlpha = 1; ctx.fillStyle = rgba(B.deep, 0.55); ctx.fillRect(0, 0, W, H); }
    ctx.strokeStyle = 'rgba(255,255,255,.4)'; ctx.lineWidth = 2; ctx.strokeRect(40, 40, W - 80, H - 80);
    if (photo) { // retrato redondo com anel
      clipped(ctx, () => circle(ctx, W / 2, 330, 150), () => cover(ctx, photo, W / 2 - 150, 180, 300, 300, 0.25));
      ctx.strokeStyle = lum(B.deco) > 0.2 ? B.deco : '#F4E6D0'; ctx.lineWidth = 6; ctx.beginPath(); circle(ctx, W / 2, 330, 166); ctx.stroke();
    }
    const tf = fitRich(ctx, tokens(d.title, true), ED.title(F), W - 200, 380, 104, 56, 1.06);
    let y = drawRich(ctx, tf, W / 2, (photo ? 600 : 420) + tf.size, ED.title(F), '#FFFFFF', lum(B.deco) > 0.25 ? B.deco : '#F4E6D0', 1.06, { align: 'center' });
    if (d.text) {
      ctx.globalAlpha = 0.9; ctx.font = `400 34px "${F.body}"`;
      const f = fitRich(ctx, tokens(d.text), (s) => `400 ${s}px "${F.body}"`, W - 240, 150, 36, 26, 1.4);
      y = drawRich(ctx, f, W / 2, y + 20 + f.size, (s) => `400 ${s}px "${F.body}"`, '#FFFFFF', '#FFFFFF', 1.4, { align: 'center' }); ctx.globalAlpha = 1;
    }
    const label = d.button || 'SALVE ESTE POST';
    ctx.font = `700 28px "${F.body}"`; const bw = ctx.measureText(label).width + 80;
    pill(ctx, label, W / 2 - bw / 2, y + 50, `700 28px "${F.body}"`, '#FFFFFF', B.deep, 40, 84);
    ctx.fillStyle = '#FFFFFF'; ctx.globalAlpha = 0.85; ctx.font = `600 24px "${F.body}"`;
    if (d.handle) spaced(ctx, d.handle.toUpperCase(), W / 2, H - 100, 5, 'center');
    ctx.globalAlpha = 1; grain(ctx, 0.07);
  },
};

// ───────────────────────── direção 2: REVISTA
const RV = {
  title: ED.title,
  frame(ctx, B) { ctx.strokeStyle = rgba(B.deco, 0.7); ctx.lineWidth = 2; ctx.strokeRect(44, 44, W - 88, H - 88); },
  cover(ctx, d) {
    const { B, F, photo } = d;
    ctx.fillStyle = B.paper; ctx.fillRect(0, 0, W, H);
    RV.frame(ctx, B);
    // monta de baixo para cima: rodapé → apoio → título → foto em arco no espaço que sobrar
    const maxW = W - 192;
    const tf = fitRich(ctx, tokens(d.hook, true), RV.title(F), maxW, photo ? 330 : 520, photo ? 92 : 116, 56, 1.04);
    let sub = null;
    if (d.sub) { sub = fitRich(ctx, tokens(d.sub), (s2) => `400 ${s2}px "${F.body}"`, maxW, 90, 32, 24, 1.35); }
    const subH = sub ? sub.lines.length * sub.size * 1.35 : 0;
    const subTop = H - 160 - subH;
    const titleH = tf.lines.length * tf.size * 1.04;
    const titleTop = subTop - (sub ? 34 : 0) - titleH;
    if (photo) {
      const top = 210, bottom = titleTop - 50, h = Math.max(380, bottom - top), w = Math.min(600, h * 0.78);
      clipped(ctx, () => arch(ctx, W - 96 - w, top, w, h), () => cover(ctx, photo, W - 96 - w, top, w, h, 0.25));
      ctx.strokeStyle = B.deco; ctx.lineWidth = 3; ctx.beginPath(); arch(ctx, W - 96 - w - 18, top - 18, w + 36, h + 18); ctx.stroke();
    } else {
      ctx.fillStyle = rgba(B.deco, 0.16); ctx.font = `italic 400 900px "${F.title}"`; ctx.fillText('“', 460, 900);
    }
    ctx.fillStyle = B.emph; ctx.font = `700 22px "${F.body}"`;
    spaced(ctx, (d.eyebrow || 'GUIA').toUpperCase(), 96, 150, 7);
    ctx.fillRect(96, 172, 60, 3);
    drawRich(ctx, tf, 96, titleTop + tf.size * 0.9, RV.title(F), B.ink, B.emph, 1.04);
    if (sub) drawRich(ctx, sub, 96, subTop + sub.size, (s2) => `400 ${s2}px "${F.body}"`, rgba(B.ink, 0.8), rgba(B.ink, 0.8), 1.35);
    ctx.fillStyle = B.ink; ctx.globalAlpha = 0.7; ctx.font = `600 22px "${F.body}"`;
    if (d.handle) spaced(ctx, d.handle.toUpperCase(), 96, H - 92, 4);
    if (d.total > 1) spaced(ctx, 'ARRASTE  →', W - 96, H - 92, 5, 'right');
    ctx.globalAlpha = 1; grain(ctx, 0.06);
  },
  inner(ctx, d) {
    const { B, F, photo } = d;
    ctx.fillStyle = B.paper; ctx.fillRect(0, 0, W, H);
    RV.frame(ctx, B);
    const num = String(d.n).padStart(2, '0');
    ctx.fillStyle = rgba(B.deco, 0.13); ctx.font = `${SERIFS.includes(F.title) ? 'italic 400' : '800'} 560px "${F.title}"`;
    ctx.fillText(num, W - ctx.measureText(num).width - 30, photo ? 470 : H - 120);
    ctx.fillStyle = B.emph; ctx.font = `700 22px "${F.body}"`;
    spaced(ctx, `${(d.label || 'PASSO')} ${num}`.toUpperCase(), 96, 180, 7);
    ctx.fillRect(96, 202, 60, 3);
    const tf = fitRich(ctx, tokens(d.title), RV.title(F), W - 192, 380, 96, 54, 1.08);
    let y = drawRich(ctx, tf, 96, 330 + tf.size, RV.title(F), B.ink, B.emph, 1.08);
    const pr = photo ? 150 : 0;
    if (d.text) paragraph(ctx, d.text, 96, y + 40, photo ? W - 192 - 40 : W - 192, H - y - 40 - (photo ? 420 : 200), F.body, 40, 28, rgba(B.ink, 0.85), 1.48);
    if (photo) {
      clipped(ctx, () => circle(ctx, W - 96 - pr, H - 150 - pr, pr), () => cover(ctx, photo, W - 96 - pr * 2, H - 150 - pr * 2, pr * 2, pr * 2, 0.3));
      ctx.strokeStyle = B.deco; ctx.lineWidth = 3; ctx.beginPath(); circle(ctx, W - 96 - pr, H - 150 - pr, pr + 14); ctx.stroke();
    }
    footer(ctx, B, F, d.handle, d.n, d.total, B.ink, 0.6);
    grain(ctx, 0.05);
  },
  cta(ctx, d) {
    const { B, F, photo } = d;
    const bg = contrast(B.deco, '#FFFFFF') >= 3 ? B.deco : B.deep;
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.lineWidth = 2; ctx.strokeRect(44, 44, W - 88, H - 88);
    ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.font = `700 22px "${F.body}"`;
    spaced(ctx, 'ANTES DE IR', 96, 180, 7); ctx.fillRect(96, 202, 60, 3);
    const tf = fitRich(ctx, tokens(d.title, true), RV.title(F), W - 192, 470, 112, 60, 1.05);
    let y = drawRich(ctx, tf, 96, 330 + tf.size, RV.title(F), '#FFFFFF', B.paper, 1.05);
    if (d.text) y = paragraph(ctx, d.text, 96, y + 30, W - 192, 200, F.body, 38, 28, 'rgba(255,255,255,.9)', 1.42);
    pill(ctx, d.button || 'SALVE ESTE POST', 96, y + 60, `700 28px "${F.body}"`, B.paper, bg, 40, 84);
    if (photo) {
      clipped(ctx, () => arch(ctx, W - 96 - 300, H - 140 - 400, 300, 400), () => cover(ctx, photo, W - 396, H - 540, 300, 400, 0.25));
    }
    ctx.fillStyle = '#FFFFFF'; ctx.globalAlpha = 0.85; ctx.font = `600 22px "${F.body}"`;
    if (d.handle) spaced(ctx, d.handle.toUpperCase(), 96, H - 96, 4);
    ctx.globalAlpha = 1; grain(ctx, 0.06);
  },
};

// ───────────────────────── direção 3: IMPACTO
const IM = {
  font: (F) => (SERIFS.includes(F.body) ? 'Montserrat' : (['Lato', 'Montserrat', 'Poppins', 'Inter', 'Raleway', 'DM Sans', 'Nunito'].includes(F.body) ? F.body : 'Montserrat')),
  title: (F) => (s) => `900 ${s}px "${IM.font(F)}"`,
  cover(ctx, d) {
    const { B, F, photo } = d;
    const bg = B.deep; ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = rgba(B.deco, 0.9); ctx.beginPath(); circle(ctx, W - 120, 210, 260); ctx.fill();
    ctx.strokeStyle = rgba(B.paper, 0.35); ctx.lineWidth = 3; ctx.beginPath(); circle(ctx, 140, H - 260, 210); ctx.stroke();
    if (photo) {
      clipped(ctx, () => circle(ctx, W - 300, H - 400, 280), () => cover(ctx, photo, W - 580, H - 680, 560, 560, 0.25));
      ctx.strokeStyle = B.paper; ctx.lineWidth = 10; ctx.beginPath(); circle(ctx, W - 300, H - 400, 288); ctx.stroke();
    }
    const tf = fitRich(ctx, tokens(plain(d.hook) ? d.hook.toUpperCase() : '', true), (s) => IM.title(F)(s), W - 160, photo ? 560 : 820, 118, 60, 1.0);
    drawRich(ctx, tf, 80, 170 + tf.size, (s) => IM.title(F)(s), B.paper, B.deep, 1.0, { mark: lum(B.deco) > 0.25 ? B.deco : B.paper });
    ctx.fillStyle = B.paper; ctx.font = `800 24px "${IM.font(F)}"`;
    if (d.handle) spaced(ctx, d.handle.toUpperCase(), 80, H - 80, 4);
    if (d.total > 1) pill(ctx, 'ARRASTE →', 80, H - 200, `800 24px "${IM.font(F)}"`, B.paper, B.deep, 28, 64);
  },
  inner(ctx, d) {
    const { B, F, photo } = d;
    ctx.fillStyle = B.paper; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = rgba(B.deco, 0.35); ctx.beginPath(); circle(ctx, W + 40, -40, 300); ctx.fill();
    const num = String(d.n).padStart(2, '0');
    pill(ctx, `DICA ${num}`, 80, 120, `900 30px "${IM.font(F)}"`, B.deep, B.paper, 34, 80);
    const tf = fitRich(ctx, tokens(d.title.toUpperCase()), (s) => IM.title(F)(s), W - 160, 420, 92, 50, 1.02);
    let y = drawRich(ctx, tf, 80, 290 + tf.size, (s) => IM.title(F)(s), B.ink, B.ink, 1.02, { mark: rgba(B.deco, 0.55) });
    if (d.text) y = paragraph(ctx, d.text, 80, y + 40, W - 160, photo ? 330 : H - y - 260, F.body === 'Cormorant Garamond' ? 'Montserrat' : IM.font(F), 40, 28, rgba(B.ink, 0.85), 1.45, 500);
    if (photo) clipped(ctx, () => { rounded(ctx, 80, Math.max(y + 50, H - 470), W - 160, Math.min(380, H - 140 - Math.max(y + 50, H - 470)), 28); }, () => cover(ctx, photo, 80, Math.max(y + 50, H - 470), W - 160, 380, 0.35));
    footer(ctx, B, { body: IM.font(F) }, d.handle, d.n, d.total, B.ink, 0.65);
  },
  cta(ctx, d) {
    const { B, F } = d;
    ctx.fillStyle = B.deep; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = rgba(B.deco, 0.9); ctx.beginPath(); circle(ctx, -60, H + 60, 420); ctx.fill();
    const tf = fitRich(ctx, tokens(d.title.toUpperCase(), true), (s) => IM.title(F)(s), W - 160, 520, 112, 56, 1.0);
    let y = drawRich(ctx, tf, 80, 260 + tf.size, (s) => IM.title(F)(s), B.paper, B.deep, 1.0, { mark: lum(B.deco) > 0.25 ? B.deco : B.paper });
    if (d.text) y = paragraph(ctx, d.text, 80, y + 30, W - 160, 200, IM.font(F), 40, 28, rgba(B.paper, 0.9), 1.4, 500);
    pill(ctx, d.button || 'SALVE ESTE POST', 80, y + 60, `900 30px "${IM.font(F)}"`, B.paper, B.deep, 40, 88);
    ctx.fillStyle = B.paper; ctx.font = `800 24px "${IM.font(F)}"`;
    if (d.handle) spaced(ctx, d.handle.toUpperCase(), W - 80, H - 80, 4, 'right');
  },
};


// ───────────────────────── direção 4: PÔSTER (referência: capas cinematográficas de perfis de design)
// Receita: imagem em tela cheia escurecida + textura; palavra manuscrita grande e inclinada (chamada);
// título em caixa alta condensada, empilhado e centralizado; palavra-chave em caixa de cor; brilhos ✦;
// etiqueta com o apoio; microtexto. Não copia nenhuma arte: aplica a estrutura com a marca do cliente.
const PO = {
  display: 'Anton',
  title: (s) => `400 ${s}px "Anton"`,
  bg(ctx, B, photo, alpha = 1) {
    ctx.fillStyle = B.deep; ctx.fillRect(0, 0, W, H);
    if (photo) { ctx.globalAlpha = alpha; cover(ctx, photo, 0, 0, W, H, 0.3); ctx.globalAlpha = 1; }
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, rgba(B.deep, photo ? 0.15 : 0)); g.addColorStop(0.45, rgba(B.deep, photo ? 0.35 : 0)); g.addColorStop(1, rgba(B.deep, photo ? 0.92 : 0));
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    const v = ctx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.85);
    v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,.45)');
    ctx.fillStyle = v; ctx.fillRect(0, 0, W, H);
  },
  hi: (B) => (contrast(B.deco, '#FFFFFF') >= 2.2 ? B.deco : B.emph === B.ink ? '#C8102E' : B.emph),
  micro(ctx, F, text, y) {
    ctx.save(); ctx.fillStyle = 'rgba(255,255,255,.7)'; ctx.font = `600 18px "${F.body}"`;
    const w = spaced(ctx, text.toUpperCase(), W / 2, y, 6, 'center');
    ctx.fillRect(W / 2 - w / 2 - 90, y - 7, 60, 2); ctx.fillRect(W / 2 + w / 2 + 30, y - 7, 60, 2);
    ctx.restore();
  },
  sparkle(ctx, x, y, r, color) {
    ctx.save(); ctx.fillStyle = color; ctx.beginPath();
    ctx.moveTo(x, y - r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.quadraticCurveTo(x, y, x, y + r); ctx.quadraticCurveTo(x, y, x - r, y); ctx.quadraticCurveTo(x, y, x, y - r);
    ctx.fill(); ctx.restore();
  },
  stack(ctx, d, text, top, maxH, from) { // título condensado, centralizado, palavra-chave em caixa de cor
    const { B } = d;
    const tf = fitRich(ctx, tokens(String(text).toUpperCase(), true), PO.title, W - 200, maxH, from, 70, 0.98);
    const y = drawRich(ctx, tf, W / 2, top + tf.size * 0.86, PO.title, '#FFFFFF', '#FFFFFF', 0.98, { align: 'center', mark: PO.hi(B) });
    const lw = Math.max(...tf.lines.map((l) => l.reduce((a, t) => a + t.width, 0) + (l.length - 1) * tf.space));
    PO.sparkle(ctx, W / 2 - lw / 2 - 46, top + tf.size * 0.35, 20, '#FFFFFF');
    PO.sparkle(ctx, W / 2 + lw / 2 + 46, y - tf.size * 0.9, 14, '#FFFFFF');
    return y;
  },
  script(ctx, d, text, y, size = 92) {
    if (!text) return y;
    const fam = d.F.script || 'Yellowtail';
    ctx.save(); ctx.translate(W / 2, y); ctx.rotate(-0.06);
    ctx.font = `400 ${size}px "${fam}"`; ctx.fillStyle = lum(d.B.deco) > 0.2 ? d.B.deco : '#F4E6D0';
    const w = ctx.measureText(text).width; ctx.fillText(text, -w / 2, 0); ctx.restore();
    return y + size * 0.35;
  },
  label(ctx, d, text, y) {
    if (!text) return y;
    const f = fitRich(ctx, tokens(text), (s, em) => `${em ? 800 : 500} ${s}px "${d.F.body}"`, W - 320, 130, 36, 26, 1.25);
    const lw = Math.max(...f.lines.map((l) => l.reduce((a, t) => a + t.width, 0) + (l.length - 1) * f.space));
    const h = f.lines.length * f.size * 1.25 + 40;
    ctx.fillStyle = rgba(PO.hi(d.B), 0.92); ctx.beginPath(); rounded(ctx, W / 2 - lw / 2 - 34, y, lw + 68, h, 14); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.lineWidth = 2; ctx.stroke();
    drawRich(ctx, f, W / 2, y + 20 + f.size * 0.85, (s, em) => `${em ? 800 : 500} ${s}px "${d.F.body}"`, '#FFFFFF', '#FFFFFF', 1.25, { align: 'center' });
    return y + h;
  },
  cover(ctx, d) {
    PO.bg(ctx, d.B, d.photo);
    PO.micro(ctx, d.F, d.handle || '', 92);
    const top = H * 0.5;
    let y = PO.script(ctx, d, d.eyebrow ? d.eyebrow.toLowerCase() : '', top - 10);
    y = PO.stack(ctx, d, d.hook, y + 10, 360, 190);
    y = PO.label(ctx, d, d.sub, y + 34);
    if (d.total > 1) { ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.font = `700 22px "${d.F.body}"`; spaced(ctx, 'ARRASTA PRO LADO  →', W / 2, H - 70, 6, 'center'); }
    grain(ctx, 0.12);
  },
  inner(ctx, d) {
    PO.bg(ctx, d.B, d.photo, 0.55);
    PO.micro(ctx, d.F, d.handle || '', 92);
    // etiqueta "PARTE 02" inclinada
    ctx.save(); ctx.translate(W / 2 + 230, 330); ctx.rotate(-0.08);
    pill(ctx, `PARTE ${String(d.n).padStart(2, '0')}`, -110, -36, `400 40px "Anton"`, PO.hi(d.B), '#FFFFFF', 30, 72); ctx.restore();
    let y = PO.stack(ctx, d, d.title, 400, 420, 170);
    y = PO.label(ctx, d, d.text, y + 50);
    footer(ctx, d.B, d.F, '', d.n, d.total, '#FFFFFF', 0.7);
    grain(ctx, 0.12);
  },
  cta(ctx, d) {
    PO.bg(ctx, d.B, d.photo, 0.7);
    PO.micro(ctx, d.F, d.handle || '', 92);
    let y = PO.script(ctx, d, 'antes de ir', H * 0.36, 84);
    y = PO.stack(ctx, d, d.title, y + 10, 400, 170);
    y = PO.label(ctx, d, d.text, y + 34);
    const label = d.button || 'SALVE ESTE POST';
    ctx.font = `400 40px "Anton"`; const bw = ctx.measureText(label).width + 80;
    pill(ctx, label, W / 2 - bw / 2, y + 50, `400 40px "Anton"`, '#FFFFFF', d.B.deep, 40, 88);
    grain(ctx, 0.12);
  },
};

export const STYLES = { editorial: ['Editorial', ED], revista: ['Revista', RV], impacto: ['Impacto', IM], poster: ['Pôster', PO] };

const toBlob = (cv) => new Promise((ok) => cv.toBlob(ok, 'image/jpeg', 0.92));

// Carrega fotos com CORS liberado (o canvas precisa exportar). Ignora as que falharem.
export async function loadPhotos(urls, max = 8) {
  const out = [];
  for (const u of urls.filter(Boolean).slice(0, max * 2)) {
    if (out.length >= max) break;
    const img = new Image(); img.crossOrigin = 'anonymous'; img.src = u;
    try { await img.decode(); if (img.width >= 400) out.push(img); } catch { /* sem CORS ou quebrada */ }
  }
  return out;
}

// Gera todas as lâminas. photos: Image[] (a 1ª vai na capa). Devolve { arts: [{blob,url}], brand, fonts }.
export async function renderPiece({ piece, hook, client, style = 'editorial', photos = [], eyebrow = '' }) {
  const B = brandColors(client?.brand_kit?.colors);
  const F = brandFonts(client?.brand_kit?.fonts);
  const R = (STYLES[style] || STYLES.editorial)[1];
  await loadFonts([...new Set([F.title, F.body, R === IM ? IM.font(F) : null, R === PO ? 'Anton' : null, R === PO ? (F.script || 'Yellowtail') : null])]);
  const handle = client?.ig_username ? `@${client.ig_username}` : (client?.name || '');
  const pages = piece.format === 'IMAGE'
    ? [{ kind: 'cover', hook: piece.headline || hook, sub: piece.support }]
    : piece.slides.map((sl, i, a) => (i === 0 ? { kind: 'cover', hook, sub: sl.text } : i === a.length - 1 && a.length > 2 ? { kind: 'cta', title: sl.title, text: sl.text } : { kind: 'inner', title: sl.title, text: sl.text }));
  const total = pages.length;
  const pick = (i) => (photos.length ? photos[i % photos.length] : null);
  const out = [];
  let k = 1; // as lâminas internas usam as fotos seguintes, sem repetir a da capa enquanto houver
  for (const [i, p] of pages.entries()) {
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d'); ctx.textBaseline = 'alphabetic';
    const d = { B, F, handle, total, n: i + 1, eyebrow, button: piece.button || '' };
    if (p.kind === 'cover') R.cover(ctx, { ...d, hook: p.hook, sub: p.sub, photo: pick(0) });
    else if (p.kind === 'cta') R.cta(ctx, { ...d, title: p.title, text: p.text, photo: pick(0) });
    else R.inner(ctx, { ...d, title: p.title, text: p.text, photo: photos.length > 1 ? pick(k++) : (style === 'editorial' && i % 2 ? null : pick(0)) });
    const blob = await toBlob(cv);
    out.push({ blob, url: URL.createObjectURL(blob) });
  }
  return { arts: out, brand: B, fonts: F };
}
