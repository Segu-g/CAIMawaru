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
    for key in [k for k in str(path).split(".") if k]:
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

    def getter(rec):
        def get(p):
            v = dig(rec, p)
            if isinstance(v, list):  # 配列は空白区切り（menus）か ; 区切り（penNames 等）にする
                return " ".join(str(x) for x in v if x not in (None, "")) if p == source.get("columns", {}).get("menus") else ";".join(str(x) for x in v if x not in (None, ""))
            return v
        return get

    return [map_record(getter(r), source) for r in records]
