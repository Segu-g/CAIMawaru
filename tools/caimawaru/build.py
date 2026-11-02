"""イベントデータ（event.json・layout.json・data/*.csv）を検証し、ページが読む public/data/circles.json を作る。

    caimawaru data <eventId>            # 検証して生成
    caimawaru data <eventId> --check    # 検証のみ
    caimawaru check                     # 全イベントを検証

circles.json はページ（src/）との唯一の境界。形は src/types.ts の CircleData。
"""
import json
import sys
from dataclasses import dataclass, field
from datetime import date

from caimawaru import importers
from caimawaru import layout as layout_mod
from caimawaru.project import (CIRCLE_COLS, MENU_COLS, DuplicateKeyError, circle_id, format_json, is_http_url,
                               print_warnings, read_csv, split_list)
from caimawaru.xurl import is_x_page, normalize_url, x_handle

LINK_KEYS = ("x", "pixiv", "booth", "web")
INFO_REQUIRED = ("name", "date", "venue")
INFO_STRINGS = ("name", "date", "venue", "hours")
INFO_ARRAYS = ("links", "hashtags")
# 参加イベントの色の枠（info.eventSlots の値・info.slotColors のキー）
SLOTS = range(1, 6)
SLOTS_TEXT = f"{SLOTS[0]}〜{SLOTS[-1]}"
# 元データのファイル（file）が必須の取り込み元の type
FILE_SOURCE_TYPES = ("csv", "json")


@dataclass
class Result:
    """検証の結果と、circles.json に書く内容。"""

    errors: list = field(default_factory=list)
    warnings: list = field(default_factory=list)
    info: dict = field(default_factory=dict)
    circles: list = field(default_factory=list)
    layout: dict | None = None


def circle_spaces(circle):
    """「A-01,A-02」のような複数スペース（「,」区切り。src/filter.ts の spacesOf と同じ）。"""
    return [space.strip() for space in circle["space"].split(",") if space.strip()]


def _is_url(value):
    return isinstance(value, str) and is_http_url(value)


def _is_link(value, is_valid_url=_is_url):
    """{ "label": 文字列, "url": … } か。"""
    return isinstance(value, dict) and isinstance(value.get("label", ""), str) and is_valid_url(value.get("url"))


def _is_hall(value):
    """{ "label", "url"（空でない文字列。相対パスも可）, "current"（任意。真偽値） } か。"""
    return (_is_link(value, lambda url: isinstance(url, str) and bool(url))
            and isinstance(value.get("current", False), bool))


def _is_slot(value):
    return isinstance(value, int) and not isinstance(value, bool) and value in SLOTS


# --- event.json ---

def _read_config(event, result, where):
    """event.json を読む。読めない・オブジェクトでないときはエラーを足して None。"""
    try:
        config = event.config()
    except DuplicateKeyError as e:
        result.errors.append(f"{where}: {e}（後の値だけが使われてしまうので1つにしてください）")
        return None
    except json.JSONDecodeError as e:
        result.errors.append(f"{where}: JSON として読めません: {e}")
        return None
    if not isinstance(config, dict):
        result.errors.append(f"{where}: オブジェクト（{{ ... }}）にしてください")
        return None
    return config


