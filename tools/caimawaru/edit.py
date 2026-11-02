"""イベントデータを確かめ・編集する（caimawaru circle / menus / config）。

    # 確かめる（--json で機械向けの JSON）
    caimawaru circle list <eventId> [<サークル指定>] [--event <イベント名>] [--json]
    caimawaru circle show <eventId> <サークル指定> [--json]
    caimawaru menus list <eventId> [<サークル指定>] [--json]
    caimawaru config get <eventId> [<キー>]

    # 編集する（--dry-run で変化だけ表示。書き込んだあと caimawaru data まで実行。--no-build で省略）
    caimawaru circle add <eventId> space=A-10 name=サークル名 event=サンプル即売会 source=…
    caimawaru circle set <eventId> A-10 notes=新刊あり tags="新刊;グッズ"
    caimawaru circle remove <eventId> A-10 [--with-menus]
    caimawaru menus set <eventId> A-10 note=既刊 [--url URL] [--all]
    caimawaru menus remove <eventId> A-10 [--url URL] [--all]
    caimawaru config set <eventId> info.venue "サンプル会館"
    caimawaru config set <eventId> info.eventSlots.併設オンリー 2 --json
    caimawaru config unset <eventId> info.contact

サークル指定はスペース番号・id・@XのID（完全一致）か、サークル名の一部（caimawaru menu と同じ）。
お品書きの追加は caimawaru menu。

- 書き込む前に、変更後のイベントデータを検証する。変更で新しいエラーが増えるなら書き込まない
- CSV は決まった形（docs/event-data.md の「CSV の書き方」。取り込み・caimawaru menu と同じ）で書き戻す。
  イベントデータにない列と「#」の行（最初の値が「#」で始まる行）は残し、空行・値がすべて空の行は落とす。その形で保存されたファイルなら、差分は変えた行だけになる
- event.json のキーは「.」で区切る（info.links.0.url）。「.」を含むキーは、親のオブジェクトごと --json で書く
- 変更でエラーが増えたかは、行番号を除いたメッセージで比べる（同じ内容のエラーが別の行に移ると見分けられない）
- event.json はインデント 2・日本語はそのままの JSON で書き戻す（キーの順は保つ）
- storeId とサークルの id は公開後に変えない（閲覧者の ★・タグ・メモが参照する）ので、変えるには --force が要る
"""
import difflib
import json
import re
import shutil
import sys
import tempfile
from collections import Counter
from pathlib import Path
from typing import NamedTuple

from caimawaru import build
from caimawaru.menu import describe, find_circles
from caimawaru.project import (CIRCLE_COLS, DRY_RUN_NOTICE, MENU_COLS, CliError, DuplicateKeyError, Event, Table, circle_id,
                               format_json, is_comment, make_id, parse_json, print_warnings, stripped)
from caimawaru.xurl import normalize_url


# --- CSV を書き戻す形のまま扱う ---

ROW_INDEX = "_row"  # 行のビューに入れる、table.rows の中の位置


class Loaded(NamedTuple):
    """circles.csv・menus.csv（書き戻す Table）と、そのデータの行のビュー。"""

    circles: Table
    circle_views: list
    menus: Table
    menu_views: list


def _row_views(table, with_circle_id):
    """データの行（read_csv が読む行）を、列名 → 前後の空白を除いた値の dict にする。ROW_INDEX は table.rows の位置。"""
    views = []
    for index, row in enumerate(table.rows):
        if is_comment(row):
            continue
        view = {name: stripped(row, key) for name, key in table.names.items()}
        if with_circle_id:
            view["id"] = circle_id(view)
        view[ROW_INDEX] = index
        views.append(view)
    return views


def _named_values(view, names):
    """ビューから列の値だけを取り出す（ROW_INDEX を除く。JSON の出力用）。"""
    return {name: view.get(name, "") for name in names}


def _candidates(found):
    return "\n".join(f"  {circle['id']}  {describe(circle)}" for circle in found)


