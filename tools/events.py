"""イベントごとのデータの置き場所。環境変数 EVENT（events/ の下のフォルダ名）で選ぶ。

    EVENT=example python3 tools/build.py

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


NAME = os.environ.get("EVENT", "")
if NAME not in known_events():
    names = ", ".join(known_events()) or "events/ にイベントがありません。tools/new_event.py で作成できます"
    sys.exit(f"環境変数 EVENT にイベントを指定してください（{names}）\n例: EVENT=<slug> pnpm data")

DIR = EVENTS_DIR / NAME
CONFIG_JSON = DIR / "event.json"
CONFIG = json.loads(CONFIG_JSON.read_text(encoding="utf-8"))
LAYOUT_JSON = DIR / "layout.json"
DATA = DIR / "data"
CIRCLES_CSV = DATA / "circles.csv"
MENUS_CSV = DATA / "menus.csv"
OUT_JSON = DIR / "public" / "data" / "circles.json"