def _check_info(info, result, where):
    """info を検証し、ページに出す形（足りないキーは既定値）にして返す。

    ページ（src/types.ts の EventInfo）は配列・オブジェクトとして読むので、null も含めて型が違えばエラーにする。
    """
    if not isinstance(info, dict):
        result.errors.append(f"{where}: info はオブジェクト（{{ ... }}）にしてください: {info!r}")
        info = {}
    info = dict(info)
    for key in INFO_REQUIRED:
        if not info.get(key):
            result.warnings.append(f"{where}: info.{key} が未入力です")
    for key in INFO_STRINGS:
        info.setdefault(key, "")
    for key in INFO_ARRAYS:
        info.setdefault(key, [])
    for key in INFO_STRINGS:
        if not isinstance(info[key], str):
            result.errors.append(f"{where}: info.{key} は文字列にしてください: {info[key]!r}")

    def check_array(key, is_valid_item, problem):
        if key not in info:
            return
        items = info[key]
        if not isinstance(items, list):
            result.errors.append(f"{where}: info.{key} は配列にしてください: {items!r}")
            return
        for item in items:
            if not is_valid_item(item):
                result.errors.append(f"{where}: info.{key} の{problem}: {item!r}")

    def object_or_empty(key):
        value = info.get(key, {})
        if not isinstance(value, dict):
            result.errors.append(f"{where}: info.{key} はオブジェクト（{{ ... }}）にしてください: {value!r}")
            return {}
        return value

    check_array("links", _is_link, "URL が不正です（{ \"label\", \"url\" } にしてください）")
    check_array("hashtags", lambda tag: isinstance(tag, str), "値は文字列にしてください")
    check_array("halls", _is_hall, "形が不正です（{ \"label\", \"url\", \"current\" } にしてください）")
    for event_name, slot in object_or_empty("eventSlots").items():
        if not _is_slot(slot):
            result.errors.append(f"{where}: info.eventSlots の {event_name} は {SLOTS_TEXT} にしてください: {slot}")
    slot_keys = [str(slot) for slot in SLOTS]
    for slot, colors in object_or_empty("slotColors").items():
        if slot not in slot_keys:
            result.errors.append(f"{where}: info.slotColors の枠 {slot} は {SLOTS_TEXT} にしてください")
        elif not (isinstance(colors, dict) and all(isinstance(color, str) for color in colors.values())):
            result.errors.append(f"{where}: info.slotColors の枠 {slot} は {{ \"light\", \"dark\", \"ink\", \"darkInk\" }}（文字列）にしてください: {colors!r}")
    if "contact" in info:
        contact = info["contact"]
        if not isinstance(contact, dict):
            result.errors.append(f'{where}: info.contact は {{ "label", "url" }} にしてください（不要ならキーごと消す）: {contact!r}')
        elif not _is_link(contact):
            result.errors.append(f"{where}: info.contact.url が不正です: {contact}")
    return info


def _check_sources(sources, result, where):
    if not isinstance(sources, list):
        result.errors.append(f"{where}: sources は配列にしてください")
        return
    types = importers.available()
    for index, source in enumerate(sources):
        source_type = source.get("type") if isinstance(source, dict) else None
        if source_type not in types:
            result.errors.append(f"{where}: sources[{index}].type は {' / '.join(types)} のどれかにしてください: {source_type!r}")
        elif source_type in FILE_SOURCE_TYPES and not source.get("file"):
            result.errors.append(f"{where}: sources[{index}] は type {source_type} なので file（元データ）が必要です")
        if isinstance(source, dict) and source.get("url") and not _is_url(source["url"]):
            result.errors.append(f"{where}: sources[{index}].url が不正です: {source['url']}")


def check_config(event, result):
    """event.json の検証。ページに出すイベント情報（info）を result.info に入れる。

    直接編集した値の型が違っても、例外にせず検証エラーにする。
    """
    where = event.rel(event.config_json)
    config = _read_config(event, result, where)
    if config is None:
        return
    for key in ("storeId", "title"):
        if not config.get(key):
            result.errors.append(f"{where}: {key} がありません")
        elif not isinstance(config[key], str):
            result.errors.append(f"{where}: {key} は文字列にしてください: {config[key]!r}")
    info = _check_info(config.get("info") or {}, result, where)
    _check_sources(config.get("sources", []), result, where)
    result.info = info


# --- circles.csv・menus.csv ---

def _circle_links(row, result, where):
    links = {}
    for key in LINK_KEYS:
        url = row.get(key, "")
        if url and is_http_url(url):
            links[key] = url
        elif url:
            result.errors.append(f"{where}: {key} のURLが不正です: {url}")
    return links


def _check_circle_row(row, row_id, result, where):
    """circles.csv の1行を検証し、circles.json のサークルにして返す。"""
    if not row.get("name"):
        result.errors.append(f"{where}: サークル名（name）が空です")
    if not row.get("space"):
        result.warnings.append(f"{where}: スペース番号が未入力です")
    links = _circle_links(row, result, where)
    # x 列はお品書きの照合（caimawaru menu・エディタ）に使う。照合できない URL は知らせる（xurl.x_handle と同じ規則）
    if links.get("x") and not x_handle(row):
        result.warnings.append(f"{where}: x が X のアカウントの URL ではありません（https://x.com/<ID> の形にしてください）: {links['x']}")
    if not row.get("source"):
        result.warnings.append(f"{where}: 情報の出典（source）が未入力です")
    adult = row.get("adult", "")
    if adult not in ("", "0", "1"):
        result.errors.append(f"{where}: adult は 0 / 1 / 空欄のいずれかにしてください: {adult}")
    if not row.get("event"):
        result.warnings.append(f"{where}: 参加イベント（event）が未入力です")
    return {
        "id": row_id,
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
        "source": row.get("source", ""),
    }


