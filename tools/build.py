#!/usr/bin/env python3
"""events/<slug>/ の event.json・layout.json・data/*.csv から public/data/circles.json を生成し、内容を検証する。

使い方（EVENT にイベントのフォルダ名を指定）:
    EVENT=<slug> python3 tools/build.py            # 生成して書き込み（= EVENT=<slug> pnpm data）
    EVENT=<slug> python3 tools/build.py --check    # 検証のみ（書き込まない）

circles.csv の列:
    id, space, event, name, kana, penNames, tags, adult, x, pixiv, booth, web, notes, source
    - event は参加イベント名（合同開催のどのイベントか）
    - penNames / tags は「;」区切り
    - adult は成人向け頒布物ありなら 1
    - id を空にするとスペース番号から自動生成
menus.csv の列:
    id, url, note, checkedAt
    - id は circles.csv の id。1サークルに複数行可
"""
import argparse
import csv
import json
import re
import sys
from datetime import date
from pathlib import Path
from urllib.parse import urlparse

from events import CIRCLES_CSV, CONFIG, CONFIG_JSON, LAYOUT_JSON, MENUS_CSV, OUT_JSON, ROOT  # イベントの切り替えは EVENT 環境変数

LINK_KEYS = ("x", "pixiv", "booth", "web")
POST_URL = re.compile(r"^https://(x|twitter)\.com/[A-Za-z0-9_]{1,15}/status/\d+")
# プロフィールや検索結果など、投稿以外のXページを誤って登録していないかの確認用
X_PAGE = re.compile(r"^https?://(?:www\.|mobile\.)?(x|twitter)\.com/", re.IGNORECASE)


def read_csv(path):
    if not path.exists():
        return []
    with path.open(encoding="utf-8-sig", newline="") as f:
        # 2行目以降。空行と「#」で始まる行は無視
        return [
            {k: (v or "").strip() for k, v in row.items() if k}
            for row in csv.DictReader(f)
            if any((v or "").strip() for v in row.values())
            and not (row.get("id") or row.get("space") or "").startswith("#")
        ]


def split_list(value):
    return [s.strip() for s in value.split(";") if s.strip()]


def is_http_url(value):
    u = urlparse(value)
    return u.scheme in ("http", "https") and bool(u.netloc)


def make_id(space):
    return re.sub(r"[^0-9A-Za-z]+", "-", space).strip("-").lower()


def build(errors, warnings):
    circles = []
    seen = {}
    for line, row in enumerate(read_csv(CIRCLES_CSV), start=2):
        where = f"circles.csv:{line}"
        cid = row.get("id") or make_id(row.get("space", ""))
        if not cid:
            errors.append(f"{where}: id もスペース番号もありません")
            continue
        if cid in seen:
            errors.append(f"{where}: id '{cid}' が重複しています（{seen[cid]} と同じ）")
            continue
        seen[cid] = where
        if not row.get("name"):
            errors.append(f"{where}: サークル名（name）が空です")
        if not row.get("space"):
            warnings.append(f"{where}: スペース番号が未入力です")

        links = {}
        for key in LINK_KEYS:
            url = row.get(key, "")
            if not url:
                continue
            if is_http_url(url):
                links[key] = url
            else:
                errors.append(f"{where}: {key} のURLが不正です: {url}")
        source = row.get("source", "")
        if not source:
            warnings.append(f"{where}: 情報の出典（source）が未入力です")

        adult = row.get("adult", "")
        if adult not in ("", "0", "1"):
            errors.append(f"{where}: adult は 0 / 1 / 空欄のいずれかにしてください: {adult}")
        if not row.get("event"):
            warnings.append(f"{where}: 参加イベント（event）が未入力です")

        circle = {
            "id": cid,
            "space": row.get("space", ""),
            "event": row.get("event", ""),
            "name": row.get("name", ""),
            "kana": row.get("kana", ""),
            "penNames": split_list(row.get("penNames", "")),
            "tags": split_list(row.get("tags", "")),
            "adult": adult == "1",
            "links": links,
            "menus": [],
            "notes": row.get("notes", ""),
            "source": source,
        }
        circles.append(circle)

    by_id = {c["id"]: c for c in circles}
    for line, row in enumerate(read_csv(MENUS_CSV), start=2):
        where = f"menus.csv:{line}"
        cid, url = row.get("id", ""), row.get("url", "")
        if cid not in by_id:
            errors.append(f"{where}: circles.csv に id '{cid}' がありません")
            continue
        if not is_http_url(url):
            errors.append(f"{where}: URLが不正です: {url}")
            continue
        # X以外（BOOTH・画像など）はそのまま掲載。Xのページなのに投稿でないものだけ警告する
        if X_PAGE.match(url) and not POST_URL.match(url):
            warnings.append(f"{where}: Xの投稿ではないページです（プロフィール等を登録していませんか）: {url}")
        # 追跡用パラメータ（?s=20 など）を除去
        clean = url.split("?")[0] if POST_URL.match(url) else url
        if any(m["url"] == clean for m in by_id[cid]["menus"]):
            warnings.append(f"{where}: 同じURLが重複しています: {clean}")
            continue
        by_id[cid]["menus"].append(
            {"url": clean, "note": row.get("note", ""), "checkedAt": row.get("checkedAt", "")}
        )
    return circles


INFO_REQUIRED = ("name", "date", "venue")
ISLAND_ORDERS = {1: ("down", "up", "right", "left"), 2: ("up-down", "down-up", "right-left", "left-right")}


