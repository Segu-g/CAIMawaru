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

from caimawaru import build
from caimawaru.menu import describe, find_circles
from caimawaru.project import CIRCLE_COLS, MENU_COLS, CliError, DuplicateKeyError, Event, Table, circle_id, is_comment, make_id, parse_json
from caimawaru.xurl import normalize_url


# --- CSV を書き戻す形のまま扱う ---

def _is_data_row(row):
    """read_csv が読む行か（read_table は空行を落とし、「#」の行をコメント行にしている）。"""
    return not is_comment(row)


def _views(table, derive_id):
    """データの行を、値の前後の空白を除いた dict にする。"_row" は table.rows の位置。"""
    out = []
    for i, row in enumerate(table.rows):
        if not _is_data_row(row):
            continue
        v = {name: (row.get(key) or "").strip() for name, key in table.names.items()}
        if derive_id:
            v["id"] = circle_id(v)
        v["_row"] = i
        out.append(v)
    return out


def _public(v, cols):
    return {c: v.get(c, "") for c in cols}


def _candidates(found):
    return "\n".join(f"  {c['id']}  {describe(c)}" for c in found)


def _pick_circle(circles, query):
    found = find_circles(circles, query)
    if not found:
        raise CliError(f"該当するサークルがありません: {query}（caimawaru circle list で確かめられます）")
    if len(found) > 1:
        raise CliError(f"候補が複数あります: {query}。スペース番号か id で指定してください\n{_candidates(found)}")
    return found[0]


def _parse_fields(items, cols):
    """「列名=値」のリストを dict（列名 → 値）にする。cols は指定できる列名。"""
    out = {}
    for item in items:
        key, sep, value = item.partition("=")
        key = key.strip()
        if not sep or not key:
            raise CliError(f"「列名=値」の形で指定してください: {item}")
        if key not in cols:
            raise CliError(f"列 '{key}' はありません（{', '.join(cols)}。列名が空・重複している列は指定できません）")
        if key in out:
            raise CliError(f"列 '{key}' を2回指定しています")
        out[key] = value.strip()
    if not out:
        raise CliError("変更する列を「列名=値」で指定してください")
    return out


def _q(value):
    return json.dumps(value, ensure_ascii=False)


# --- 検証して書き込む ---

_LINE = re.compile(r"\b(circles|menus)\.csv:\d+|\d+行目")


def _unnumber(m):
    return f"{m.group(1)}.csv" if m.group(1) else "N行目"


def _new_messages(before, after):
    """after にだけあるメッセージ（行番号は行の増減でずれるので比べない）。"""
    left = Counter(_LINE.sub(_unnumber, m) for m in before)
    out = []
    for m in after:
        key = _LINE.sub(_unnumber, m)
        if left[key]:
            left[key] -= 1
        else:
            out.append(m)
    return out


def _validate_with(event, files):
    """files（{パス: 新しい内容}）を反映したイベントデータを、一時フォルダに写して検証する。"""
    with tempfile.TemporaryDirectory() as tmp:
        temp = Event(Path(tmp).resolve() / "events", event.id)
        for src in (event.config_json, event.layout_json, event.circles_csv, event.menus_csv):
            dst = temp.dir / src.relative_to(event.dir)
            dst.parent.mkdir(parents=True, exist_ok=True)
            if src in files:
                with dst.open("w", encoding="utf-8", newline="") as f:
                    f.write(files[src])
            elif src.exists():
                shutil.copyfile(src, dst)
        return build.validate(temp)


def _read_text(path):
    return path.read_bytes().decode("utf-8-sig") if path.exists() else ""


def _has_lf_records(text):
    """CSV の行の終わりに LF だけのものがあるか（引用符の中の改行は値の一部なので数えない）。"""
    quoted = False
    for i, ch in enumerate(text):
        if ch == '"':
            quoted = not quoted  # 「""」は2回切り替わるので元に戻る
        elif ch == "\n" and not quoted and (i == 0 or text[i - 1] != "\r"):
            return True
    return False


def _write_all(event, files):
    """files をまとめて書く。どれか1つでも開けなければ（読み取り専用・ほかのアプリが開いている等）、どれも書かない。

    先にすべてを中身を消さずに開いてから書く（一時ファイルを作って置き換える方法はファイルを動かすので使わない）。
    """
    handles = []
    try:
        for path in sorted(files, key=lambda p: not p.exists()):  # 新しく作るファイルは最後に
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


