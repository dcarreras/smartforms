// test/run-unit-tests.js
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const unitDir = path.join(__dirname, 'unit', 'detection');
const testFiles = fs.readdirSync(unitDir)
    .filter(file => file.endsWith('.test.js'))
    .map(file => path.join(unitDir, file));

const res = spawnSync(process.execPath, ['--test', ...testFiles], {
    stdio: 'inherit'
});

process.exit(res.status ?? 0);

