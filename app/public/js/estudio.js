// MC DIGITAL — Estúdio: briefing → 3 ganchos → texto de cada lâmina / roteiro → CTA e legenda → Canva → Fluxo.
// A IA escreve no tom do cliente (lib/pasta/studio.js); a arte continua no Canva. Daqui sai:
//   • "Copiar para o Canva": texto lâmina a lâmina
//   • "CSV para o Canva": uma linha com os campos (gancho, titulo_2, texto_2… cta) para o "Criar em massa" do Canva
//   • "Criar post no Fluxo": post com pauta, legenda, hashtags e o texto das lâminas nas notas (Reels: roteiro anexado)
import { h, api, toast, copyText, zonedToISO } from '/shared.js';
import { TEMPLATES, DURATIONS, checkScript } from '/roteiro.js';
import { S, can, clientById, render } from './core.js';
import { openPost, upsert } from './post.js';
import { renderPiece, brandFonts, loadPhotos } from './artes.js';
import { MODELOS, MODELO_PADRAO } from './modelos.js';

const FORMATS = { CAROUSEL: 'Carrossel', IMAGE: 'Estático', REELS: 'Reels' };
const GOALS = { educar: 'Educar', engajar: 'Engajar', autoridade: 'Autoridade', vender: 'Vender' };
const st = () => (S.studio ||= { client: '', format: 'CAROUSEL', goal: 'educar', topic: '', slides: 7, duration: 30, template: 'livre', extra: '', busy: false, res: null, hook: 0 });

function seg(label, options, value, onPick) {
  return h('div', { class: 'field' }, h('span', { class: 'label' }, label),
    h('div', { class: 'seg studio-seg', role: 'group', 'aria-label': label }, ...Object.entries(options).map(([k, v]) =>
      h('button', { type: 'button', class: 'seg-btn', 'aria-pressed': String(value === k), onclick: () => onPick(k) }, v))));
}

function viewStudio() {
  const s = st();
  const clients = S.clients;
  if ((!s.client || !clients.some((c) => c.id === s.client)) && clients.length) s.client = clients[0].id;
  const head = h('div', { class: 'page-head' }, h('div', {},
    h('div', { class: 'eyebrow' }, 'Produção'),
    h('h1', {}, 'Estúdio ', h('i', {}, 'de criação'))));
  return [head, h('div', { class: 'studio' }, briefCard(s, clients), resultArea(s))];
}

function briefCard(s, clients) {
  const sel = h('select', { id: 'st-client', onchange: (e) => { s.client = e.target.value; } },
    ...clients.map((c) => h('option', { value: c.id, selected: c.id === s.client }, c.name)));
  const topic = h('textarea', { id: 'st-topic', rows: 3, placeholder: 'Ex.: 5 sinais de que está na hora de clarear os dentes', oninput: (e) => { s.topic = e.target.value; } }, s.topic);
  const extra = h('textarea', { id: 'st-extra', rows: 2, placeholder: 'Opcional: público, oferta, referência, o que evitar…', oninput: (e) => { s.extra = e.target.value; } }, s.extra);
  const rerender = () => render();
  const byFormat = s.format === 'CAROUSEL'
    ? h('div', { class: 'field' }, h('label', { for: 'st-slides' }, 'Lâminas'),
      h('input', { id: 'st-slides', type: 'number', min: 3, max: 20, value: s.slides, oninput: (e) => { s.slides = Number(e.target.value) || 7; } }))
    : s.format === 'REELS'
      ? h('div', { class: 'studio-2col' },
        h('div', { class: 'field' }, h('label', { for: 'st-dur' }, 'Duração'),
          h('select', { id: 'st-dur', onchange: (e) => { s.duration = Number(e.target.value); } }, ...DURATIONS.map((d) => h('option', { value: d, selected: d === s.duration }, `${d}s`)))),
        h('div', { class: 'field' }, h('label', { for: 'st-tpl' }, 'Modelo'),
          h('select', { id: 'st-tpl', onchange: (e) => { s.template = e.target.value; } }, ...Object.entries(TEMPLATES).map(([k, t]) => h('option', { value: k, selected: k === s.template }, t.label)))))
      : null;
  const go = h('button', { class: 'btn primary studio-go', type: 'button', disabled: s.busy || !can('ia'), onclick: generate }, s.busy ? 'Escrevendo…' : s.res ? '✨ Gerar de novo' : '✨ Criar com IA');
  return h('section', { class: 'card studio-brief' },
    h('h3', {}, 'Briefing'),
    h('div', { class: 'field' }, h('label', { for: 'st-client' }, 'Cliente'), sel, voiceHint(clients.find((c) => c.id === s.client))),
    seg('Formato', FORMATS, s.format, (k) => { s.format = k; rerender(); }),
    seg('Objetivo', GOALS, s.goal, (k) => { s.goal = k; rerender(); }),
    h('div', { class: 'field' }, h('label', { for: 'st-topic' }, 'Tema'), topic),
    byFormat,
    h('div', { class: 'field' }, h('label', { for: 'st-extra' }, 'Pedido extra'), extra),
    go,
    can('ia') ? h('p', { class: 'hint muted', style: 'margin:0;font-size:12.5px' }, 'A IA usa o tom de voz, o kit da marca, as regras do nicho e os ganchos que já funcionaram para este cliente.')
      : h('p', { class: 'hint muted', style: 'margin:0' }, 'Sem permissão para usar a IA.'));
}

