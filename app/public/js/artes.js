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
const FAMILY_AXES = { 'Inter': 'ital,wght@0,400;0,700;0,800;0,900;1,400', 'Anton': '', 'Yellowtail': '', 'Allura': '', 'Great Vibes': '', 'Cormorant Garamond': 'ital,wght@0,400;0,500;0,600;0,700;1,400;1,500', 'Playfair Display': 'ital,wght@0,400;0,600;0,700;0,800;1,400;1,600', 'Montserrat': 'ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;0,900;1,400', 'Lato': 'ital,wght@0,300;0,400;0,700;0,900;1,400' };
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
  for (const part of s.split('*')) {
    part.split('\n').forEach((ln, li) => {
      if (li > 0) out.push({ br: true });
      for (const w of ln.split(/\s+/).filter(Boolean)) {
        const prev = out[out.length - 1];
        if (/^[.,;:!?…)]+$/.test(w) && prev && !prev.br) prev.w += w; else out.push({ w, em });
      }
    });
    em = !em;
  }
  const words = out.filter((t) => !t.br);
  if (autoEmph && !s.includes('*') && words.length > 3) words.slice(-2).forEach((t) => { t.em = true; }); // sem marcação: destaca as 2 últimas
  return out;
}
const plain = (text) => String(text || '').replace(/\*/g, '');
function wrapRich(ctx, toks, maxW, font) {
  const lines = [[]]; let w = 0;
  ctx.font = font(false); const space = ctx.measureText(' ').width;
  for (const t of toks) {
    if (t.br) { lines.push([]); w = 0; continue; } // quebra de parágrafo (linha vazia vira espaço)
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
    return top + tf.lines.length * tf.size * 0.98; // base real do bloco (não a linha de base seguinte)
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
    // mede antes: o bloco (chamada + título + etiqueta) termina acima do "arrasta"
    const tf = fitRich(ctx, tokens(String(d.hook).toUpperCase(), true), PO.title, W - 200, 360, 190, 70, 0.98);
    let labelH = 0;
    if (d.sub) { const f = fitRich(ctx, tokens(d.sub), (s2, em) => `${em ? 800 : 500} ${s2}px "${d.F.body}"`, W - 320, 130, 36, 26, 1.25); labelH = f.lines.length * f.size * 1.25 + 40 + 34; }
    const block = (d.eyebrow ? 70 : 0) + tf.lines.length * tf.size * 0.98 + labelH;
    let y = H - 140 - block + (d.eyebrow ? 50 : 0);
    if (d.eyebrow) y = PO.script(ctx, d, d.eyebrow.toLowerCase(), y);
    y = PO.stack(ctx, d, d.hook, y + 10, 360, 190);
    PO.label(ctx, d, d.sub, y + 34);
    if (d.total > 1) { ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.font = `700 22px "${d.F.body}"`; spaced(ctx, 'ARRASTA PRO LADO  →', W / 2, H - 64, 6, 'center'); }
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

// ───────────────────────── direção 5: PERFIL (referência: guias educativos com cabeçalho de perfil)
// Receita: fundo claro com manchas de cor desfocadas; cabeçalho de perfil (foto, nome, selo, @);
// título forte com a palavra-chave na cor da marca; foto em cartão branco levemente inclinado com sombra.
const PF = {
  title: (F) => (s, em) => `${SERIFS.includes(F.title) ? 700 : 800} ${s}px "${F.title}"`,
  bg(ctx, B) {
    ctx.fillStyle = B.paper; ctx.fillRect(0, 0, W, H);
    for (const [x, y, r, c, a] of [[W + 40, 120, 360, B.deco, 0.35], [-80, H - 200, 420, B.emph, 0.18]]) {
      const g = ctx.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, rgba(c, a)); g.addColorStop(1, rgba(c, 0));
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    }
  },
  header(ctx, d, y = 96) {
    const { B, F, name, handle } = d; const photo = d.avatar || d.photo;
    const r = 38, cx = 80 + r;
    if (photo) clipped(ctx, () => circle(ctx, cx, y, r), () => cover(ctx, photo, cx - r, y - r, r * 2, r * 2, 0.2));
    else { ctx.fillStyle = B.emph; ctx.beginPath(); circle(ctx, cx, y, r); ctx.fill(); ctx.fillStyle = B.paper; ctx.font = `800 28px "${F.body}"`; const t = (name || '?').slice(0, 1).toUpperCase(); ctx.fillText(t, cx - ctx.measureText(t).width / 2, y + 10); }
    ctx.strokeStyle = B.deco; ctx.lineWidth = 3; ctx.beginPath(); circle(ctx, cx, y, r + 6); ctx.stroke();
    ctx.fillStyle = B.ink; ctx.font = `800 28px "${F.body}"`; const nm = name || ''; ctx.fillText(nm, cx + r + 22, y - 2);
    const nw = ctx.measureText(nm).width; // selo
    ctx.fillStyle = B.emph; ctx.beginPath(); circle(ctx, cx + r + 22 + nw + 20, y - 11, 13); ctx.fill();
    ctx.strokeStyle = '#FFFFFF'; ctx.lineWidth = 3.5; ctx.beginPath(); const sx = cx + r + 22 + nw + 20; ctx.moveTo(sx - 6, y - 11); ctx.lineTo(sx - 1, y - 6); ctx.lineTo(sx + 7, y - 16); ctx.stroke();
    ctx.fillStyle = rgba(B.ink, 0.6); ctx.font = `500 22px "${F.body}"`; if (handle) ctx.fillText(handle, cx + r + 22, y + 28);
  },
  card(ctx, photo, x, y, w, h, rot, B) {
    ctx.save(); ctx.translate(x + w / 2, y + h / 2); ctx.rotate(rot);
    ctx.shadowColor = 'rgba(0,0,0,.22)'; ctx.shadowBlur = 50; ctx.shadowOffsetY = 24;
    ctx.fillStyle = '#FFFFFF'; ctx.beginPath(); rounded(ctx, -w / 2, -h / 2, w, h, 30); ctx.fill();
    ctx.shadowColor = 'transparent';
    clipped(ctx, () => rounded(ctx, -w / 2 + 14, -h / 2 + 14, w - 28, h - 28, 20), () => cover(ctx, photo, -w / 2 + 14, -h / 2 + 14, w - 28, h - 28, 0.3));
    ctx.restore();
  },
  cover(ctx, d) {
    const { B, F, photo } = d;
    PF.bg(ctx, B); PF.header(ctx, d);
    let y = 230;
    if (d.eyebrow) { ctx.fillStyle = B.emph; ctx.font = `700 26px "${F.body}"`; spaced(ctx, d.eyebrow.toUpperCase(), 80, y, 5); y += 30; }
    const tf = fitRich(ctx, tokens(d.hook, true), PF.title(F), W - 160, photo ? 330 : 600, photo ? 104 : 130, 60, 1.02);
    y = drawRich(ctx, tf, 80, y + tf.size, PF.title(F), B.ink, B.emph, 1.02);
    if (d.sub) y = paragraph(ctx, d.sub, 80, y + 10, W - 160, 90, F.body, 34, 26, rgba(B.ink, 0.75), 1.35, 500);
    if (photo) { const top = Math.max(y + 50, 640); PF.card(ctx, photo, 150, top, W - 300, H - top - 110, -0.035, B); }
    if (d.total > 1) pill(ctx, 'ARRASTA →', W - 80 - 250, H - 110, `800 24px "${F.body}"`, B.ink, B.paper, 30, 66);
  },
  inner(ctx, d) {
    const { B, F, photo } = d;
    PF.bg(ctx, B); PF.header(ctx, d);
    const num = `${String(d.n).padStart(2, '0')}.`;
    ctx.fillStyle = B.emph; ctx.font = `${SERIFS.includes(F.title) ? 700 : 900} 120px "${F.title}"`; ctx.fillText(num, 80, 320);
    const tf = fitRich(ctx, tokens(d.title), PF.title(F), W - 160, 300, 84, 50, 1.06);
    let y = drawRich(ctx, tf, 80, 370 + tf.size, PF.title(F), B.ink, B.emph, 1.06);
    if (d.text) { // texto em cartão branco com barra de cor
      const f = fitRich(ctx, tokens(d.text), (s2, em) => `${em ? 700 : 400} ${s2}px "${F.body}"`, W - 160 - 90, photo ? 260 : 480, 40, 28, 1.45);
      const h = f.lines.length * f.size * 1.45 + 70;
      ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.08)'; ctx.shadowBlur = 30; ctx.shadowOffsetY = 10;
      ctx.fillStyle = '#FFFFFF'; ctx.beginPath(); rounded(ctx, 80, y + 40, W - 160, h, 24); ctx.fill(); ctx.restore();
      ctx.fillStyle = B.emph; ctx.fillRect(80, y + 40 + 24, 8, h - 48);
      drawRich(ctx, f, 80 + 50, y + 40 + 35 + f.size * 0.85, (s2, em) => `${em ? 700 : 400} ${s2}px "${F.body}"`, rgba(B.ink, 0.88), B.emph, 1.45);
      y += 40 + h;
    }
    if (photo && H - y - 140 > 260) PF.card(ctx, photo, 260, y + 40, W - 520, H - y - 150, 0.03, B);
    footer(ctx, B, F, '', d.n, d.total, B.ink, 0.5);
  },
  cta(ctx, d) {
    const { B, F } = d;
    PF.bg(ctx, B); PF.header(ctx, d);
    const tf = fitRich(ctx, tokens(d.title, true), PF.title(F), W - 160, 420, 110, 60, 1.04);
    let y = drawRich(ctx, tf, 80, 330 + tf.size, PF.title(F), B.ink, B.emph, 1.04);
    if (d.text) y = paragraph(ctx, d.text, 80, y + 20, W - 160, 180, F.body, 38, 28, rgba(B.ink, 0.8), 1.4, 500);
    pill(ctx, d.button || 'SALVE ESTE POST', 80, y + 60, `800 30px "${F.body}"`, B.emph, '#FFFFFF', 44, 92);
    // ícone de salvar
    const bx = W - 80 - 90, by = y + 56;
    ctx.fillStyle = B.ink; ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx + 70, by); ctx.lineTo(bx + 70, by + 96); ctx.lineTo(bx + 35, by + 70); ctx.lineTo(bx, by + 96); ctx.closePath(); ctx.fill();
    if (d.photo && H - (y + 200) > 300) PF.card(ctx, d.photo, 220, y + 200, W - 440, H - y - 300, -0.03, B);
  },
};

