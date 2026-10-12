// Configuração do app (Vercel → Settings → Environment Variables).
//
// Obrigatórias (só 3):
//   ADMIN_PASSWORD        senha para entrar no painel
//   SUPABASE_URL          https://xxxx.supabase.co
//   SUPABASE_SERVICE_KEY  chave "service_role" do Supabase (secreta!)
// Da Etapa 3 (Meta):
//   IG_APP_ID, IG_APP_SECRET
// Opcionais (o app descobre ou gera sozinho):
//   APP_URL         só se usar domínio próprio; senão vem da Vercel
//   SESSION_SECRET  / CRON_SECRET   derivados da chave do Supabase
//   APP_TIMEZONE    padrão America/Cuiaba
import crypto from 'node:crypto';

const REQUIRED = ['ADMIN_PASSWORD', 'SUPABASE_URL', 'SUPABASE_SERVICE_KEY'];
const IG = ['IG_APP_ID', 'IG_APP_SECRET'];

function configError(message) {
  return Object.assign(new Error(message), { status: 503, expose: true });
}

export function env(name) {
  const v = process.env[name];
  if (!v) throw configError(`Configuração incompleta: falta a variável ${name} na Vercel.`);
  return name.endsWith('_URL') ? v.trim().replace(/\/+$/, '') : v;
}

// Endereço público do app. A Vercel informa sozinha (VERCEL_PROJECT_PRODUCTION_URL).
export function appUrl() {
  if (process.env.APP_URL) return process.env.APP_URL.trim().replace(/\/+$/, '');
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
  if (host) return `https://${host.replace(/^https?:\/\//, '').replace(/\/+$/, '')}`;
  throw configError('Não consegui descobrir o endereço do app. Defina APP_URL na Vercel.');
}

// Segredos derivados da chave do Supabase (HMAC): ninguém precisa inventar e colar textos aleatórios.
const derive = (label) => crypto.createHmac('sha256', env('SUPABASE_SERVICE_KEY')).update(`pauta:${label}`).digest('base64url');
export const sessionSecret = () => process.env.SESSION_SECRET || derive('session');
export const cronSecret = () => process.env.CRON_SECRET || derive('cron');

export const TIMEZONE = () => process.env.APP_TIMEZONE || 'America/Cuiaba';
export const IG_API_VERSION = () => process.env.IG_API_VERSION || 'v25.0';
export const missingEnv = () => REQUIRED.filter((k) => !process.env[k]);
export const igReady = () => IG.every((k) => process.env[k] && process.env[k].trim().toLowerCase() !== 'pendente');
