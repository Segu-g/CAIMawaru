"""主催が配る任意の形式のサークル情報（event.json の sources）を、イベントデータの
data/circles.csv と data/menus.csv に取り込む（caimawaru import）。

    取得（sources/ に元データを置く） → 変換（インポーター） → イベントデータ（data/*.csv） → caimawaru data

- 取り込んだ列（インポーターが返した列）は毎回上書きする。返さなかった列（tags / notes など）は直接編集した値を残す
- menus.csv は取り込んだお品書き URL を追加し、直接追加した行は残す
- イベントデータにない列（直接足した列）と「#」の行は残す（「#」の行は、元のファイルで次にあったサークルの前に置く）
- 公式リストから消えたサークルは知らせる（配置変更・参加取り消しの可能性。menus.csv に残った行は検証でエラーになる）
- 書き込んだあと検証・生成する（--no-build で省略）
"""
import sys
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import NamedTuple

from caimawaru import build, importers
from caimawaru.project import (CIRCLE_COLS, DRY_RUN_NOTICE, LIST_COLS, MENU_COLS, CliError, Table, circle_id, is_comment, make_id,
                               print_warnings, split_list, stripped)
from caimawaru.xurl import X_ORIGIN

TRUE_WORDS = {"1", "true", "yes", "y", "有", "あり", "○", "◯", "r18", "成人向け"}
FALSE_WORDS = {"0", "false", "no", "n", "無", "なし", "×", "-", "全年齢"}
PIXIV_USER_URL = "https://www.pixiv.net/users/"
# 取り込んだサークルで、インポーターが返さなくても取り込んだ列として扱う列（共通処理で作る）
ALWAYS_PROVIDED_COLS = {"id", "source"}


class ImportedCircle(NamedTuple):
    row: dict             # circles.csv の列 → 文字列
    menus: list           # お品書き [(URL, 説明)]
    provided_cols: set    # インポーターが返した列（毎回上書きする列）


@dataclass
class MergeReport:
    added: list           # 新しいサークルの id
    changed: list         # 値が変わったサークルの id
    removed: list         # 取り込み元から消えた id
    orphan_menus: list    # menus.csv に残る、サークルのない id
    added_menus: int      # 追加したお品書きの数
    manual_cols: list     # 直接編集する列（既存の値を残す列）


def as_list(value):
    """「;」区切りの文字列か、そのリストを、値のリストにする。"""
    values = value if isinstance(value, (list, tuple)) else [value or ""]
    return [item for element in values for item in split_list(str(element))]


def _adult_value(value, warnings, where):
    """adult 列の値を "1" / "0" / ""（判定できない）にする。"""
    if isinstance(value, bool):
        return "1" if value else "0"
    word = str(value or "").strip().lower()
    if word in TRUE_WORDS:
        return "1"
    if word in FALSE_WORDS:
        return "0"
    if word:
        warnings.append(f"{where}: adult の値 {value!r} を判定できません（空欄にします）")
    return ""


def _account_urls(row):
    """X の ID・pixiv の数字だけの指定は URL にする。"""
    x_account = row.get("x", "")
    if x_account and not x_account.startswith("http"):
        row["x"] = f"{X_ORIGIN}/{x_account.lstrip('@')}"
    pixiv = row.get("pixiv", "")
    if pixiv.isdigit():
        row["pixiv"] = f"{PIXIV_USER_URL}{pixiv}"


def _source_name(source):
    """source 列の既定値（取り込み元を表すもの）。"""
    return source.get("url") or source.get("label") or source.get("file") or source.get("type", "")


def _menu_links(raw):
    """インポーターが返した menus（URL の文字列か {"url", "note"}）を [(URL, 説明)] にする。"""
    links = []
    for menu in raw.get("menus") or []:
        url, note = (menu.get("url", ""), menu.get("note", "")) if isinstance(menu, dict) else (str(menu), "")
        if url.strip():
            links.append((url.strip(), note.strip()))
    return links