// ───────────────────────── direção 6: NEON (referência: perfis de design com fundo escuro e brilho)
// Receita: fundo quase preto com brilhos da cor da marca; abas de navegação no topo; texto leve + palavra-chave
// grande e brilhante; cartão translúcido com lista de tópicos (setas); botão de destaque.
const NE = {
  glow(B) { return lum(B.deco) > 0.12 ? B.deco : lum(B.emph) > 0.12 ? B.emph : '#C084FC'; },
  bg(ctx, B) {
    const base = '#0D0B10'; ctx.fillStyle = base; ctx.fillRect(0, 0, W, H);
    const c = NE.glow(B);
    for (const [x, y, r, a] of [[W * 0.85, H * 0.15, 620, 0.5], [W * 0.05, H * 0.95, 560, 0.35]]) {
      const g = ctx.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, rgba(c, a)); g.addColorStop(1, rgba(c, 0));
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    }
    grain(ctx, 0.1);
  },
  tabs(ctx, d) {
    const labels = [d.eyebrow || 'Conteúdo', 'Dicas', (d.name || '').split(' ')[0] || 'Perfil'].map((t) => t.slice(0, 16));
    ctx.font = `500 22px "${d.F.body}"`;
    const ws = labels.map((t) => ctx.measureText(t).width + 56); const total = ws.reduce((a, b) => a + b, 0) + 24;
    let x = (W - total) / 2;
    labels.forEach((t, i) => {
      ctx.strokeStyle = 'rgba(255,255,255,.45)'; ctx.lineWidth = 2; ctx.beginPath(); rounded(ctx, x, 70, ws[i], 50, 25); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.fillText(t, x + 28, 103); x += ws[i] + 12;
    });
  },
  // palavras normais finas; destaque grande na fonte de título e com brilho
  rich(ctx, d, text, x, y, maxW, maxH, from) {
    const fam = d.F.title, body = d.F.body, c = NE.glow(d.B);
    const font = (s, em) => (em ? `${SERIFS.includes(fam) ? 'italic 600' : 800} ${Math.round(s * 1.25)}px "${fam}"` : `300 ${s}px "${body}"`);
    const f = fitRich(ctx, tokens(text, true), font, maxW, maxH, from, 44, 1.18);
    ctx.save(); ctx.shadowColor = rgba(c, 0.8); ctx.shadowBlur = 0;
    const out = drawRich(ctx, f, x, y + f.size, (s, em) => { ctx.shadowBlur = em ? 30 : 0; return font(s, em); }, '#FFFFFF', c, 1.18);
    ctx.restore();
    return out;
  },
  cover(ctx, d) {
    const { B, F, photo } = d;
    NE.bg(ctx, B); NE.tabs(ctx, d);
    if (photo) {
      clipped(ctx, () => rounded(ctx, W - 80 - 430, 200, 430, 560, 40), () => cover(ctx, photo, W - 510, 200, 430, 560, 0.25));
      ctx.strokeStyle = rgba(NE.glow(B), 0.9); ctx.lineWidth = 3; ctx.shadowColor = NE.glow(B); ctx.shadowBlur = 30; ctx.beginPath(); rounded(ctx, W - 80 - 430, 200, 430, 560, 40); ctx.stroke(); ctx.shadowBlur = 0;
    }
    PO.sparkle(ctx, 110, photo ? 830 : 330, 22, NE.glow(B));
    let y = NE.rich(ctx, d, d.hook, 80, photo ? 860 : 380, W - 160, photo ? 280 : 560, 78);
    if (d.sub) {
      ctx.font = `500 26px "${F.body}"`; const f = fitRich(ctx, tokens(d.sub), (s2) => `500 ${s2}px "${F.body}"`, W - 260, 80, 28, 22, 1.3);
      const lw = Math.max(...f.lines.map((l) => l.reduce((a, t) => a + t.width, 0) + (l.length - 1) * f.space)); const h = f.lines.length * f.size * 1.3 + 36;
      ctx.strokeStyle = 'rgba(255,255,255,.6)'; ctx.lineWidth = 2; ctx.beginPath(); rounded(ctx, 80, y + 30, lw + 60, h, h / 2); ctx.stroke();
      drawRich(ctx, f, 110, y + 30 + 18 + f.size * 0.85, (s2) => `500 ${s2}px "${F.body}"`, '#FFFFFF', '#FFFFFF', 1.3);
    }
    if (d.total > 1) { ctx.fillStyle = 'rgba(255,255,255,.7)'; ctx.font = `600 22px "${F.body}"`; spaced(ctx, 'ARRASTA  →', W - 80, H - 70, 5, 'right'); }
  },
  inner(ctx, d) {
    const { B, F } = d;
    NE.bg(ctx, B); NE.tabs(ctx, d);
    const x = 80, w = W - 160, top = 220;
    // conteúdo numa camada à parte: o cartão fica do tamanho do texto e centralizado na altura
    const layer = document.createElement('canvas'); layer.width = W; layer.height = H;
    const lc = layer.getContext('2d'); lc.textBaseline = 'alphabetic';
    lc.fillStyle = NE.glow(B); lc.font = `600 24px "${F.body}"`; spaced(lc, `PASSO ${String(d.n).padStart(2, '0')}`, x + 60, top + 80, 6);
    let y = NE.rich(lc, d, d.title, x + 60, top + 110, w - 120, 300, 70);
    const items = String(d.text || '').split(/(?<=[.!?])\s+/).map((t) => t.trim()).filter(Boolean).slice(0, 5);
    y += 40;
    for (const it of items) {
      if (y > H - 340) break;
      lc.fillStyle = NE.glow(B); lc.font = `800 40px "${F.body}"`; lc.fillText('›', x + 60, y + 38);
      y = paragraph(lc, it, x + 110, y, w - 170, 170, F.body, 38, 28, 'rgba(255,255,255,.9)', 1.38, 400) + 30;
    }
    const ch = y - top + 40;
    const off = Math.max(0, (H - 150 - top - ch) / 2);
    ctx.fillStyle = 'rgba(255,255,255,.05)'; ctx.strokeStyle = rgba(NE.glow(B), 0.55); ctx.lineWidth = 2;
    ctx.beginPath(); rounded(ctx, x, top + off, w, ch, 36); ctx.fill(); ctx.stroke();
    ctx.drawImage(layer, 0, off);
    footer(ctx, B, F, d.handle, d.n, d.total, '#FFFFFF', 0.6);
  },
  cta(ctx, d) {
    const { B, F, photo } = d;
    NE.bg(ctx, B); NE.tabs(ctx, d);
    if (photo) {
      clipped(ctx, () => circle(ctx, W / 2, 400, 170), () => cover(ctx, photo, W / 2 - 170, 230, 340, 340, 0.25));
      ctx.strokeStyle = NE.glow(B); ctx.lineWidth = 5; ctx.shadowColor = NE.glow(B); ctx.shadowBlur = 40; ctx.beginPath(); circle(ctx, W / 2, 400, 182); ctx.stroke(); ctx.shadowBlur = 0;
    }
    let y = NE.rich(ctx, d, d.title, 80, photo ? 640 : 380, W - 160, 300, 80);
    if (d.text) y = paragraph(ctx, d.text, 80, y + 10, W - 160, 150, F.body, 34, 26, 'rgba(255,255,255,.8)', 1.4, 300);
    const label = d.button || 'Salve este post';
    ctx.font = `700 30px "${F.body}"`; const bw = ctx.measureText(label).width + 100;
    const g = ctx.createLinearGradient(80, 0, 80 + bw, 0); g.addColorStop(0, NE.glow(B)); g.addColorStop(1, rgba(NE.glow(B), 0.6));
    ctx.fillStyle = g; ctx.shadowColor = NE.glow(B); ctx.shadowBlur = 30; ctx.beginPath(); rounded(ctx, 80, y + 50, bw, 90, 45); ctx.fill(); ctx.shadowBlur = 0;
    ctx.fillStyle = '#0D0B10'; ctx.fillText(label, 130, y + 50 + 56);
    footer(ctx, B, F, d.handle, d.n, d.total, '#FFFFFF', 0.6);
  },
};

