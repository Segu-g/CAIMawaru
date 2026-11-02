"""caimawaru — イベントデータを扱う CLI。

    uv run caimawaru <command> [<eventId>] [オプション]

ページの開発・ビルド（pnpm dev / pnpm build）とは独立していて、Node は使わない。
"""
import argparse
import sys
from pathlib import Path

from caimawaru import build, edit, importing, menu, new_event
from caimawaru.project import CIRCLE_COLS, MENU_COLS, CliError, find_root, known_events, load_event


def _parser():
    p = argparse.ArgumentParser(prog="caimawaru", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--root", type=Path, help="プロジェクトのフォルダ（events/ のあるフォルダ。既定はカレントディレクトリ）")
    sub = p.add_subparsers(dest="command", required=True, metavar="<command>")

    s = sub.add_parser("list", help="イベントの一覧")

    s = sub.add_parser("data", help="イベントデータを検証して circles.json を生成する")
    s.add_argument("event_id", metavar="eventId")
    s.add_argument("--check", action="store_true", help="検証のみ（circles.json を書き換えない）")

    s = sub.add_parser("check", help="イベントデータを検証する（eventId を省略すると全イベント）")
    s.add_argument("event_ids", metavar="eventId", nargs="*")

    s = sub.add_parser("import", help="主催の元データ（sources）をイベントデータに取り込む")
    s.add_argument("event_id", metavar="eventId")
    s.add_argument("--fetch", action="store_true", help="元データを取得してから取り込む")
    s.add_argument("--input", help="元データのファイル（sources が1つのとき）")
    s.add_argument("--dry-run", action="store_true", help="変化を表示するだけで書き込まない")
    s.add_argument("--no-build", action="store_true", help="取り込み後に検証・生成しない")

    sub.add_parser("importers", help="使えるインポーターの一覧")

    s = sub.add_parser("menu", help="お品書きの URL を登録する", description=menu.__doc__,
                       formatter_class=argparse.RawDescriptionHelpFormatter)
    s.add_argument("event_id", metavar="eventId")
    s.add_argument("urls", nargs="+", metavar="URL", help="お品書きの URL。「-」で標準入力から1行ずつ読む")
    s.add_argument("--circle", help="サークルの指定（スペース番号・id・サークル名の一部・@XのID）")
    s.add_argument("--note", default="", help="リンク名に添える説明（例: 新刊）")
    s.add_argument("--dry-run", action="store_true", help="判定結果を表示するだけで書き込まない")

    _edit_parsers(sub)

    s = sub.add_parser("new-event", help="新しいイベントのフォルダを作る", description=new_event.__doc__,
                       formatter_class=argparse.RawDescriptionHelpFormatter)
    s.add_argument("event_id", metavar="eventId")
    s.add_argument("--name", default="")
    s.add_argument("--date", default="")
    s.add_argument("--venue", default="")
    s.add_argument("--sockbase", default="", help="Sockbase の公式サークルリストの URL")
    s.add_argument("--map", action="store_true", help="配置図の雛形 layout.json を作る")
    return p


def _edit_parsers(sub):
    """circle / menus / config（tools/caimawaru/edit.py）。"""
    circle_help = "サークルの指定（スペース番号・id・@XのID・サークル名の一部）"
    key_help = "「.」区切りのキー（例: info.venue、info.links.0.url）。「.」を含むキーは親のオブジェクトごと --json で書く"

    def group(name, help):
        s = sub.add_parser(name, help=help, description=edit.__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
        return s.add_subparsers(dest="action", required=True, metavar="<action>")

    def action(actions, name, help, write=False):
        s = actions.add_parser(name, help=help)
        s.add_argument("event_id", metavar="eventId")
        if write:
            s.add_argument("--dry-run", action="store_true", help="変化（変更前 → 変更後）を表示し、検証するだけで書き込まない")
            s.add_argument("--no-build", action="store_true", help="書き込み後に circles.json を生成しない")
        return s

    def fields(s, cols):
        s.add_argument("fields", nargs="+", metavar="列名=値",
                       help=f"変更する列と値（{', '.join(cols)}。ファイルにだけある列も可）。値を空にすると空欄にする")

    def json_flag(s):
        s.add_argument("--json", action="store_true", help="JSON で出力する")

    actions = group("circle", "サークル（circles.csv）を確かめる・追加・変更・削除する")
    s = action(actions, "list", "サークルの一覧（サークル指定で絞り込み）")
    s.add_argument("query", nargs="?", metavar="サークル指定", help=circle_help)
    s.add_argument("--event", dest="event_name", help="参加イベント（event 列）で絞り込む")
    json_flag(s)
    s = action(actions, "show", "サークル1件の全列とお品書き")
    s.add_argument("query", metavar="サークル指定", help=circle_help)
    json_flag(s)
    s = action(actions, "add", "サークルを追加する（id を省くとスペース番号から作る）", write=True)
    fields(s, CIRCLE_COLS)
    s = action(actions, "set", "サークルの列を変更する", write=True)
    s.add_argument("query", metavar="サークル指定", help=circle_help)
    fields(s, CIRCLE_COLS)
    s.add_argument("--force", action="store_true",
                   help="サークルの id の変更を許す（id は閲覧者の ★・タグ・メモが参照するので公開後は変えない。menus.csv の id も書き換える）")
    s = action(actions, "remove", "サークルを削除する", write=True)
    s.add_argument("query", metavar="サークル指定", help=circle_help)
    s.add_argument("--with-menus", action="store_true", help="そのサークルのお品書き（menus.csv の行）も削除する")

    actions = group("menus", "お品書き（menus.csv）を確かめる・変更・削除する（追加は caimawaru menu）")
    s = action(actions, "list", "お品書きの一覧（サークル指定で絞り込み）")
    s.add_argument("query", nargs="?", metavar="サークル指定", help=circle_help)
    json_flag(s)
    for name, help in (("set", "お品書きの列を変更する"), ("remove", "お品書きを削除する")):
        s = action(actions, name, help, write=True)
        s.add_argument("query", metavar="サークル指定", help=circle_help + "。circles.csv にない id も可")
        if name == "set":
            fields(s, MENU_COLS)
        s.add_argument("--url", help="対象のお品書きの URL（そのサークルに複数あるとき）")
        s.add_argument("--all", action="store_true", help="そのサークルのお品書きすべてを対象にする")

    actions = group("config", "event.json の値を確かめる・変更する")
    s = action(actions, "get", "値を JSON で表示する（キーを省くと全体）")
    s.add_argument("key", nargs="?", metavar="キー", help=key_help)
    for name, help in (("set", "値を変更する（途中のオブジェクトがなければ作る）"), ("unset", "キーを削除する")):
        s = action(actions, name, help, write=True)
        s.add_argument("key", metavar="キー", help=key_help)
        if name == "set":
            s.add_argument("value", metavar="値")
            s.add_argument("--json", action="store_true", help="値を JSON として読む（数・真偽値・配列・オブジェクト）。付けなければ文字列")
        s.add_argument("--force", action="store_true",
                       help="storeId の変更を許す（★・タグ・メモの保存先なので公開後は変えない）")


def _run(a):
    if a.command == "importers":
        importing.list_importers()
        return 0
    root = find_root(a.root)
    if a.command == "list":
        for event_id in known_events(root):
            print(event_id)
        return 0
    if a.command == "new-event":
        return new_event.run(root, a)
    if a.command == "check":
        failed = 0
        for event_id in a.event_ids or known_events(root):
            print(f"{event_id}: ", end="", flush=True)
            failed += build.run(load_event(root, event_id), check=True) != 0
        return 1 if failed else 0

    event = load_event(root, a.event_id)
    if a.command == "data":
        return build.run(event, check=a.check)
    if a.command == "import":
        return importing.run(event, fetch=a.fetch, input=a.input, dry_run=a.dry_run, no_build=a.no_build)
    if a.command == "menu":
        return menu.run(event, a.urls, circle=a.circle, note=a.note, dry_run=a.dry_run)
    if a.command in ("circle", "menus", "config"):
        return edit.run(event, a)
    raise AssertionError(a.command)


def main(argv=None):
    # 日本語の出力を Windows の既定の文字コード（cp1252 など）に左右されないようにする
    # （menu の「-」で貼り付ける標準入力も同じ）
    for stream in (sys.stdin, sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")
    args = _parser().parse_args(argv)
    try:
        return _run(args)
    except CliError as e:
        print(e, file=sys.stderr)
        return 1
