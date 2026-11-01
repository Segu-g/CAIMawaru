#!/usr/bin/env python3
"""主催が配る任意の形式のサークル情報（event.json の sources）を、正規フォーマットの
data/circles.csv と data/menus.csv に取り込む。

    取得（sources/ に元データを置く） → 変換（インポーター） → 正規フォーマット（data/*.csv） → pnpm data

使い方（EVENT にイベントのフォルダ名を指定）:
    EVENT=<slug> pnpm import-circles              # sources/ の元データから取り込む
    EVENT=<slug> pnpm import-circles --fetch      # 元データを取得してから取り込む（インポーターが fetch に対応している場合）
    EVENT=<slug> pnpm import-circles --dry-run    # 変化を表示するだけで書き込まない
    EVENT=<slug> pnpm import-circles --input <ファイル>   # source が1つのとき、元データのファイルを直接指定する
    EVENT=<slug> pnpm import-circles --list       # 使えるインポーターの一覧

- 取り込んだ列（インポーターが返した列）は毎回上書きする。返さなかった列（tags / notes など）は手で書いた値を残す
- menus.csv は取り込んだお品書き URL を追加し、手で追加した行は残す
- 公式リストから消えたサークルは知らせる（配置変更・参加取り消しの可能性。menus.csv に残った行は build.py がエラーにする）
- 書き込んだあと build.py で検証・生成する（--no-build で省略）
"""
import argparse
import csv
import re
import subprocess
import sys
from datetime import date
from pathlib import Path

# -I（隔離モード）で実行しても同じフォルダのモジュールを読めるようにする
sys.path.insert(0, str(Path(__file__).resolve().parent))

CIRCLE_COLS = ["id", "space", "event", "name", "kana", "penNames", "tags", "adult",
               "x", "pixiv", "booth", "web", "notes", "source"]
MENU_COLS = ["id", "url", "note", "checkedAt"]
TRUE_WORDS = {"1", "true", "yes", "y", "有", "あり", "○", "◯", "r18", "成人向け"}
FALSE_WORDS = {"0", "false", "no", "n", "無", "なし", "×", "-", "全年齢"}


def make_id(space):
    return re.sub(r"[^0-9A-Za-z]+", "-", space).strip("-").lower()


def as_list(value):
    if isinstance(value, (list, tuple)):
        return [s.strip() for v in value for s in str(v).split(";") if s.strip()]
    return [s.strip() for s in str(value or "").split(";") if s.strip()]


def normalize(raw, source, warnings, where):
    """インポーターが返した行を、circles.csv の文字列の行と、お品書きのリストにする。"""
    row = {}
    for key, value in raw.items():
        if key == "menus" or key not in CIRCLE_COLS:
            if key not in ("menus",):
                warnings.append(f"{where}: 正規フォーマットにない列 {key!r} は無視します")
            continue
        if key in ("penNames", "tags"):
            row[key] = ";".join(as_list(value))
        elif key == "adult":
            if isinstance(value, bool):
                row[key] = "1" if value else "0"
            else:
                v = str(value or "").strip().lower()
                row[key] = "1" if v in TRUE_WORDS else "0" if v in FALSE_WORDS else ""
                if v and not row[key]:
                    warnings.append(f"{where}: adult の値 {value!r} を判定できません（空欄にします）")
        else:
            row[key] = str(value if value is not None else "").strip()

    # X の ID・pixiv の数字だけの指定は URL にする
    x = row.get("x", "")
    if x and not x.startswith("http"):
        row["x"] = f"https://x.com/{x.lstrip('@')}"
    px = row.get("pixiv", "")
    if px.isdigit():
        row["pixiv"] = f"https://www.pixiv.net/users/{px}"

    if not row.get("id"):
        row["id"] = make_id(row.get("space", ""))
    if "source" not in raw:
        row["source"] = source.get("url") or source.get("label") or source.get("file") or source.get("type", "")

    menus = []
    for m in raw.get("menus") or []:
        url, note = (m.get("url", ""), m.get("note", "")) if isinstance(m, dict) else (str(m), "")
        if url.strip():
            menus.append((url.strip(), note.strip()))
    return row, menus