// ───────────────────────── direção 7: MANCHETE (referência: capas de foto com tipografia mista)
// Receita: foto real em tela cheia com tom quente e textura; selo do perfil no topo; manchete em caixa alta
// condensada e enorme, com as palavras de ligação (que, de, pra, o…) pequenas, em itálico, "penduradas" na linha.
const MA = {
  big: (s) => `400 ${s}px "Anton"`,
  small: (F, s) => `italic ${SERIFS.includes(F.title) ? 500 : 400} ${Math.round(s * 0.34)}px "${SERIFS.includes(F.title) ? F.title : 'Playfair Display'}"`,
  isSmall: (t) => !t.em && t.w.replace(/[^\p{L}]/gu, '').length <= 3,
  layout(ctx, F, toks, size, maxW) {
    const lines = [[]]; let w = 0; const gap = size * 0.12;
    for (const t of toks.filter((x) => !x.br)) {
      const sm = MA.isSmall(t); ctx.font = sm ? MA.small(F, size) : MA.big(size);
      const word = sm ? t.w.toLowerCase() : t.w.toUpperCase();
      const tw = ctx.measureText(word).width;
      const cur = lines[lines.length - 1];
      if (cur.length && w + gap + tw > maxW) { lines.push([{ ...t, word, sm, width: tw }]); w = tw; } else { cur.push({ ...t, word, sm, width: tw }); w += (cur.length > 1 ? gap : 0) + tw; }
    }
    return { lines, gap };
  },
  draw(ctx, d, text, cy, maxH, from = 200) {
    const { F, B } = d; const toks = tokens(text);
    let size = from, L;
    for (; size >= 70; size -= 4) { L = MA.layout(ctx, F, toks, size, W - 160); if (L.lines.length * size * 0.92 <= maxH) break; }
    const lh = size * 0.92; let y = cy - (L.lines.length * lh) / 2 + size * 0.8;
    const accent = lum(B.deco) > 0.2 ? B.deco : '#F4E6D0';
    ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.35)'; ctx.shadowBlur = 24; ctx.shadowOffsetY = 6;
    for (const line of L.lines) {
      const lw = line.reduce((a, t) => a + t.width, 0) + (line.length - 1) * L.gap;
      let x = W / 2 - lw / 2;
      for (const t of line) {
        ctx.font = t.sm ? MA.small(F, size) : MA.big(size);
        ctx.fillStyle = t.sm ? accent : t.em ? accent : '#FFFFFF';
        ctx.fillText(t.word, x, t.sm ? y - size * 0.48 : y);
        x += t.width + L.gap;
      }
      y += lh;
    }
    ctx.restore();
    return y - lh + size * 0.2;
  },
  base(ctx, d, dark = 0.25) {
    const { B, photo } = d;
    ctx.fillStyle = B.deep; ctx.fillRect(0, 0, W, H);
    if (photo) cover(ctx, photo, 0, 0, W, H, 0.3);
    ctx.fillStyle = rgba('#3A2A1A', 0.18); ctx.fillRect(0, 0, W, H); // tom quente de filme
    ctx.fillStyle = `rgba(0,0,0,${dark})`; ctx.fillRect(0, 0, W, H);
    const v = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.8);
    v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,.5)'); ctx.fillStyle = v; ctx.fillRect(0, 0, W, H);
    // selo do perfil
    const { F } = d; const av = d.avatar;
    ctx.font = `700 22px "${F.body}"`; const nm = (d.name || d.handle || '').slice(0, 28); const tw = ctx.measureText(nm).width;
    ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.beginPath(); rounded(ctx, 60, 60, tw + (av ? 100 : 50), 64, 32); ctx.fill();
    if (av) clipped(ctx, () => circle(ctx, 92, 92, 24), () => cover(ctx, av, 68, 68, 48, 48, 0.2));
    ctx.fillStyle = '#FFFFFF'; ctx.fillText(nm, av ? 128 : 85, 100);
  },
  cover(ctx, d) {
    MA.base(ctx, d, 0.2);
    let y = MA.draw(ctx, d, d.hook, H * 0.52, 640, 210);
    if (d.sub) { ctx.globalAlpha = 0.92; const f = fitRich(ctx, tokens(d.sub), (s2) => `500 ${s2}px "${d.F.body}"`, W - 260, 110, 32, 24, 1.3); drawRich(ctx, f, W / 2, y + 50 + f.size, (s2) => `500 ${s2}px "${d.F.body}"`, '#FFFFFF', '#FFFFFF', 1.3, { align: 'center' }); ctx.globalAlpha = 1; }
    if (d.total > 1) { ctx.fillStyle = '#FFFFFF'; ctx.globalAlpha = 0.85; ctx.font = `700 22px "${d.F.body}"`; spaced(ctx, 'ARRASTA  →', W / 2, H - 70, 6, 'center'); ctx.globalAlpha = 1; }
    grain(ctx, 0.14);
  },
  inner(ctx, d) {
    MA.base(ctx, d, d.photo ? 0.5 : 0);
    let y = MA.draw(ctx, d, d.title, H * 0.4, 460, 170);
    if (d.text) { const f = fitRich(ctx, tokens(d.text), (s2, em) => `${em ? 700 : 400} ${s2}px "${d.F.body}"`, W - 220, H - y - 230, 40, 28, 1.42); drawRich(ctx, f, W / 2, y + 60 + f.size, (s2, em) => `${em ? 700 : 400} ${s2}px "${d.F.body}"`, '#FFFFFF', '#FFFFFF', 1.42, { align: 'center' }); }
    footer(ctx, d.B, d.F, '', d.n, d.total, '#FFFFFF', 0.7);
    grain(ctx, 0.14);
  },
  cta(ctx, d) {
    MA.base(ctx, d, 0.45);
    let y = MA.draw(ctx, d, d.title, H * 0.42, 480, 180);
    if (d.text) { const f = fitRich(ctx, tokens(d.text), (s2) => `400 ${s2}px "${d.F.body}"`, W - 240, 160, 38, 28, 1.4); y = drawRich(ctx, f, W / 2, y + 50 + f.size, (s2) => `400 ${s2}px "${d.F.body}"`, '#FFFFFF', '#FFFFFF', 1.4, { align: 'center' }); }
    const label = d.button || 'SALVE ESTE POST'; ctx.font = `400 38px "Anton"`; const bw = ctx.measureText(label).width + 80;
    pill(ctx, label, W / 2 - bw / 2, y + 40, `400 38px "Anton"`, '#FFFFFF', '#1D1A1A', 40, 86);
    grain(ctx, 0.14);
  },
};

