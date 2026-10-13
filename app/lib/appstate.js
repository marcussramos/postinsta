// Pequenos valores guardados na tabela app_state (chave → JSON).
import { db } from './db.js';

export async function getState(key, fallback = null) {
  try { return (await db.one('app_state', { select: 'value', key: `eq.${key}` }))?.value ?? fallback; }
  catch { return fallback; }
}
export async function setState(key, value) {
  await db.upsert('app_state', { key, value, updated_at: new Date().toISOString() });
  return value;
}