// sem tom de voz cadastrado a IA não tem de onde tirar o jeito do cliente falar
function voiceHint(c) {
  if (!c || String(c.brand_voice || '').trim()) return null;
  return h('p', { class: 'studio-voice-warn' }, 'Este cliente não tem tom de voz cadastrado. A IA vai se basear só nas legendas já aprovadas dele. ',
    h('a', { href: `#pasta/${c.id}` }, 'Cadastrar o tom na pasta →'));
}

async function generate() {
  const s = st();
  if ((s.topic || '').trim().length < 3) return toast('Escreva o tema da peça.', true);
  s.busy = true; render();
  try {
    s.res = await api('/api/pasta?r=studio', { method: 'POST', body: { client_id: s.client, format: s.format, goal: s.goal, topic: s.topic, slides: s.slides, duration: s.duration, template: s.template, extra: s.extra } });
    s.res.client_id = s.client; s.hook = 0; s.arts = null; if (s.artPhotosClient !== s.client) { s.artPhotos = null; s.artPhotosClient = null; }
  } catch (e) { toast(e.message, true); }
  s.busy = false; render();
}

// ───────────────────────── resultado
function resultArea(s) {
  if (s.busy && !s.res) return h('section', { class: 'card studio-empty' }, h('p', { class: 'muted' }, 'Escrevendo os ganchos e o texto… leva uns 20 segundos.'));
  if (!s.res) return h('section', { class: 'card studio-empty' },
    h('div', { class: 'studio-empty-in' },
      h('span', { class: 'script', style: 'font-size:34px' }, 'Do briefing ao Canva'),
      h('ol', { class: 'assist-steps' },
        h('li', {}, 'Escolha cliente, formato e objetivo e escreva o tema.'),
        h('li', {}, 'A IA traz 3 ganchos, o texto de cada lâmina (ou o roteiro), o CTA e a legenda.'),
        h('li', {}, 'Ajuste aqui, copie ou baixe o CSV para o seu modelo no Canva.'),
        h('li', {}, 'Crie o post no Fluxo: legenda pronta, só falta subir a arte.'))));
  const p = s.res.piece;
  const c = clientById(s.res.client_id || s.client) || {};
  const hookBox = h('div', { class: 'studio-hooks' }, ...p.hooks.map((t, i) => h('button', {
    type: 'button', class: 'studio-hook', 'aria-pressed': String(s.hook === i),
    onclick: () => { s.hook = i; render(); },
  }, h('span', { class: 'studio-hook-n' }, ['Curiosidade', 'Dor', 'Direto'][i] || `Opção ${i + 1}`), h('span', {}, t))));
  const hookEdit = h('input', { class: 'studio-hook-edit', value: p.hooks[s.hook] || '', 'aria-label': 'Editar gancho escolhido', oninput: (e) => { p.hooks[s.hook] = e.target.value; document.querySelectorAll('.studio-cover-hook, .studio-hook[aria-pressed="true"] span:last-child').forEach((el) => { el.textContent = e.target.value; }); } });

  const v = s.res.voice;
  const parts = [
    v && !v.described && !v.samples ? h('p', { class: 'studio-voice-warn' }, '⚠️ Este texto saiu no tom genérico: o cliente não tem tom de voz cadastrado nem legendas aprovadas no app. Cadastre o tom (ou cole 2 ou 3 legendas que ele gosta no "Pedido extra") e gere de novo.')
      : v ? h('p', { class: 'studio-ok' }, `✓ Escrito no tom ${v.described ? 'cadastrado' : ''}${v.described && v.samples ? ' e ' : ''}${v.samples ? `de ${v.samples} legenda${v.samples > 1 ? 's' : ''} já aprovada${v.samples > 1 ? 's' : ''}` : ''} do cliente.`) : null,
    h('section', { class: 'card' }, h('div', { class: 'home-card-head' }, h('h3', {}, '1 · Gancho'), h('span', { class: 'muted' }, 'A frase que para o scroll')), hookBox, hookEdit),
  ];
  if (p.format === 'CAROUSEL') parts.push(slidesCard(s, p));
  if (p.format === 'IMAGE') parts.push(imageCard(p));
  if (p.format === 'REELS') parts.push(reelsCard(p));
  if (p.format !== 'REELS') parts.push(artsCard(s, p, c));
  parts.push(captionCard(p), checksCard(s, c), actionsCard(s, p, c));
  return h('div', { class: 'studio-result' }, ...parts.filter(Boolean));
}