def commit(event, files, dry_run=False, no_build=False):
    """files（{パス: 新しい内容}）の差分を表示し、検証して書き込む。終了コードを返す。"""
    changed = {p: (_read_text(p), new) for p, new in files.items() if _read_text(p) != new}
    if not changed:
        print("変更はありません")
        return 0
    for path, (old, new) in changed.items():
        rel = event.rel(path)
        diff = list(difflib.unified_diff(old.splitlines(), new.splitlines(), f"a/{rel}", f"b/{rel}", lineterm=""))
        for line in diff or [f"{rel}: 改行・空行・BOM だけが変わります"]:
            print(line)
        if path.suffix == ".csv" and _has_lf_records(old):
            print(f"{rel}: 改行を CRLF にそろえます")

    before = build.validate(event)
    after = _validate_with(event, {p: new for p, (_, new) in changed.items()})
    for w in _new_messages(before.warnings, after.warnings):
        print(f"警告: {w}", file=sys.stderr)
    errors = _new_messages(before.errors, after.errors)
    if errors:
        raise CliError("検証でエラーになるため書き込みません:\n" + "\n".join(f"  エラー: {e}" for e in errors))
    if dry_run:
        print("（--dry-run のため書き込みません）")
        return 0

    _write_all(event, {p: new for p, (_, new) in changed.items()})
    print(f"{' と '.join(event.rel(p) for p in changed)} を更新しました")
    return 0 if no_build else build.run(event)


# --- circles.csv ---

def _load(event):
    circles = Table(event.circles_csv, CIRCLE_COLS)
    menus = Table(event.menus_csv, MENU_COLS)
    for w in circles.warnings + menus.warnings:
        print(f"警告: {w}", file=sys.stderr)
    return circles, _views(circles, True), menus, _views(menus, False)


def _menus_of(menu_views, cid, cols):
    return [{c: m[c] for c in cols if c != "id"} for m in menu_views if m["id"] == cid]


def _print_json(value):
    print(json.dumps(value, ensure_ascii=False, indent=2))


def circle_list(event, query=None, event_name=None, as_json=False):
    circles, views, menus, menu_views = _load(event)
    found = find_circles(views, query) if query else views
    if event_name:
        found = [c for c in found if c["event"] == event_name]
    if as_json:
        _print_json([{**_public(c, circles.names), "menus": _menus_of(menu_views, c["id"], menus.names)} for c in found])
        return 0
    for c in found:
        n = sum(1 for m in menu_views if m["id"] == c["id"])
        print(f"{c['id']}\t{c['space']}\t{c['name']}\t{c['event']}\tお品書き {n}")
    print(f"{len(found)} 件", file=sys.stderr)
    return 0


def circle_show(event, query, as_json=False):
    circles, views, menus, menu_views = _load(event)
    c = _pick_circle(views, query)
    menu_list = _menus_of(menu_views, c["id"], menus.names)
    if as_json:
        _print_json({**_public(c, circles.names), "menus": menu_list})
        return 0
    for col in circles.names:
        print(f"{col}: {c[col]}")
    print(f"お品書き: {len(menu_list)} 件")
    for m in menu_list:
        print("  " + "  ".join(v for v in m.values() if v))
    return 0


def circle_add(event, fields, dry_run=False, no_build=False):
    circles, views, _, _ = _load(event)
    values = _parse_fields(fields, circles.names)
    row = {c: "" for c in circles.cols}
    row.update({circles.names[k]: v for k, v in values.items()})
    if not row["id"]:
        row["id"] = make_id(row["space"])
    if not row["id"]:
        raise CliError("id か space を指定してください")
    if any(c["id"] == row["id"] for c in views):
        raise CliError(f"id '{row['id']}' のサークルはすでにあります（変えるなら caimawaru circle set）")
    circles.rows.append(row)
    print(f"追加: {row['id']}  {describe(row)}")
    return commit(event, {event.circles_csv: circles.text()}, dry_run, no_build)


def circle_set(event, query, fields, force=False, dry_run=False, no_build=False):
    circles, views, menus, menu_views = _load(event)
    c = _pick_circle(views, query)
    values = _parse_fields(fields, circles.names)
    row = circles.rows[c["_row"]]
    print(f"変更: {c['id']}  {describe(c)}")
    for name, value in values.items():
        key = circles.names[name]
        if (row.get(key) or "").strip() != value:
            print(f"  {name}: {_q((row.get(key) or '').strip())} → {_q(value)}")
        row[key] = value
    files = {event.circles_csv: circles.text()}

    new_id = circle_id(row)
    if new_id != c["id"]:
        if any(o["id"] == new_id for o in views if o is not c):
            raise CliError(f"id '{new_id}' のサークルはすでにあります")
        if not force:
            raise CliError(f"id が {c['id']} から {new_id or '（空）'} に変わります。id は menus.csv と閲覧者の ★・タグ・メモが参照するので、"
                           "公開後は変えません。変えるときは --force（menus.csv の id も書き換えます）")
        moved = [m for m in menu_views if m["id"] == c["id"]]
        for m in moved:
            menus.rows[m["_row"]]["id"] = new_id
        if moved:
            print(f"  menus.csv の {len(moved)} 行の id も {new_id} にします")
            files[event.menus_csv] = menus.text()
    return commit(event, files, dry_run, no_build)


