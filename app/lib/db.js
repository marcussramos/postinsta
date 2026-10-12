// Acesso ao Supabase pela API REST (PostgREST + Storage), usando a chave service_role.
// Só roda no servidor: a chave nunca vai para o navegador.
import { env, supabaseKeyProblem } from './env.js';
import { HttpError } from './http.js';

const BUCKET = 'posts';

function headers(extra = {}) {
  const key = env('SUPABASE_SERVICE_KEY').trim();
  const problem = supabaseKeyProblem();
  if (problem) throw Object.assign(new Error(problem), { status: 503, expose: true });
  // Chaves novas (sb_secret_...) vão só no cabeçalho apikey; as antigas (JWT) também no Authorization.
  return key.startsWith('sb_') ? { apikey: key, ...extra } : { apikey: key, Authorization: `Bearer ${key}`, ...extra };
}

async function call(path, init = {}) {
  const res = await fetch(`${env('SUPABASE_URL')}${path}`, { ...init, headers: headers(init.headers) });
  const text = await res.text();
  const body = text ? safeJson(text) : null;
  if (!res.ok) {
    const msg = body?.message || body?.error || text || res.statusText;
    throw new HttpError(res.status >= 500 ? 502 : 400, `Banco de dados: ${msg}`);
  }
  return body;
}

function safeJson(t) { try { return JSON.parse(t); } catch { return t; } }

// Monta filtros do PostgREST: { id: 'eq.123', status: 'in.(a,b)' }
function qs(params) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) sp.append(k, v);
  return sp.toString();
}

export const db = {
  select: (table, params = {}) => call(`/rest/v1/${table}?${qs(params)}`),

  one: async (table, params) => (await call(`/rest/v1/${table}?${qs({ ...params, limit: 1 })}`))[0] || null,

  insert: async (table, row) => (await call(`/rest/v1/${table}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify(row),
  }))[0],

  // Atualiza só as linhas que batem com o filtro. Devolve as linhas alteradas
  // (lista vazia = nada bateu, útil para travas do tipo "só se ainda estiver aprovado").
  update: (table, filter, patch) => call(`/rest/v1/${table}?${qs(filter)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify(patch),
  }),

  // Insere ou atualiza pela chave primária.
  upsert: (table, row) => call(`/rest/v1/${table}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(row),
  }),

  remove: (table, filter) => call(`/rest/v1/${table}?${qs(filter)}`, {
    method: 'DELETE',
    headers: { Prefer: 'return=representation' },
  }),
};

export const storage = {
  async upload(path, buffer, contentType = 'image/jpeg') {
    await call(`/storage/v1/object/${BUCKET}/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': contentType, 'x-upsert': 'false', 'Cache-Control': 'max-age=31536000' },
      body: buffer,
    });
    return { path, url: `${env('SUPABASE_URL')}/storage/v1/object/public/${BUCKET}/${path}` };
  },
  async remove(path) {
    if (!path) return;
    try { await call(`/storage/v1/object/${BUCKET}/${path}`, { method: 'DELETE' }); }
    catch (e) { console.warn('Não foi possível apagar a imagem', path, e.message); }
  },
};
