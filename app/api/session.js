// GET: estou logado? | POST: entrar com a senha | DELETE: sair
import { route, send, readJson, need } from '../lib/http.js';
import { isAdmin, checkPassword, sessionCookie, clearCookie } from '../lib/auth.js';
import { TIMEZONE, missingEnv } from '../lib/env.js';

export default route({
  GET: (req, res) => send(res, 200, { admin: isAdmin(req), timezone: TIMEZONE(), missing_env: isAdmin(req) ? missingEnv() : undefined }),

  POST: async (req, res) => {
    const { password } = await readJson(req);
    // pequena espera em toda tentativa: atrasa quem tenta adivinhar a senha
    await new Promise((r) => setTimeout(r, 400));
    need(checkPassword(password), 401, 'Senha incorreta.');
    send(res, 200, { admin: true, timezone: TIMEZONE() }, { 'Set-Cookie': sessionCookie() });
  },

  DELETE: (req, res) => send(res, 200, { admin: false }, { 'Set-Cookie': clearCookie() }),
});
