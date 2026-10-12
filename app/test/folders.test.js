// Pasta privada do cliente: arquivos, mensalidades, dados da agência e contrato gerado.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './dev-server.js';
import { valorPorExtenso, renderContract } from '../lib/contract.js';

let S, base, cookie = '';
async function call(path, { method = 'GET', body, raw, headers = {}, auth = true } = {}) {
  const init = { method, headers: { ...(auth ? { cookie } : {}), ...headers }, redirect: 'manual' };
  if (raw) { init.body = raw; init.headers['Content-Type'] = 'application/octet-stream'; }
  else if (body) { init.body = JSON.stringify(body); init.headers['Content-Type'] = 'application/json'; }
  const r = await fetch(base + path, init);
  const t = await r.text(); let data; try { data = JSON.parse(t); } catch { data = t; }
  return { status: r.status, data, headers: r.headers };
}
before(async () => {
  S = await startServer(4412); base = S.url;
  const r = await call('/api/session', { method: 'POST', body: { password: 'senha-teste' } });
  cookie = r.headers.get('set-cookie').split(';')[0];
});
after(() => { S.server.close(); S.fakes.restore(); });

test('valor por extenso', () => {
  assert.equal(valorPorExtenso(150000), 'mil e quinhentos reais');
  assert.equal(valorPorExtenso(123456), 'mil duzentos e trinta e quatro reais e cinquenta e seis centavos');
  assert.equal(valorPorExtenso(100), 'um real');
  assert.equal(valorPorExtenso(250000000), 'dois milhões e quinhentos mil reais');
});

test('modelo escapa HTML, marca campos faltando e gera assinaturas', () => {
  const { html, missing } = renderContract('# Título\n\nOlá {{cliente.nome}} <script>\n\n{{assinaturas}}', { 'cliente.nome': 'A & B' });
  assert.match(html, /<h1>Título<\/h1>/);
  assert.match(html, /A &amp; B/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /class="assinaturas"/);
  assert.ok(missing.includes('agencia.razao_social'));
});

test('arquivos: só a agência envia, abre e apaga; PDF falso é recusado', async () => {
  const c = (await call('/api/clients', { method: 'POST', body: { name: 'Cliente Pasta' } })).data;
  const pdf = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(100)]);
  // sem login: bloqueado
  assert.equal((await call(`/api/pasta?r=files&client=${c.id}`, { auth: false })).status, 401);
  assert.equal((await call(`/api/pasta?r=files&client=${c.id}&category=contract`, { method: 'POST', raw: pdf, auth: false, headers: { 'x-file-name': 'a.pdf' } })).status, 401);
  // tipo e conteúdo
  assert.equal((await call(`/api/pasta?r=files&client=${c.id}&category=contract`, { method: 'POST', raw: pdf, headers: { 'x-file-name': 'virus.exe' } })).status, 415);
  assert.equal((await call(`/api/pasta?r=files&client=${c.id}&category=contract`, { method: 'POST', raw: Buffer.from('oi'), headers: { 'x-file-name': 'falso.pdf' } })).status, 415);
  assert.equal((await call(`/api/pasta?r=files&client=${c.id}&category=xyz`, { method: 'POST', raw: pdf, headers: { 'x-file-name': 'a.pdf' } })).status, 400);
  const up = await call(`/api/pasta?r=files&client=${c.id}&category=report&ref_month=2026-09`, { method: 'POST', raw: pdf, headers: { 'x-file-name': encodeURIComponent('Relatório Setembro.pdf') } });
  assert.equal(up.status, 201);
  assert.equal(up.data.name, 'Relatório Setembro.pdf');
  assert.equal(up.data.ref_month, '2026-09');
  assert.equal(up.data.path, undefined, 'caminho interno não vaza');
  const key = [...S.fakes.files.keys()].find((k) => k.startsWith(`docs/${c.id}/report/`));
  assert.ok(key, 'guardado no bucket privado docs');
  const list = (await call(`/api/pasta?r=files&client=${c.id}`)).data;
  assert.equal(list.length, 1);
  // abrir: redireciona para link temporário assinado; baixar acrescenta o nome
  const open = await call(`/api/pasta?r=files&id=${up.data.id}&open=1`);
  assert.equal(open.status, 302);
  assert.match(open.headers.get('location'), /^https:\/\/fake\.supabase\.co\/storage\/v1\/object\/sign\/docs\/.+token=/);
  const dl = await call(`/api/pasta?r=files&id=${up.data.id}&download=1`);
  assert.match(dl.headers.get('location'), /download=Relat%C3%B3rio%20Setembro\.pdf/);
  assert.equal((await call(`/api/pasta?r=files&id=${up.data.id}&open=1`, { auth: false })).status, 401);
  // apagar remove do banco e do armazenamento
  assert.equal((await call(`/api/pasta?r=files&id=${up.data.id}`, { method: 'DELETE' })).status, 200);
  assert.ok(!S.fakes.files.has(key));
  assert.equal((await call(`/api/pasta?r=files&client=${c.id}`)).data.length, 0);
});