// ───────────────────────── direção 8: POST DE REDE (referência: carrosséis em formato de post do X/Twitter)
// Receita: fundo branco limpo; cabeçalho de perfil (foto, nome, selo azul, @ e "···"); texto corrido grande,
// como uma postagem; imagem com cantos arredondados; rodapé discreto. Lê como conversa, gera muito compartilhamento.
const TW = {
  font: (F) => (SERIFS.includes(F.body) ? 'Inter' : F.body === 'Montserrat' ? 'Inter' : F.body),
  head(ctx, d, y = 120) {
    const { B } = d; const f = TW.font(d.F); const av = d.avatar; const r = 46, x = 90;
    if (av) clipped(ctx, () => circle(ctx, x + r, y, r), () => cover(ctx, av, x, y - r, r * 2, r * 2, 0.2));
    else { ctx.fillStyle = B.emph; ctx.beginPath(); circle(ctx, x + r, y, r); ctx.fill(); }
    ctx.fillStyle = '#0F1419'; ctx.font = `700 34px "${f}"`; const nm = d.name || ''; ctx.fillText(nm, x + r * 2 + 24, y - 6);
    const nw = ctx.measureText(nm).width; const bx = x + r * 2 + 24 + nw + 22;
    ctx.fillStyle = '#1D9BF0'; ctx.beginPath(); circle(ctx, bx, y - 17, 15); ctx.fill();
    ctx.strokeStyle = '#FFFFFF'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(bx - 7, y - 17); ctx.lineTo(bx - 1, y - 11); ctx.lineTo(bx + 8, y - 23); ctx.stroke();
    ctx.fillStyle = '#536471'; ctx.font = `400 28px "${f}"`; ctx.fillText(d.handle || '', x + r * 2 + 24, y + 32);
    ctx.fillStyle = '#536471'; for (let i = 0; i < 3; i++) { ctx.beginPath(); circle(ctx, W - 110 + i * 16, y - 4, 4); ctx.fill(); }
  },
  body(ctx, d, text, y, maxH, from = 52) {
    const f = TW.font(d.F);
    const fit = fitRich(ctx, tokens(text), (s2, em) => `${em ? 700 : 400} ${s2}px "${f}"`, W - 180, maxH, from, 34, 1.36);
    return drawRich(ctx, fit, 90, y + fit.size, (s2, em) => `${em ? 700 : 400} ${s2}px "${f}"`, '#0F1419', '#0F1419', 1.36);
  },
  photo(ctx, photo, y, h) {
    if (!photo || h < 220) return y;
    clipped(ctx, () => rounded(ctx, 90, y, W - 180, h, 32), () => cover(ctx, photo, 90, y, W - 180, h, 0.3));
    ctx.strokeStyle = '#CFD9DE'; ctx.lineWidth = 2; ctx.beginPath(); rounded(ctx, 90, y, W - 180, h, 32); ctx.stroke();
    return y + h;
  },
  base(ctx, d) { ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, W, H); TW.head(ctx, d); },
  foot(ctx, d) { ctx.fillStyle = '#536471'; ctx.font = `400 24px "${TW.font(d.F)}"`; if (d.total > 1) spaced(ctx, `${d.n}/${d.total}`, W - 90, H - 70, 2, 'right'); },
  cover(ctx, d) {
    TW.base(ctx, d);
    let y = TW.body(ctx, d, `${plain(d.hook)}${d.sub ? `\n\n${d.sub}` : ''}`, 210, d.photo ? 420 : 900, 64);
    TW.photo(ctx, d.photo, y + 40, H - y - 180);
    TW.foot(ctx, d);
  },
  inner(ctx, d) {
    TW.base(ctx, d);
    let y = TW.body(ctx, d, `*${plain(d.title)}*${d.text ? `\n\n${d.text}` : ''}`, 210, d.photo ? 520 : 900, 52);
    TW.photo(ctx, d.photo, y + 40, H - y - 180);
    TW.foot(ctx, d);
  },
  cta(ctx, d) {
    TW.base(ctx, d);
    let y = TW.body(ctx, d, `*${plain(d.title)}*${d.text ? `\n\n${d.text}` : ''}`, 210, 600, 60);
    const f = TW.font(d.F);
    pill(ctx, d.button ? d.button : 'Salvar este post', 90, y + 60, `700 30px "${f}"`, '#0F1419', '#FFFFFF', 44, 88);
    TW.photo(ctx, d.photo, y + 200, H - y - 340);
    TW.foot(ctx, d);
  },
};