def normalize(raw, source, warnings, where):
    """インポーターが返した行を、circles.csv の文字列の行と、お品書きのリストにする。"""
    row = {}
    for key, value in raw.items():
        if key == "menus":
            continue
        if key not in CIRCLE_COLS:
            warnings.append(f"{where}: イベントデータにない列 {key!r} は無視します")
            continue
        if key in LIST_COLS:
            row[key] = ";".join(as_list(value))
        elif key == "adult":
            row[key] = _adult_value(value, warnings, where)
        else:
            row[key] = str(value if value is not None else "").strip()
    _account_urls(row)
    if not row.get("id"):
        row["id"] = make_id(row.get("space", ""))
    if "source" not in raw:
        row["source"] = _source_name(source)
    return row, _menu_links(raw)


def _combine_sources(imported):
    """id ごとにまとめる。複数の source に同じサークルがあれば、後の source の空でない値で上書きする。

    (id の順のリスト, id → (行, お品書き), 取り込んだ列) を返す。
    """
    combined, order, provided_cols = {}, [], set()
    for row, menus, cols in imported:
        provided_cols |= cols
        row_id = row["id"]
        if row_id in combined:
            current_row, current_menus = combined[row_id]
            current_row.update({key: value for key, value in row.items() if value})
            current_menus.extend(menu for menu in menus if menu not in current_menus)
        else:
            combined[row_id] = (dict(row), list(menus))
            order.append(row_id)
    return order, combined, provided_cols


def merge(imported, existing_circles, existing_menus, today):
    """取り込んだ行 [ImportedCircle] を既存の CSV の内容と合わせる。

    返り値: (circles, menus, MergeReport)。menus は既存の行のあとに追加した行を並べる。
    """
    order, combined, provided_cols = _combine_sources(imported)
    existing = {circle_id(row): row for row in existing_circles}
    manual_cols = [col for col in CIRCLE_COLS if col not in provided_cols]
    circles = []
    for row_id in order:
        row, _ = combined[row_id]
        old = existing.get(row_id, {})
        circles.append({col: old.get(col, "") if col in manual_cols else row.get(col, "") for col in CIRCLE_COLS})

    menus = [dict(menu) for menu in existing_menus]
    known_menus = {(stripped(menu, "id"), stripped(menu, "url")) for menu in menus}
    added_menus = 0
    for row_id in order:
        for url, note in combined[row_id][1]:
            if (row_id, url) not in known_menus:
                menus.append({"id": row_id, "url": url, "note": note, "checkedAt": today})
                known_menus.add((row_id, url))
                added_menus += 1

    imported_ids = set(order)
    changed = [row_id for row_id, circle in zip(order, circles) if row_id in existing
               and any(stripped(existing[row_id], col) != (circle[col] or "").strip() for col in CIRCLE_COLS)]
    report = MergeReport(
        added=[row_id for row_id in order if row_id not in existing],
        changed=changed,
        removed=sorted(set(existing) - imported_ids),
        orphan_menus=sorted({menu["id"] for menu in menus if menu["id"] not in imported_ids}),
        added_menus=added_menus,
        manual_cols=manual_cols,
    )
    return circles, menus, report


def keep_extras_and_comments(table, circles):
    """取り込み結果の circles に、table（今の circles.csv）にだけある列の値と「#」の行を戻した行のリストを返す。"""
    extra_cols = [col for col in table.cols if col not in CIRCLE_COLS]
    old_rows = {circle_id(row): row for row in table.data_rows()}
    imported_ids = {circle["id"] for circle in circles}
    comments_before, pending_comments = {}, []  # id → その前に置くコメント行
    for row in table.rows:
        if is_comment(row):
            pending_comments.append(row)
        elif pending_comments and circle_id(row) in imported_ids:
            comments_before.setdefault(circle_id(row), []).extend(pending_comments)
            pending_comments = []
    rows = []
    for circle in circles:
        rows.extend(comments_before.get(circle["id"], []))
        old_row = old_rows.get(circle["id"], {})
        rows.append({**circle, **{col: old_row.get(col, "") for col in extra_cols}})
    return rows + pending_comments


def list_importers():
    for source_type in importers.available():
        module = importers.load({"type": source_type})
        can_fetch = "（取得に対応）" if hasattr(module, "fetch") else ""
        print(f"{source_type:9} {getattr(module, 'DESCRIPTION', '')}{can_fetch}")


