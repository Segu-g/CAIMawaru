// scripts/ の共通処理。OS（Linux・macOS・Windows）に依存しないよう、シェルを通さずに Node から直接起動する。
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';

export const root = resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);

/** events/ の下で event.json があるフォルダ名（イベントの eventId）。 */
export function knownEvents() {
  const dir = resolve(root, 'events');
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(resolve(dir, d.name, 'event.json')))
    .map((d) => d.name)
    .sort();
}

export const eventConfig = (eventId) => JSON.parse(readFileSync(resolve(root, 'events', eventId, 'event.json'), 'utf-8'));

/**
 * 引数からイベント（eventId）を取り出す。tools/eventargs.py と同じ規則:
 *   1. --event <eventId>（--event=<eventId>）  2. 最初の引数がイベントのフォルダ名ならそれ
 * 両方あって値が違えば error を返す。環境変数では指定しない（シェルに残った値で別のイベントを書き換えないように）。
 * 返り値: { eventId, rest, known, error }（rest はイベントの指定を除いた残りの引数）
 */
export function takeEvent(args, known = knownEvents()) {
  const rest = [...args];
  let option;
  const i = rest.findIndex((a) => a === '--event' || a.startsWith('--event='));
  if (i >= 0) {
    if (rest[i] === '--event') {
      if (i + 1 >= rest.length) return { eventId: undefined, rest, known, error: '--event のあとに eventId を指定してください' };
      option = rest[i + 1];
      rest.splice(i, 2);
    } else {
      option = rest[i].slice('--event='.length);
      rest.splice(i, 1);
    }
  }
  const positional = rest.length && known.includes(rest[0]) ? rest[0] : undefined;
  if (option !== undefined && positional !== undefined && option !== positional) {
    return { eventId: undefined, rest, known, error: `イベントが2つ指定されています（--event ${option} と ${positional}）` };
  }
  if (positional !== undefined) rest.shift();
  return { eventId: option ?? positional, rest, known };
}

export function requireEvent(args, usage) {
  const { eventId, rest, known, error } = takeEvent(args);
  if (error) fail(error);
  if (!eventId || !known.includes(eventId)) {
    const list = known.length ? known.join(', ') : 'events/ にイベントがありません（pnpm new-event <eventId> で作成）';
    const guess = eventId ?? rest.find((a, n) => n === 0 && !a.startsWith('-'));
    fail(`${guess ? `イベント '${guess}' がありません` : 'イベントを指定してください'}（${list}）\n例: ${usage.replace('<eventId>', known[0] ?? '<eventId>')}`);
  }
  return { eventId, rest };
}

// vite.config.ts にイベントを渡すための、内部用の環境変数（利用者が設定するものではない）
export const INTERNAL_EVENT_ENV = 'CAIMAWARU_EVENT_ID';

export function fail(message) {
  console.error(message);
  process.exit(1);
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

let python;
/** Python 3.10 以上の起動方法。python3（Linux・macOS）→ python → py -3（Windows）の順に探す。 */
export function findPython() {
  if (python) return python;
  const candidates = process.env.PYTHON ? [[process.env.PYTHON]] : [['python3'], ['python'], ['py', '-3']];
  for (const [cmd, ...pre] of candidates) {
    const r = spawnSync(cmd, [...pre, '-c', 'import sys; print(sys.version_info >= (3, 10))'], { encoding: 'utf-8' });
    if (r.status === 0 && r.stdout.trim() === 'True') return (python = [cmd, ...pre]);
  }
  fail('Python 3.10 以上が見つかりません（python3 / python / py -3）。環境変数 PYTHON で指定することもできます');
}

/**
 * Python を起動する。入出力は UTF-8 にそろえる（Windows の既定の文字コードに左右されないように）。
 * 隔離モード（-I）は PYTHON* 環境変数を無視するので、環境変数ではなく -X utf8 で指定する。
 */
export function runPython(args, env = {}) {
  const [cmd, ...pre] = findPython();
  return spawnSync(cmd, [...pre, '-X', 'utf8', ...args], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8', ...env },
  }).status ?? 1;
}