function slidesCard(s, p) {
  const n = p.slides.length;
  return h('section', { class: 'card' },
    h('div', { class: 'home-card-head' }, h('h3', {}, `2 · Lâminas · ${n}`), h('button', { class: 'btn ghost sm', type: 'button', onclick: () => copyText(canvaText(s, p), 'Texto das lâminas copiado.') }, 'Copiar todas')),
    h('div', { class: 'studio-slides' }, ...p.slides.map((sl, i) => {
      const cover = i === 0;
      const last = i === n - 1;
      return h('div', { class: `studio-slide${cover ? ' cover' : ''}` },
        h('div', { class: 'studio-slide-n' }, h('b', {}, String(i + 1).padStart(2, '0')), h('span', {}, cover ? 'Capa' : last ? 'CTA' : 'Lâmina'),
          h('button', { class: 'btn ghost sm', type: 'button', 'aria-label': `Copiar lâmina ${i + 1}`, onclick: () => copyText([cover ? p.hooks[s.hook] : sl.title, sl.text].filter(Boolean).join('\n'), `Lâmina ${i + 1} copiada.`) }, 'Copiar')),
        cover ? h('p', { class: 'studio-cover-hook' }, p.hooks[s.hook] || '')
          : h('input', { value: sl.title, placeholder: 'Título', 'aria-label': `Título da lâmina ${i + 1}`, oninput: (e) => { sl.title = e.target.value; } }),
        h('textarea', { rows: cover ? 1 : 3, placeholder: cover ? 'Apoio da capa (opcional)' : 'Texto', 'aria-label': `Texto da lâmina ${i + 1}`, oninput: (e) => { sl.text = e.target.value; } }, sl.text));
    })));
}

function imageCard(p) {
  return h('section', { class: 'card' }, h('h3', {}, '2 · Arte'),
    h('div', { class: 'field' }, h('label', {}, 'Headline'), h('input', { value: p.headline || '', oninput: (e) => { p.headline = e.target.value; } })),
    h('div', { class: 'field' }, h('label', {}, 'Apoio'), h('textarea', { rows: 2, oninput: (e) => { p.support = e.target.value; } }, p.support || '')));
}

