// Fotos e vídeos dos posts com acesso privado.
// O banco continua guardando o endereço "público" (…/object/public/posts/caminho). Quando a agência liga
// "Fotos privadas" em Ajustes, o bucket deixa de ser público e todo endereço que sai da API (e o que vai
// para a Meta publicar) é trocado por um link temporário assinado. O que chega do navegador volta ao formato
// original antes de ser salvo, para nunca gravar um link que expira.
import { storage } from './db.js';
import { getState } from './appstate.js';

const BUCKET = 'posts';
const TTL = 7 * 86400; // 7 dias, em segundos
const REUSE_MS = 24 * 3600e3; // reaproveita o mesmo link enquanto faltar mais de 1 dia para vencer (o navegador guarda em cache)
const base = () => String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

let flag = { value: false, at: 0 };
export function resetMediaCache() { flag = { value: false, at: 0 }; cache.clear(); }
export async function mediaPrivate() {
  if (Date.now() - flag.at < 60e3) return flag.value;
  flag = { value: Boolean(await getState('media_private', false)), at: Date.now() };
  return flag.value;
}
export function setMediaPrivateCache(v) { flag = { value: Boolean(v), at: Date.now() }; }

const cache = new Map(); // caminho → { url, until }

function collect(v, found) {
  if (typeof v === 'string') { if (v.includes(`/object/public/${BUCKET}/`)) found.add(v); }
  else if (Array.isArray(v)) v.forEach((x) => collect(x, found));
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => collect(x, found));
}
function replace(v, map) {
  if (typeof v === 'string') return map.get(v) ?? v;
  if (Array.isArray(v)) return v.map((x) => replace(x, map));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, replace(x, map)]));
  return v;
}

export const hasPublicMedia = (data) => data != null && typeof data === 'object' && JSON.stringify(data).includes(`/object/public/${BUCKET}/`);

// Troca os endereços públicos das fotos por links assinados. Sem "Fotos privadas" ligado, devolve igual.
export async function signMedia(data) {
  if (!hasPublicMedia(data) || !(await mediaPrivate())) return data;
  const prefix = `${base()}/storage/v1/object/public/${BUCKET}/`;
  const found = new Set(); collect(data, found);
  const urls = [...found].filter((u) => u.startsWith(prefix));
  const pathOf = (u) => decodeURIComponent(u.slice(prefix.length).split('?')[0]);
  const todo = [...new Set(urls.map(pathOf).filter((p) => !(cache.get(p)?.until > Date.now() + REUSE_MS)))];
  for (let i = 0; i < todo.length; i += 100) {
    const signed = await storage.signMany(todo.slice(i, i + 100), TTL);
    for (const [p, url] of Object.entries(signed)) cache.set(p, { url, until: Date.now() + TTL * 1000 });
  }
  const map = new Map(urls.map((u) => [u, cache.get(pathOf(u))?.url]).filter(([, s]) => s));
  return replace(data, map);
}

// O inverso: link assinado (ou com token) → endereço público guardado no banco.
export function unsignMedia(data) {
  if (data == null || typeof data !== 'object' || !JSON.stringify(data).includes(`/object/sign/${BUCKET}/`)) return data;
  const re = new RegExp(`^${esc(base())}/storage/v1/object/sign/${BUCKET}/([^?#]+)(\\?.*)?$`);
  const fix = (v) => {
    if (typeof v === 'string') { const m = v.match(re); return m ? `${base()}/storage/v1/object/public/${BUCKET}/${m[1]}` : v; }
    if (Array.isArray(v)) return v.map(fix);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fix(x)]));
    return v;
  };
  return fix(data);
}