def _read_circles(event, result):
    circles, first_line_of = [], {}
    for line_number, row in enumerate(read_csv(event.circles_csv, CIRCLE_COLS, result.warnings), start=2):  # 1行目は見出し
        where = f"circles.csv:{line_number}"
        row_id = circle_id(row)
        if not row_id:
            result.errors.append(f"{where}: id もスペース番号もありません")
            continue
        if row_id in first_line_of:
            result.errors.append(f"{where}: id '{row_id}' が重複しています（{first_line_of[row_id]} と同じ）")
            continue
        first_line_of[row_id] = where
        circles.append(_check_circle_row(row, row_id, result, where))
    return circles


def _attach_menus(event, circles, result):
    """menus.csv の行を、id が同じサークルの menus に足す。"""
    circle_by_id = {circle["id"]: circle for circle in circles}
    for line_number, row in enumerate(read_csv(event.menus_csv, MENU_COLS, result.warnings), start=2):
        where = f"menus.csv:{line_number}"
        menu_id, url = row.get("id", ""), row.get("url", "")
        if menu_id not in circle_by_id:
            result.errors.append(f"{where}: circles.csv に id '{menu_id}' がありません")
            continue
        if not is_http_url(url):
            result.errors.append(f"{where}: URLが不正です: {url}")
            continue
        # X の投稿は caimawaru menu と同じ形（https://x.com/<ID>/status/<番号>）にそろえ、追跡用パラメータ（?s=20 など）を落とす。
        # X以外（BOOTH・画像など）はそのまま掲載。Xのページなのに投稿でないものだけ警告する
        clean_url, post_handle = normalize_url(url)
        if not post_handle and is_x_page(url):
            result.warnings.append(f"{where}: Xの投稿ではないページです（プロフィール等を登録していませんか）: {url}")
        menus = circle_by_id[menu_id]["menus"]
        if any(menu["url"] == clean_url for menu in menus):
            result.warnings.append(f"{where}: 同じURLが重複しています: {clean_url}")
            continue
        menus.append({"url": clean_url, "note": row.get("note", ""), "checkedAt": row.get("checkedAt", "")})


def check_circles(event, result):
    circles = _read_circles(event, result)
    _attach_menus(event, circles, result)
    result.circles = circles


# --- layout.json ---

def check_layout(event, result):
    if not event.layout_json.exists():
        return
    where = event.rel(event.layout_json)
    try:
        spec = json.loads(event.layout_json.read_text(encoding="utf-8"))
        if not isinstance(spec, dict):
            raise layout_mod.LayoutError("配置図はオブジェクト（{ ... }）にしてください")
        result.layout = layout_mod.expand(spec)
    except json.JSONDecodeError as e:
        result.errors.append(f"{where}: JSON として読めません: {e}")
        return
    except (layout_mod.LayoutError, KeyError, TypeError, AttributeError) as e:
        result.errors.append(f"{where}: {e}")
        return
    spaces_on_map = {cell["space"] for cell in result.layout["cells"]}
    for circle in result.circles:
        for space in circle_spaces(circle):
            if space not in spaces_on_map:
                result.errors.append(f"{where}: {circle['id']}（{circle['name']}）のスペース {space} が配置図にありません")


def validate(event):
    result = Result()
    check_config(event, result)
    check_circles(event, result)
    check_layout(event, result)
    return result


def report(result):
    print_warnings(result.warnings)
    for error in result.errors:
        print(f"エラー: {error}", file=sys.stderr)
    with_menus = sum(1 for circle in result.circles if circle["menus"])
    print(f"サークル {len(result.circles)} 件（お品書きあり {with_menus} 件）、エラー {len(result.errors)} 件、警告 {len(result.warnings)} 件")


def write_output(event, result, today=None):
    """circles.json を書く。「サークル情報の更新」日はサークル情報（お品書きを含む）が変わったときだけ今日にする。"""
    previous = json.loads(event.out_json.read_text(encoding="utf-8")) if event.out_json.exists() else {}
    previous_updated = previous.get("event", {}).get("updatedAt")
    is_unchanged = previous.get("circles") == result.circles and previous_updated
    info = {**result.info, "updatedAt": previous_updated if is_unchanged else (today or date.today().isoformat())}
    output = {"event": info, "circles": result.circles}
    if result.layout is not None:
        output["layout"] = result.layout
    event.out_json.parent.mkdir(parents=True, exist_ok=True)
    event.out_json.write_text(format_json(output), encoding="utf-8")
    return output


def run(event, check=False):
    """検証して（check でなければ）生成する。終了コードを返す。"""
    result = validate(event)
    report(result)
    if result.errors:
        return 1
    if not check:
        write_output(event, result)
        print(f"{event.rel(event.out_json)} を更新しました")
    return 0
