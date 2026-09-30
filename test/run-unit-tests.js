// test/run-unit-tests.js
import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const res = spawnSync(process.execPath, ['--test', path.join(__dirname, 'unit/detection/*.test.js')], {
    stdio: 'inherit'
});

process.exit(res.status ?? 0);
