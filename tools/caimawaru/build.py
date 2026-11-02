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
from caimawaru.project import CIRCLE_COLS, MENU_COLS, DuplicateKeyError, circle_id, is_http_url, read_csv
from caimawaru.xurl import is_x_page, normalize_url, x_handle

LINK_KEYS = ("x", "pixiv", "booth", "web")
INFO_REQUIRED = ("name", "date", "venue")


@dataclass
class Result:
    errors: list = field(default_factory=list)
    warnings: list = field(default_factory=list)
    info: dict = field(default_factory=dict)
    circles: list = field(default_factory=list)
    layout: dict | None = None


def split_list(value):
    return [s.strip() for s in value.split(";") if s.strip()]


def circle_spaces(circle):
    """「A-01,A-02」のような複数スペース（「,」区切り。src/filter.ts の spacesOf と同じ）。"""
    return [s.strip() for s in circle["space"].split(",") if s.strip()]


def _url_ok(value):
    return isinstance(value, str) and is_http_url(value)


def _is_link(value, url_ok=_url_ok):
    """{ "label": 文字列, "url": … } か。"""
    return isinstance(value, dict) and isinstance(value.get("label", ""), str) and url_ok(value.get("url"))


def check_config(event, r):
    """event.json の検証。ページに出すイベント情報（info）を r.info に入れる。

    直接編集した値の型が違っても、例外にせず検証エラーにする。
    """
    where = event.rel(event.config_json)
    try:
        config = event.config()
    except DuplicateKeyError as e:
        r.errors.append(f"{where}: {e}（後の値だけが使われてしまうので1つにしてください）")
        return
    except json.JSONDecodeError as e:
        r.errors.append(f"{where}: JSON として読めません: {e}")
        return
    if not isinstance(config, dict):
        r.errors.append(f"{where}: オブジェクト（{{ ... }}）にしてください")
        return
    for key in ("storeId", "title"):
        if not config.get(key):
            r.errors.append(f"{where}: {key} がありません")
        elif not isinstance(config[key], str):
            r.errors.append(f"{where}: {key} は文字列にしてください: {config[key]!r}")
    info = config.get("info") or {}
    if not isinstance(info, dict):
        r.errors.append(f"{where}: info はオブジェクト（{{ ... }}）にしてください: {info!r}")
        info = {}
    info = dict(info)
    for key in INFO_REQUIRED:
        if not info.get(key):
            r.warnings.append(f"{where}: info.{key} が未入力です")
    for key, default in (("name", ""), ("date", ""), ("venue", ""), ("hours", ""), ("links", []), ("hashtags", [])):
        info.setdefault(key, default)
    for key in ("name", "date", "venue", "hours"):
        if not isinstance(info[key], str):
            r.errors.append(f"{where}: info.{key} は文字列にしてください: {info[key]!r}")

    # ページ（src/types.ts の EventInfo）は配列・オブジェクトとして読むので、null も含めて型が違えばエラー
    def array_of(key, ok, what):
        if key not in info:
            return
        value = info[key]
        if not isinstance(value, list):
            r.errors.append(f"{where}: info.{key} は配列にしてください: {value!r}")
            return
        for item in value:
            if not ok(item):
                r.errors.append(f"{where}: info.{key} の{what}: {item!r}")

    def object_of(key):
        value = info.get(key, {})
        if not isinstance(value, dict):
            r.errors.append(f"{where}: info.{key} はオブジェクト（{{ ... }}）にしてください: {value!r}")
            return {}
        return value

    array_of("links", _is_link, "URL が不正です（{ \"label\", \"url\" } にしてください）")
    array_of("hashtags", lambda v: isinstance(v, str), "値は文字列にしてください")
    array_of("halls", lambda v: _is_link(v, lambda u: isinstance(u, str) and bool(u))
             and isinstance(v.get("current", False), bool), "形が不正です（{ \"label\", \"url\", \"current\" } にしてください）")
    for ev, n in object_of("eventSlots").items():
        if not (isinstance(n, int) and not isinstance(n, bool) and 1 <= n <= 5):
            r.errors.append(f"{where}: info.eventSlots の {ev} は 1〜5 にしてください: {n}")
    for n, color in object_of("slotColors").items():
        if n not in ("1", "2", "3", "4", "5"):
            r.errors.append(f"{where}: info.slotColors の枠 {n} は 1〜5 にしてください")
        elif not (isinstance(color, dict) and all(isinstance(v, str) for v in color.values())):
            r.errors.append(f"{where}: info.slotColors の枠 {n} は {{ \"light\", \"dark\", \"ink\", \"darkInk\" }}（文字列）にしてください: {color!r}")
    if "contact" in info:
        contact = info["contact"]
        if not isinstance(contact, dict):
            r.errors.append(f'{where}: info.contact は {{ "label", "url" }} にしてください（不要ならキーごと消す）: {contact!r}')
        elif not _is_link(contact):
            r.errors.append(f"{where}: info.contact.url が不正です: {contact}")

    sources = config.get("sources", [])
    if not isinstance(sources, list):
        r.errors.append(f"{where}: sources は配列にしてください")
        sources = []
    for i, s in enumerate(sources):
        kind = s.get("type") if isinstance(s, dict) else None
        if kind not in importers.available():
            r.errors.append(f"{where}: sources[{i}].type は {' / '.join(importers.available())} のどれかにしてください: {kind!r}")
        elif kind in ("csv", "json") and not s.get("file"):
            r.errors.append(f"{where}: sources[{i}] は type {kind} なので file（元データ）が必要です")
        if isinstance(s, dict) and s.get("url") and not _url_ok(s["url"]):
            r.errors.append(f"{where}: sources[{i}].url が不正です: {s['url']}")
    r.info = info


