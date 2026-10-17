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

// Bucket PRIVADO dos documentos dos clientes (contratos, comprovantes, relatórios).
// Nada aqui é público: para abrir, o servidor gera um link temporário só para a agência.
const DOCS = 'docs';
export const docs = {
  async upload(path, buffer, contentType = 'application/octet-stream') {
    await call(`/storage/v1/object/${DOCS}/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': contentType, 'x-upsert': 'false' },
      body: buffer,
    });
    return path;
  },
  async signedUrl(path, { expiresIn = 300, downloadName } = {}) {
    const r = await call(`/storage/v1/object/sign/${DOCS}/${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expiresIn }),
    });
    const rel = r.signedURL || r.signedUrl;
    const url = `${env('SUPABASE_URL')}/storage/v1${rel.startsWith('/') ? '' : '/'}${rel}`;
    return downloadName ? `${url}${url.includes('?') ? '&' : '?'}download=${encodeURIComponent(downloadName)}` : url;
  },
  async remove(path) {
    if (!path) return;
    try { await call(`/storage/v1/object/${DOCS}/${path}`, { method: 'DELETE' }); }
    catch (e) { console.warn('Não foi possível apagar o documento', path, e.message); }
  },
  // Lê um arquivo do cofre (usado para conferir backups); JSON volta já convertido
  async download(path) { return call(`/storage/v1/object/${DOCS}/${path}`); },
  // Arquivo grande (acima do limite da Vercel): o navegador envia direto ao Supabase por este link
  async signUpload(path) {
    const r = await call(`/storage/v1/object/upload/sign/${DOCS}/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const rel = r.url || r.signedURL || r.signedUrl;
    return { path, upload_url: `${env('SUPABASE_URL')}/storage/v1${rel.startsWith('/') ? '' : '/'}${rel}` };
  },
  // Confere se o arquivo chegou e devolve o tamanho (null se não existe)
  async stat(path) {
    const i = path.lastIndexOf('/');
    const r = await call(`/storage/v1/object/list/${DOCS}`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefix: path.slice(0, i), search: path.slice(i + 1), limit: 5 }) });
    const it = (Array.isArray(r) ? r : []).find((x) => x?.name === path.slice(i + 1));
    return it ? { size: Number(it.metadata?.size ?? it.metadata?.contentLength ?? 0) } : null;
  },
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
  // Link para o NAVEGADOR enviar um arquivo grande (vídeo) direto ao Supabase, sem passar pela Vercel (limite de 4,5 MB).
  async signUpload(path) {
    const r = await call(`/storage/v1/object/upload/sign/${BUCKET}/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const rel = r.url || r.signedURL || r.signedUrl;
    return {
      path,
      upload_url: `${env('SUPABASE_URL')}/storage/v1${rel.startsWith('/') ? '' : '/'}${rel}`,
      url: `${env('SUPABASE_URL')}/storage/v1/object/public/${BUCKET}/${path}`,
    };
  },
  async remove(path) {
    if (!path) return;
    try { await call(`/storage/v1/object/${BUCKET}/${path}`, { method: 'DELETE' }); }
    catch (e) { console.warn('Não foi possível apagar a imagem', path, e.message); }
  },
  // Links temporários para vários arquivos de uma vez (usado quando o bucket "posts" está privado).
  async signMany(paths, expiresIn) {
    if (!paths.length) return {};
    const r = await call(`/storage/v1/object/sign/${BUCKET}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expiresIn, paths }) });
    const out = {};
    for (const it of Array.isArray(r) ? r : []) {
      const rel = it?.signedURL || it?.signedUrl;
      if (it?.path && rel && !it.error) out[it.path] = `${env('SUPABASE_URL')}/storage/v1${rel.startsWith('/') ? '' : '/'}${rel}`;
    }
    return out;
  },
  // Liga/desliga o acesso público ao bucket das fotos dos posts.
  async setPublic(isPublic) {
    await call(`/storage/v1/bucket/${BUCKET}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: BUCKET, name: BUCKET, public: Boolean(isPublic) }) });
  },
};