def _no_circle_error(query):
    return CliError(f"該当するサークルがありません: {query}（caimawaru circle list で確かめられます）")


def _ambiguous_error(query, found):
    return CliError(f"候補が複数あります: {query}。スペース番号か id で指定してください\n{_candidates(found)}")


def _pick_circle(circles, query):
    found = find_circles(circles, query)
    if not found:
        raise _no_circle_error(query)
    if len(found) > 1:
        raise _ambiguous_error(query, found)
    return found[0]


def _parse_fields(items, names):
    """「列名=値」のリストを dict（列名 → 値）にする。names は指定できる列名。"""
    values = {}
    for item in items:
        name, has_equals, value = item.partition("=")
        name = name.strip()
        if not has_equals or not name:
            raise CliError(f"「列名=値」の形で指定してください: {item}")
        if name not in names:
            raise CliError(f"列 '{name}' はありません（{', '.join(names)}。列名が空・重複している列は指定できません）")
        if name in values:
            raise CliError(f"列 '{name}' を2回指定しています")
        values[name] = value.strip()
    if not values:
        raise CliError("変更する列を「列名=値」で指定してください")
    return values


def _print_changes(table, row, values, indent):
    """row（table.rows の行）に values（列名 → 値）を入れると変わる列を、変更前 → 変更後で表示する。"""
    for name, value in values.items():
        old = stripped(row, table.names[name])
        if old != value:
            print(f"{indent}{name}: {_quoted(old)} → {_quoted(value)}")


def _set_values(table, row, values):
    for name, value in values.items():
        row[table.names[name]] = value


def _quoted(value):
    return json.dumps(value, ensure_ascii=False)


# --- 検証して書き込む ---

_LINE_NUMBER = re.compile(r"\b(circles|menus)\.csv:\d+|\d+行目")


def _without_line_number(match):
    return f"{match.group(1)}.csv" if match.group(1) else "N行目"


def _new_messages(before, after):
    """after にだけあるメッセージ（行番号は行の増減でずれるので比べない）。"""
    remaining = Counter(_LINE_NUMBER.sub(_without_line_number, message) for message in before)
    added = []
    for message in after:
        key = _LINE_NUMBER.sub(_without_line_number, message)
        if remaining[key]:
            remaining[key] -= 1
        else:
            added.append(message)
    return added


def _validate_with(event, files):
    """files（{パス: 新しい内容}）を反映したイベントデータを、一時フォルダに写して検証する。"""
    with tempfile.TemporaryDirectory() as tmp:
        temp_event = Event(Path(tmp).resolve() / "events", event.id)
        for source in (event.config_json, event.layout_json, event.circles_csv, event.menus_csv):
            copy = temp_event.dir / source.relative_to(event.dir)
            copy.parent.mkdir(parents=True, exist_ok=True)
            if source in files:
                with copy.open("w", encoding="utf-8", newline="") as f:
                    f.write(files[source])
            elif source.exists():
                shutil.copyfile(source, copy)
        return build.validate(temp_event)


def _read_text(path):
    return path.read_bytes().decode("utf-8-sig") if path.exists() else ""


def _has_lf_records(text):
    """CSV の行の終わりに LF だけのものがあるか（引用符の中の改行は値の一部なので数えない）。"""
    is_quoted = False
    for index, char in enumerate(text):
        if char == '"':
            is_quoted = not is_quoted  # 「""」は2回切り替わるので元に戻る
        elif char == "\n" and not is_quoted and (index == 0 or text[index - 1] != "\r"):
            return True
    return False


