"""イベントごとのデータの置き場所。どのイベントかは、次の順で決める（tools/ のツールに共通）:

    1. 引数 --event <slug>（--event=<slug>）
    2. 最初の引数がイベントのフォルダ名なら、それ   例: python3 tools/build.py example --check
    3. 環境変数 EVENT

    （pnpm data example のように pnpm から呼ぶときも同じ）

events/<slug>/
    event.json            設定とイベント情報（直接編集）
    layout.json           配置図（任意。なければ配置図なし）
    sources/              主催が配る元データ（任意の形式。pnpm import-circles が data/ に変換する）
    data/circles.csv      サークル情報（イベントデータ。直接編集・pnpm import-circles）
    data/menus.csv        お品書きのURL（イベントデータ。直接編集・pnpm menu・pnpm import-circles）
    public/data/circles.json  ページが読み込むデータ（build.py が生成）

イベントデータの仕様は docs/event-data.md。
"""
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
EVENTS_DIR = ROOT / "events"


def known_events():
    return sorted(p.parent.name for p in EVENTS_DIR.glob("*/event.json"))


def take_event(argv):
    """argv（sys.argv[1:]）からイベントの指定を取り除き、(slug, 残りの引数) を返す。"""
    rest = list(argv)
    for i, arg in enumerate(rest):
        if arg == "--event" and i + 1 < len(rest):
            return rest[i + 1], rest[:i] + rest[i + 2:]
        if arg.startswith("--event="):
            return arg.split("=", 1)[1], rest[:i] + rest[i + 1:]
    if rest and rest[0] in known_events():
        return rest[0], rest[1:]
    return os.environ.get("EVENT", ""), rest


NAME, _rest = take_event(sys.argv[1:])
if NAME not in known_events():
    names = ", ".join(known_events()) or "events/ にイベントがありません。pnpm new-event <slug> で作成できます"
    # 最初の引数がイベント名のつもりで間違っている場合（オプションや URL ではない）も知らせる
    guess = NAME or next((a for a in _rest[:1] if not a.startswith("-") and "://" not in a), "")
    what = f"イベント '{guess}' がありません" if guess else "イベントを指定してください"
    sys.exit(f"{what}（{names}）\n例: pnpm data <slug>")
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
