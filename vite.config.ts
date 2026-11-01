import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// どのイベントを開発・ビルドするかは、pnpm dev <eventId> / pnpm build <eventId> で指定する。
// scripts/vite.mjs・scripts/build-all.mjs が内部用の環境変数 CAIMAWARU_EVENT_ID で渡す（利用者が設定するものではない）。
// 読むのは events/<eventId>/event.json（storeId・title・outDir）と、Python の caimawaru data が書いた
// public/data/circles.json だけ（Python は呼ばない。依存関係は docs/architecture.md）。
const root = import.meta.dirname;
// テスト（vitest）はイベントに依存しないのでイベントの指定がなくてもよい
const testing = !!process.env.VITEST;
const eventId = process.env.CAIMAWARU_EVENT_ID ?? (testing ? undefined : '');
const known = readdirSync(resolve(root, 'events'), { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(resolve(root, 'events', d.name, 'event.json')))
  .map((d) => d.name);
if (!testing && (!eventId || !known.includes(eventId))) {
  throw new Error(`イベントを指定してください（${known.join(', ') || 'events/ にイベントがありません'}）。例: pnpm dev ${known[0] ?? '<eventId>'}`);
}
const dir = resolve(root, 'events', eventId ?? '');
const config = (eventId ? JSON.parse(readFileSync(resolve(dir, 'event.json'), 'utf-8')) : { storeId: 'test', title: 'test' }) as {
  storeId: string;
  title: string;
  outDir?: string;
};
if (!config.storeId || !config.title) throw new Error(`events/${eventId}/event.json に storeId と title が必要です`);

// ページが読むデータ。なければ先に Python 側で作る
const dataJson = resolve(dir, 'public', 'data', 'circles.json');
if (eventId && !existsSync(dataJson)) {
  throw new Error(`events/${eventId}/public/data/circles.json がありません。先に uv run caimawaru data ${eventId} で作ってください`);
}
const hasMap = !!eventId && !!(JSON.parse(readFileSync(dataJson, 'utf-8')) as { layout?: unknown }).layout;

// index.html の %VITE_TITLE% とアプリの import.meta.env に渡す
process.env.VITE_STORE_ID = config.storeId;
process.env.VITE_TITLE = config.title;
process.env.VITE_HAS_MAP = String(hasMap);

// ビルドごとに assets のファイル名を変える。公開前に新しいファイル名の URL が一度でも
// 取得されると、CDN（Cloudflare など）がその 404 をキャッシュしてページが壊れることがあるため、
// 内容が同じでも毎回まだ誰も取得していない名前にする
const BUILD_ID = Date.now().toString(36);

export default defineConfig({
  plugins: [react()],
  // サブパスに置いても動くよう相対パスで出力
  base: './',
  publicDir: resolve(dir, 'public'),
  build: {
    // 既定は dist/<eventId>/。同じサイトに複数ページを置くときは event.json の outDir で揃える
    outDir: resolve(root, 'dist', config.outDir ?? eventId ?? ''),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        entryFileNames: `assets/[name]-[hash]-${BUILD_ID}.js`,
        chunkFileNames: `assets/[name]-[hash]-${BUILD_ID}.js`,
        assetFileNames: `assets/[name]-[hash]-${BUILD_ID}[extname]`,
      },
    },
  },
});
