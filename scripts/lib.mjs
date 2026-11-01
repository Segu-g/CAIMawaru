// scripts/ の共通処理（Node だけで完結。Python は呼ばない）。
// OS（Linux・macOS・Windows）に依存しないよう、シェルを通さずに node_modules の実行ファイルを同じ Node で起動する。
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';

export const root = resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);

// vite.config.ts にイベントを渡すための、内部用の環境変数（利用者が設定するものではない）
export const INTERNAL_EVENT_ENV = 'CAIMAWARU_EVENT_ID';

/** events/ の下で event.json があるフォルダ名（eventId）。 */
export function knownEvents() {
  const dir = resolve(root, 'events');
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(resolve(dir, d.name, 'event.json')))
    .map((d) => d.name)
    .sort();
}

export const eventConfig = (eventId) => JSON.parse(readFileSync(resolve(root, 'events', eventId, 'event.json'), 'utf-8'));
export const dataJsonOf = (eventId) => resolve(root, 'events', eventId, 'public', 'data', 'circles.json');

export function fail(message) {
  console.error(message);
  process.exit(1);
}

/** 最初の引数を eventId として取り出す。返り値: { eventId, rest } */
export function requireEvent(args, usage, known = knownEvents()) {
  const [eventId, ...rest] = args;
  if (!eventId || eventId.startsWith('-') || !known.includes(eventId)) {
    const list = known.length ? known.join(', ') : 'events/ にイベントがありません';
    const what = eventId && !eventId.startsWith('-') ? `イベント '${eventId}' がありません` : '最初の引数にイベント（eventId）を指定してください';
    fail(`${what}（${list}）\n例: ${usage.replace('<eventId>', known[0] ?? '<eventId>')}`);
  }
  return { eventId, rest };
}

/** node_modules の実行ファイル（JS）のパス。 */
export function binOf(pkg, name = pkg) {
  const pkgJson = require.resolve(`${pkg}/package.json`);
  const { bin } = JSON.parse(readFileSync(pkgJson, 'utf-8'));
  return resolve(dirname(pkgJson), typeof bin === 'string' ? bin : bin[name]);
}

/** Node の実行ファイルを、同じ Node で起動する。終了コードを返す。 */
export function runNode(script, args = [], env = {}) {
  return spawnSync(process.execPath, [script, ...args], { cwd: root, stdio: 'inherit', env: { ...process.env, ...env } }).status ?? 1;
}
