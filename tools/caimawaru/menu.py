"""お品書きのURLを data/menus.csv に登録し、circles.json を再生成する（caimawaru menu）。

    # Xの投稿URLなら、投稿したアカウントからサークルを自動で判定する
    caimawaru menu <eventId> "https://x.com/example_user/status/1234567890123456789"

    # まとめて登録（スペース区切り）
    caimawaru menu <eventId> "URL1" "URL2" "URL3"

    # サークルを指定する（スペース番号・id・サークル名の一部・@XのID）
    caimawaru menu <eventId> --circle A-05 "https://booth.pm/..."
    caimawaru menu <eventId> --circle 星屑 --note "新刊" "https://x.com/..."

    # 1行ずつ貼り付ける（終わったら Ctrl+D、Windows は Ctrl+Z → Enter）。行は「URL」または「サークル指定 URL」
    caimawaru menu <eventId> -

    --dry-run を付けると、判定結果を表示するだけで書き込まない。
"""
import sys
from datetime import date

from caimawaru import build
from caimawaru.build import circle_spaces
from caimawaru.console import DRY_RUN_NOTICE
from caimawaru.project import CIRCLE_COLS, MENU_COLS, Table, circle_id, is_http_url, read_csv, stripped
from caimawaru.xurl import normalize_url, x_handle

STDIN = "-"  # URL の代わりに書くと、標準入力から1行ずつ読む


def find_circles(circles, query):
    """検索語に一致するサークルを返す。完全一致（id・スペース・XのID）を優先し、なければサークル名の部分一致。"""
    text = query.strip()
    key = text.lower().lstrip("@")
    if not key:
        return []  # 空・「@」だけの指定は、スペースや X が空欄のサークルに当たらないようにする
    exact = [
        circle for circle in circles
        if circle["id"] == key
        or circle["space"].strip().lower() == key  # 「A-01,A-02」のようにまとめた書き方そのもの
        or key in (space.lower() for space in circle_spaces(circle))  # 複数スペースのどれか
        or x_handle(circle) == key
    ]
    if exact:
        return exact
    return [circle for circle in circles if text in circle["name"] or text in circle.get("kana", "")]


def describe(circle):
    return f"{circle['space']} {circle['name']}（{circle['event']}）"


def choose(candidates, label):
    """候補が複数あるときは端末で選ばせる。端末でなければ選べないのでエラーにする。"""
    if len(candidates) == 1:
        return candidates[0]
    if not candidates:
        print(f"  ✗ {label}: 該当するサークルがありません", file=sys.stderr)
        return None
    if not sys.stdin.isatty():
        print(f"  ✗ {label}: 候補が複数あります。--circle でスペース番号を指定してください", file=sys.stderr)
        for circle in candidates:
            print(f"      {describe(circle)}", file=sys.stderr)
        return None
    print(f"  {label}: 候補が複数あります")
    for number, circle in enumerate(candidates, 1):
        print(f"    {number}. {describe(circle)}")
    while True:
        answer = input("  番号を選んでください（空欄でスキップ）: ").strip()
        if not answer:
            return None
        if answer.isdigit() and 1 <= int(answer) <= len(candidates):
            return candidates[int(answer) - 1]


def resolve(circles, url, query):
    """登録するURLとサークルを決める。(サークル, そろえた URL) を返し、失敗したら None。"""
    url, post_handle = normalize_url(url)
    if not is_http_url(url):
        print(f"  ✗ URLではありません: {url}", file=sys.stderr)
        return None
    if query:
        circle = choose(find_circles(circles, query), query)
    elif post_handle:
        circle = choose([circle for circle in circles if x_handle(circle) == post_handle.lower()], f"@{post_handle}")
    else:
        print(f"  ✗ {url}: Xの投稿URL以外は --circle でサークルを指定してください", file=sys.stderr)
        return None
    return (circle, url) if circle else None


def parse_stdin_line(line):
    """「URL」または「サークル指定 URL」を (サークル指定か None, URL) にする。空行は None。"""
    words = line.split()
    if not words:
        return None
    url = words[-1]
    query = " ".join(words[:-1]) or None
    return query, url


def _read_pasted_lines(default_query):
    """標準入力の行を [(サークル指定, URL)] にする。サークル指定のない行は default_query（--circle）。"""
    if sys.stdin.isatty():
        print("URLを1行ずつ貼り付けてください（「サークル指定 URL」も可）。終わったら Ctrl+D（Windows は Ctrl+Z → Enter）")
    entries = []
    for line in sys.stdin.read().splitlines():
        parsed = parse_stdin_line(line)
        if parsed:
            query, url = parsed
            entries.append((query or default_query, url))
    return entries


def run(event, urls, circle=None, note="", dry_run=False):
    """登録する。終了コードを返す。"""
    # id が空欄のサークルはスペース番号から作った id で扱う（build と同じ。menus.csv にはこの id を書く）
    circles = [{**row, "id": circle_id(row)} for row in read_csv(event.circles_csv, CIRCLE_COLS)]
    table = Table(event.menus_csv, MENU_COLS)  # 書き戻す（ファイルにだけある列・「#」の行も残す）
    registered = {(stripped(row, "id"), stripped(row, "url")) for row in table.data_rows()}

    entries = []  # (サークル指定, URL)
    for url in urls:
        if url == STDIN:
            entries += _read_pasted_lines(circle)
        else:
            entries.append((circle, url))

    today = date.today().isoformat()
    added = failed = 0
    for query, url in entries:
        resolved = resolve(circles, url, query)
        if not resolved:
            failed += 1
            continue
        target, url = resolved
        if (target["id"], url) in registered:
            print(f"  - 登録済み: {target['id']}  {describe(target)}  {url}")
            continue
        registered.add((target["id"], url))
        table.rows.append({"id": target["id"], "url": url, "note": note, "checkedAt": today})
        added += 1
        print(f"  ✓ {target['id']}  {describe(target)}  {url}")

    if dry_run:
        print(f"{DRY_RUN_NOTICE}{added} 件を登録できます")
        return 0
    if not added:
        print("登録したお品書きはありません")
        return 1 if failed else 0

    table.write()
    print(f"{added} 件を {event.rel(event.menus_csv)} に登録しました" + (f"（{failed} 件は登録できませんでした）" if failed else ""))
    # 表示用データを作り直す（検証エラーがあれば知らせる）
    return build.run(event)
