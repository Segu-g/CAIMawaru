import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// どのイベントを開発・ビルドするかは、コマンドの引数で指定する。
//   pnpm dev <eventId>      → vite -- <eventId>
//   pnpm build <eventId>    → tsc … && vite build -- <eventId>
//   pnpm preview <eventId>  → vite preview -- <eventId>
// Vite は「--」より後ろの引数を使わないので、その最初の値を eventId として読む（「--」がないと Vite は
// eventId をプロジェクトのフォルダ（root）と解釈してしまうため、package.json の scripts に「--」を入れてある）。
// 読むのは events/<eventId>/event.json（storeId・title・outDir）と、Python の caimawaru data が書いた
// public/data/circles.json だけ（Python は呼ばない。依存関係は docs/architecture.md）。
const root = import.meta.dirname;
const eventsDir = resolve(root, 'events');

type EventConfig = { storeId: string; title: string; outDir?: string };
const readConfig = (eventId: string) =>
  JSON.parse(readFileSync(resolve(eventsDir, eventId, 'event.json'), 'utf-8')) as EventConfig;
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

/** コマンドの引数（「--」より後ろ）から eventId を取り出す。 */
function eventIdFromArgs(usage: string): string {
  const argv = process.argv;
  const at = argv.indexOf('--');
  const [eventId, ...extra] = at < 0 ? [] : argv.slice(at + 1);
  const list = known.join(', ') || 'events/ にイベントがありません';
  const example = usage.replace('<eventId>', known[0] ?? '<eventId>');
  if (!eventId || eventId.startsWith('-')) {
    fail(`イベント（eventId）を指定してください（${list}）。例: ${example}`);
  }
  if (!known.includes(eventId)) fail(`イベント '${eventId}' がありません（${list}）`);
  // 「pnpm dev example --host」の --host は「--」の後ろに入って Vite に届かないので、黙って無視せず止める
  if (extra.length) {
    fail(
      `eventId の後ろの ${extra.join(' ')} は Vite に渡りません。Vite のオプションは「--」の前に書いてください。` +
        `例: pnpm exec vite ${extra.join(' ')} -- ${eventId}`,
    );
  }
  return eventId;
}

const isInside = (child: string, parent: string) => child.startsWith(parent + sep);

/**
 * このイベントの出力（index.html・assets/・public/ にあるもの）だけを消す。
 * 別のイベントの outDir がこの中にある（入れ子の）ときは、出力先を丸ごと空にするとそのページまで消えるため。
 */
function cleanOwnOutput(outDir: string, publicDir: string) {
  const own = ['index.html', 'assets', ...(existsSync(publicDir) ? readdirSync(publicDir) : [])];
  for (const name of own) rmSync(resolve(outDir, name), { recursive: true, force: true });
}

export default defineConfig(({ command, isPreview }) => {
  // テスト（vitest）はイベントに依存しない
  if (process.env.VITEST) return { plugins: [react()] };

  const usage = isPreview ? 'pnpm preview <eventId>' : command === 'build' ? 'pnpm build <eventId>' : 'pnpm dev <eventId>';
  const eventId = eventIdFromArgs(usage);
  const dir = resolve(eventsDir, eventId);
  const config = readConfig(eventId);
  if (!config.storeId || !config.title) fail(`events/${eventId}/event.json に storeId と title が必要です`);

  // ページが読むデータ。なければ先に Python 側で作る
  const publicDir = resolve(dir, 'public');
  const dataJson = resolve(publicDir, 'data', 'circles.json');
  if (!existsSync(dataJson)) {
    fail(`events/${eventId}/public/data/circles.json がありません。先に uv run caimawaru data ${eventId} で作ってください`);
  }
  const hasMap = !!(JSON.parse(readFileSync(dataJson, 'utf-8')) as { layout?: unknown }).layout;

  // 既定は dist/<eventId>/。同じサイトに複数ページを置くときは event.json の outDir で揃える（入れ子も可）
  const outDirOf = (id: string) => resolve(root, 'dist', readConfig(id).outDir ?? id);
  const outDir = outDirOf(eventId);
  if (isPreview && !existsSync(resolve(outDir, 'index.html'))) {
    fail(`${relative(root, outDir)}/ にビルド結果がありません。先に pnpm build ${eventId} を実行してください`);
  }
  const nested = known.filter((id) => id !== eventId && isInside(outDirOf(id), outDir));
  if (command === 'build' && !isPreview && nested.length) {
    console.log(`dist/${relative(resolve(root, 'dist'), outDir)}/ には ${nested.join(', ')} のページもあるため、${eventId} の出力だけを消します`);
    cleanOwnOutput(outDir, publicDir);
  }

  // index.html の %VITE_TITLE% とアプリの import.meta.env に渡す
  process.env.VITE_STORE_ID = config.storeId;
  process.env.VITE_TITLE = config.title;
  process.env.VITE_HAS_MAP = String(hasMap);

  // ビルドごとに assets のファイル名を変える。公開前に新しいファイル名の URL が一度でも
  // 取得されると、CDN（Cloudflare など）がその 404 をキャッシュしてページが壊れることがあるため、
  // 内容が同じでも毎回まだ誰も取得していない名前にする
  const BUILD_ID = Date.now().toString(36);

  return {
    plugins: [react()],
    // サブパスに置いても動くよう相対パスで出力
    base: './',
    publicDir,
    build: {
      outDir,
      emptyOutDir: nested.length === 0,
      rollupOptions: {
        output: {
          entryFileNames: `assets/[name]-[hash]-${BUILD_ID}.js`,
          chunkFileNames: `assets/[name]-[hash]-${BUILD_ID}.js`,
          assetFileNames: `assets/[name]-[hash]-${BUILD_ID}[extname]`,
        },
      },
    },
  };
});