function reelsCard(p) {
  const total = (p.scenes || []).reduce((a, x) => a + (Number(x.secs) || 0), 0);
  return h('section', { class: 'card' },
    h('div', { class: 'home-card-head' }, h('h3', {}, `2 · Roteiro · ${total}s`), h('span', { class: 'muted' }, p.audio ? `Trilha: ${p.audio}` : '')),
    p.cover ? h('p', { style: 'margin:0' }, h('b', {}, 'Capa: '), p.cover) : null,
    h('ol', { class: 'studio-scenes' }, ...(p.scenes || []).map((sc, i) => h('li', {},
      h('div', { class: 'studio-scene-top' }, h('b', {}, `Cena ${i + 1}`), h('span', { class: 'muted' }, `${sc.secs || 0}s`)),
      sc.show ? h('p', {}, h('span', { class: 'muted' }, '🎥 '), sc.show) : null,
      i === 0 && !sc.say ? h('p', {}, h('span', { class: 'muted' }, '🗣 '), h('i', {}, 'gancho escolhido')) : sc.say ? h('p', {}, h('span', { class: 'muted' }, '🗣 '), sc.say) : null,
      sc.text ? h('p', {}, h('span', { class: 'muted' }, '🔤 '), sc.text) : null))));
}

function captionCard(p) {
  const tags = h('input', { value: (p.hashtags || []).join(' '), 'aria-label': 'Hashtags', oninput: (e) => { p.hashtags = e.target.value.split(/\s+/).filter(Boolean); } });
  return h('section', { class: 'card' }, h('h3', {}, '3 · CTA e legenda'),
    h('div', { class: 'field' }, h('label', {}, 'CTA'), h('input', { value: p.cta || '', oninput: (e) => { p.cta = e.target.value; } })),
    h('div', { class: 'field' }, h('label', {}, 'Legenda'), h('textarea', { rows: 8, oninput: (e) => { p.caption = e.target.value; } }, p.caption || '')),
    h('div', { class: 'field' }, h('label', {}, 'Hashtags'), tags));
}

function checksCard(s, c) {
  const p = s.res.piece;
  const checks = checkScript({ hooks: p.hooks, cta: p.cta, caption: p.caption, cover: p.cover || p.headline || '', scenes: p.scenes || (p.slides || []).map((x) => ({ text: x.title, say: x.text })) }, c.brand_kit?.niche);
  const items = [...(s.res.warnings || []).map((w) => ['atencao', 'A IA adaptou', w]), ...checks.map((x) => [x.level, x.title, x.detail])];
  if (!items.length) return h('p', { class: 'studio-ok' }, '✓ Nenhum ponto de atenção nas regras do nicho.');
  return h('section', { class: 'card studio-checks' }, h('h3', {}, 'Revisão'),
    ...items.map(([lv, t, d]) => h('div', { class: `studio-check ${lv}` }, h('b', {}, t), d ? h('span', {}, d) : null)));
}

// ───────────────────────── saídas: Canva e Fluxo
function canvaText(s, p) {
  return canvaText0(s, p).replace(/\*/g, '');
}
function canvaText0(s, p) {
  const hook = p.hooks[s.hook] || '';
  if (p.format === 'CAROUSEL') return p.slides.map((sl, i) => `LÂMINA ${i + 1}${i === 0 ? ' (CAPA)' : i === p.slides.length - 1 ? ' (CTA)' : ''}\n${[i === 0 ? hook : sl.title, sl.text].filter(Boolean).join('\n')}`).join('\n\n');
  if (p.format === 'IMAGE') return [p.headline || hook, p.support].filter(Boolean).join('\n');
  return [`GANCHO: ${hook}`, p.cover ? `CAPA: ${p.cover}` : '', ...(p.scenes || []).map((sc, i) => `CENA ${i + 1} (${sc.secs || 0}s)\n🎥 ${sc.show || ''}\n🗣 ${i === 0 && !sc.say ? hook : sc.say || ''}${sc.text ? `\n🔤 ${sc.text}` : ''}`), `CTA: ${p.cta || ''}`].filter(Boolean).join('\n\n');
}

