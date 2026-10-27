// Lembretes recorrentes no celular (notificação do app), conferidos a cada rodada do agendador:
//   • stories: toda semana, lista os clientes sem stories planejados para a semana seguinte
//   • relatórios: todo mês, diz quantos relatórios do mês que fechou estão prontos para revisar e enviar
// Cada lembrete sai uma vez só no período (guardado em app_state "reminders_sent").
import { db } from './db.js';
import { getState, setState } from './appstate.js';
import { notify } from './push.js';
import { TIMEZONE } from './env.js';
import { productionList } from './production.js';

export const REMINDER_DEFAULTS = {
  stories: { on: true, weekday: 5, hour: 9 },  // sexta (0 = domingo)
  reports: { on: true, day: 3, hour: 9 },      // dia do mês
};
const WD = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

export async function reminderSettings() {
  const v = (await getState('reminders', null)) || {};
  return { stories: { ...REMINDER_DEFAULTS.stories, ...(v.stories || {}) }, reports: { ...REMINDER_DEFAULTS.reports, ...(v.reports || {}) } };
}
export function cleanReminderSettings(b = {}) {
  const int = (x, min, max, d) => { const n = Number(x); return Number.isInteger(n) && n >= min && n <= max ? n : d; };
  const s = b.stories || {}, r = b.reports || {};
  return {
    stories: { on: s.on !== false, weekday: int(s.weekday, 0, 6, 5), hour: int(s.hour, 0, 23, 9) },
    reports: { on: r.on !== false, day: int(r.day, 1, 28, 3), hour: int(r.hour, 0, 23, 9) },
  };
}

function localParts(now, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23', weekday: 'short' }).formatToParts(now).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, month: `${p.year}-${p.month}`, day: Number(p.day), hour: Number(p.hour), weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday) };
}
const addDays = (date, n) => new Date(new Date(`${date}T12:00:00Z`).getTime() + n * 864e5).toISOString().slice(0, 10);
const prevMonth = (m) => { const [y, mm] = m.split('-').map(Number); const d = new Date(Date.UTC(y, mm - 2, 1)); return d.toISOString().slice(0, 7); };
// início (UTC) de um dia local, aproximado pelo fuso fixo do Brasil sem horário de verão
const dayStartISO = (date, tz) => {
  const probe = new Date(`${date}T12:00:00Z`);
  const local = new Date(probe.toLocaleString('en-US', { timeZone: tz }));
  const offsetMs = probe.getTime() - local.getTime();
  return new Date(new Date(`${date}T00:00:00Z`).getTime() + offsetMs).toISOString();
};

// Stories da semana seguinte (segunda a domingo) por cliente ativo
export async function storiesPlan(fromDate, tz = TIMEZONE()) {
  const wd = new Date(`${fromDate}T12:00:00Z`).getUTCDay();
  const monday = addDays(fromDate, ((8 - wd) % 7) || 7);
  const end = addDays(monday, 7);
  const [clients, own, prod] = await Promise.all([db.select('clients', { select: 'id,name', order: 'name.asc' }), getState('own_accounts', []), productionList()]);
  const skip = new Set([...(Array.isArray(own) ? own : []), ...prod]);
  const active = clients.filter((c) => !skip.has(c.id));
  const stories = await db.select('posts', { select: 'client_id,status', media_type: 'eq.STORY', and: `(scheduled_at.gte.${dayStartISO(monday, tz)},scheduled_at.lt.${dayStartISO(end, tz)})` }).catch(() => []);
  const count = (id) => stories.filter((p) => p.client_id === id).length;
  return { monday, sunday: addDays(monday, 6), clients: active.map((c) => ({ name: c.name, n: count(c.id) })) };
}

export async function runReminders({ now = Date.now(), tz = TIMEZONE() } = {}) {
  const cfg = await reminderSettings();
  const L = localParts(now, tz);
  const sent = (await getState('reminders_sent', null)) || {};
  const out = {};
  if (cfg.stories.on && L.weekday === cfg.stories.weekday && L.hour >= cfg.stories.hour && sent.stories !== L.date) {
    const plan = await storiesPlan(L.date, tz);
    const missing = plan.clients.filter((c) => !c.n).map((c) => c.name);
    const total = plan.clients.reduce((a, c) => a + c.n, 0);
    const range = `${plan.monday.slice(8)}/${plan.monday.slice(5, 7)} a ${plan.sunday.slice(8)}/${plan.sunday.slice(5, 7)}`;
    await notify({
      title: '📱 Cronograma de stories da semana que vem',
      body: missing.length ? `${range}: sem stories planejados para ${missing.join(', ')}.${total ? ` Já há ${total} no total.` : ''}` : `${range}: todos os clientes têm stories planejados (${total} no total). Confira o cronograma.`,
      url: '/#calendario', tag: `rem-stories-${L.date}`,
    }).catch(() => 0);
    sent.stories = L.date; out.stories = { missing, total };
  }
  if (cfg.reports.on && L.day === cfg.reports.day && L.hour >= cfg.reports.hour && sent.reports !== L.month) {
    const month = prevMonth(L.month);
    const [reports, clients] = await Promise.all([
      db.select('reports', { select: 'client_id', ref_month: `eq.${month}` }).catch(() => []),
      db.select('clients', { select: 'id,name,ig_token' }).catch(() => []),
    ]);
    const done = new Set(reports.map((r) => r.client_id));
    const ready = clients.filter((c) => done.has(c.id)).map((c) => c.name);
    const pending = clients.filter((c) => c.ig_token && !done.has(c.id)).map((c) => c.name);
    const mName = MESES[Number(month.slice(5)) - 1];
    await notify({
      title: `📊 Relatórios de ${mName}`,
      body: [ready.length ? `${ready.length} pronto${ready.length > 1 ? 's' : ''} para revisar e enviar: ${ready.join(', ')}.` : 'Nenhum relatório gerado ainda.',
        pending.length ? ` Falta gerar: ${pending.join(', ')}.` : ''].join(''),
      url: '/#clientes', tag: `rem-reports-${L.month}`,
    }).catch(() => 0);
    sent.reports = L.month; out.reports = { month, ready, pending };
  }
  if (out.stories || out.reports) await setState('reminders_sent', sent);
  return Object.keys(out).length ? out : null;
}
export { WD as WEEKDAYS };