def check_config(errors, warnings):
    """event.json の検証。info（ページに出すイベント情報）を返す。"""
    where = CONFIG_JSON.relative_to(ROOT)
    for key in ("storeId", "title"):
        if not CONFIG.get(key):
            errors.append(f"{where}: {key} がありません")
    info = dict(CONFIG.get("info") or {})
    for key in INFO_REQUIRED:
        if not info.get(key):
            warnings.append(f"{where}: info.{key} が未入力です")
    info.setdefault("name", "")
    info.setdefault("date", "")
    info.setdefault("venue", "")
    info.setdefault("hours", "")
    info.setdefault("links", [])
    info.setdefault("hashtags", [])
    for link in info["links"]:
        if not is_http_url(link.get("url", "")):
            errors.append(f"{where}: info.links の URL が不正です: {link}")
    slots = info.get("eventSlots") or {}
    for ev, n in slots.items():
        if not (isinstance(n, int) and 1 <= n <= 5):
            errors.append(f"{where}: info.eventSlots の {ev} は 1〜5 にしてください: {n}")
    for n in (info.get("slotColors") or {}):
        if n not in ("1", "2", "3", "4", "5"):
            errors.append(f"{where}: info.slotColors の枠 {n} は 1〜5 にしてください")
    contact = info.get("contact")
    if contact and not is_http_url(contact.get("url", "")):
        errors.append(f"{where}: info.contact.url が不正です: {contact}")
    return info


def layout_spaces(layout, errors):
    """layout.json のスペース番号の一覧。src/layout.ts の buildLayout と同じ規則で数える。"""
    where = LAYOUT_JSON.relative_to(ROOT)
    spaces = []
    if not isinstance(layout.get("hall"), dict):
        errors.append(f"{where}: hall（ホールの矩形）がありません")
    for isl in layout.get("islands", []):
        cols, rows = isl.get("columns"), isl.get("rows")
        name = isl.get("name", "?")
        if cols not in (1, 2) or not isinstance(rows, int) or rows < 1:
            errors.append(f"{where}: 島 {name}: columns は 1 か 2、rows は 1 以上の整数にしてください")
            continue
        order = isl.get("order", ISLAND_ORDERS[cols][0])
        if order not in ISLAND_ORDERS[cols]:
            errors.append(f"{where}: 島 {name}: {cols}列の order は {' / '.join(ISLAND_ORDERS[cols])} のどれかです: {order}")
        start, sep, digits = isl.get("start", 1), isl.get("separator", "-"), isl.get("digits", 2)
        spaces += [f"{name}{sep}{str(start + i).zfill(digits)}" for i in range(rows * cols)]
    spaces += [c.get("space", "") for c in layout.get("cells", [])]
    seen = set()
    for s in spaces:
        if s in seen:
            errors.append(f"{where}: スペース {s} が重複しています")
        seen.add(s)
    return seen


def circle_spaces(circle):
    """「A-01,A-02」のような複数スペース。src/filter.ts の spacesOf と同じ規則（「,」区切り）。"""
    return [s.strip() for s in circle["space"].split(",") if s.strip()]


def check_layout(circles, errors, warnings):
    if not LAYOUT_JSON.exists():
        return None
    where = LAYOUT_JSON.relative_to(ROOT)
    try:
        layout = json.loads(LAYOUT_JSON.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        errors.append(f"{where}: JSON として読めません: {e}")
        return None
    layout.pop("$comment", None)
    expected = layout.pop("expectedSpaces", None)
    spaces = layout_spaces(layout, errors)
    # 公式配置図のスペース数を書いておくと、描き起こしの数え間違いに気づける
    if expected is not None and expected != len(spaces):
        errors.append(f"{where}: スペース数 {len(spaces)} が expectedSpaces {expected} と一致しません")
    for c in circles:
        for s in circle_spaces(c):
            if s and s not in spaces:
                errors.append(f"{where}: {c['id']}（{c['name']}）のスペース {s} が配置図にありません")
    return layout


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--check", action="store_true", help="検証のみ行い、circles.json を書き換えない")
    args = parser.parse_args()

    errors, warnings = [], []
    info = check_config(errors, warnings)
    circles = build(errors, warnings)
    layout = check_layout(circles, errors, warnings)

    for w in warnings:
        print(f"警告: {w}", file=sys.stderr)
    for e in errors:
        print(f"エラー: {e}", file=sys.stderr)
    with_menu = sum(1 for c in circles if c["menus"])
    print(f"サークル {len(circles)} 件（お品書きあり {with_menu} 件）、エラー {len(errors)} 件、警告 {len(warnings)} 件")
    if errors:
        sys.exit(1)
    if args.check:
        return

    out = {"event": info, "circles": circles}
    if layout is not None:
        out["layout"] = layout
    # 「サークル情報の更新」日は、サークル情報（お品書きを含む）が変わったときだけ今日にする。
    # event.json のイベント情報や配置図だけの変更では変えない
    prev = json.loads(OUT_JSON.read_text(encoding="utf-8")) if OUT_JSON.exists() else {}
    prev_updated = prev.get("event", {}).get("updatedAt")
    unchanged = prev.get("circles") == circles and prev_updated
    info["updatedAt"] = prev_updated if unchanged else date.today().isoformat()
    out = {"event": info, "circles": circles, **({"layout": layout} if layout is not None else {})}
    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUT_JSON.write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"{OUT_JSON.relative_to(ROOT)} を更新しました")


if __name__ == "__main__":
    main()
