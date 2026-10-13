// Chamada à API do Claude (Anthropic). Variáveis: ANTHROPIC_API_KEY (obrigatória para a IA) e AI_MODEL (opcional).
import { HttpError } from './http.js';

export const AI_MODEL = () => process.env.AI_MODEL || 'claude-sonnet-5-5';

export async function askClaude(content, { maxTokens = 4000 } = {}) {
  if (!process.env.ANTHROPIC_API_KEY) throw new HttpError(503, 'A IA ainda não está ligada: falta ANTHROPIC_API_KEY na Vercel (veja a aba Ajustes).');
  let r;
  try {
    r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: AI_MODEL(), max_tokens: maxTokens, messages: [{ role: 'user', content }] }),
    });
  } catch { throw new HttpError(502, 'Não consegui falar com a IA agora. Tente de novo.'); }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = data?.error?.message || `erro ${r.status}`;
    const hint = r.status === 401 ? ' Confira a ANTHROPIC_API_KEY.' : r.status === 400 && /credit|billing/i.test(msg) ? ' Verifique o saldo/créditos no console da Anthropic.' : '';
    throw new HttpError(r.status === 429 ? 429 : 502, `IA: ${msg}.${hint}`);
  }
  return (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
}

export function jsonFrom(text) {
  try { return JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)); }
  catch { throw new HttpError(502, 'A IA respondeu num formato inesperado. Tente de novo.'); }
}