def check_circles(event, r):
    circles, seen = [], {}
    for line, row in enumerate(read_csv(event.circles_csv, CIRCLE_COLS, r.warnings), start=2):
        where = f"circles.csv:{line}"
        cid = circle_id(row)
        if not cid:
            r.errors.append(f"{where}: id もスペース番号もありません")
            continue
        if cid in seen:
            r.errors.append(f"{where}: id '{cid}' が重複しています（{seen[cid]} と同じ）")
            continue
        seen[cid] = where
        if not row.get("name"):
            r.errors.append(f"{where}: サークル名（name）が空です")
        if not row.get("space"):
            r.warnings.append(f"{where}: スペース番号が未入力です")
        links = {}
        for key in LINK_KEYS:
            url = row.get(key, "")
            if url and is_http_url(url):
                links[key] = url
            elif url:
                r.errors.append(f"{where}: {key} のURLが不正です: {url}")
        # x 列はお品書きの照合（caimawaru menu・エディタ）に使う。照合できない URL は知らせる（xurl.x_handle と同じ規則）
        if links.get("x") and not x_handle(row):
            r.warnings.append(f"{where}: x が X のアカウントの URL ではありません（https://x.com/<ID> の形にしてください）: {links['x']}")
        if not row.get("source"):
            r.warnings.append(f"{where}: 情報の出典（source）が未入力です")
        adult = row.get("adult", "")
        if adult not in ("", "0", "1"):
            r.errors.append(f"{where}: adult は 0 / 1 / 空欄のいずれかにしてください: {adult}")
        if not row.get("event"):
            r.warnings.append(f"{where}: 参加イベント（event）が未入力です")
        circles.append({
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
            "source": row.get("source", ""),
        })

    by_id = {c["id"]: c for c in circles}
    for line, row in enumerate(read_csv(event.menus_csv, MENU_COLS, r.warnings), start=2):
        where = f"menus.csv:{line}"
        cid, url = row.get("id", ""), row.get("url", "")
        if cid not in by_id:
            r.errors.append(f"{where}: circles.csv に id '{cid}' がありません")
            continue
        if not is_http_url(url):
            r.errors.append(f"{where}: URLが不正です: {url}")
            continue
        # X の投稿は caimawaru menu と同じ形（https://x.com/<ID>/status/<番号>）にそろえ、追跡用パラメータ（?s=20 など）を落とす。
        # X以外（BOOTH・画像など）はそのまま掲載。Xのページなのに投稿でないものだけ警告する
        clean, handle = normalize_url(url)
        if not handle and is_x_page(url):
            r.warnings.append(f"{where}: Xの投稿ではないページです（プロフィール等を登録していませんか）: {url}")
        if any(m["url"] == clean for m in by_id[cid]["menus"]):
            r.warnings.append(f"{where}: 同じURLが重複しています: {clean}")
            continue
        by_id[cid]["menus"].append({"url": clean, "note": row.get("note", ""), "checkedAt": row.get("checkedAt", "")})
    r.circles = circles


def check_layout(event, r):
    if not event.layout_json.exists():
        return
    where = event.rel(event.layout_json)
    try:
        spec = json.loads(event.layout_json.read_text(encoding="utf-8"))
        if not isinstance(spec, dict):
            raise layout_mod.LayoutError("配置図はオブジェクト（{ ... }）にしてください")
        r.layout = layout_mod.expand(spec)
    except json.JSONDecodeError as e:
        r.errors.append(f"{where}: JSON として読めません: {e}")
        return
    except (layout_mod.LayoutError, KeyError, TypeError, AttributeError) as e:
        r.errors.append(f"{where}: {e}")
        return
    spaces = {c["space"] for c in r.layout["cells"]}
    for c in r.circles:
        for s in circle_spaces(c):
            if s not in spaces:
                r.errors.append(f"{where}: {c['id']}（{c['name']}）のスペース {s} が配置図にありません")


def validate(event):
    r = Result()
    check_config(event, r)
    check_circles(event, r)
    check_layout(event, r)
    return r


def report(r, out=None, err=None):
    out, err = out or sys.stdout, err or sys.stderr
    for w in r.warnings:
        print(f"警告: {w}", file=err)
    for e in r.errors:
        print(f"エラー: {e}", file=err)
    with_menu = sum(1 for c in r.circles if c["menus"])
    print(f"サークル {len(r.circles)} 件（お品書きあり {with_menu} 件）、エラー {len(r.errors)} 件、警告 {len(r.warnings)} 件", file=out)


def write_output(event, r, today=None):
    """circles.json を書く。「サークル情報の更新」日はサークル情報（お品書きを含む）が変わったときだけ今日にする。"""
    prev = json.loads(event.out_json.read_text(encoding="utf-8")) if event.out_json.exists() else {}
    prev_updated = prev.get("event", {}).get("updatedAt")
    unchanged = prev.get("circles") == r.circles and prev_updated
    info = {**r.info, "updatedAt": prev_updated if unchanged else (today or date.today().isoformat())}
    out = {"event": info, "circles": r.circles, **({"layout": r.layout} if r.layout is not None else {})}
    event.out_json.parent.mkdir(parents=True, exist_ok=True)
    event.out_json.write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return out


def run(event, check=False):
    """検証して（check でなければ）生成する。終了コードを返す。"""
    r = validate(event)
    report(r)
    if r.errors:
        return 1
    if not check:
        write_output(event, r)
        print(f"{event.rel(event.out_json)} を更新しました")
    return 0
