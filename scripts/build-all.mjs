// 全イベント（または引数で指定したイベント）を型チェックしてからビルドする。
//   pnpm build                          # events/ の全イベント
//   pnpm build example                  # 指定したイベントだけ
// 出力先は dist/<event.json の outDir（既定は slug）>/。outDir が入れ子になる場合（例: site と site/sub）は
// 親を先にビルドする（親のビルドは出力先を空にするため）。
import { resolve } from 'node:path';
import { binOf, eventConfig, fail, knownEvents, root, runNode, runPython } from './lib.mjs';

const all = knownEvents();
const args = process.argv.slice(2);
const unknown = args.filter((a) => !all.includes(a));
if (unknown.length) fail(`不明なイベント: ${unknown.join(', ')}（${all.join(', ')} のどれか）`);
const outDirOf = (slug) => eventConfig(slug).outDir ?? slug;
const targets = (args.length ? args : all).sort((a, b) => outDirOf(a).split('/').length - outDirOf(b).split('/').length);

// 親だけを指定してビルドすると、入れ子の子ページが消える
for (const t of targets) {
  const lost = all.filter((o) => !targets.includes(o) && outDirOf(o).startsWith(`${outDirOf(t)}/`));
  if (lost.length) console.warn(`注意: ${t} のビルドで dist/${outDirOf(t)}/ が空になるため、${lost.join(', ')} もビルドし直してください`);
}

const check = (code) => code && process.exit(code);
const tsc = binOf('typescript', 'tsc');
check(runNode(tsc));
check(runNode(tsc, ['-p', 'tsconfig.node.json']));
for (const slug of targets) {
  console.log(`\n== ${slug} → dist/${outDirOf(slug)}/`);
  check(runPython([resolve(root, 'tools', 'build.py'), slug, '--check']));
  check(runNode(binOf('vite'), ['build'], { EVENT: slug }));
}
