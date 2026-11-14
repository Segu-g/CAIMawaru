"""主催が配る任意の形式のサークル情報（event.json の sources）を、イベントデータの
data/circles.csv と data/menus.csv に取り込む（caimawaru import）。

    取得（sources/ に元データを置く） → 変換（インポーター） → イベントデータ（data/*.csv） → caimawaru data

- 取り込んだ列（インポーターが返した列）は毎回上書きする。返さなかった列（tags / notes など）は直接編集した値を残す
- menus.csv は取り込んだお品書き URL を追加し、直接追加した行は残す
- イベントデータにない列（直接足した列）と「#」の行は残す（「#」の行は、元のファイルで次にあったサークルの前に置く）
- 公式リストから消えたサークルは知らせる（配置変更・参加取り消しの可能性。menus.csv に残った行は検証でエラーになる）
- 取り込んだサークルは、circles.csv の行と1対1で対応付ける（id が1対1で同じ → スペース番号 → サークル名 → 順番）。
  id をスペース番号から作るサークルは、対応する行の id を使う（circles.csv に書いた id は変えない）。対応付けは
  circles.csv の行ごとに行うので、同じ id の行が2つあっても、それぞれの直接編集した列・ほかの列・「#」の行を保つ
- 同じ取り込み元の別の行が同じ id になったら（「A-01」と「A 01」など）、1つにまとめず両方を残す。
  対応する行の id で区別できなければ、同じ id のまま残して知らせる（検証で id の重複のエラーになる）
- 書き込んだあと検証・生成する（--no-build で省略）
"""
import sys
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import NamedTuple

from caimawaru import build, importers
from caimawaru.console import DRY_RUN_NOTICE, print_warnings
from caimawaru.project import (CIRCLE_COLS, LIST_COLS, MENU_COLS, CliError, Table, circle_id, is_comment, make_id, split_list,
                               stripped)
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
    where: str = ""       # 知らせるときの場所（「<label> 3件目」）
    source: object = None  # 取り込み元（event.json の sources の位置）。同じ取り込み元の行どうしはまとめない
    derived: bool = False  # id をスペース番号から作った


def describe_id(row, derived):
    """id の出どころの説明（「スペース エ-04 から作った id」「id 列の値」）。"""
    return f"スペース {row.get('space', '')} から作った id" if derived else "id 列の値"


@dataclass
class MergeReport:
    added: list           # 新しいサークルの id
    changed: list         # 値が変わったサークルの id
    removed: list         # 取り込み元から消えた id
    orphan_menus: list    # menus.csv に残る、サークルのない id
    added_menus: int      # 追加したお品書きの数
    manual_cols: list     # 直接編集する列（既存の値を残す列）
    duplicates: list      # 取り込んだあとも同じ id のサークルの説明（検証でエラーになる）
    kept_ids: list        # スペース番号から作る id の代わりに、既存の行の id を使ったもの（説明）
    notices: list         # 知らせること（スペース番号から作ると同じ id だが、既存の行の id で区別した、など）
    warnings: list        # 確かめてほしいこと（使い続けた id の行とサークル名が違う、など）
    old_rows: list        # circles の各行に対応する existing_circles の位置（新しいサークルは None）


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
    """同じサークルを1つの ImportedCircle にまとめる（取り込んだ順）。返り値: [ImportedCircle]。

    別の source にある同じ id の行は同じサークルとして、後の source の空でない値で上書きし、お品書きと取り込んだ列は足し合わせる。
    同じ source の中で同じ id になった行は別のサークルなので、まとめずに両方を残す（まとめると片方の値とお品書きが黙って混ざる）。
    id が空の行（スペース番号から id を作れない行）は、どれもまとめない。
    """
    combined, sources_of = [], []
    position_of = {}  # id → combined の位置（まとめる先。最初の行）
    for circle in imported:
        circle_ref = circle.row["id"]
        position = position_of.get(circle_ref) if circle_ref else None
        if position is not None and circle.source is not None and circle.source in sources_of[position]:
            position = None
        if position is None:
            if circle_ref and circle_ref not in position_of:
                position_of[circle_ref] = len(combined)
            combined.append(ImportedCircle(dict(circle.row), list(circle.menus), set(circle.provided_cols), circle.where, circle.source, circle.derived))
            sources_of.append({circle.source})
            continue
        current = combined[position]
        current.row.update({key: value for key, value in circle.row.items() if value})
        current.menus.extend(menu for menu in circle.menus if menu not in current.menus)
        current.provided_cols.update(circle.provided_cols)
        sources_of[position].add(circle.source)
    return combined


def _group(indexes, key):
    groups = {}
    for index in indexes:
        groups.setdefault(key(index), []).append(index)
    return groups