def _write_all(event, files):
    """files をまとめて書く。どれか1つでも開けなければ（読み取り専用・ほかのアプリが開いている等）、どれも書かない。

    先にすべてを中身を消さずに開いてから書く（一時ファイルを作って置き換える方法はファイルを動かすので使わない）。
    """
    handles = []
    try:
        for path in sorted(files, key=lambda path: not path.exists()):  # 新しく作るファイルは最後に
            try:
                path.parent.mkdir(parents=True, exist_ok=True)
                handles.append((path, path.open("r+b" if path.exists() else "xb")))
            except OSError as e:
                raise CliError(f"{event.rel(path)} に書き込めません（ほかのアプリで開いていたら閉じてください）: {e}。"
                               "どのファイルも書き換えていません") from e
        for path, f in handles:
            try:
                f.write(files[path].encode("utf-8"))
                f.truncate()
            except OSError as e:
                raise CliError(f"{event.rel(path)} の書き込みに失敗しました: {e}") from e
    finally:
        for _, f in handles:
            f.close()


def _print_diff(event, path, old, new):
    rel = event.rel(path)
    diff = list(difflib.unified_diff(old.splitlines(), new.splitlines(), f"a/{rel}", f"b/{rel}", lineterm=""))
    for line in diff or [f"{rel}: 改行・空行・BOM だけが変わります"]:
        print(line)
    if path.suffix == ".csv" and _has_lf_records(old):
        print(f"{rel}: 改行を CRLF にそろえます")


def commit(event, files, dry_run=False, no_build=False):
    """files（{パス: 新しい内容}）の差分を表示し、検証して書き込む。終了コードを返す。"""
    old_texts = {path: _read_text(path) for path in files}
    changed = {path: new for path, new in files.items() if old_texts[path] != new}
    if not changed:
        print("変更はありません")
        return 0
    for path, new in changed.items():
        _print_diff(event, path, old_texts[path], new)

    before = build.validate(event)
    after = _validate_with(event, changed)
    print_warnings(_new_messages(before.warnings, after.warnings))
    errors = _new_messages(before.errors, after.errors)
    if errors:
        raise CliError("検証でエラーになるため書き込みません:\n" + "\n".join(f"  エラー: {error}" for error in errors))
    if dry_run:
        print(DRY_RUN_NOTICE)
        return 0

    _write_all(event, changed)
    print(f"{' と '.join(event.rel(path) for path in changed)} を更新しました")
    return 0 if no_build else build.run(event)


# --- circles.csv ---

def _load(event):
    circles = Table(event.circles_csv, CIRCLE_COLS)
    menus = Table(event.menus_csv, MENU_COLS)
    print_warnings(circles.warnings + menus.warnings)
    return Loaded(circles, _row_views(circles, with_circle_id=True), menus, _row_views(menus, with_circle_id=False))


def _menu_views_of(menu_views, owner_id):
    return [menu for menu in menu_views if menu["id"] == owner_id]


def _menus_json(menu_views, owner_id, names):
    """サークルのお品書き（id 以外の列）。"""
    return [{name: menu[name] for name in names if name != "id"} for menu in _menu_views_of(menu_views, owner_id)]


def _print_json(value):
    print(json.dumps(value, ensure_ascii=False, indent=2))


def circle_list(event, query=None, event_name=None, as_json=False):
    loaded = _load(event)
    found = find_circles(loaded.circle_views, query) if query else loaded.circle_views
    if event_name:
        found = [circle for circle in found if circle["event"] == event_name]
    if as_json:
        _print_json([{**_named_values(circle, loaded.circles.names),
                      "menus": _menus_json(loaded.menu_views, circle["id"], loaded.menus.names)} for circle in found])
        return 0
    for circle in found:
        menu_count = len(_menu_views_of(loaded.menu_views, circle["id"]))
        print(f"{circle['id']}\t{circle['space']}\t{circle['name']}\t{circle['event']}\tお品書き {menu_count}")
    print(f"{len(found)} 件", file=sys.stderr)
    return 0


def circle_show(event, query, as_json=False):
    loaded = _load(event)
    circle = _pick_circle(loaded.circle_views, query)
    menus = _menus_json(loaded.menu_views, circle["id"], loaded.menus.names)
    if as_json:
        _print_json({**_named_values(circle, loaded.circles.names), "menus": menus})
        return 0
    for name in loaded.circles.names:
        print(f"{name}: {circle[name]}")
    print(f"お品書き: {len(menus)} 件")
    for menu in menus:
        print("  " + "  ".join(value for value in menu.values() if value))
    return 0