def circle_remove(event, query, with_menus=False, dry_run=False, no_build=False):
    circles, views, menus, menu_views = _load(event)
    c = _pick_circle(views, query)
    own = [m for m in menu_views if m["id"] == c["id"]]
    if own and not with_menus:
        raise CliError(f"{c['id']}  {describe(c)} には menus.csv にお品書きが {len(own)} 件あります:\n"
                       + "\n".join(f"  {m['url']}" for m in own)
                       + "\nお品書きも消すなら --with-menus、別のサークルに移すなら先に caimawaru menus set … id=<id>")
    print(f"削除: {c['id']}  {describe(c)}" + (f"（お品書き {len(own)} 件も削除）" if own else ""))
    del circles.rows[c["_row"]]
    files = {event.circles_csv: circles.text()}
    if own:
        for m in sorted(own, key=lambda m: m["_row"], reverse=True):
            del menus.rows[m["_row"]]
        files[event.menus_csv] = menus.text()
    return commit(event, files, dry_run, no_build)


# --- menus.csv ---

def _menu_ids(views, menu_views, query):
    """サークル指定に一致する id。サークルがなく menus.csv にだけある id（宙に浮いたお品書き）も指定できる。"""
    found = find_circles(views, query)
    if found:
        return found
    if any(m["id"] == query.strip() for m in menu_views):
        return [{"id": query.strip(), "space": "", "name": "（circles.csv にないサークル）", "event": ""}]
    raise CliError(f"該当するサークルがありません: {query}（caimawaru circle list で確かめられます）")


def menus_list(event, query=None, as_json=False):
    _, views, menus, menu_views = _load(event)
    rows = menu_views
    if query:
        ids = {c["id"] for c in _menu_ids(views, menu_views, query)}
        rows = [m for m in menu_views if m["id"] in ids]
    if as_json:
        _print_json([_public(m, menus.names) for m in rows])
        return 0
    for m in rows:
        print("\t".join(m[c] for c in menus.names))
    print(f"{len(rows)} 件", file=sys.stderr)
    return 0


def _pick_menus(event, query, url, all_):
    _, views, menus, menu_views = _load(event)
    found = _menu_ids(views, menu_views, query)
    if len(found) > 1:
        raise CliError(f"候補が複数あります: {query}。スペース番号か id で指定してください\n{_candidates(found)}")
    c = found[0]
    entries = [m for m in menu_views if m["id"] == c["id"]]
    if url:
        wanted = {url.strip(), normalize_url(url.strip())[0]}
        entries = [m for m in entries if m["url"] in wanted]
    if not entries:
        raise CliError(f"{c['id']}  {describe(c)} に" + (f" {url} の" if url else "") + "お品書きはありません")
    if len(entries) > 1 and not all_:
        raise CliError(f"{c['id']} のお品書きが {len(entries)} 件あります。--url で指定するか、すべてなら --all\n"
                       + "\n".join(f"  {m['url']}" for m in entries))
    return c, menus, entries


def menus_set(event, query, fields, url=None, all_=False, dry_run=False, no_build=False):
    c, menus, entries = _pick_menus(event, query, url, all_)
    values = _parse_fields(fields, menus.names)
    if values.get("url"):
        values["url"] = normalize_url(values["url"])[0]
    print(f"変更: {c['id']}  {describe(c)} のお品書き {len(entries)} 件")
    for m in entries:
        row = menus.rows[m["_row"]]
        print(f"  {m['url']}")
        for name, value in values.items():
            key = menus.names[name]
            if (row.get(key) or "").strip() != value:
                print(f"    {name}: {_q((row.get(key) or '').strip())} → {_q(value)}")
            row[key] = value
    return commit(event, {event.menus_csv: menus.text()}, dry_run, no_build)