def _match_existing(combined, existing_circles):
    """取り込んだサークル（combined）と circles.csv の行（existing_circles）を1対1で対応付ける。

    返り値: combined の各サークルに対応する existing_circles の位置（なければ None）。行は dict にまとめず位置で扱うので、
    同じ id の行が2つあっても、どちらも別々に対応付ける。順に:
      1. id（空でない）が両方に1つずつしかない
      2. スペース番号から id を作るサークルは、同じスペース番号の行（1つずつならそのまま、複数ならサークル名が同じもの、残りは順に）
      3. 同じ id（空でない）の行を順に
    """
    old_ids = [circle_id(row) for row in existing_circles]
    old_spaces = [stripped(row, "space") for row in existing_circles]
    old_names = [stripped(row, "name") for row in existing_circles]
    match = [None] * len(combined)
    free_old = set(range(len(existing_circles)))

    def pair(new, old):
        match[new] = old
        free_old.discard(old)

    def unmatched(condition=lambda index: True):
        return [index for index, old in enumerate(match) if old is None and condition(index)]

    def new_id(index):
        return combined[index].row["id"]

    old_by_id = _group(sorted(free_old), lambda old: old_ids[old])
    for circle_ref, news in _group(unmatched(), new_id).items():
        if circle_ref and len(news) == 1 and len(old_by_id.get(circle_ref, [])) == 1:
            pair(news[0], old_by_id[circle_ref][0])

    old_by_space = _group(sorted(free_old), lambda old: old_spaces[old])
    for space, news in _group(unmatched(lambda index: combined[index].derived), lambda index: combined[index].row.get("space", "")).items():
        olds = [old for old in old_by_space.get(space, []) if old in free_old] if space else []
        if len(news) > 1 or len(olds) > 1:
            for new in news:
                name = combined[new].row.get("name", "")
                same_name = [old for old in olds if old in free_old and name and old_names[old] == name]
                if len(same_name) == 1 and sum(combined[other].row.get("name", "") == name for other in news) == 1:
                    pair(new, same_name[0])
        rest_new = [new for new in news if match[new] is None]
        rest_old = [old for old in olds if old in free_old]
        for new, old in zip(rest_new, rest_old):
            pair(new, old)

    old_by_id = _group(sorted(free_old), lambda old: old_ids[old])
    for circle_ref, news in _group(unmatched(), new_id).items():
        if circle_ref:
            for new, old in zip(news, old_by_id.get(circle_ref, [])):
                pair(new, old)
    return match


def _final_ids(combined, existing_circles, match):
    """id をスペース番号から作るサークルに、対応する行の id を使う。返り値: (使い続けた id の説明, 確かめてほしいこと)。"""
    kept, warnings = [], []
    for circle, old in zip(combined, match):
        if old is None or not circle.derived:
            continue
        old_row = existing_circles[old]
        old_ref, made = circle_id(old_row), circle.row["id"]
        if not old_ref or old_ref == made:
            continue
        circle.row["id"] = old_ref
        space = circle.row.get("space", "")
        kept.append(f"{space} は '{old_ref}'（作ると '{made}'）")
        new_name, old_name = circle.row.get("name", ""), stripped(old_row, "name")
        if new_name and old_name and new_name != old_name:
            warnings.append(f"{circle.where}（スペース {space}・{new_name}）: circles.csv の id '{old_ref}'（{old_name}）を使い続けますが、"
                            "サークル名が違います。別のサークルなら、閲覧者の ★・タグ・メモがこのサークルに引き継がれます。"
                            "別のサークルのときは、取り込んだあと circles.csv の id 列で別の id を付けてください")
    return kept, warnings


def _same_id_reports(combined):
    """取り込んだあとも同じ id のサークル（検証でエラー）と、スペース番号から作ると同じ id だが既存の行の id で区別したサークルの説明。"""
    duplicates, notices = [], []
    describe = [f"{circle.where}（{describe_id(circle.row, circle.derived)}）" for circle in combined]
    for circle_ref, members in _group(range(len(combined)), lambda index: combined[index].row["id"]).items():
        if circle_ref and len(members) > 1:
            duplicates.append(f"{'、'.join(describe[index] for index in members)}が同じ id '{circle_ref}' です。別のサークルとして残します"
                              "（検証で id の重複のエラーになるので、取り込み元の id 列か、取り込んだあとの circles.csv の id 列で別の id を付けてください）")
    made = [make_id(circle.row.get("space", "")) if circle.derived else circle.row["id"] for circle in combined]
    for made_ref, members in _group(range(len(combined)), lambda index: made[index]).items():
        final_ids = [combined[index].row["id"] for index in members]
        if made_ref and len(members) > 1 and len(set(final_ids)) == len(members):
            rows = "、".join(f"{combined[index].where}（スペース {combined[index].row.get('space', '')}）" for index in members)
            notices.append(f"{rows}は、スペース番号から作ると同じ id '{made_ref}' ですが、"
                           f"circles.csv の id（{', '.join(repr(final_id) for final_id in final_ids)}）で区別します")
    return duplicates, notices


