"""JSON（主催サイトのデータファイルなど）。

event.json:
    {
      "type": "json",
      "file": "sources/circles.json",
      "records": "data.circles",          # サークルの配列までのパス（"." 区切り。省略するとトップレベルが配列）
      "columns": {                        # イベントデータの列 ← 各サークル内のパス（"." 区切り、配列は番号）
        "space": "booth.code",
        "name": "name",
        "x": "sns.twitter",
        "menus": "menu_urls"
      },
      "constants": { "event": "○○" }
    }
"""
import json as _json
from pathlib import Path

from caimawaru.importers.csv import map_record

DESCRIPTION = "JSON（パスの対応表で読み取る）"


def dig(obj, path):
    """「.」区切りのパス（配列は番号）の先の値。途中でたどれなければ None。"""
    for key in [key for key in str(path).split(".") if key]:
        if isinstance(obj, list) and key.isdigit():
            obj = obj[int(key)] if int(key) < len(obj) else None
        elif isinstance(obj, dict):
            obj = obj.get(key)
        else:
            return None
    return obj


def read(source, path):
    data = _json.loads(Path(path).read_text(encoding=source.get("encoding", "utf-8")))
    records = dig(data, source.get("records", ""))
    if not isinstance(records, list):
        raise ValueError(f"records のパス {source.get('records', '')!r} が配列を指していません")

    def getter(record):
        def get(value_path):
            value = dig(record, value_path)
            if not isinstance(value, list):
                return value
            # 配列は、map_record が読む区切り（menus は空白、penNames などは「;」）でつなぐ
            is_menus = value_path == source.get("columns", {}).get("menus")
            separator = " " if is_menus else ";"
            return separator.join(str(item) for item in value if item not in (None, ""))
        return get

    return [map_record(getter(record), source) for record in records]
