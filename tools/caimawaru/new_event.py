"""新しいイベントのフォルダ events/<eventId>/ を作る（caimawaru new-event）。

    caimawaru new-event <eventId> [--name 表示名] [--date YYYY-MM-DD] [--venue 会場]
                                  [--sockbase URL] [--map]

    <eventId> は英数字・ハイフン・アンダースコア（例: 2027-03-21-mycon）。★・タグの保存先（storeId）の既定値にもなる。
    --sockbase を付けると、取り込み元（sources）に Sockbase の公式リストを入れる。
    ほかの形式（CSV・JSON・独自形式）は event.json の sources に書く（docs/importers.md）。
    --map を付けると配置図の雛形 layout.json も作る（主催が配置図の二次利用を認めているときだけ載せる）。

作ったあとは event.json を埋め、docs/new-event.md の手順でサークル情報を入れる。
"""
import json
import re

from caimawaru.project import CIRCLE_COLS, EVENT_ID, MENU_COLS, CliError, write_csv


def run(root, a):
    """a は argparse の結果（event_id, name, date, venue, sockbase, map）。終了コードを返す。"""
    if not EVENT_ID.fullmatch(a.event_id):
        raise CliError("eventId は英数字・ハイフン・アンダースコアにしてください")
    if a.date and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", a.date):
        raise CliError("--date は YYYY-MM-DD で指定してください")
    d = root / "events" / a.event_id
    if d.exists():
        raise CliError(f"events/{a.event_id}/ はすでにあります")

    name = a.name or a.event_id
    links = [{"label": "公式サイト", "url": "https://example.com/"}]
    if a.sockbase:
        links.append({"label": "公式サークルリスト（Sockbase）", "url": a.sockbase})
    config = {
        "storeId": a.event_id,
        "title": f"{name} サークルリスト",
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
    write_csv(d / "data" / "circles.csv", CIRCLE_COLS, [])
    write_csv(d / "data" / "menus.csv", MENU_COLS, [])
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
        print(f"  2. 公式リストを取得して取り込む: caimawaru import {a.event_id} --fetch")
    else:
        print(f"  2. 主催の元データを events/{a.event_id}/sources/ に置いて event.json の sources に書き、caimawaru import {a.event_id}")
        print(f"     （または events/{a.event_id}/data/circles.csv に直接書く）")
    print(f"  3. caimawaru data {a.event_id}（検証・生成）→ pnpm dev {a.event_id}（ページの確認）")
    return 0
