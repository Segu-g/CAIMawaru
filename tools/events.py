"""イベントごとのデータの置き場所。どのイベントかは引数で指定する（tools/ のツールに共通。規則は tools/eventargs.py）:

    python3 tools/build.py example --check      # 最初の引数がイベントのフォルダ名（eventId）
    python3 tools/build.py --check --event example

    （pnpm data example のように pnpm から呼ぶときも同じ）

events/<eventId>/
    event.json            設定とイベント情報（直接編集）
    layout.json           配置図（任意。なければ配置図なし）
    sources/              主催が配る元データ（任意の形式。pnpm import-circles が data/ に変換する）
    data/circles.csv      サークル情報（イベントデータ。直接編集・pnpm import-circles）
    data/menus.csv        お品書きのURL（イベントデータ。直接編集・pnpm menu・pnpm import-circles）
    public/data/circles.json  ページが読み込むデータ（build.py が生成）

イベントデータの仕様は docs/event-data.md。
"""
import json
import sys
from pathlib import Path

from eventargs import EVENTS_DIR, known_events, take_event

ROOT = Path(__file__).resolve().parent.parent

try:
    NAME, _rest = take_event(sys.argv[1:])
except ValueError as e:
    sys.exit(str(e))
if NAME not in known_events():
    names = ", ".join(known_events()) or "events/ にイベントがありません。pnpm new-event <eventId> で作成できます"
    # 最初の引数がイベント名のつもりで間違っている場合（オプションや URL ではない）も知らせる
    guess = NAME or next((a for a in _rest[:1] if not a.startswith("-") and "://" not in a), "")
    what = f"イベント '{guess}' がありません" if guess else "イベントを指定してください"
    sys.exit(f"{what}（{names}）\n例: pnpm data <eventId>")
# ツールの argparse が見るのは、イベントの指定を除いた引数
sys.argv[1:] = _rest
DIR = EVENTS_DIR / NAME
CONFIG_JSON = DIR / "event.json"
CONFIG = json.loads(CONFIG_JSON.read_text(encoding="utf-8"))
LAYOUT_JSON = DIR / "layout.json"
DATA = DIR / "data"
CIRCLES_CSV = DATA / "circles.csv"
MENUS_CSV = DATA / "menus.csv"
OUT_JSON = DIR / "public" / "data" / "circles.json"