// ───────────────────────── direção 9: CAPA DE REVISTA (referência: capas editoriais de perfis de criação)
// Receita: retrato em tela cheia; logotipo empilhado no canto; chamada curta minúscula; manchete sem serifa
// pesadíssima e apertada, centralizada, com a palavra-chave em itálico serifado; botão pequeno "veja →" colorido.
const CR = {
  sans: (F) => (['Inter', 'Montserrat', 'Poppins', 'DM Sans'].includes(F.body) ? F.body : 'Inter'),
  serif: (F) => (SERIFS.includes(F.title) ? F.title : 'Playfair Display'),
  font: (F) => (s, em) => (em ? `italic 500 ${s}px "${CR.serif(F)}"` : `800 ${s}px "${CR.sans(F)}"`),
  base(ctx, d, dim = 0) {
    const { B, photo, F } = d;
    ctx.fillStyle = B.deep; ctx.fillRect(0, 0, W, H);
    if (photo) cover(ctx, photo, 0, 0, W, H, 0.25);
    const g = ctx.createLinearGradient(0, H * 0.35, 0, H); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, `rgba(0,0,0,${0.55 + dim})`);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    if (dim) { ctx.fillStyle = `rgba(0,0,0,${dim})`; ctx.fillRect(0, 0, W, H); }
    ctx.fillStyle = '#FFFFFF'; ctx.font = `800 20px "${CR.sans(F)}"`;
    const words = (d.name || '').toUpperCase().split(/\s+/).slice(0, 3);
    words.forEach((w, i) => ctx.fillText(w, 70, 90 + i * 22));
  },
  head(ctx, d, text, kicker, cy, maxH, from) {
    const { F } = d;
    ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.3)'; ctx.shadowBlur = 30;
    const tf = fitRich(ctx, tokens(text, true), CR.font(F), W - 140, maxH, from, 64, 0.92);
    const h = tf.lines.length * tf.size * 0.92 + (kicker ? 60 : 0);
    let y = cy - h / 2;
    if (kicker) { ctx.fillStyle = '#FFFFFF'; ctx.font = `700 44px "${CR.sans(F)}"`; const kw = ctx.measureText(kicker).width; ctx.fillText(kicker, W / 2 - kw / 2, y + 40); y += 60; }
    if ('letterSpacing' in ctx) ctx.letterSpacing = `${-Math.round(tf.size * 0.03)}px`;
    y = drawRich(ctx, tf, W / 2, y + tf.size * 0.82, CR.font(F), '#FFFFFF', '#FFFFFF', 0.92, { align: 'center' });
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
    ctx.restore();
    return y;
  },
  button(ctx, d, label, y) {
    const { B, F } = d; const font = `800 28px "${CR.sans(F)}"`; ctx.font = font;
    const w = ctx.measureText(label).width + 72;
    pill(ctx, label, W / 2 - w / 2, y, font, contrast(B.deco, '#FFFFFF') >= 2 ? B.deco : B.emph, '#FFFFFF', 36, 68);
  },
  cover(ctx, d) {
    CR.base(ctx, d);
    const y = CR.head(ctx, d, d.hook, d.eyebrow ? d.eyebrow.toLowerCase() : '', H * 0.66, 420, 170);
    if (d.total > 1) CR.button(ctx, d, 'ARRASTA PRO LADO →', Math.min(y + 40, H - 120));
    grain(ctx, 0.06);
  },
  inner(ctx, d) {
    CR.base(ctx, d, 0.35);
    let y = CR.head(ctx, d, d.title, String(d.n).padStart(2, '0'), H * 0.45, 380, 130);
    if (d.text) { const f = fitRich(ctx, tokens(d.text), (s2, em) => `${em ? 700 : 500} ${s2}px "${CR.sans(d.F)}"`, W - 200, H - y - 170, 46, 34, 1.38); drawRich(ctx, f, W / 2, y + 44 + f.size, (s2, em) => `${em ? 700 : 500} ${s2}px "${CR.sans(d.F)}"`, '#FFFFFF', '#FFFFFF', 1.38, { align: 'center' }); }
    footer(ctx, d.B, { body: CR.sans(d.F) }, '', d.n, d.total, '#FFFFFF', 0.7);
    grain(ctx, 0.06);
  },
  cta(ctx, d) {
    CR.base(ctx, d, 0.3);
    let y = CR.head(ctx, d, d.title, '', H * 0.5, 420, 150);
    if (d.text) { const f = fitRich(ctx, tokens(d.text), (s2) => `500 ${s2}px "${CR.sans(d.F)}"`, W - 220, 200, 42, 32, 1.38); y = drawRich(ctx, f, W / 2, y + 40 + f.size, (s2) => `500 ${s2}px "${CR.sans(d.F)}"`, '#FFFFFF', '#FFFFFF', 1.38, { align: 'center' }); }
    CR.button(ctx, d, (d.button || 'SALVE ESTE POST').toUpperCase() + ' →', y + 50);
    grain(ctx, 0.06);
  },
};

// ───────────────────────── direção 10: NOTÍCIA (referência: posts em formato de manchete de portal)
// Receita: foto ocupando o topo; bloco de cor sólida embaixo com manchete sem serifa forte, alinhada à esquerda;
// linha fina e microtexto de rodapé. Parece notícia: ótimo para novidade, curiosidade e opinião.
const NO = {
  sans: (F) => (['Inter', 'Montserrat', 'Poppins', 'DM Sans', 'Lato'].includes(F.body) ? F.body : 'Inter'),
  block(B, n) { return n % 2 ? '#FFFFFF' : B.paper; },
  layout(ctx, d, text, sub, n, ratio = 0.56) {
    const { B, F, photo } = d; const sans = NO.sans(F);
    const ph = photo ? Math.round(H * ratio) : 0;
    ctx.fillStyle = photo ? NO.block(B, n) : B.deep; ctx.fillRect(0, 0, W, H);
    if (photo) cover(ctx, photo, 0, 0, W, ph, 0.3);
    const ink = photo ? B.ink : '#FFFFFF';
    const top = photo ? ph + 70 : 260;
    const tf = fitRich(ctx, tokens(text), (s2, em) => `800 ${s2}px "${sans}"`, W - 160, photo ? H - top - 230 : 600, photo ? 76 : 110, 46, 1.08);
    let y = drawRich(ctx, tf, 80, top + tf.size * 0.85, (s2) => `800 ${s2}px "${sans}"`, ink, photo ? B.emph : (lum(B.deco) > 0.2 ? B.deco : '#FFFFFF'), 1.08);
    if (sub) y = paragraph(ctx, sub, 80, y + 6, W - 160, H - y - 190, sans, 34, 26, rgba(ink, 0.75), 1.38, 400);
    ctx.fillStyle = rgba(ink, 0.35); ctx.fillRect(80, H - 120, W - 160, 2);
    ctx.fillStyle = rgba(ink, 0.7); ctx.font = `600 20px "${sans}"`;
    if (d.handle) spaced(ctx, d.handle.toUpperCase(), 80, H - 76, 3);
    if (d.total > 1) spaced(ctx, d.n === 1 ? 'ARRASTA →' : `${d.n}/${d.total}`, W - 80, H - 76, 3, 'right');
  },
  cover(ctx, d) { NO.layout(ctx, d, d.hook, d.sub, 1); },
  inner(ctx, d) { NO.layout(ctx, d, d.title, d.text, d.n, 0.5); },
  cta(ctx, d) {
    NO.layout(ctx, { ...d, photo: null }, d.title, d.text, 0);
    pill(ctx, d.button || 'Salve este post', 80, H - 280, `800 30px "${NO.sans(d.F)}"`, '#FFFFFF', d.B.deep, 40, 84);
  },
};

