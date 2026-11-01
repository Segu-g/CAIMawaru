import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// どのイベントを開発・ビルドするかは、pnpm dev <eventId> / pnpm build <eventId> で指定する。
// scripts/vite.mjs・scripts/build-all.mjs が内部用の環境変数 CAIMAWARU_EVENT_ID で渡す（利用者が設定するものではない）。
// イベントの設定は events/<eventId>/event.json、配置図は events/<eventId>/layout.json（なければ配置図なし）。
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

// index.html の %VITE_TITLE% とアプリの import.meta.env に渡す
process.env.VITE_STORE_ID = config.storeId;
process.env.VITE_TITLE = config.title;
process.env.VITE_HAS_MAP = String(existsSync(resolve(dir, 'layout.json')));

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
