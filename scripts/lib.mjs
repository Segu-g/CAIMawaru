// scripts/ の共通処理。OS（Linux・macOS・Windows）に依存しないよう、シェルを通さずに Node から直接起動する。
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';

export const root = resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);

/** events/ の下で event.json があるフォルダ名（イベントの slug）。 */
export function knownEvents() {
  const dir = resolve(root, 'events');
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(resolve(dir, d.name, 'event.json')))
    .map((d) => d.name)
    .sort();
}

export const eventConfig = (slug) => JSON.parse(readFileSync(resolve(root, 'events', slug, 'event.json'), 'utf-8'));

/**
 * 引数からイベントを取り出す。優先順位: --event <slug> / --event=<slug> → 最初の引数がイベント名 → 環境変数 EVENT。
 * 返り値: { slug, rest }（rest はイベントの指定を除いた残りの引数）
 */
export function takeEvent(args) {
  const known = knownEvents();
  const rest = [...args];
  let slug;
  const i = rest.findIndex((a) => a === '--event' || a.startsWith('--event='));
  if (i >= 0) {
    slug = rest[i].includes('=') ? rest[i].slice('--event='.length) : rest[i + 1];
    rest.splice(i, rest[i].includes('=') ? 1 : 2);
  } else if (rest.length && known.includes(rest[0])) {
    slug = rest.shift();
  } else {
    slug = process.env.EVENT;
  }
  return { slug, rest, known };
}

export function requireEvent(args, usage) {
  const { slug, rest, known } = takeEvent(args);
  if (!slug || !known.includes(slug)) {
    const list = known.length ? known.join(', ') : 'events/ にイベントがありません（pnpm new-event <slug> で作成）';
    fail(`${slug ? `イベント '${slug}' がありません` : 'イベントを指定してください'}（${list}）\n例: ${usage.replace('<slug>', known[0] ?? '<slug>')}`);
  }
  return { slug, rest };
}

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

/** Python を起動する。入出力は UTF-8 にそろえる（Windows の既定の文字コードに左右されないように）。 */
export function runPython(args, env = {}) {
  const [cmd, ...pre] = findPython();
  return spawnSync(cmd, [...pre, ...args], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8', ...env },
  }).status ?? 1;
}