def circle_add(event, fields, dry_run=False, no_build=False):
    loaded = _load(event)
    values = _parse_fields(fields, loaded.circles.names)
    row = {key: "" for key in loaded.circles.cols}
    row.update({loaded.circles.names[name]: value for name, value in values.items()})
    if not row["id"]:
        row["id"] = make_id(row["space"])
    if not row["id"]:
        raise CliError("id か space を指定してください")
    if any(circle["id"] == row["id"] for circle in loaded.circle_views):
        raise CliError(f"id '{row['id']}' のサークルはすでにあります（変えるなら caimawaru circle set）")
    loaded.circles.rows.append(row)
    print(f"追加: {row['id']}  {describe(row)}")
    return commit(event, {event.circles_csv: loaded.circles.text()}, dry_run, no_build)


def circle_set(event, query, fields, force=False, dry_run=False, no_build=False):
    loaded = _load(event)
    circle = _pick_circle(loaded.circle_views, query)
    values = _parse_fields(fields, loaded.circles.names)
    row = loaded.circles.rows[circle[ROW_INDEX]]
    print(f"変更: {circle['id']}  {describe(circle)}")
    _print_changes(loaded.circles, row, values, indent="  ")
    _set_values(loaded.circles, row, values)
    files = {event.circles_csv: loaded.circles.text()}

    new_id = circle_id(row)
    if new_id == circle["id"]:
        return commit(event, files, dry_run, no_build)
    if any(other["id"] == new_id for other in loaded.circle_views if other is not circle):
        raise CliError(f"id '{new_id}' のサークルはすでにあります")
    if not force:
        raise CliError(f"id が {circle['id']} から {new_id or '（空）'} に変わります。id は menus.csv と閲覧者の ★・タグ・メモが参照するので、"
                       "公開後は変えません。変えるときは --force（menus.csv の id も書き換えます）")
    moved = _menu_views_of(loaded.menu_views, circle["id"])
    for menu in moved:
        loaded.menus.rows[menu[ROW_INDEX]]["id"] = new_id
    if moved:
        print(f"  menus.csv の {len(moved)} 行の id も {new_id} にします")
        files[event.menus_csv] = loaded.menus.text()
    return commit(event, files, dry_run, no_build)


def _delete_rows(table, views):
    """views の行を table.rows から消す（後ろから消して、残りの位置をずらさない）。"""
    for view in sorted(views, key=lambda view: view[ROW_INDEX], reverse=True):
        del table.rows[view[ROW_INDEX]]


def circle_remove(event, query, with_menus=False, dry_run=False, no_build=False):
    loaded = _load(event)
    circle = _pick_circle(loaded.circle_views, query)
    own_menus = _menu_views_of(loaded.menu_views, circle["id"])
    if own_menus and not with_menus:
        raise CliError(f"{circle['id']}  {describe(circle)} には menus.csv にお品書きが {len(own_menus)} 件あります:\n"
                       + "\n".join(f"  {menu['url']}" for menu in own_menus)
                       + "\nお品書きも消すなら --with-menus、別のサークルに移すなら先に caimawaru menus set … id=<id>")
    print(f"削除: {circle['id']}  {describe(circle)}" + (f"（お品書き {len(own_menus)} 件も削除）" if own_menus else ""))
    del loaded.circles.rows[circle[ROW_INDEX]]
    files = {event.circles_csv: loaded.circles.text()}
    if own_menus:
        _delete_rows(loaded.menus, own_menus)
        files[event.menus_csv] = loaded.menus.text()
    return commit(event, files, dry_run, no_build)


# --- menus.csv ---

def _circles_for_menus(loaded, query):
    """サークル指定に一致するサークル。サークルがなく menus.csv にだけある id（宙に浮いたお品書き）も指定できる。"""
    found = find_circles(loaded.circle_views, query)
    if found:
        return found
    orphan_id = query.strip()
    if any(menu["id"] == orphan_id for menu in loaded.menu_views):
        return [{"id": orphan_id, "space": "", "name": "（circles.csv にないサークル）", "event": ""}]
    raise _no_circle_error(query)