def _read_sources_config(event):
    try:
        sources = event.config().get("sources") or []
    except ValueError as e:  # 書き方の誤り・キーの重複
        raise CliError(f"{event.rel(event.config_json)}: JSON として読めません: {e}")
    if not sources:
        raise CliError("event.json に sources（取り込み元）がありません。docs/importers.md を参照してください")
    return sources


def _source_path(event, source, module, label, input_file):
    """元データのファイル。--input があればそれ、なければ source の file かインポーターの DEFAULT_FILE（イベントのフォルダから）。"""
    if input_file:
        return Path(input_file).resolve()
    file = source.get("file") or getattr(module, "DEFAULT_FILE", "")
    if not file:
        raise CliError(f"{label}: 元データの file を指定してください")
    return event.dir / file


def _import_source(event, index, source, input_file, fetch, warnings):
    """1つの取り込み元を（必要なら取得して）読み、[ImportedCircle] を返す。"""
    label = source.get("name") or source.get("type") or f"sources[{index}]"
    try:
        module = importers.load(source)
    except ValueError as e:
        raise CliError(f"{label}: {e}") from e
    path = _source_path(event, source, module, label, input_file)
    if fetch:
        if not callable(getattr(module, "fetch", None)):
            raise CliError(f"{label}: このインポーターは取得（fetch）に対応していません。元データを {event.rel(path)} に置いてください")
        print(f"{label}: 取得しています → {event.rel(path)}")
        module.fetch(source, path)
    if not path.exists():
        raise CliError(f"{label}: 元データ {event.rel(path)} がありません（--fetch で取得するか、ここに置いてください）")

    try:
        raw_rows = module.read(source, path)
    except (ValueError, KeyError) as e:
        raise CliError(f"{label}: 読み取れませんでした: {e}") from e
    imported = []
    for number, raw in enumerate(raw_rows, 1):
        where = f"{label} {number}件目"
        if not (raw.get("id") or raw.get("space")):
            warnings.append(f"{where}: id も space もないため飛ばします")
            continue
        row, menus = normalize(raw, source, warnings, where)
        provided_cols = {key for key in raw if key in CIRCLE_COLS} | ALWAYS_PROVIDED_COLS
        imported.append(ImportedCircle(row, menus, provided_cols))
    print(f"{label}: {len(raw_rows)} 件")
    return imported


def _print_report(circles, report):
    print(f"サークル {len(circles)} 件（新規 {len(report.added)}・変更 {len(report.changed)}）、お品書きの追加 {report.added_menus} 件")
    print(f"直接編集する列（既存の値を残す）: {', '.join(report.manual_cols) or 'なし'}")
    if report.removed:
        print(f"取り込み元から消えた id: {', '.join(report.removed)}", file=sys.stderr)
    if report.orphan_menus:
        print(f"menus.csv に残る、サークルのない id（検証でエラーになります）: {', '.join(report.orphan_menus)}", file=sys.stderr)


def run(event, fetch=False, input_file=None, dry_run=False, no_build=False):
    """取り込む。終了コードを返す。"""
    sources = _read_sources_config(event)
    if input_file and len(sources) != 1:
        raise CliError("--input は sources が1つのときだけ使えます")

    warnings, imported = [], []
    for index, source in enumerate(sources):
        imported += _import_source(event, index, source, input_file, fetch, warnings)

    circle_table, menu_table = Table(event.circles_csv, CIRCLE_COLS), Table(event.menus_csv, MENU_COLS)
    warnings += circle_table.warnings + menu_table.warnings
    existing_menus = menu_table.data_rows()
    circles, menus, report = merge(imported, circle_table.data_rows(), existing_menus, date.today().isoformat())

    print_warnings(warnings)
    _print_report(circles, report)
    if dry_run:
        print(DRY_RUN_NOTICE)
        return 0

    circle_table.rows = keep_extras_and_comments(circle_table, circles)
    menu_table.rows += menus[len(existing_menus):]  # merge は既存の行のあとに追加した行を返す
    circle_table.write()
    menu_table.write()
    print(f"{event.rel(event.circles_csv)} と {event.menus_csv.name} を更新しました")
    return 0 if no_build else build.run(event)
