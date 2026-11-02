"""新しいイベントのフォルダ events/<eventId>/ を作る（caimawaru new-event）。

    caimawaru new-event <eventId> [--name 表示名] [--date YYYY-MM-DD] [--venue 会場]
                                  [--sockbase URL] [--map]

    <eventId> は英数字・ハイフン・アンダースコア（例: 2027-03-21-mycon）。★・タグの保存先（storeId）の既定値にもなる。
    --sockbase を付けると、取り込み元（sources）に Sockbase の公式リストを入れる。
    ほかの形式（CSV・JSON・独自形式）は event.json の sources に書く（docs/importers.md）。
    --map を付けると配置図の雛形 layout.json も作る（主催が配置図の二次利用を認めているときだけ載せる）。

作ったあとは event.json を埋め、docs/new-event.md の手順でサークル情報を入れる。
"""
import re

from caimawaru.project import CIRCLE_COLS, EVENT_ID, MENU_COLS, CliError, Event, format_json, write_csv

# 配置図の雛形（--map）。docs/layout.md の書き方の例を兼ねる
LAYOUT_TEMPLATE = {
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


def _config(args):
    """event.json の雛形。"""
    name = args.name or args.event_id
    links = [{"label": "公式サイト", "url": "https://example.com/"}]
    if args.sockbase:
        links.append({"label": "公式サークルリスト（Sockbase）", "url": args.sockbase})
    return {
        "storeId": args.event_id,
        "title": f"{name} サークルリスト",
        "sources": [{"type": "sockbase", "url": args.sockbase}] if args.sockbase else [],
        "info": {
            "name": name,
            "date": args.date,
            "venue": args.venue,
            "hours": "",
            "links": links,
            "hashtags": [],
            "eventSlots": {name: 1},
        },
    }


def _print_next_steps(args):
    event_id = args.event_id
    print(f"events/{event_id}/ を作りました。次に:")
    print(f"  1. events/{event_id}/event.json を埋める（storeId は公開後に変えない）")
    if args.sockbase:
        print(f"  2. 公式リストを取得して取り込む: caimawaru import {event_id} --fetch")
    else:
        print(f"  2. 主催の元データを events/{event_id}/sources/ に置いて event.json の sources に書き、caimawaru import {event_id}")
        print(f"     （または events/{event_id}/data/circles.csv に直接書く）")
    print(f"  3. caimawaru data {event_id}（検証・生成）→ pnpm dev {event_id}（ページの確認）")


def run(events_dir, args):
    """args は argparse の結果（event_id, name, date, venue, sockbase, map）。終了コードを返す。"""
    if not EVENT_ID.fullmatch(args.event_id):
        raise CliError("eventId は英数字・ハイフン・アンダースコアにしてください")
    if args.date and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", args.date):
        raise CliError("--date は YYYY-MM-DD で指定してください")
    event = Event(events_dir, args.event_id)
    if event.dir.exists():
        raise CliError(f"events/{args.event_id}/ はすでにあります")

    event.data_dir.mkdir(parents=True)
    event.sources_dir.mkdir()
    event.out_json.parent.mkdir(parents=True)
    event.config_json.write_text(format_json(_config(args)), encoding="utf-8")
    write_csv(event.circles_csv, CIRCLE_COLS, [])
    write_csv(event.menus_csv, MENU_COLS, [])
    if args.map:
        event.layout_json.write_text(format_json(LAYOUT_TEMPLATE), encoding="utf-8")
    _print_next_steps(args)
    return 0