def menus_list(event, query=None, as_json=False):
    loaded = _load(event)
    menu_views = loaded.menu_views
    if query:
        ids = {circle["id"] for circle in _circles_for_menus(loaded, query)}
        menu_views = [menu for menu in menu_views if menu["id"] in ids]
    if as_json:
        _print_json([_named_values(menu, loaded.menus.names) for menu in menu_views])
        return 0
    for menu in menu_views:
        print("\t".join(menu[name] for name in loaded.menus.names))
    print(f"{len(menu_views)} 件", file=sys.stderr)
    return 0


def _pick_menus(event, query, url, select_all):
    """対象のサークルとお品書きを決める。(サークル, menus.csv の Table, お品書きのビューのリスト) を返す。"""
    loaded = _load(event)
    found = _circles_for_menus(loaded, query)
    if len(found) > 1:
        raise _ambiguous_error(query, found)
    circle = found[0]
    targets = _menu_views_of(loaded.menu_views, circle["id"])
    if url:
        wanted = {url.strip(), normalize_url(url.strip())[0]}
        targets = [menu for menu in targets if menu["url"] in wanted]
    if not targets:
        raise CliError(f"{circle['id']}  {describe(circle)} に" + (f" {url} の" if url else "") + "お品書きはありません")
    if len(targets) > 1 and not select_all:
        raise CliError(f"{circle['id']} のお品書きが {len(targets)} 件あります。--url で指定するか、すべてなら --all\n"
                       + "\n".join(f"  {menu['url']}" for menu in targets))
    return circle, loaded.menus, targets


def menus_set(event, query, fields, url=None, select_all=False, dry_run=False, no_build=False):
    circle, menus, targets = _pick_menus(event, query, url, select_all)
    values = _parse_fields(fields, menus.names)
    if values.get("url"):
        values["url"] = normalize_url(values["url"])[0]
    print(f"変更: {circle['id']}  {describe(circle)} のお品書き {len(targets)} 件")
    for menu in targets:
        print(f"  {menu['url']}")
        row = menus.rows[menu[ROW_INDEX]]
        _print_changes(menus, row, values, indent="    ")
        _set_values(menus, row, values)
    return commit(event, {event.menus_csv: menus.text()}, dry_run, no_build)


def menus_remove(event, query, url=None, select_all=False, dry_run=False, no_build=False):
    circle, menus, targets = _pick_menus(event, query, url, select_all)
    print(f"削除: {circle['id']}  {describe(circle)} のお品書き {len(targets)} 件")
    for menu in sorted(targets, key=lambda menu: menu[ROW_INDEX], reverse=True):
        print(f"  {menu['url']}")
    _delete_rows(menus, targets)
    return commit(event, {event.menus_csv: menus.text()}, dry_run, no_build)


# --- event.json ---

_MISSING = object()


def _load_config(event):
    where = event.rel(event.config_json)
    text = _read_text(event.config_json)
    try:
        config = parse_json(text)
    except DuplicateKeyError as e:
        raise CliError(f"{where}: {e}。書き換えると片方が消えるので、先に直してください")
    except json.JSONDecodeError as e:
        raise CliError(f"{where}: JSON として読めません: {e}")
    if not isinstance(config, dict):
        raise CliError(f"{where}: オブジェクト（{{ ... }}）ではありません")
    return text, config


def _key_parts(key):
    parts = key.split(".")
    if not all(parts):
        raise CliError(f"キーは「.」区切りで書いてください（例: info.venue、info.links.0.url）: {key}")
    return parts