// uma linha com os campos nomeados como no modelo do Canva ("Criar em massa" e, depois, o preenchimento automático)
function canvaFields(s, p) {
  const hook = p.hooks[s.hook] || '';
  if (p.format === 'CAROUSEL') {
    const f = { gancho: hook, apoio_capa: p.slides[0]?.text || '' };
    p.slides.slice(1, -1).forEach((sl, i) => { f[`titulo_${i + 2}`] = sl.title; f[`texto_${i + 2}`] = sl.text; });
    const last = p.slides.length > 1 ? p.slides[p.slides.length - 1] : null;
    f.cta_titulo = last?.title || p.cta || ''; f.cta_texto = last?.text || '';
    return f;
  }
  if (p.format === 'IMAGE') return { gancho: p.headline || hook, apoio: p.support || '', cta: p.cta || '' };
  return { capa: p.cover || hook, gancho: hook, cta: p.cta || '' };
}
function downloadCsv(s, p, c) {
  const f = Object.fromEntries(Object.entries(canvaFields(s, p)).map(([k, v]) => [k, String(v ?? '').replace(/\*/g, '')]));
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = `﻿${Object.keys(f).map(q).join(',')}\n${Object.values(f).map(q).join(',')}\n`;
  const a = h('a', { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })), download: `${(c.name || 'cliente').replace(/\s+/g, '-').toLowerCase()}-${p.format.toLowerCase()}.csv` });
  document.body.append(a); a.click(); a.remove();
  toast('CSV baixado. No Canva: Apps → Criar em massa → Enviar CSV.');
}

function actionsCard(s, p, c) {
  const date = h('input', { type: 'date', value: s.date || '', 'aria-label': 'Data do post', oninput: (e) => { s.date = e.target.value; } });
  const time = h('input', { type: 'time', value: s.time || '19:00', 'aria-label': 'Hora do post', oninput: (e) => { s.time = e.target.value; } });
  const create = h('button', { class: 'btn primary', type: 'button', disabled: !can('conteudo'), onclick: async () => {
    create.disabled = true;
    try { await createPost(s, p, c); } catch (e) { toast(e.message, true); }
    create.disabled = false;
  } }, s.arts?.length && p.format !== 'REELS' ? `Criar post no Fluxo com as ${s.arts.length} arte${s.arts.length > 1 ? 's' : ''}` : 'Criar post no Fluxo');
  return h('section', { class: 'card studio-actions' }, h('h3', {}, 'Levar para o Fluxo'),
    h('div', { class: 'studio-when' }, h('span', { class: 'label' }, 'Data (opcional)'), date, time),
    create,
    h('details', { class: 'studio-canva' }, h('summary', {}, 'Prefere montar no seu modelo do Canva?'),
    h('div', { class: 'actions' },
      h('button', { class: 'btn', type: 'button', onclick: () => copyText(canvaText(s, p), 'Texto copiado. Cole no seu modelo do Canva.') }, '📋 Copiar para o Canva'),
      h('button', { class: 'btn', type: 'button', onclick: () => downloadCsv(s, p, c) }, '⬇ CSV para o Canva')),
    h('p', { class: 'hint muted', style: 'margin:0;font-size:12.5px' }, 'O CSV usa os nomes de campo gancho, titulo_2, texto_2… cta_titulo para o "Criar em massa" do Canva.')));
}

