"""主催が配る任意の形式のサークル情報（event.json の sources）を、イベントデータの
data/circles.csv と data/menus.csv に取り込む（caimawaru import）。

    取得（sources/ に元データを置く） → 変換（インポーター） → イベントデータ（data/*.csv） → caimawaru data

- 取り込んだ列（インポーターが返した列）は毎回上書きする。返さなかった列（tags / notes など）は直接編集した値を残す
- menus.csv は取り込んだお品書き URL を追加し、直接追加した行は残す
- 公式リストから消えたサークルは知らせる（配置変更・参加取り消しの可能性。menus.csv に残った行は検証でエラーになる）
- 書き込んだあと検証・生成する（--no-build で省略）
"""
import importlib
import json
import sys
from datetime import date
from pathlib import Path

from caimawaru import build, importers
from caimawaru.project import CIRCLE_COLS, MENU_COLS, CliError, make_id, read_rows, write_csv

TRUE_WORDS = {"1", "true", "yes", "y", "有", "あり", "○", "◯", "r18", "成人向け"}
FALSE_WORDS = {"0", "false", "no", "n", "無", "なし", "×", "-", "全年齢"}


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
                warnings.append(f"{where}: イベントデータにない列 {key!r} は無視します")
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


def list_importers():
    for kind in importers.BUILTIN:
        mod = importlib.import_module(f"caimawaru.importers.{kind}")
        print(f"{kind:9} {mod.DESCRIPTION}{'（取得に対応）' if hasattr(mod, 'fetch') else ''}")
    print(f"{'python':9} イベントごとの Python ファイル（events/<eventId>/ に置き、module で指定）")


def run(event, fetch=False, input=None, dry_run=False, no_build=False):
    """取り込む。終了コードを返す。"""
    try:
        sources = event.config().get("sources") or []
    except json.JSONDecodeError as e:
        raise CliError(f"{event.rel(event.config_json)}: JSON として読めません: {e}")
    if not sources:
        raise CliError("event.json に sources（取り込み元）がありません。docs/importers.md を参照してください")
    if input and len(sources) != 1:
        raise CliError("--input は sources が1つのときだけ使えます")

    warnings, imported = [], []
    for i, source in enumerate(sources):
        label = source.get("name") or source.get("type") or f"sources[{i}]"
        try:
            mod = importers.load(source, event.dir)
        except ValueError as e:
            raise CliError(f"{label}: {e}") from e
        default = getattr(mod, "DEFAULT_FILE", "")
        if input:
            path = Path(input).resolve()
        elif source.get("file") or default:
            path = event.dir / (source.get("file") or default)
        else:
            raise CliError(f"{label}: 元データの file を指定してください")

        if fetch:
            if not callable(getattr(mod, "fetch", None)):
                raise CliError(f"{label}: このインポーターは取得（fetch）に対応していません。元データを {event.rel(path)} に置いてください")
            print(f"{label}: 取得しています → {event.rel(path)}")
            mod.fetch(source, path)
        if not path.exists():
            raise CliError(f"{label}: 元データ {event.rel(path)} がありません（--fetch で取得するか、ここに置いてください）")

        try:
            raws = mod.read(source, path)
        except (ValueError, KeyError) as e:
            raise CliError(f"{label}: 読み取れませんでした: {e}") from e
        for n, raw in enumerate(raws, 1):
            where = f"{label} {n}件目"
            if not (raw.get("id") or raw.get("space")):
                warnings.append(f"{where}: id も space もないため飛ばします")
                continue
            row, menus = normalize(raw, source, warnings, where)
            cols = {k for k in raw if k in CIRCLE_COLS} | {"id", "source"}
            imported.append((row, menus, cols))
        print(f"{label}: {len(raws)} 件")

    circles, menus, report = merge(imported, read_rows(event.circles_csv), read_rows(event.menus_csv), date.today().isoformat())

    for w in warnings:
        print(f"警告: {w}", file=sys.stderr)
    print(f"サークル {len(circles)} 件（新規 {len(report['added'])}・変更 {len(report['changed'])}）、お品書きの追加 {report['added_menus']} 件")
    print(f"直接編集する列（既存の値を残す）: {', '.join(report['manual_cols']) or 'なし'}")
    if report["removed"]:
        print(f"取り込み元から消えた id: {', '.join(report['removed'])}", file=sys.stderr)
    if report["orphan_menus"]:
        print(f"menus.csv に残る、サークルのない id（検証でエラーになります）: {', '.join(report['orphan_menus'])}", file=sys.stderr)
    if dry_run:
        print("（--dry-run のため書き込みません）")
        return 0

    write_csv(event.circles_csv, CIRCLE_COLS, circles)
    write_csv(event.menus_csv, MENU_COLS, menus)
    print(f"{event.rel(event.circles_csv)} と {event.menus_csv.name} を更新しました")
    return 0 if no_build else build.run(event)
