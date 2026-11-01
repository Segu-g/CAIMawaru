#!/usr/bin/env python3
"""Sockbase の公式サークルリストを events/<slug>/data/circles.csv と menus.csv に取り込む。

公式リスト（event.json の sockbase）は JavaScript で描画されるため、ブラウザで描画済みの HTML を保存してから渡す:

    mkdir -p /tmp/sockbase
    google-chrome --headless=new --virtual-time-budget=15000 --dump-dom <sockbase の URL> > /tmp/sockbase/list.html
    EVENT=<slug> python3 -I tools/import_sockbase.py /tmp/sockbase/list.html
    EVENT=<slug> python3 tools/build.py

ページ内の astro-island（SpaceMapViewer）の props を読んでいるため、Sockbase 側の変更で壊れることがある。

- Sockbase 由来の列（スペース・サークル名・ペンネーム・リンク等）は毎回上書きする
- 手で追記した tags / booth / notes は id が同じなら引き継ぐ
- menus.csv は Sockbase のお品書きURLを追加し、手で追加した行は残す
- サークルカット画像は取り込まない
"""
import csv
import html
import json
import re
import sys
from datetime import date
from pathlib import Path

# -I（隔離モード）で実行しても同じフォルダの events.py を読めるようにする
sys.path.insert(0, str(Path(__file__).resolve().parent))
from events import CIRCLES_CSV, MENUS_CSV, SOURCE  # noqa: E402  イベントの切り替えは EVENT 環境変数

CIRCLE_COLS = ["id", "space", "event", "name", "kana", "penNames", "tags", "adult",
               "x", "pixiv", "booth", "web", "notes", "source"]
MANUAL_COLS = ("tags", "booth", "notes")
MENU_COLS = ["id", "url", "note", "checkedAt"]


def astro(v):
    # Astro の props シリアライズ形式 [型, 値]（0=値, 1=配列）を素の値に戻す
    if isinstance(v, list) and len(v) == 2 and isinstance(v[0], int):
        t, x = v
        return [astro(i) for i in x] if t == 1 else astro(x)
    if isinstance(v, dict):
        return {k: astro(x) for k, x in v.items()}
    if isinstance(v, list):
        return [astro(i) for i in v]
    return v


def load_spaces(path):
    src = Path(path).read_text(encoding="utf-8")
    m = re.search(r'<astro-island[^>]*component-url="[^"]*SpaceMapViewer[^"]*"[^>]*props="([^"]*)"', src)
    if not m:
        sys.exit("サークルデータが見つかりません。描画済みのHTML（--dump-dom の出力）を指定してください。")
    return astro(json.loads(html.unescape(m.group(1))))["spaces"]


def read_rows(path):
    if not path.exists():
        return []
    with path.open(encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    if not SOURCE:
        sys.exit("event.json に sockbase（公式サークルリストの URL）を書いてください。source 列に使います")
    spaces = load_spaces(sys.argv[1])
    existing = {r["id"]: r for r in read_rows(CIRCLES_CSV)}
    menus = read_rows(MENUS_CSV)
    known_menus = {(r["id"], r["url"]) for r in menus}
    today = date.today().isoformat()

    rows = []
    for s in spaces:
        links = s["links"]
        space = s["spaceName"].strip()
        cid = space.replace(",", "-").lower()
        tw = links["twitterScreenName"].strip().lstrip("@")
        px = links["pixivUserId"].strip()
        row = {
            "id": cid,
            "space": space,
            "event": s["eventName"].strip(),
            "name": s["circleName"].strip(),
            "kana": s["circleNameYomi"].strip(),
            "penNames": s["penName"].strip(),
            "tags": "",
            "adult": "1" if s["hasAdult"] else "0",
            "x": f"https://x.com/{tw}" if tw else "",
            "pixiv": f"https://www.pixiv.net/users/{px}" if px else "",
            "booth": "",
            "web": links["websiteURL"].strip(),
            "notes": "",
            "source": SOURCE,
        }
        for col in MANUAL_COLS:
            row[col] = existing.get(cid, {}).get(col, "")
        rows.append(row)

        url = links["menuURL"].strip()
        if url and (cid, url) not in known_menus:
            menus.append({"id": cid, "url": url, "note": "", "checkedAt": today})
            known_menus.add((cid, url))

    removed = sorted(set(existing) - {r["id"] for r in rows})

    CIRCLES_CSV.parent.mkdir(parents=True, exist_ok=True)
    with CIRCLES_CSV.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=CIRCLE_COLS)
        w.writeheader()
        w.writerows(rows)
    with MENUS_CSV.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=MENU_COLS, extrasaction="ignore")
        w.writeheader()
        w.writerows(menus)

    print(f"サークル {len(rows)} 件を取り込みました（お品書き {len(menus)} 件）")
    if removed:
        # 配置変更・参加取り消しの可能性。menus.csv に残った行は build.py がエラーにする
        print(f"公式リストから消えた id: {', '.join(removed)}", file=sys.stderr)


if __name__ == "__main__":
    main()
