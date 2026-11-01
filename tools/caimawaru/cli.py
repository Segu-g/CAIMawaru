"""caimawaru — イベントデータを扱う CLI。

    uv run caimawaru <command> [<eventId>] [オプション]

ページの開発・ビルド（pnpm dev / pnpm build）とは独立していて、Node は使わない。
"""
import argparse
import sys
from pathlib import Path

from caimawaru import build, importing, menu, new_event
from caimawaru.project import CliError, find_root, known_events, load_event


def _parser():
    p = argparse.ArgumentParser(prog="caimawaru", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--root", type=Path, help="プロジェクトのフォルダ（既定はカレントディレクトリから上にたどって events/ のあるフォルダ）")
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

    s = sub.add_parser("new-event", help="新しいイベントのフォルダを作る", description=new_event.__doc__,
                       formatter_class=argparse.RawDescriptionHelpFormatter)
    s.add_argument("event_id", metavar="eventId")
    s.add_argument("--name", default="")
    s.add_argument("--date", default="")
    s.add_argument("--venue", default="")
    s.add_argument("--sockbase", default="", help="Sockbase の公式サークルリストの URL")
    s.add_argument("--out-dir", default="", help="dist/ の下の出力先（既定は eventId）")
    s.add_argument("--map", action="store_true", help="配置図の雛形 layout.json を作る")
    return p


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
    raise AssertionError(a.command)


def main(argv=None):
    # 日本語の出力を Windows の既定の文字コード（cp1252 など）に左右されないようにする
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")
    args = _parser().parse_args(argv)
    try:
        return _run(args)
    except CliError as e:
        print(e, file=sys.stderr)
        return 1
