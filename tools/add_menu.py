#!/usr/bin/env python3
"""お品書きのURLを data/menus.csv に登録し、public/data/circles.json を再生成する。

使い方:
    # Xの投稿URLなら、投稿したアカウントからサークルを自動で判定する
    pnpm menu <eventId> https://x.com/example_user/status/1234567890123456789

    # まとめて登録（スペース区切り）
    pnpm menu <eventId> URL1 URL2 URL3

    # サークルを指定する（スペース番号・id・サークル名の一部・@XのID）
    pnpm menu <eventId> --circle A-05 https://booth.pm/...
    pnpm menu <eventId> --circle 星屑 --note 新刊 https://x.com/...

    # 1行ずつ貼り付ける（終わったら Ctrl+D）。行は「URL」または「サークル指定 URL」
    pnpm menu <eventId> -

    --dry-run を付けると、判定結果を表示するだけで書き込まない。
"""
import argparse
import csv
import re
import subprocess
import sys
from datetime import date
from pathlib import Path

import build

X_POST = re.compile(
    r"^https?://(?:www\.|mobile\.)?(?:x|twitter)\.com/([A-Za-z0-9_]{1,15})/status/(\d+)", re.IGNORECASE
)
MENU_COLS = ["id", "url", "note", "checkedAt"]


def normalize_url(url):
    """Xの投稿URLは https://x.com/<ID>/status/<番号> の形にそろえ、追跡用パラメータを落とす。"""
    m = X_POST.match(url)
    if m:
        return f"https://x.com/{m.group(1)}/status/{m.group(2)}", m.group(1)
    return url, None


def x_handle(circle):
    m = re.match(r"^https?://(?:x|twitter)\.com/([A-Za-z0-9_]{1,15})/?$", circle.get("x", ""), re.IGNORECASE)
    return m.group(1).lower() if m else None


def find_circles(circles, query):
    """検索語に一致するサークルを返す。完全一致（id・スペース・XのID）を優先し、なければサークル名の部分一致。"""
    q = query.strip()
    ql = q.lower().lstrip("@")
    exact = [
        c for c in circles
        if c["id"] == ql
        or c["space"].strip().lower() == ql  # 「A-01,A-02」のように複数スペースをまとめた書き方
        or ql in (s.strip().lower() for s in c["space"].split(","))
        or x_handle(c) == ql
    ]
    if exact:
        return exact
    return [c for c in circles if q and (q in c["name"] or q in c.get("kana", ""))]


def describe(c):
    return f"{c['space']} {c['name']}（{c['event']}）"


def choose(candidates, label):
    """候補が複数あるときは端末で選ばせる。端末でなければ選べないのでエラーにする。"""
    if len(candidates) == 1:
        return candidates[0]
    if not candidates:
        print(f"  ✗ {label}: 該当するサークルがありません", file=sys.stderr)
        return None
    if not sys.stdin.isatty():
        print(f"  ✗ {label}: 候補が複数あります。--circle でスペース番号を指定してください", file=sys.stderr)
        for c in candidates:
            print(f"      {describe(c)}", file=sys.stderr)
        return None
    print(f"  {label}: 候補が複数あります")
    for i, c in enumerate(candidates, 1):
        print(f"    {i}. {describe(c)}")
    while True:
        ans = input("  番号を選んでください（空欄でスキップ）: ").strip()
        if not ans:
            return None
        if ans.isdigit() and 1 <= int(ans) <= len(candidates):
            return candidates[int(ans) - 1]


def resolve(circles, url, query):
    """登録するURLとサークルを決める。失敗したら None。"""
    url, handle = normalize_url(url.strip())
    if not build.is_http_url(url):
        print(f"  ✗ URLではありません: {url}", file=sys.stderr)
        return None
    if query:
        circle = choose(find_circles(circles, query), query)
    elif handle:
        circle = choose([c for c in circles if x_handle(c) == handle.lower()], f"@{handle}")
    else:
        print(f"  ✗ {url}: Xの投稿URL以外は --circle でサークルを指定してください", file=sys.stderr)
        return None
    return (circle, url) if circle else None


def parse_stdin_line(line):
    """「URL」または「サークル指定 URL」。"""
    parts = line.split()
    if not parts:
        return None
    url = parts[-1]
    query = " ".join(parts[:-1]) or None
    return query, url


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("urls", nargs="+", help="お品書きのURL。「-」で標準入力から1行ずつ読む")
    parser.add_argument("--circle", help="サークルの指定（スペース番号・id・サークル名の一部・@XのID）")
    parser.add_argument("--note", default="", help="リンク名に添える説明（例: 新刊）")
    parser.add_argument("--dry-run", action="store_true", help="判定結果を表示するだけで書き込まない")
    args = parser.parse_args()

    circles = build.read_csv(build.CIRCLES_CSV)
    menus = build.read_csv(build.MENUS_CSV)
    known = {(m["id"], m["url"]) for m in menus}

    entries = []
    for u in args.urls:
        if u == "-":
            if sys.stdin.isatty():
                print("URLを1行ずつ貼り付けてください（「サークル指定 URL」も可）。終わったら Ctrl+D")
            for line in sys.stdin.read().splitlines():
                parsed = parse_stdin_line(line)
                if parsed:
                    entries.append((parsed[0] or args.circle, parsed[1]))
        else:
            entries.append((args.circle, u))

    today = date.today().isoformat()
    added = failed = 0
    for query, url in entries:
        result = resolve(circles, url, query)
        if not result:
            failed += 1
            continue
        circle, url = result
        if (circle["id"], url) in known:
            print(f"  - 登録済み: {describe(circle)}  {url}")
            continue
        known.add((circle["id"], url))
        menus.append({"id": circle["id"], "url": url, "note": args.note, "checkedAt": today})
        added += 1
        print(f"  ✓ {describe(circle)}  {url}")

    if args.dry_run:
        print(f"（--dry-run のため書き込みません）{added} 件を登録できます")
        return
    if not added:
        print("登録したお品書きはありません")
        sys.exit(1 if failed else 0)

    with build.MENUS_CSV.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=MENU_COLS, extrasaction="ignore")
        w.writeheader()
        w.writerows(menus)
    print(f"{added} 件を {build.MENUS_CSV.relative_to(build.ROOT)} に登録しました" + (f"（{failed} 件は登録できませんでした）" if failed else ""))

    # 表示用データを作り直す（検証エラーがあれば build.py が知らせる）
    sys.stdout.flush()
    sys.exit(subprocess.call([sys.executable, str(Path(build.__file__)), "--event", build.NAME]))


if __name__ == "__main__":
    main()