def _child(node, part, key):
    """node の part（オブジェクトのキーか配列の番号）。なければ _MISSING。key はエラーの表示用。"""
    if isinstance(node, dict):
        return node.get(part, _MISSING)
    if isinstance(node, list):
        if part.isdigit() and int(part) < len(node):
            return node[int(part)]
        raise CliError(f"{key}: {part} は配列の番号（0〜{len(node) - 1}）にしてください")
    raise CliError(f"{key}: {part} の手前が値（オブジェクトでも配列でもない）です")


def _get(config, key):
    node = config
    for part in _key_parts(key):
        node = _child(node, part, key)
        if node is _MISSING:
            raise CliError(f"event.json に {key} がありません")
    return node


def _dump_config(config, old_text):
    """event.json の新しい内容。元の改行が CRLF なら CRLF のまま。"""
    text = format_json(config)
    return text.replace("\n", "\r\n") if "\r\n" in old_text else text


def _check_store_id(parts, force):
    if parts[0] == "storeId" and not force:
        raise CliError("storeId は ★・タグ・メモの保存先なので、公開後に変えると閲覧者の保存内容が読めなくなります。変えるときは --force")


def config_get(event, key=None):
    _, config = _load_config(event)
    _print_json(_get(config, key) if key else config)
    return 0


def config_set(event, key, value, as_json=False, force=False, dry_run=False, no_build=False):
    old_text, config = _load_config(event)
    parts = _key_parts(key)
    if as_json:
        try:
            value = parse_json(value)
        except ValueError as e:
            raise CliError(f"値を JSON として読めません（文字列なら --json を付けない）: {e}")
    parent = config
    for part in parts[:-1]:
        child = _child(parent, part, key)
        if child is _MISSING:
            child = parent[part] = {}
        parent = child
    last = parts[-1]
    old = _child(parent, last, key)
    if old != value:
        _check_store_id(parts, force)
    if isinstance(parent, list):
        parent[int(last)] = value
    else:
        parent[last] = value
    print(f"{key}: {'（なし）' if old is _MISSING else _quoted(old)} → {_quoted(value)}")
    return commit(event, {event.config_json: _dump_config(config, old_text)}, dry_run, no_build)


def config_unset(event, key, force=False, dry_run=False, no_build=False):
    old_text, config = _load_config(event)
    parts = _key_parts(key)
    *parent_parts, last = parts
    parent = _get(config, ".".join(parent_parts)) if parent_parts else config
    old = _child(parent, last, key)
    if old is _MISSING:
        raise CliError(f"event.json に {key} がありません")
    _check_store_id(parts, force)
    if isinstance(parent, list):
        del parent[int(last)]
    else:
        del parent[last]
    print(f"{key}: {_quoted(old)} → （削除）")
    return commit(event, {event.config_json: _dump_config(config, old_text)}, dry_run, no_build)


# --- CLI ---

def run(event, args):
    """caimawaru circle / menus / config の各操作。終了コードを返す。"""
    write_options = {"dry_run": getattr(args, "dry_run", False), "no_build": getattr(args, "no_build", False)}
    match (args.command, args.action):
        case ("circle", "list"):
            return circle_list(event, args.query, args.event_name, args.json)
        case ("circle", "show"):
            return circle_show(event, args.query, args.json)
        case ("circle", "add"):
            return circle_add(event, args.fields, **write_options)
        case ("circle", "set"):
            return circle_set(event, args.query, args.fields, force=args.force, **write_options)
        case ("circle", "remove"):
            return circle_remove(event, args.query, with_menus=args.with_menus, **write_options)
        case ("menus", "list"):
            return menus_list(event, args.query, args.json)
        case ("menus", "set"):
            return menus_set(event, args.query, args.fields, url=args.url, select_all=args.all, **write_options)
        case ("menus", "remove"):
            return menus_remove(event, args.query, url=args.url, select_all=args.all, **write_options)
        case ("config", "get"):
            return config_get(event, args.key)
        case ("config", "set"):
            return config_set(event, args.key, args.value, as_json=args.json, force=args.force, **write_options)
        case ("config", "unset"):
            return config_unset(event, args.key, force=args.force, **write_options)
    raise AssertionError((args.command, args.action))