def read_rows(path):
    if not path.exists():
        return []
    with path.open(encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


def merge(imported, existing_circles, existing_menus, today):
    """取り込んだ行 [(row, menus, provided_cols)] を既存の CSV の内容と合わせる。

    返り値: (circles, menus, report)
    """
    by_id, order, provided = {}, [], set()
    for row, menus, cols in imported:
        provided |= cols
        cid = row["id"]
        if cid in by_id:
            # 複数の source に同じサークルがあれば、後の source の空でない値で上書きする
            cur, cur_menus = by_id[cid]
            cur.update({k: v for k, v in row.items() if v})
            cur_menus.extend(m for m in menus if m not in cur_menus)
        else:
            by_id[cid] = (dict(row), list(menus))
            order.append(cid)

    existing = {r["id"]: r for r in existing_circles}
    manual = [c for c in CIRCLE_COLS if c not in provided]
    circles = []
    for cid in order:
        row, _ = by_id[cid]
        old = existing.get(cid, {})
        out = {c: row.get(c, "") for c in CIRCLE_COLS}
        for c in manual:
            out[c] = old.get(c, "")
        circles.append(out)

    menus = [dict(m) for m in existing_menus]
    known = {(m["id"], m["url"]) for m in menus}
    added_menus = 0
    for cid in order:
        for url, note in by_id[cid][1]:
            if (cid, url) not in known:
                menus.append({"id": cid, "url": url, "note": note, "checkedAt": today})
                known.add((cid, url))
                added_menus += 1

    new_ids = set(order)
    changed = [cid for cid in order if cid in existing
               and any((existing[cid].get(c) or "") != circles[order.index(cid)][c] for c in CIRCLE_COLS)]
    report = {
        "added": [cid for cid in order if cid not in existing],
        "changed": changed,
        "removed": sorted(set(existing) - new_ids),
        "orphan_menus": sorted({m["id"] for m in menus if m["id"] not in new_ids}),
        "added_menus": added_menus,
        "manual_cols": manual,
    }
    return circles, menus, report


def run(args):
    import events  # EVENT が必要なので、--list のときは読まない
    import importers

    sources = events.CONFIG.get("sources") or []
    if not sources:
        sys.exit("event.json に sources（取り込み元）がありません。docs/format.md の「sources」を参照してください")
    if args.input and len(sources) != 1:
        sys.exit("--input は sources が1つのときだけ使えます")

    warnings, imported = [], []
    for i, source in enumerate(sources):
        label = source.get("name") or source.get("type") or f"sources[{i}]"
        try:
            mod = importers.load(source, events.DIR)
        except ValueError as e:
            sys.exit(f"{label}: {e}")
        default = getattr(mod, "DEFAULT_FILE", "")
        if args.input:
            path = Path(args.input).resolve()
        elif source.get("file") or default:
            path = events.DIR / (source.get("file") or default)
        else:
            sys.exit(f"{label}: 元データの file を指定してください")

        if args.fetch:
            if not callable(getattr(mod, "fetch", None)):
                sys.exit(f"{label}: このインポーターは取得（fetch）に対応していません。元データを {path} に置いてください")
            print(f"{label}: 取得しています → {path.relative_to(events.ROOT) if path.is_relative_to(events.ROOT) else path}")
            mod.fetch(source, path)
        if not path.exists():
            sys.exit(f"{label}: 元データ {path} がありません（--fetch で取得するか、手で置いてください）")

        try:
            raws = mod.read(source, path)
        except (ValueError, KeyError) as e:
            sys.exit(f"{label}: 読み取れませんでした: {e}")
        for n, raw in enumerate(raws, 1):
            where = f"{label} {n}件目"
            if not (raw.get("id") or raw.get("space")):
                warnings.append(f"{where}: id も space もないため飛ばします")
                continue
            row, menus = normalize(raw, source, warnings, where)
            cols = {k for k in raw if k in CIRCLE_COLS} | {"id", "source"}
            imported.append((row, menus, cols))
        print(f"{label}: {len(raws)} 件")

    circles, menus, report = merge(imported, read_rows(events.CIRCLES_CSV), read_rows(events.MENUS_CSV), date.today().isoformat())

    for w in warnings:
        print(f"警告: {w}", file=sys.stderr)
    print(f"サークル {len(circles)} 件（新規 {len(report['added'])}・変更 {len(report['changed'])}）、お品書きの追加 {report['added_menus']} 件")
    print(f"手で書く列（既存の値を残す）: {', '.join(report['manual_cols']) or 'なし'}")
    if report["removed"]:
        print(f"取り込み元から消えた id: {', '.join(report['removed'])}", file=sys.stderr)
    if report["orphan_menus"]:
        print(f"menus.csv に残る、サークルのない id（build.py がエラーにします）: {', '.join(report['orphan_menus'])}", file=sys.stderr)
    if args.dry_run:
        print("（--dry-run のため書き込みません）")
        return

    events.DATA.mkdir(parents=True, exist_ok=True)
    with events.CIRCLES_CSV.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=CIRCLE_COLS)
        w.writeheader()
        w.writerows(circles)
    with events.MENUS_CSV.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=MENU_COLS, extrasaction="ignore")
        w.writeheader()
        w.writerows(menus)
    print(f"{events.CIRCLES_CSV.relative_to(events.ROOT)} と {events.MENUS_CSV.name} を更新しました")
    if not args.no_build:
        sys.stdout.flush()
        sys.exit(subprocess.call([sys.executable, str(Path(__file__).resolve().parent / "build.py")]))


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--fetch", action="store_true", help="元データを取得してから取り込む")
    parser.add_argument("--input", help="元データのファイル（sources が1つのとき）")
    parser.add_argument("--dry-run", action="store_true", help="変化を表示するだけで書き込まない")
    parser.add_argument("--no-build", action="store_true", help="取り込み後に build.py を実行しない")
    parser.add_argument("--list", action="store_true", help="使えるインポーターの一覧")
    args = parser.parse_args()
    if args.list:
        import importlib
        import importers
        for kind in importers.BUILTIN:
            mod = importlib.import_module(f"importers.{kind}")
            print(f"{kind:9} {mod.DESCRIPTION}{'（取得に対応）' if hasattr(mod, 'fetch') else ''}")
        print(f"{'python':9} イベントごとの Python ファイル（events/<slug>/ に置き、module で指定）")
        return
    run(args)


if __name__ == "__main__":
    main()