// ───────────────────────── artes prontas (gerador no navegador, com as cores e fontes do cliente)
function artsCard(s, p, c) {
  const fonts = brandFonts(c.brand_kit?.fonts);
  const hasKit = Array.isArray(c.brand_kit?.colors) && c.brand_kit.colors.length >= 2;
  if (!MODELOS.some((m) => m.key === s.artStyle)) s.artStyle = MODELO_PADRAO;
  const photoIn = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true, onchange: async (e) => {
    const files = [...(e.target.files || [])].slice(0, 10); if (!files.length) return;
    s.artPhotos = (await Promise.all(files.map(async (f) => { const img = new Image(); img.src = URL.createObjectURL(f); await img.decode().catch(() => null); return img; }))).filter((i) => i.width);
    s.artPhotosFrom = 'escolhidas'; await makeArts(s, p, c);
  } });
  const cards = h('div', { class: 'studio-models' }, ...MODELOS.map((m) => h('button', {
    type: 'button', class: 'studio-model', 'aria-pressed': String(s.artStyle === m.key), title: m.receita,
    onclick: async () => { s.artStyle = m.key; await makeArts(s, p, c); },
  }, h('b', {}, m.nome), h('span', {}, m.serve), h('i', {}, m.origem === 'MC DIGITAL' ? 'MC DIGITAL' : `ref. ${m.origem}`))));
  const eyebrow = h('input', { value: s.artEyebrow ?? '', placeholder: 'Chamada (opcional): "coisas que", "guia", "passo a passo"', 'aria-label': 'Chamada da capa', oninput: (e) => { s.artEyebrow = e.target.value; } });
  const gen = h('button', { class: 'btn primary', type: 'button', disabled: s.artBusy, onclick: () => makeArts(s, p, c) }, s.artBusy ? 'Montando…' : s.arts?.length ? '↻ Refazer' : '🎨 Gerar artes');
  const grid = s.arts?.length ? h('div', { class: 'studio-arts' }, ...s.arts.map((a, i) => h('a', { class: 'studio-art', href: a.url, download: `${(c.name || 'arte').replace(/\s+/g, '-').toLowerCase()}-${i + 1}.jpg`, title: 'Baixar' },
    h('img', { src: a.url, alt: `Lâmina ${i + 1}` }), h('span', {}, `${i + 1} ⬇`)))) : null;
  const nPh = s.artPhotos?.length || 0;
  return h('section', { class: 'card' },
    h('div', { class: 'home-card-head' }, h('h3', {}, '✦ Artes prontas'), h('span', { class: 'muted' }, `${fonts.title}${fonts.body !== fonts.title ? ` + ${fonts.body}` : ''} · ${hasKit ? 'cores da marca' : 'cores MC DIGITAL'}`)),
    !hasKit ? h('p', { class: 'studio-voice-warn' }, 'Este cliente não tem cores cadastradas: as artes saem nas cores da MC DIGITAL. Cadastre as cores e fontes na pasta do cliente → Marca.') : null,
    h('span', { class: 'label' }, 'Modelo'), cards,
    h('div', { class: 'studio-art-tools' }, eyebrow, photoIn,
      h('button', { class: 'btn ghost sm', type: 'button', onclick: () => photoIn.click() }, nPh && s.artPhotosFrom === 'escolhidas' ? `${nPh} foto(s) escolhida(s) · trocar` : 'Escolher fotos'),
      gen),
    s.arts?.length && !nPh ? h('p', { class: 'studio-voice-warn' }, 'Não achei fotos deste cliente no banco de mídia: as artes saíram só com tipografia. Suba fotos dele no banco (pasta → Banco de mídia) ou toque em "Escolher fotos".') : null,
    grid,
    s.arts?.length ? h('div', { class: 'actions' },
      h('button', { class: 'btn sm', type: 'button', onclick: () => s.arts.forEach((a, i) => setTimeout(() => { const l = h('a', { href: a.url, download: `${(c.name || 'arte').replace(/\s+/g, '-').toLowerCase()}-${i + 1}.jpg` }); document.body.append(l); l.click(); l.remove(); }, i * 250)) }, '⬇ Baixar todas'),
      h('span', { class: 'muted', style: 'font-size:12.5px' }, 'Use *asteriscos* no texto para destacar uma palavra. Mudou algo? Toque em Refazer.')) : null);
}

