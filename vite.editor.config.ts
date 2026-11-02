import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// イベントデータのエディタ（src/editor/）。どのイベントにも依存しないので、eventId が必要な vite.config.ts とは別の設定。
//   pnpm editor        → vite --config vite.editor.config.ts（開発サーバ）
//   pnpm build:editor  → dist/editor/ に静的なページとしてビルド
// イベントのファイルを読み書きするのはブラウザだけ（利用者が選んだ events/<eventId>/ に File System Access API で）。
// この設定と開発サーバはイベントのファイルを読み書きしない。
const root = import.meta.dirname;

export default defineConfig({
  plugins: [react()],
  root: resolve(root, 'src/editor'),
  // サブパスに置いても動くよう相対パスで出力
  base: './',
  publicDir: false,
  build: { outDir: resolve(root, 'dist/editor'), emptyOutDir: true },
});
