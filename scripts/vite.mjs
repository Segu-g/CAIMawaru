// イベントを指定して Vite を起動する。
//   pnpm dev <eventId> [Vite のオプション…]       開発サーバ（例: pnpm dev example --host）
//   pnpm preview <eventId> [Vite のオプション…]   ビルド結果の確認（先に pnpm build <eventId>）
// イベントは --event <eventId> でも指定できる。
import { INTERNAL_EVENT_ENV, binOf, requireEvent, runNode } from './lib.mjs';

const [mode, ...args] = process.argv.slice(2);
const { eventId, rest } = requireEvent(args, `pnpm ${mode === 'preview' ? 'preview' : 'dev'} <eventId>`);
const viteArgs = mode === 'preview' ? ['preview', ...rest] : rest;
process.exit(runNode(binOf('vite'), viteArgs, { [INTERNAL_EVENT_ENV]: eventId }));
