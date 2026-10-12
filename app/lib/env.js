// Variáveis de ambiente (configuradas no painel da Vercel → Settings → Environment Variables).
const REQUIRED = [
  'APP_URL',               // https://seu-app.vercel.app (sem barra no final)
  'ADMIN_PASSWORD',        // senha para entrar no painel
  'SESSION_SECRET',        // texto aleatório longo (assina o login)
  'CRON_SECRET',           // texto aleatório longo (protege o publicador)
  'SUPABASE_URL',          // https://xxxx.supabase.co
  'SUPABASE_SERVICE_KEY',  // chave "service_role" (secreta!)
  'IG_APP_ID',             // Instagram App ID (painel da Meta)
  'IG_APP_SECRET',         // Instagram App Secret
];

export function env(name) {
  const v = process.env[name];
  if (!v) {
    const e = new Error(`Variável de ambiente ausente: ${name}`);
    e.status = 500;
    throw e;
  }
  return name.endsWith('_URL') ? v.trim().replace(/\/+$/, '') : v;
}

export const TIMEZONE = () => process.env.APP_TIMEZONE || 'America/Cuiaba';
export const IG_API_VERSION = () => process.env.IG_API_VERSION || 'v25.0';
export const missingEnv = () => REQUIRED.filter((k) => !process.env[k]);
