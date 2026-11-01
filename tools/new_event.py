#!/usr/bin/env python3
"""新しいイベントのフォルダ events/<eventId>/ を作る。

使い方:
    python3 tools/new_event.py <eventId> [--name 表示名] [--date YYYY-MM-DD] [--venue 会場]
                                      [--sockbase URL] [--out-dir 公開先] [--map]
    （= pnpm new-event <eventId> ...）

    --sockbase を付けると、取り込み元（sources）に Sockbase の公式リストを入れる。
    ほかの形式（CSV・JSON・独自形式）は event.json の sources に書く（docs/importers.md）。

    <eventId> は英数字・ハイフン（例: 2027-03-21-mycon）。★・タグの保存先（storeId）の既定値にもなる。
    --map を付けると配置図の雛形 layout.json も作る（主催が配置図の二次利用を認めているときだけ載せる）。

作ったあとは event.json を埋め、docs/new-event.md の手順でサークル情報を入れる。
"""
import argparse
import csv
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CIRCLE_COLS = ["id", "space", "event", "name", "kana", "penNames", "tags", "adult",
               "x", "pixiv", "booth", "web", "notes", "source"]
MENU_COLS = ["id", "url", "note", "checkedAt"]


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("event_id", metavar="eventId")
    p.add_argument("--name", default="")
    p.add_argument("--date", default="")
    p.add_argument("--venue", default="")
    p.add_argument("--sockbase", default="", help="Sockbase の公式サークルリストの URL")
    p.add_argument("--out-dir", default="", help="dist/ の下の出力先（既定は eventId）")
    p.add_argument("--map", action="store_true", help="配置図の雛形 layout.json を作る")
    a = p.parse_args()

    if not re.fullmatch(r"[0-9A-Za-z][0-9A-Za-z_-]*", a.event_id):
        sys.exit("eventId は英数字・ハイフン・アンダースコアにしてください")
    if a.date and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", a.date):
        sys.exit("--date は YYYY-MM-DD で指定してください")
    d = ROOT / "events" / a.event_id
    if d.exists():
        sys.exit(f"{d.relative_to(ROOT)} はすでにあります")

    name = a.name or a.event_id
    links = [{"label": "公式サイト", "url": "https://example.com/"}]
    if a.sockbase:
        links.append({"label": "公式サークルリスト（Sockbase）", "url": a.sockbase})
    config = {
        "storeId": a.event_id,
        "title": f"{name} サークルリスト",
        **({"outDir": a.out_dir} if a.out_dir else {}),
        "sources": [{"type": "sockbase", "url": a.sockbase}] if a.sockbase else [],
        "info": {
            "name": name,
            "date": a.date,
            "venue": a.venue,
            "hours": "",
            "links": links,
            "hashtags": [],
            "eventSlots": {name: 1},
        },
    }
    (d / "data").mkdir(parents=True)
    (d / "sources").mkdir()
    (d / "public" / "data").mkdir(parents=True)
    (d / "event.json").write_text(json.dumps(config, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    for path, cols in ((d / "data" / "circles.csv", CIRCLE_COLS), (d / "data" / "menus.csv", MENU_COLS)):
        with path.open("w", encoding="utf-8", newline="") as f:
            csv.writer(f).writerow(cols)
    if a.map:
        layout = {
            "$comment": "配置図の出典（公式配置図のURL）と、二次利用が認められていることを書いておく",
            "cell": {"w": 45, "h": 26},
            "hall": {"x": 0, "y": 0, "w": 1000, "h": 600},
            "islands": [
                {"name": "A", "x": 100, "y": 100, "rows": 10, "columns": 2},
                {"name": "B", "x": 300, "y": 100, "rows": 10, "columns": 2},
            ],
            "entrances": [{"label": "出入口", "rect": {"x": -20, "y": 450, "w": 36, "h": 100}}],
            "landmarks": [{"label": "本部", "rect": {"x": 600, "y": 500, "w": 200, "h": 60}, "kind": "facility"}],
        }
        (d / "layout.json").write_text(json.dumps(layout, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(f"events/{a.event_id}/ を作りました。次に:")
    print(f"  1. events/{a.event_id}/event.json を埋める（storeId は公開後に変えない）")
    if a.sockbase:
        print(f"  2. 公式リストを取得して取り込む: pnpm import-circles {a.event_id} --fetch")
    else:
        print(f"  2. 主催の元データを events/{a.event_id}/sources/ に置いて event.json の sources に書き、pnpm import-circles {a.event_id}")
        print(f"     （または events/{a.event_id}/data/circles.csv に直接書く）")
    print(f"  3. pnpm data {a.event_id} && pnpm dev {a.event_id}")


if __name__ == "__main__":
    main()
