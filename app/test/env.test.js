// Configuração mínima: só ADMIN_PASSWORD + Supabase; o resto o app descobre ou deriva.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appUrl, sessionSecret, cronSecret, missingEnv, igReady } from '../lib/env.js';

test('funciona só com as 3 variáveis obrigatórias', () => {
  const saved = { ...process.env };
  for (const k of ['APP_URL', 'SESSION_SECRET', 'CRON_SECRET', 'IG_APP_ID', 'IG_APP_SECRET', 'VERCEL_URL']) delete process.env[k];
  Object.assign(process.env, { ADMIN_PASSWORD: 'x', SUPABASE_URL: 'https://a.supabase.co', SUPABASE_SERVICE_KEY: 'chave', VERCEL_PROJECT_PRODUCTION_URL: 'pauta-marcus.vercel.app' });
  try {
    assert.deepEqual(missingEnv(), []);
    assert.equal(appUrl(), 'https://pauta-marcus.vercel.app');
    assert.equal(sessionSecret(), sessionSecret(), 'estável entre chamadas');
    assert.notEqual(sessionSecret(), cronSecret(), 'segredos diferentes para cada uso');
    assert.ok(cronSecret().length >= 40);
    assert.equal(igReady(), false);
    process.env.IG_APP_ID = 'pendente'; process.env.IG_APP_SECRET = 'pendente';
    assert.equal(igReady(), false, '"pendente" conta como não configurado');
    process.env.IG_APP_ID = '123'; process.env.IG_APP_SECRET = 'abc';
    assert.equal(igReady(), true);
    process.env.APP_URL = 'https://posts.minhaagencia.com.br/';
    assert.equal(appUrl(), 'https://posts.minhaagencia.com.br', 'domínio próprio tem prioridade');
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
});

test('detecta chave pública do Supabase no lugar da secreta', async () => {
  const { supabaseKeyProblem } = await import('../lib/env.js');
  const jwt = (role) => `x.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.y`;
  const saved = process.env.SUPABASE_SERVICE_KEY;
  try {
    process.env.SUPABASE_SERVICE_KEY = 'sb_publishable_abc'; assert.match(supabaseKeyProblem(), /PÚBLICA/);
    process.env.SUPABASE_SERVICE_KEY = jwt('anon'); assert.match(supabaseKeyProblem(), /PÚBLICA/);
    process.env.SUPABASE_SERVICE_KEY = jwt('service_role'); assert.equal(supabaseKeyProblem(), null);
    process.env.SUPABASE_SERVICE_KEY = 'sb_secret_abc'; assert.equal(supabaseKeyProblem(), null);
  } finally { process.env.SUPABASE_SERVICE_KEY = saved; }
});
