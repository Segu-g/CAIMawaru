import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// どのイベントを開発・ビルドするかは、コマンドの引数で指定する。
//   pnpm dev <eventId>      → vite -- <eventId>
//   pnpm build <eventId>    → tsc … && vite build -- <eventId>
//   pnpm preview <eventId>  → vite preview -- <eventId>
// Vite は「--」より後ろの引数を使わないので、その最初の値を eventId として読む（「--」がないと Vite は
// eventId をプロジェクトのフォルダ（root）と解釈してしまうため、package.json の scripts に「--」を入れてある）。
// 読むのは events/<eventId>/event.json（storeId・title）と、Python の caimawaru data が書いた
// public/data/circles.json だけ（Python は呼ばない。依存関係は docs/architecture.md）。
// 出力先は dist/<eventId>/ で、ビルドのたびに Vite が空にする（この設定ではファイルやフォルダを消したり書いたりしない）。
const root = import.meta.dirname;
const eventsDir = resolve(root, 'events');

const known = existsSync(eventsDir)
  ? readdirSync(eventsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && existsSync(resolve(eventsDir, d.name, 'event.json')))
      .map((d) => d.name)
      .sort()
  : [];

/** 設定を読み込めないときは、Vite のスタックトレースを出さずに理由だけを出して止まる。 */
function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

/** コマンドの引数（「--」より後ろ）から eventId を取り出す（Node 標準の util.parseArgs）。 */
function eventIdFromArgs(vite: string, usage: string): string {
  const at = process.argv.indexOf('--');
  const args = at < 0 ? [] : process.argv.slice(at + 1);
  const list = known.join(', ') || 'events/ にイベントがありません';
  let positionals: string[];
  try {
    // オプションは受け付けない。「pnpm dev example --host」の --host は「--」の後ろに入って Vite に届かないため、黙って無視せず止める
    ({ positionals } = parseArgs({ args, allowPositionals: true, strict: true, options: {} }));
  } catch {
    const i = args.findIndex((a) => !a.startsWith('-'));
    const id = i < 0 ? (known[0] ?? '<eventId>') : args[i];
    const opts = args.filter((_, j) => j !== i);
    fail(`${opts.join(' ')} は Vite に渡りません。Vite のオプションは「--」の前に書いてください。例: pnpm exec ${vite} ${opts.join(' ')} -- ${id}`);
  }
  const [eventId, ...extra] = positionals;
  if (!eventId) fail(`イベント（eventId）を指定してください（${list}）。例: ${usage.replace('<eventId>', known[0] ?? '<eventId>')}`);
  if (extra.length) fail(`イベントは1つだけ指定してください（${extra.join(' ')} が余分です）。複数のときはコマンドを並べて実行します`);
  if (!known.includes(eventId)) fail(`イベント '${eventId}' がありません（${list}）`);
  return eventId;
}

/** JSON ファイルを読む。読めなければ理由だけを出して止まる。 */
function readJson<T>(path: string, label: string): T {
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as T;
  } catch (e) {
    fail(`${label} を読めません: ${(e as Error).message}`);
  }
}

export default defineConfig(({ command, isPreview }) => {
  // テスト（vitest）はイベントに依存しない
  if (process.env.VITEST) return { plugins: [react()] };

  const [vite, pnpm] = isPreview ? ['vite preview', 'preview'] : command === 'build' ? ['vite build', 'build'] : ['vite', 'dev'];
  const eventId = eventIdFromArgs(vite, `pnpm ${pnpm} <eventId>`);
  const dir = resolve(eventsDir, eventId);
  const config = readJson<{ storeId?: string; title?: string }>(resolve(dir, 'event.json'), `events/${eventId}/event.json`);
  if (!config.storeId || !config.title) fail(`events/${eventId}/event.json に storeId と title が必要です`);

  // ページが読むデータ。なければ先に Python 側で作る
  const publicDir = resolve(dir, 'public');
  const dataJson = resolve(publicDir, 'data', 'circles.json');
  if (!existsSync(dataJson)) {
    fail(`events/${eventId}/public/data/circles.json がありません。先に uv run caimawaru data ${eventId} で作ってください`);
  }
  const hasMap = !!readJson<{ layout?: unknown }>(dataJson, `events/${eventId}/public/data/circles.json`).layout;

  const outDir = resolve(root, 'dist', eventId);
  if (isPreview && !existsSync(resolve(outDir, 'index.html'))) {
    fail(`dist/${eventId}/ にビルド結果がありません。先に pnpm build ${eventId} を実行してください`);
  }

  // index.html の %VITE_TITLE% とアプリの import.meta.env に渡す
  process.env.VITE_STORE_ID = config.storeId;
  process.env.VITE_TITLE = config.title;
  process.env.VITE_HAS_MAP = String(hasMap);

  return {
    plugins: [react()],
    // サブパスに置いても動くよう相対パスで出力
    base: './',
    publicDir,
    build: { outDir, emptyOutDir: true },
  };
});