// ───────────────────────── direção 11: LISTA (referência: carrosséis de dicas com grade e etiquetas)
// Receita: barra fina no topo (tema | etiqueta | nº); área de imagem com etiquetas flutuantes; título em caixa
// alta com a segunda parte na cor de destaque; texto curto; rodapé de autor com barra de progresso.
const LI = {
  sans: NO.sans,
  top(ctx, d, label) {
    const { B } = d; const sans = LI.sans(d.F);
    ctx.fillStyle = rgba(B.ink, 0.55); ctx.font = `600 20px "${sans}"`;
    spaced(ctx, (d.eyebrow || 'DICAS').toUpperCase(), 70, 74, 3);
    ctx.fillStyle = B.emph; spaced(ctx, label.toUpperCase(), W / 2, 74, 3, 'center');
    ctx.fillStyle = rgba(B.ink, 0.55); spaced(ctx, `${String(d.n).padStart(2, '0')}/${String(d.total).padStart(2, '0')}`, W - 70, 74, 3, 'right');
    ctx.fillStyle = rgba(B.ink, 0.15); ctx.fillRect(70, 96, W - 140, 2);
  },
  chip(ctx, d, text, x, y, dark) {
    const sans = LI.sans(d.F); const font = `700 24px "${sans}"`; ctx.font = font;
    const w = ctx.measureText(text).width + 44;
    ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.25)'; ctx.shadowBlur = 24; ctx.shadowOffsetY = 8;
    ctx.fillStyle = dark ? '#16181D' : '#FFFFFF'; ctx.beginPath(); rounded(ctx, x, y, w, 58, 14); ctx.fill(); ctx.restore();
    ctx.fillStyle = d.B.emph; ctx.beginPath(); circle(ctx, x + 22, y + 29, 6); ctx.fill();
    ctx.fillStyle = dark ? '#FFFFFF' : '#16181D'; ctx.font = font; ctx.fillText(text, x + 36, y + 37);
  },
  title(ctx, d, text, y, maxH, from) {
    const { B } = d; const sans = LI.sans(d.F);
    const t = String(plain(text)).toUpperCase(); const words = t.split(/\s+/);
    const cut = Math.max(1, Math.ceil(words.length / 2));
    const marked = text.includes('*') ? text.toUpperCase() : `${words.slice(0, cut).join(' ')} *${words.slice(cut).join(' ')}*`;
    const tf = fitRich(ctx, tokens(marked), (s2) => `900 ${s2}px "${sans}"`, W - 140, maxH, from, 44, 1.0);
    return drawRich(ctx, tf, 70, y + tf.size * 0.85, (s2) => `900 ${s2}px "${sans}"`, B.ink, B.emph, 1.0);
  },
  author(ctx, d) {
    const { B } = d; const sans = LI.sans(d.F);
    if (d.avatar) clipped(ctx, () => circle(ctx, 100, H - 92, 30), () => cover(ctx, d.avatar, 70, H - 122, 60, 60, 0.2));
    ctx.fillStyle = B.ink; ctx.font = `700 24px "${sans}"`; ctx.fillText(d.name || '', d.avatar ? 146 : 70, H - 98);
    ctx.fillStyle = rgba(B.ink, 0.55); ctx.font = `400 20px "${sans}"`; ctx.fillText(d.handle || '', d.avatar ? 146 : 70, H - 70);
    const bw = 300, bx = W - 70 - bw; ctx.fillStyle = rgba(B.ink, 0.12); ctx.fillRect(bx, H - 92, bw, 6);
    ctx.fillStyle = B.emph; ctx.fillRect(bx, H - 92, bw * (d.n / d.total), 6);
  },
  page(ctx, d, text, sub, label, chips) {
    const { B, photo } = d;
    ctx.fillStyle = B.paper; ctx.fillRect(0, 0, W, H);
    LI.top(ctx, d, label);
    let y = 130;
    if (photo) {
      const ih = 560;
      clipped(ctx, () => rounded(ctx, 70, y, W - 140, ih, 28), () => cover(ctx, photo, 70, y, W - 140, ih, 0.3));
      chips.slice(0, 2).forEach((c, i) => LI.chip(ctx, d, c, i ? W - 70 - 40 - Math.min(380, c.length * 15 + 44) : 110, i ? y + ih - 100 : y + 40, i === 1));
      y += ih + 60;
    } else y += 120;
    y = LI.title(ctx, d, text, y, photo ? 260 : 520, photo ? 84 : 120);
    if (sub) paragraph(ctx, sub, 70, y + 14, W - 140, H - y - 200, LI.sans(d.F), 34, 26, rgba(B.ink, 0.75), 1.38, 400);
    LI.author(ctx, d);
  },
  cover(ctx, d) { LI.page(ctx, d, d.hook, d.sub, 'GUIA', [d.eyebrow || 'Salve para depois', 'Arrasta →']); },
  inner(ctx, d) { LI.page(ctx, d, d.title, d.text, `ITEM ${String(d.n - 1).padStart(2, '0')}`, [`#${d.n - 1}`, plain(d.title).split(/\s+/).slice(0, 3).join(' ')]); },
  cta(ctx, d) {
    LI.page(ctx, { ...d, photo: null }, d.title, d.text, 'FIM', []);
    pill(ctx, d.button || 'SALVE ESTE POST', 70, H - 330, `900 30px "${LI.sans(d.F)}"`, d.B.emph, '#FFFFFF', 44, 88);
  },
};