def menus_remove(event, query, url=None, all_=False, dry_run=False, no_build=False):
    c, menus, entries = _pick_menus(event, query, url, all_)
    print(f"削除: {c['id']}  {describe(c)} のお品書き {len(entries)} 件")
    for m in sorted(entries, key=lambda m: m["_row"], reverse=True):
        print(f"  {m['url']}")
        del menus.rows[m["_row"]]
    return commit(event, {event.menus_csv: menus.text()}, dry_run, no_build)


# --- event.json ---

_MISSING = object()


def _load_config(event):
    text = _read_text(event.config_json)
    try:
        config = parse_json(text)
    except DuplicateKeyError as e:
        raise CliError(f"{event.rel(event.config_json)}: {e}。書き換えると片方が消えるので、先に直してください")
    except json.JSONDecodeError as e:
        raise CliError(f"{event.rel(event.config_json)}: JSON として読めません: {e}")
    if not isinstance(config, dict):
        raise CliError(f"{event.rel(event.config_json)}: オブジェクト（{{ ... }}）ではありません")
    return text, config


def _keys(key):
    parts = key.split(".")
    if not all(parts):
        raise CliError(f"キーは「.」区切りで書いてください（例: info.venue、info.links.0.url）: {key}")
    return parts


def _step(node, part, key):
    """node の part（オブジェクトのキーか配列の番号）。なければ _MISSING。"""
    if isinstance(node, dict):
        return node.get(part, _MISSING)
    if isinstance(node, list):
        if part.isdigit() and int(part) < len(node):
            return node[int(part)]
        raise CliError(f"{key}: {part} は配列の番号（0〜{len(node) - 1}）にしてください")
    raise CliError(f"{key}: {part} の手前が値（オブジェクトでも配列でもない）です")


def _get(config, key):
    node = config
    for part in _keys(key):
        node = _step(node, part, key)
        if node is _MISSING:
            raise CliError(f"event.json に {key} がありません")
    return node


def _dump_config(config, old_text):
    text = json.dumps(config, ensure_ascii=False, indent=2) + "\n"
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
    parts = _keys(key)
    if as_json:
        try:
            value = parse_json(value)
        except ValueError as e:
            raise CliError(f"値を JSON として読めません（文字列なら --json を付けない）: {e}")
    node = config
    for part in parts[:-1]:
        child = _step(node, part, key)
        if child is _MISSING:
            child = node[part] = {}
        node = child
    last = parts[-1]
    old = _step(node, last, key)
    if old != value:
        _check_store_id(parts, force)
    if isinstance(node, list):
        node[int(last)] = value
    else:
        node[last] = value
    print(f"{key}: {'（なし）' if old is _MISSING else _q(old)} → {_q(value)}")
    return commit(event, {event.config_json: _dump_config(config, old_text)}, dry_run, no_build)


def config_unset(event, key, force=False, dry_run=False, no_build=False):
    old_text, config = _load_config(event)
    parts = _keys(key)
    parent = _get(config, ".".join(parts[:-1])) if len(parts) > 1 else config
    old = _step(parent, parts[-1], key)
    if old is _MISSING:
        raise CliError(f"event.json に {key} がありません")
    _check_store_id(parts, force)
    if isinstance(parent, list):
        del parent[int(parts[-1])]
    else:
        del parent[parts[-1]]
    print(f"{key}: {_q(old)} → （削除）")
    return commit(event, {event.config_json: _dump_config(config, old_text)}, dry_run, no_build)


# --- CLI ---

def run(event, a):
    """caimawaru circle / menus / config の各操作。終了コードを返す。"""
    w = {"dry_run": getattr(a, "dry_run", False), "no_build": getattr(a, "no_build", False)}
    match (a.command, a.action):
        case ("circle", "list"):
            return circle_list(event, a.query, a.event_name, a.json)
        case ("circle", "show"):
            return circle_show(event, a.query, a.json)
        case ("circle", "add"):
            return circle_add(event, a.fields, **w)
        case ("circle", "set"):
            return circle_set(event, a.query, a.fields, force=a.force, **w)
        case ("circle", "remove"):
            return circle_remove(event, a.query, with_menus=a.with_menus, **w)
        case ("menus", "list"):
            return menus_list(event, a.query, a.json)
        case ("menus", "set"):
            return menus_set(event, a.query, a.fields, url=a.url, all_=a.all, **w)
        case ("menus", "remove"):
            return menus_remove(event, a.query, url=a.url, all_=a.all, **w)
        case ("config", "get"):
            return config_get(event, a.key)
        case ("config", "set"):
            return config_set(event, a.key, a.value, as_json=a.json, force=a.force, **w)
        case ("config", "unset"):
            return config_unset(event, a.key, force=a.force, **w)
    raise AssertionError((a.command, a.action))
