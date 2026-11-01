// 全イベント（または引数で指定したイベント）を型チェックしてからビルドする。
//   pnpm build                          # events/ の全イベント
//   pnpm build example                  # 指定したイベントだけ
// 出力先は dist/<event.json の outDir（既定は slug）>/。outDir が入れ子になる場合（例: site と site/sub）は
// 親を先にビルドする（親のビルドは出力先を空にするため）。
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const all = readdirSync(resolve(root, 'events'), { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(resolve(root, 'events', d.name, 'event.json')))
  .map((d) => d.name);
const args = process.argv.slice(2);
const unknown = args.filter((a) => !all.includes(a));
if (unknown.length) {
  console.error(`不明なイベント: ${unknown.join(', ')}（${all.join(', ')} のどれか）`);
  process.exit(1);
}
const outDirOf = (slug) => JSON.parse(readFileSync(resolve(root, 'events', slug, 'event.json'), 'utf-8')).outDir ?? slug;
const targets = (args.length ? args : all).sort((a, b) => outDirOf(a).split('/').length - outDirOf(b).split('/').length);

// 親だけを指定してビルドすると、入れ子の子ページが消える
for (const t of targets) {
  const lost = all.filter((o) => !targets.includes(o) && outDirOf(o).startsWith(`${outDirOf(t)}/`));
  if (lost.length) console.warn(`注意: ${t} のビルドで dist/${outDirOf(t)}/ が空になるため、${lost.join(', ')} もビルドし直してください`);
}

const run = (cmd, argv, env = {}) => execFileSync(cmd, argv, { cwd: root, stdio: 'inherit', env: { ...process.env, ...env } });
run('pnpm', ['exec', 'tsc']);
run('pnpm', ['exec', 'tsc', '-p', 'tsconfig.node.json']);
for (const slug of targets) {
  console.log(`\n== ${slug} → dist/${outDirOf(slug)}/`);
  run('python3', ['tools/build.py', '--check'], { EVENT: slug });
  run('pnpm', ['exec', 'vite', 'build'], { EVENT: slug });
}