// ───────────────────────── direção 12: ANTES E DEPOIS (referência: comparativos "isso X aquilo")
// Receita: duas fotos lado a lado (ou em cima/embaixo) com etiquetas ANTES / DEPOIS; um "X" ou seta grande no
// encontro; faixa com o título. Se o título tiver " x " (ex.: "Café x Água"), as etiquetas viram as duas palavras.
const AD = {
  sans: NO.sans,
  labels(title) {
    const m = plain(title).split(/\s+x\s+|\s+vs\.?\s+/i);
    return m.length === 2 ? [m[0], m[1]] : ['ANTES', 'DEPOIS'];
  },
  tag(ctx, d, text, x, y, light) {
    const font = `900 30px "${AD.sans(d.F)}"`; ctx.font = font; const w = ctx.measureText(text.toUpperCase()).width + 50;
    ctx.fillStyle = light ? '#FFFFFF' : d.B.emph; ctx.beginPath(); rounded(ctx, x, y, w, 64, 32); ctx.fill();
    ctx.fillStyle = light ? '#16181D' : '#FFFFFF'; ctx.fillText(text.toUpperCase(), x + 25, y + 43);
  },
  split(ctx, d, a, b, labels) {
    const { B } = d; const half = W / 2;
    ctx.fillStyle = B.deep; ctx.fillRect(0, 0, W, H);
    if (a) cover(ctx, a, 0, 0, half, H, 0.3);
    if (b) { ctx.save(); ctx.beginPath(); ctx.rect(half, 0, half, H); ctx.clip(); cover(ctx, b, half, 0, half, H, 0.3); ctx.restore(); }
    if (!b && a) { ctx.save(); ctx.beginPath(); ctx.rect(half, 0, half, H); ctx.clip(); ctx.filter = 'grayscale(1) brightness(.7)'; cover(ctx, a, 0, 0, W, H, 0.3); ctx.filter = 'none'; ctx.restore(); }
    ctx.fillStyle = '#FFFFFF'; ctx.fillRect(half - 3, 0, 6, H);
    const g = ctx.createLinearGradient(0, H * 0.55, 0, H); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.8)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    AD.tag(ctx, d, labels[0], 50, 70, true); ctx.font = `900 30px "${AD.sans(d.F)}"`;
    const w2 = ctx.measureText(labels[1].toUpperCase()).width + 50; AD.tag(ctx, d, labels[1], W - 50 - w2, 70, false);
    // "X" no encontro
    ctx.fillStyle = B.emph; ctx.beginPath(); circle(ctx, half, H * 0.42, 62); ctx.fill();
    ctx.strokeStyle = '#FFFFFF'; ctx.lineWidth = 5; ctx.stroke();
    ctx.fillStyle = '#FFFFFF'; ctx.font = `900 60px "${AD.sans(d.F)}"`; const xw = ctx.measureText('X').width; ctx.fillText('X', half - xw / 2, H * 0.42 + 22);
  },
  caption(ctx, d, text, sub) {
    const sans = AD.sans(d.F);
    const tf = fitRich(ctx, tokens(text.replace(/\s+x\s+/i, ' *x* ')), (s2, em) => `${em ? 'italic 600' : 900} ${s2}px "${em ? 'Playfair Display' : sans}"`, W - 140, 260, 96, 52, 1.0);
    const subH = sub ? 120 : 0; let y = H - 110 - subH - tf.lines.length * tf.size;
    y = drawRich(ctx, tf, W / 2, y + tf.size * 0.85, (s2, em) => `${em ? 'italic 600' : 900} ${s2}px "${em ? 'Playfair Display' : sans}"`, '#FFFFFF', lum(d.B.deco) > 0.2 ? d.B.deco : '#FFFFFF', 1.0, { align: 'center' });
    if (sub) { const f = fitRich(ctx, tokens(sub), (s2) => `500 ${s2}px "${sans}"`, W - 200, 100, 32, 26, 1.3); drawRich(ctx, f, W / 2, y + 20 + f.size, (s2) => `500 ${s2}px "${sans}"`, '#FFFFFF', '#FFFFFF', 1.3, { align: 'center' }); }
  },
  cover(ctx, d) { AD.split(ctx, d, d.photos[0], d.photos[1], AD.labels(d.hook)); AD.caption(ctx, d, plain(d.hook), d.sub); },
  inner(ctx, d) { const i = (d.n - 1) * 2; AD.split(ctx, d, d.photos[i % (d.photos.length || 1)], d.photos[(i + 1) % (d.photos.length || 1)] || null, AD.labels(d.title)); AD.caption(ctx, d, plain(d.title), d.text); footer(ctx, d.B, d.F, '', d.n, d.total, '#FFFFFF', 0.7); },
  cta(ctx, d) { ED.cta(ctx, d); },
};

// ───────────────────────── direção 13: COLAGEM (referência: perfis com estética de recorte e adesivos)
// Receita: fundo de cor quente sólida; uma palavra gigante quebrada em sílabas que sangra da página; foto em
// polaroide inclinada; selo estrelado com texto; etiquetas inclinadas; textura de papel.
const CO = {
  font: (s) => `900 ${s}px "Montserrat"`,
  bg(ctx, B, alt) { ctx.fillStyle = alt ? B.paper : (contrast(B.deco, '#FFFFFF') >= 2 ? B.deco : B.emph); ctx.fillRect(0, 0, W, H); grain(ctx, 0.12); },
  star(ctx, cx, cy, r, color, text, F) {
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(0.2); ctx.fillStyle = color; ctx.beginPath();
    for (let i = 0; i < 24; i++) { const a = (i / 24) * Math.PI * 2; const rr = i % 2 ? r * 0.78 : r; ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#FFFFFF'; ctx.font = `900 ${Math.round(r * 0.3)}px "Montserrat"`;
    const lines = String(text).toUpperCase().split(' ').slice(0, 3);
    lines.forEach((l, i) => { const w = ctx.measureText(l).width; ctx.fillText(l, -w / 2, (i - (lines.length - 1) / 2) * r * 0.32 + r * 0.1); });
    ctx.restore();
  },
  polaroid(ctx, photo, x, y, w, h, rot) {
    ctx.save(); ctx.translate(x + w / 2, y + h / 2); ctx.rotate(rot);
    ctx.shadowColor = 'rgba(0,0,0,.3)'; ctx.shadowBlur = 40; ctx.shadowOffsetY = 18;
    ctx.fillStyle = '#FBF8F2'; ctx.fillRect(-w / 2, -h / 2, w, h + 70); ctx.shadowColor = 'transparent';
    if (photo) clipped(ctx, () => ctx.rect(-w / 2 + 22, -h / 2 + 22, w - 44, h - 30), () => cover(ctx, photo, -w / 2 + 22, -h / 2 + 22, w - 44, h - 30, 0.25));
    ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.fillRect(-60, -h / 2 - 22, 120, 44); // fita
    ctx.restore();
  },
  label(ctx, text, x, y, rot, bg, fg) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.font = `800 34px "Montserrat"`; const w = ctx.measureText(text).width + 40;
    ctx.fillStyle = bg; ctx.fillRect(0, -44, w, 60); ctx.fillStyle = fg; ctx.fillText(text, 20, 0); ctx.restore();
  },
  giant(ctx, word, ink) { // palavra gigante em sílabas, sangrando para fora
    const w = plain(word).toUpperCase().replace(/[^\p{L}\p{N}]/gu, '');
    const parts = w.length > 6 ? [w.slice(0, Math.ceil(w.length / 2)), w.slice(Math.ceil(w.length / 2))] : [w];
    ctx.fillStyle = ink; ctx.font = CO.font(330);
    parts.forEach((p, i) => ctx.fillText(p, -20, 330 + i * 300));
  },
  cover(ctx, d) {
    const { B } = d; CO.bg(ctx, B);
    const words = tokens(d.hook, true).filter((t) => !t.br);
    const key = (words.find((t) => t.em) || words[words.length - 1] || { w: '' }).w;
    CO.giant(ctx, key, B.paper);
    CO.polaroid(ctx, d.photo, W - 520, 520, 420, 520, 0.06);
    const rest = words.map((t) => t.w).join(' ');
    CO.label(ctx, rest.length > 32 ? `${rest.slice(0, 30)}…` : rest, 70, H - 200, -0.04, '#16181D', '#FFFFFF');
    if (d.sub) CO.label(ctx, plain(d.sub).slice(0, 34), 110, H - 110, 0.03, B.paper, B.ink);
    CO.star(ctx, 230, 840, 120, B.ink, d.eyebrow || 'novo', d.F);
  },
  inner(ctx, d) {
    const { B } = d; CO.bg(ctx, B, true);
    ctx.fillStyle = B.emph; ctx.font = CO.font(260); ctx.fillText(String(d.n - 1).padStart(2, '0'), W - 400, 300);
    const tf = fitRich(ctx, tokens(d.title), (s2) => CO.font(s2), W - 160, 330, 96, 52, 1.0);
    let y = drawRich(ctx, tf, 80, 400 + tf.size, (s2) => CO.font(s2), B.ink, B.emph, 1.0, { mark: rgba(B.deco, 0.4) });
    if (d.text) y = paragraph(ctx, d.text, 80, y + 30, W - 160, d.photo ? 230 : 500, 'Montserrat', 38, 28, rgba(B.ink, 0.85), 1.4, 500);
    if (d.photo) CO.polaroid(ctx, d.photo, W - 470, Math.max(y + 40, 860), 360, 330, -0.05);
    footer(ctx, B, { body: 'Montserrat' }, d.handle, d.n, d.total, B.ink, 0.6);
  },
  cta(ctx, d) {
    const { B } = d; CO.bg(ctx, B);
    const tf = fitRich(ctx, tokens(d.title, true), (s2) => CO.font(s2), W - 160, 480, 120, 60, 1.0);
    let y = drawRich(ctx, tf, 80, 300 + tf.size, (s2) => CO.font(s2), B.paper, '#16181D', 1.0);
    if (d.text) y = paragraph(ctx, d.text, 80, y + 30, W - 160, 200, 'Montserrat', 38, 28, B.paper, 1.4, 600);
    CO.label(ctx, (d.button || 'salva esse post!'), 80, y + 120, -0.05, '#16181D', '#FFFFFF');
    CO.star(ctx, W - 230, H - 260, 140, B.ink, 'até o próximo', d.F);
  },
};