def merge(imported, existing_circles, existing_menus, today):
    """取り込んだ行 [ImportedCircle] を既存の CSV の内容と合わせる。

    返り値: (circles, menus, MergeReport)。menus は既存の行のあとに追加した行を並べる。
    report.old_rows は circles の各行に対応する existing_circles の位置（keep_extras_and_comments に渡す）。
    """
    combined = _combine_sources(imported)
    provided_cols = set().union(*(circle.provided_cols for circle in combined))
    match = _match_existing(combined, existing_circles)
    kept_ids, warnings = _final_ids(combined, existing_circles, match)
    duplicates, notices = _same_id_reports(combined)
    manual_cols = [col for col in CIRCLE_COLS if col not in provided_cols]
    circles = []
    for imported_circle, old in zip(combined, match):
        old_row = existing_circles[old] if old is not None else {}
        circles.append({col: old_row.get(col, "") if col in manual_cols else imported_circle.row.get(col, "") for col in CIRCLE_COLS})

    menus = [dict(menu) for menu in existing_menus]
    known_menus = {(stripped(menu, "id"), stripped(menu, "url")) for menu in menus}
    added_menus = 0
    for imported_circle in combined:
        circle_ref = imported_circle.row["id"]
        for url, note in imported_circle.menus:
            if (circle_ref, url) not in known_menus:
                menus.append({"id": circle_ref, "url": url, "note": note, "checkedAt": today})
                known_menus.add((circle_ref, url))
                added_menus += 1

    imported_ids = {circle["id"] for circle in circles}
    matched_old = {old for old in match if old is not None}
    changed = [circle["id"] for circle, old in zip(circles, match) if old is not None
               and any(stripped(existing_circles[old], col) != (circle[col] or "").strip() for col in CIRCLE_COLS)]
    report = MergeReport(
        added=[circle["id"] for circle, old in zip(circles, match) if old is None],
        changed=list(dict.fromkeys(changed)),
        removed=sorted({circle_id(row) for index, row in enumerate(existing_circles) if index not in matched_old}),
        orphan_menus=sorted({menu["id"] for menu in menus} - imported_ids),
        added_menus=added_menus,
        manual_cols=manual_cols,
        duplicates=duplicates,
        kept_ids=kept_ids,
        notices=notices,
        warnings=warnings,
        old_rows=match,
    )
    return circles, menus, report


def keep_extras_and_comments(table, circles, old_rows):
    """取り込み結果の circles に、table（今の circles.csv）にだけある列の値と「#」の行を戻した行のリストを返す。

    old_rows は circles の各行に対応する table.data_rows() の位置（merge の report.old_rows）。「#」の行は、
    元のファイルでその後にあった行のうち、取り込み結果に残る最初の行の前に置く。
    """
    extra_cols = [col for col in table.cols if col not in CIRCLE_COLS]
    data_rows = table.data_rows()
    kept_rows = {old for old in old_rows if old is not None}
    comments_before, pending_comments = {}, []  # data_rows の位置 → その前に置くコメント行
    data_index = 0
    for row in table.rows:
        if is_comment(row):
            pending_comments.append(row)
            continue
        if pending_comments and data_index in kept_rows:
            comments_before[data_index] = pending_comments
            pending_comments = []
        data_index += 1
    rows = []
    for circle, old in zip(circles, old_rows):
        old_row = data_rows[old] if old is not None else {}
        rows.extend(comments_before.pop(old, []) if old is not None else [])
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
    label = source.get("label") or source.get("type") or f"sources[{index}]"
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
        derived = not str(raw.get("id") or "").strip()
        if not row["id"]:
            warnings.append(f"{where}: スペース番号 {row.get('space', '')!r} から id を作れません（文字か数字が要ります）。"
                            "取り込んだあと circles.csv の id 列に id を書いてください")
        imported.append(ImportedCircle(row, menus, provided_cols, where, index, derived))
    print(f"{label}: {len(raw_rows)} 件")
    return imported


def _print_report(circles, report):
    print(f"サークル {len(circles)} 件（新規 {len(report.added)}・変更 {len(report.changed)}）、お品書きの追加 {report.added_menus} 件")
    print(f"直接編集する列（既存の値を残す）: {', '.join(report.manual_cols) or 'なし'}")
    for notice in report.notices:
        print(notice)
    for warning in report.warnings:
        print(f"確かめてください: {warning}", file=sys.stderr)
    if report.kept_ids:
        print(f"スペース番号から作る id と違う、circles.csv の今の id を使うサークル: {', '.join(report.kept_ids)}")
    for duplicate in report.duplicates:
        print(f"同じ id: {duplicate}", file=sys.stderr)
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

    circle_table.rows = keep_extras_and_comments(circle_table, circles, report.old_rows)
    menu_table.rows += menus[len(existing_menus):]  # merge は既存の行のあとに追加した行を返す
    circle_table.write()
    menu_table.write()
    print(f"{event.rel(event.circles_csv)} と {event.menus_csv.name} を更新しました")
    return 0 if no_build else build.run(event)