test('mensalidades: marcar pago, editar no mesmo mês e desfazer', async () => {
  const c = (await call('/api/clients', { method: 'POST', body: { name: 'Cliente Mensal' } })).data;
  const p1 = await call('/api/pasta?r=payments', { method: 'PUT', body: { client_id: c.id, ref_month: '2026-09', status: 'paid', amount_cents: 150000, paid_at: '2026-09-10' } });
  assert.equal(p1.status, 200);
  await call('/api/pasta?r=payments', { method: 'PUT', body: { client_id: c.id, ref_month: '2026-09', status: 'paid', amount_cents: 120000, paid_at: '2026-09-11', note: 'desconto' } });
  let rows = (await call(`/api/pasta?r=payments&client=${c.id}`)).data;
  assert.equal(rows.length, 1, 'upsert no mesmo mês');
  assert.equal(rows[0].amount_cents, 120000);
  assert.equal((await call('/api/pasta?r=payments', { method: 'PUT', body: { client_id: c.id, ref_month: '2026-13' } })).status, 400);
  assert.equal((await call('/api/pasta?r=payments', { method: 'PUT', body: { client_id: c.id, ref_month: '2026-10', status: 'xx' } })).status, 400);
  await call(`/api/pasta?r=payments&client=${c.id}&month=2026-09`, { method: 'DELETE' });
  rows = (await call(`/api/pasta?r=payments&client=${c.id}`)).data;
  assert.equal(rows.length, 0);
});

test('contrato: dados do cliente + agência viram contrato preenchido', async () => {
  const c = (await call('/api/clients', { method: 'POST', body: { name: 'Padaria Pão Quente' } })).data;
  // dados de cobrança e contrato
  const bad = await call(`/api/clients?id=${c.id}`, { method: 'PATCH', body: { due_day: 40 } });
  assert.equal(bad.status, 400);
  const saved = (await call(`/api/clients?id=${c.id}`, { method: 'PATCH', body: {
    monthly_fee: 'R$ 1.500,00', due_day: '10', billing_start: '2026-08-01',
    contract_data: { nome: 'Pão Quente Ltda', documento: '11.222.333/0001-44', servicos: 'Gestão do Instagram', prazo_meses: '12', lixo: 'x' },
  } })).data;
  assert.equal(saved.monthly_fee_cents, 150000);
  assert.equal(saved.due_day, 10);
  assert.deepEqual(saved.contract_data, { nome: 'Pão Quente Ltda', documento: '11.222.333/0001-44', servicos: 'Gestão do Instagram', prazo_meses: 12 });
  // modelo padrão: faltam dados da agência
  let k = (await call(`/api/pasta?r=contract&client=${c.id}`)).data;
  assert.equal(k.template_is_default, true);
  assert.ok(k.missing.includes('Razão social da agência'));
  assert.match(k.html, /Pão Quente Ltda/);
  assert.match(k.html, /mil e quinhentos reais/);
  assert.match(k.html, /dia 10/);
  // agência + modelo próprio
  await call('/api/pasta?r=settings', { method: 'PUT', body: { agency: { razao_social: 'MC Digital Ltda', cnpj: '99.888.777/0001-66', cidade: 'Cuiabá/MT', hack: 'x' } } });
  await call('/api/pasta?r=settings', { method: 'PUT', body: { contract_template: '# CONTRATO {{cliente.nome}}\n\nContratada: {{agencia.razao_social}} ({{agencia.cnpj}}). Início: {{contrato.inicio}}.' } });
  const st = (await call('/api/pasta?r=settings')).data;
  assert.equal(st.agency.hack, undefined);
  assert.equal(st.template_is_default, false);
  k = (await call(`/api/pasta?r=contract&client=${c.id}`)).data;
  assert.deepEqual(k.missing, []);
  assert.match(k.html, /MC Digital Ltda/);
  assert.match(k.html, /1 de agosto de 2026/);
  assert.equal(k.title, 'Contrato - Pão Quente Ltda');
  assert.equal((await call(`/api/pasta?r=contract&client=${c.id}`, { auth: false })).status, 401);
  // remover cliente apaga a pasta no armazenamento
  const pdf = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(10)]);
  await call(`/api/pasta?r=files&client=${c.id}&category=contract`, { method: 'POST', raw: pdf, headers: { 'x-file-name': 'assinado.pdf' } });
  assert.ok([...S.fakes.files.keys()].some((x) => x.includes(`${c.id}/contract/`)));
  await call(`/api/clients?id=${c.id}`, { method: 'DELETE' });
  assert.ok(![...S.fakes.files.keys()].some((x) => x.includes(`${c.id}/contract/`)));
});
