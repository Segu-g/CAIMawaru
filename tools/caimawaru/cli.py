"""caimawaru — イベントデータを扱う CLI。

    uv run caimawaru <command> [<eventId>] [オプション]

ページの開発・ビルド（pnpm dev / pnpm build）とは独立していて、Node は使わない。
"""
import argparse
import sys
from pathlib import Path

from caimawaru import build, edit, importing, menu, new_event
from caimawaru.project import CIRCLE_COLS, MENU_COLS, CliError, find_events_dir, known_events, load_event


def _parser():
    parser = argparse.ArgumentParser(prog="caimawaru", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--events-dir", type=Path, help="イベントのフォルダ（<eventId>/ を並べたフォルダ。既定はカレントディレクトリの events/）")
    commands = parser.add_subparsers(dest="command", required=True, metavar="<command>")

    commands.add_parser("list", help="イベントの一覧")

    command = commands.add_parser("data", help="イベントデータを検証して circles.json を生成する")
    command.add_argument("event_id", metavar="eventId")
    command.add_argument("--check", action="store_true", help="検証のみ（circles.json を書き換えない）")

    command = commands.add_parser("check", help="イベントデータを検証する（eventId を省略すると全イベント）")
    command.add_argument("event_ids", metavar="eventId", nargs="*")

    command = commands.add_parser("import", help="主催の元データ（sources）をイベントデータに取り込む")
    command.add_argument("event_id", metavar="eventId")
    command.add_argument("--fetch", action="store_true", help="元データを取得してから取り込む")
    command.add_argument("--input", help="元データのファイル（sources が1つのとき）")
    command.add_argument("--dry-run", action="store_true", help="変化を表示するだけで書き込まない")
    command.add_argument("--no-build", action="store_true", help="取り込み後に検証・生成しない")

    commands.add_parser("importers", help="使えるインポーターの一覧")

    command = commands.add_parser("menu", help="お品書きの URL を登録する", description=menu.__doc__,
                                  formatter_class=argparse.RawDescriptionHelpFormatter)
    command.add_argument("event_id", metavar="eventId")
    command.add_argument("urls", nargs="+", metavar="URL", help="お品書きの URL。「-」で標準入力から1行ずつ読む")
    command.add_argument("--circle", help="サークルの指定（スペース番号・id・サークル名の一部・@XのID）")
    command.add_argument("--note", default="", help="リンク名に添える説明（例: 新刊）")
    command.add_argument("--dry-run", action="store_true", help="判定結果を表示するだけで書き込まない")

    _add_edit_parsers(commands)

    command = commands.add_parser("new-event", help="新しいイベントのフォルダを作る", description=new_event.__doc__,
                                  formatter_class=argparse.RawDescriptionHelpFormatter)
    command.add_argument("event_id", metavar="eventId")
    command.add_argument("--name", default="")
    command.add_argument("--date", default="")
    command.add_argument("--venue", default="")
    command.add_argument("--sockbase", default="", help="Sockbase の公式サークルリストの URL")
    command.add_argument("--map", action="store_true", help="配置図の雛形 layout.json を作る")
    return parser


def _add_edit_parsers(commands):
    """circle / menus / config（tools/caimawaru/edit.py）。"""
    circle_help = "サークルの指定（スペース番号・id・@XのID・サークル名の一部）"
    key_help = "「.」区切りのキー（例: info.venue、info.links.0.url）。「.」を含むキーは親のオブジェクトごと --json で書く"

    def add_group(name, help_text):
        group = commands.add_parser(name, help=help_text, description=edit.__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
        return group.add_subparsers(dest="action", required=True, metavar="<action>")

    def add_action(actions, name, help_text, writes=False):
        action = actions.add_parser(name, help=help_text)
        action.add_argument("event_id", metavar="eventId")
        if writes:
            action.add_argument("--dry-run", action="store_true", help="変化（変更前 → 変更後）を表示し、検証するだけで書き込まない")
            action.add_argument("--no-build", action="store_true", help="書き込み後に circles.json を生成しない")
        return action

    def add_fields(action, cols):
        action.add_argument("fields", nargs="+", metavar="列名=値",
                            help=f"変更する列と値（{', '.join(cols)}。ファイルにだけある列も可）。値を空にすると空欄にする")

    def add_json_flag(action):
        action.add_argument("--json", action="store_true", help="JSON で出力する")

    actions = add_group("circle", "サークル（circles.csv）を確かめる・追加・変更・削除する")
    action = add_action(actions, "list", "サークルの一覧（サークル指定で絞り込み）")
    action.add_argument("query", nargs="?", metavar="サークル指定", help=circle_help)
    action.add_argument("--event", dest="event_name", help="参加イベント（event 列）で絞り込む")
    add_json_flag(action)
    action = add_action(actions, "show", "サークル1件の全列とお品書き")
    action.add_argument("query", metavar="サークル指定", help=circle_help)
    add_json_flag(action)
    action = add_action(actions, "add", "サークルを追加する（id を省くとスペース番号から作る）", writes=True)
    add_fields(action, CIRCLE_COLS)
    action = add_action(actions, "set", "サークルの列を変更する", writes=True)
    action.add_argument("query", metavar="サークル指定", help=circle_help)
    add_fields(action, CIRCLE_COLS)
    action.add_argument("--force", action="store_true",
                        help="サークルの id の変更を許す（id は閲覧者の ★・タグ・メモが参照するので公開後は変えない。menus.csv の id も書き換える）")
    action = add_action(actions, "remove", "サークルを削除する", writes=True)
    action.add_argument("query", metavar="サークル指定", help=circle_help)
    action.add_argument("--with-menus", action="store_true", help="そのサークルのお品書き（menus.csv の行）も削除する")

    actions = add_group("menus", "お品書き（menus.csv）を確かめる・変更・削除する（追加は caimawaru menu）")
    action = add_action(actions, "list", "お品書きの一覧（サークル指定で絞り込み）")
    action.add_argument("query", nargs="?", metavar="サークル指定", help=circle_help)
    add_json_flag(action)
    for name, help_text in (("set", "お品書きの列を変更する"), ("remove", "お品書きを削除する")):
        action = add_action(actions, name, help_text, writes=True)
        action.add_argument("query", metavar="サークル指定", help=circle_help + "。circles.csv にない id も可")
        if name == "set":
            add_fields(action, MENU_COLS)
        action.add_argument("--url", help="対象のお品書きの URL（そのサークルに複数あるとき）")
        action.add_argument("--all", action="store_true", help="そのサークルのお品書きすべてを対象にする")

    actions = add_group("config", "event.json の値を確かめる・変更する")
    action = add_action(actions, "get", "値を JSON で表示する（キーを省くと全体）")
    action.add_argument("key", nargs="?", metavar="キー", help=key_help)
    for name, help_text in (("set", "値を変更する（途中のオブジェクトがなければ作る）"), ("unset", "キーを削除する")):
        action = add_action(actions, name, help_text, writes=True)
        action.add_argument("key", metavar="キー", help=key_help)
        if name == "set":
            action.add_argument("value", metavar="値")
            action.add_argument("--json", action="store_true", help="値を JSON として読む（数・真偽値・配列・オブジェクト）。付けなければ文字列")
        action.add_argument("--force", action="store_true",
                            help="storeId の変更を許す（★・タグ・メモの保存先なので公開後は変えない）")


def _check_events(events_dir, event_ids):
    """eventId ごとに検証する。1つでもエラーがあれば終了コード 1。"""
    failed = 0
    for event_id in event_ids or known_events(events_dir):
        print(f"{event_id}: ", end="", flush=True)
        failed += build.run(load_event(events_dir, event_id), check=True) != 0
    return 1 if failed else 0


def _run(args):
    if args.command == "importers":
        importing.list_importers()
        return 0
    events_dir = find_events_dir(args.events_dir)
    if args.command == "list":
        for event_id in known_events(events_dir):
            print(event_id)
        return 0
    if args.command == "new-event":
        return new_event.run(events_dir, args)
    if args.command == "check":
        return _check_events(events_dir, args.event_ids)

    event = load_event(events_dir, args.event_id)
    if args.command == "data":
        return build.run(event, check=args.check)
    if args.command == "import":
        return importing.run(event, fetch=args.fetch, input_file=args.input, dry_run=args.dry_run, no_build=args.no_build)
    if args.command == "menu":
        return menu.run(event, args.urls, circle=args.circle, note=args.note, dry_run=args.dry_run)
    if args.command in ("circle", "menus", "config"):
        return edit.run(event, args)
    raise AssertionError(args.command)


def main(argv=None):
    # 日本語の出力を Windows の既定の文字コード（cp1252 など）に左右されないようにする
    # （menu の「-」で貼り付ける標準入力も同じ）
    for stream in (sys.stdin, sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")
    args = _parser().parse_args(argv)
    try:
        return _run(args)
    except CliError as error:
        print(error, file=sys.stderr)
        return 1
