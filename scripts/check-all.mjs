// 全イベントのイベントデータを検証する（書き込まない）。CI 用
import { knownEvents, root, runPython } from './lib.mjs';
import { resolve } from 'node:path';

let failed = 0;
for (const eventId of knownEvents()) {
  process.stdout.write(`${eventId}: `);
  if (runPython([resolve(root, 'tools', 'build.py'), eventId, '--check'])) failed++;
}
process.exit(failed ? 1 : 0);
