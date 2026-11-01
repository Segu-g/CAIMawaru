// 全イベント（または引数で指定したイベント）のページを、型チェックしてからビルドする（Node だけで完結）。
//   pnpm build                          # events/ の全イベント
//   pnpm build example                  # 指定したイベントだけ
// 出力先は dist/<event.json の outDir（既定は eventId）>/。outDir が入れ子になる場合（例: site と site/sub）は
// 親を先にビルドする（親のビルドは出力先を空にするため）。
import { existsSync } from 'node:fs';
import { INTERNAL_EVENT_ENV, binOf, dataJsonOf, eventConfig, fail, knownEvents, runNode } from './lib.mjs';

const all = knownEvents();
const args = process.argv.slice(2);
const unknown = args.filter((a) => !all.includes(a));
if (unknown.length) fail(`不明なイベント: ${unknown.join(', ')}（${all.join(', ')} のどれか）`);
const outDirOf = (eventId) => eventConfig(eventId).outDir ?? eventId;
const targets = (args.length ? args : all).sort((a, b) => outDirOf(a).split('/').length - outDirOf(b).split('/').length);

// 親だけを指定してビルドすると、入れ子の子ページが消える
for (const t of targets) {
  const lost = all.filter((o) => !targets.includes(o) && outDirOf(o).startsWith(`${outDirOf(t)}/`));
  if (lost.length) console.warn(`注意: ${t} のビルドで dist/${outDirOf(t)}/ が空になるため、${lost.join(', ')} もビルドし直してください`);
}

// ページが読むデータ（circles.json）は Python 側（uv run caimawaru data <eventId>）で作っておく。ここでは Python を呼ばない
const missing = targets.filter((t) => !existsSync(dataJsonOf(t)));
if (missing.length) fail(`circles.json がありません: ${missing.join(', ')}\n先に uv run caimawaru data <eventId> で作ってください`);

const check = (code) => code && process.exit(code);
const tsc = binOf('typescript', 'tsc');
check(runNode(tsc));
check(runNode(tsc, ['-p', 'tsconfig.node.json']));
for (const eventId of targets) {
  console.log(`\n== ${eventId} → dist/${outDirOf(eventId)}/`);
  check(runNode(binOf('vite'), ['build'], { [INTERNAL_EVENT_ENV]: eventId }));
}
