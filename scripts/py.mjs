// tools/ の Python ツールを、OS に合った Python で起動する（python3 / python / py -3）。
//   node scripts/py.mjs <ツール名> [引数…]    例: node scripts/py.mjs build example --check
//   node scripts/py.mjs -m unittest …          Python のモジュールを直接起動
// イベントの指定（最初の引数・--event・環境変数 EVENT）は Python 側（tools/events.py）が解釈する。
import { resolve } from 'node:path';
import { fail, root, runPython } from './lib.mjs';

// 取り込みは外から取得した元データを読むので、隔離モード（-I）で起動する
const ISOLATED = new Set(['import_circles']);

const [tool, ...args] = process.argv.slice(2);
if (!tool) fail('ツール名を指定してください（build / add_menu / import_circles / new_event）');
if (tool === '-m') process.exit(runPython(['-m', ...args]));
process.exit(runPython([...(ISOLATED.has(tool) ? ['-I'] : []), resolve(root, 'tools', `${tool}.py`), ...args]));
