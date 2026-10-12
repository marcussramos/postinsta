// Mesma regra do painel (public/billing.js), com a data de hoje no fuso da agência.
import { TIMEZONE } from './env.js';
import { billingMonths as months, planOf, splitCents, dueSoon } from '../public/billing.js';

export { planOf, splitCents, dueSoon };
export const todayIn = (tz = TIMEZONE(), now = Date.now()) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(now);
export function billingMonths(client, payments, { now = Date.now(), tz = TIMEZONE() } = {}) {
  return months(client, payments, todayIn(tz, now));
}
