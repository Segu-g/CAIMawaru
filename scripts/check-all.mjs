// 全イベントのイベントデータを検証する（書き込まない）。CI 用
import { knownEvents, root, runPython } from './lib.mjs';
import { resolve } from 'node:path';

let failed = 0;
for (const slug of knownEvents()) {
  process.stdout.write(`${slug}: `);
  if (runPython([resolve(root, 'tools', 'build.py'), slug, '--check'])) failed++;
}
process.exit(failed ? 1 : 0);