// ───────────────────────── direção 14: MOSAICO (referência: capas com grade de fotos e manchete no meio)
// Receita: grade de 6 fotos do cliente (2×3) com respiro fino; faixa de cor no centro com manchete
// contrastando sem serifa + itálico serifado. Ótimo para portfólio, bastidores e "resultados do mês".
const MO = {
  grid(ctx, d, photos) {
    const { B } = d; ctx.fillStyle = B.deep; ctx.fillRect(0, 0, W, H);
    const g = 8, cw = (W - g) / 2, ch = (H - 2 * g) / 3;
    for (let i = 0; i < 6; i++) { const p = photos.length ? photos[i % photos.length] : null; const x = (i % 2) * (cw + g), y = Math.floor(i / 2) * (ch + g); if (p) cover(ctx, p, x, y, cw, ch, 0.3); else { ctx.fillStyle = rgba(B.paper, 0.1 + (i % 3) * 0.05); ctx.fillRect(x, y, cw, ch); } }
    ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fillRect(0, 0, W, H);
  },
  band(ctx, d, text, sub) {
    const { B, F } = d; const sans = 'Montserrat'; const serif = SERIFS.includes(F.title) ? F.title : 'Playfair Display';
    const font = (s2, em) => (em ? `italic 500 ${Math.round(s2 * 1.05)}px "${serif}"` : `900 ${s2}px "${sans}"`);
    const tf = fitRich(ctx, tokens(String(text).toUpperCase().replace(/\*([^*]+)\*/g, (m, x) => `*${x.toLowerCase()}*`), true), font, W - 200, 360, 104, 56, 1.0);
    const bh = tf.lines.length * tf.size * 1.0 + (sub ? 100 : 0) + 110; const by = (H - bh) / 2;
    ctx.fillStyle = rgba(B.deep, 0.92); ctx.fillRect(0, by, W, bh);
    ctx.fillStyle = lum(B.deco) > 0.2 ? B.deco : B.paper; ctx.fillRect(0, by, W, 6); ctx.fillRect(0, by + bh - 6, W, 6);
    let y = drawRich(ctx, tf, W / 2, by + 55 + tf.size * 0.85, font, B.paper, lum(B.deco) > 0.2 ? B.deco : B.paper, 1.0, { align: 'center' });
    if (sub) { const f = fitRich(ctx, tokens(sub), (s2) => `500 ${s2}px "${sans}"`, W - 240, 80, 32, 24, 1.3); drawRich(ctx, f, W / 2, y + 16 + f.size, (s2) => `500 ${s2}px "${sans}"`, rgba(B.paper, 0.85), B.paper, 1.3, { align: 'center' }); }
  },
  cover(ctx, d) { MO.grid(ctx, d, d.photos); MO.band(ctx, d, d.hook, d.sub); },
  inner(ctx, d) { ED.inner(ctx, d); },
  cta(ctx, d) { MO.grid(ctx, d, d.photos.slice().reverse()); MO.band(ctx, d, d.title, d.text); pill(ctx, d.button || 'SALVE ESTE POST', W / 2 - 200, H - 190, `800 30px "Montserrat"`, d.B.paper, d.B.deep, 50, 86); },
};

export const STYLES = { editorial: ['Editorial', ED], revista: ['Revista', RV], impacto: ['Impacto', IM], poster: ['Pôster', PO], perfil: ['Perfil', PF], neon: ['Neon', NE], manchete: ['Manchete', MA], tweet: ['Post de rede', TW], capa: ['Capa de revista', CR], noticia: ['Notícia', NO], lista: ['Lista', LI], antesdepois: ['Antes e depois', AD], colagem: ['Colagem', CO], mosaico: ['Mosaico', MO] };

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
  await loadFonts([...new Set([F.title, F.body, R === IM ? IM.font(F) : null, [PO, MA].includes(R) ? 'Anton' : null, R === MA && !SERIFS.includes(F.title) ? 'Playfair Display' : null, [TW, CR, NO, LI, AD].includes(R) ? 'Inter' : null, [CO, MO].includes(R) ? 'Montserrat' : null, [AD, MO].includes(R) ? 'Playfair Display' : null, R === CR && !SERIFS.includes(F.title) ? 'Playfair Display' : null, R === PO ? (F.script || 'Yellowtail') : null])]);
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
    const d = { B, F, handle, name: client?.name || '', avatar: photos[0] || null, photos, total, n: i + 1, eyebrow, button: piece.button || '' };
    if (p.kind === 'cover') R.cover(ctx, { ...d, hook: p.hook, sub: p.sub, photo: pick(0) });
    else if (p.kind === 'cta') R.cta(ctx, { ...d, title: p.title, text: p.text, photo: pick(0) });
    else R.inner(ctx, { ...d, title: p.title, text: p.text, photo: photos.length > 1 ? pick(k++) : (style === 'editorial' && i % 2 ? null : pick(0)) });
    const blob = await toBlob(cv);
    out.push({ blob, url: URL.createObjectURL(blob) });
  }
  return { arts: out, brand: B, fonts: F };
}
