import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// どのイベントを開発・ビルドするかは環境変数 EVENT（events/ の下のフォルダ名）で選ぶ。
//   EVENT=example pnpm dev
// イベントの設定は events/<slug>/event.json、配置図は events/<slug>/layout.json（なければ配置図なし）。
const root = import.meta.dirname;
// テスト（vitest）はイベントに依存しないので EVENT がなくてもよい
const testing = !!process.env.VITEST;
const slug = process.env.EVENT ?? (testing ? undefined : '');
const known = readdirSync(resolve(root, 'events'), { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(resolve(root, 'events', d.name, 'event.json')))
  .map((d) => d.name);
if (!testing && (!slug || !known.includes(slug))) {
  throw new Error(`環境変数 EVENT にイベントを指定してください（${known.join(', ') || 'events/ にイベントがありません'}）。例: EVENT=${known[0] ?? '<slug>'} pnpm dev`);
}
const dir = resolve(root, 'events', slug ?? '');
const config = (slug ? JSON.parse(readFileSync(resolve(dir, 'event.json'), 'utf-8')) : { storeId: 'test', title: 'test' }) as {
  storeId: string;
  title: string;
  outDir?: string;
};
if (!config.storeId || !config.title) throw new Error(`events/${slug}/event.json に storeId と title が必要です`);

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
    // 既定は dist/<slug>/。同じサイトに複数ページを置くときは event.json の outDir で揃える
    outDir: resolve(root, 'dist', config.outDir ?? slug ?? ''),
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
