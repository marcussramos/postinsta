// Restauração de emergência: regrava no banco os dados de um arquivo de backup do MC DIGITAL.
// Uso (no computador, com as mesmas variáveis da Vercel):
//   SUPABASE_URL=... SUPABASE_SERVICE_KEY=... node scripts/restaurar-backup.mjs backup-2026-10-18-03-00.json            → só confere
//   SUPABASE_URL=... SUPABASE_SERVICE_KEY=... node scripts/restaurar-backup.mjs backup-2026-10-18-03-00.json --confirmar → regrava
// Regrava por cima (mesmo id = substitui); não apaga o que foi criado depois do backup.
import fs from 'node:fs';
import { checkBackup, restoreBackup } from '../lib/backup.js';

const [file, flag] = process.argv.slice(2);
if (!file) { console.error('Informe o arquivo do backup.'); process.exit(1); }
const data = JSON.parse(fs.readFileSync(file, 'utf8'));
const chk = checkBackup(data);
console.log(`Backup de ${chk.created_at || '?'}:`, chk.tables);
if (!chk.ok) { console.error('Backup inválido:', chk.problems.join(' ')); process.exit(1); }
if (flag !== '--confirmar') { console.log('Arquivo OK. Para regravar no banco, rode de novo com --confirmar.'); process.exit(0); }
const done = await restoreBackup(data);
console.log('Restaurado:', done);
