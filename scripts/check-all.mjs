// 全イベントのデータを検証する（書き込まない）。CI 用
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const events = readdirSync(resolve(root, 'events'), { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(resolve(root, 'events', d.name, 'event.json')))
  .map((d) => d.name);
let failed = 0;
for (const slug of events) {
  process.stdout.write(`${slug}: `);
  try {
    execFileSync('python3', ['tools/build.py', '--check'], { cwd: root, stdio: 'inherit', env: { ...process.env, EVENT: slug } });
  } catch {
    failed++;
  }
}
process.exit(failed ? 1 : 0);