// fotos do cliente: banco de mídia + posts aprovados/publicados (carrega uma vez por cliente)
async function clientPhotos(s, c) {
  if (s.artPhotosFrom === 'escolhidas' && s.artPhotosClient === c.id) return s.artPhotos;
  if (s.artPhotosClient === c.id && s.artPhotos) return s.artPhotos;
  const [bank, posts] = await Promise.all([
    api(`/api/pasta?r=media&client=${c.id}`).catch(() => []),
    api(`/api/posts?client=${c.id}&status=published,approved,pending_approval`).catch(() => []),
  ]);
  const urls = [...new Set([...bank.map((b) => b.url), ...posts.flatMap((x) => [x.image_url, ...(x.media || []).filter((m) => m.kind !== 'video').map((m) => m.url)])].filter(Boolean))];
  s.artPhotos = await loadPhotos(urls, 8); s.artPhotosClient = c.id; s.artPhotosFrom = 'banco';
  return s.artPhotos;
}

async function makeArts(s, p, c) {
  s.artBusy = true; render();
  try {
    if (s.artPhotosClient !== c.id) s.artPhotosFrom = null;
    const photos = await clientPhotos(s, c);
    s.artPhotosClient = c.id;
    const { arts } = await renderPiece({ piece: p, hook: p.hooks[s.hook] || '', client: c, style: s.artStyle, photos, eyebrow: s.artEyebrow || '' });
    (s.arts || []).forEach((a) => URL.revokeObjectURL(a.url));
    s.arts = arts;
  } catch (e) { toast(`Não deu para montar as artes: ${e.message}`, true); }
  s.artBusy = false; render();
}

async function createPost(s, p, c) {
  const hook = p.hooks[s.hook] || '';
  const goal = GOALS[s.res.input?.goal] || '';
  const caption = [String(p.caption || '').replace(/\*/g, ''), (p.hashtags || []).join(' ')].filter(Boolean).join('\n\n').slice(0, 2200);
  const notes = [`🎨 Estúdio · ${FORMATS[p.format]}${goal ? ` · ${goal}` : ''}`, `Gancho: ${hook.replace(/\*/g, '')}`, p.format === 'REELS' ? `CTA: ${p.cta || ''}` : canvaText(s, p)].join('\n\n').slice(0, 4000);
  const body = { client_id: c.id || s.client, title: (s.res.input?.topic || hook).replace(/\*/g, '').slice(0, 140), caption, notes, media_type: p.format, stage: 'draft' };
  if (s.date) body.scheduled_at = zonedToISO(s.date, s.time || '19:00', S.tz);
  if (p.format !== 'REELS' && s.arts?.length) { // sobe as artes geradas e já anexa ao post
    const ups = [];
    for (const [i, a] of s.arts.entries()) {
      toast(`Enviando arte ${i + 1} de ${s.arts.length}…`);
      const r = await api(`/api/upload?client=${body.client_id}`, { method: 'POST', raw: a.blob });
      ups.push({ url: r.image_url, path: r.image_path, kind: 'image' });
    }
    Object.assign(body, { image_url: ups[0].url, image_path: ups[0].path });
    if (p.format === 'CAROUSEL') body.media = ups;
  }
  const row = await api('/api/posts', { method: 'POST', body });
  let final = row;
  if (p.format === 'REELS') {
    try {
      final = await api('/api/pasta?r=script', { method: 'PUT', body: { post_id: row.id, script: { hooks: p.hooks, hook: s.hook, scenes: p.scenes, cta: p.cta, audio: p.audio, cover: p.cover, caption: p.caption, topic: s.res.input?.topic, template: s.res.input?.template, duration: s.res.input?.duration } } });
    } catch (e) { toast(`Post criado, mas o roteiro não foi anexado: ${e.message}`, true); }
  }
  upsert(final, false);
  toast(p.format !== 'REELS' && s.arts?.length ? 'Post criado em produção no Fluxo, com as artes.' : 'Post criado em produção no Fluxo. Suba a arte nele.');
  openPost(final);
}

export { viewStudio, canvaFields, canvaText };
