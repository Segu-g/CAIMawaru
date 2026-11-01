// イベントを指定して Vite を起動する。
//   pnpm dev <slug> [Vite のオプション…]       開発サーバ（例: pnpm dev example --host）
//   pnpm preview <slug> [Vite のオプション…]   ビルド結果の確認（先に pnpm build <slug>）
// イベントは --event <slug> でも、環境変数 EVENT でも指定できる。
import { binOf, requireEvent, runNode } from './lib.mjs';

const [mode, ...args] = process.argv.slice(2);
const { slug, rest } = requireEvent(args, `pnpm ${mode === 'preview' ? 'preview' : 'dev'} <slug>`);
const viteArgs = mode === 'preview' ? ['preview', ...rest] : rest;
process.exit(runNode(binOf('vite'), viteArgs, { EVENT: slug }));
