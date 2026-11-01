"""CSV / TSV（主催が配る表、スプレッドシートの書き出しなど）。

event.json:
    {
      "type": "csv",
      "file": "sources/official.csv",
      "encoding": "utf-8-sig",           # 任意（Excel の CSV なら "cp932" など）
      "delimiter": ",",                  # 任意（拡張子 .tsv なら既定はタブ）
      "columns": {                       # 正規フォーマットの列 ← 元データの列名（複数なら ";" でつなぐ）
        "space": "配置",
        "name": "サークル名",
        "penNames": ["代表者", "寄稿者"],
        "x": "X(Twitter)",
        "menus": "お品書きURL"
      },
      "constants": { "event": "○○オンリー" }   # 任意。全行に入れる値
    }
"""
import csv as _csv
from pathlib import Path

DESCRIPTION = "CSV / TSV（列名の対応表で読み取る）"


def map_record(get, source):
    """get(元データの列名) で値を返す関数から、正規フォーマットの行を作る（json インポーターと共用）。"""
    columns = source.get("columns") or {}
    if not columns:
        raise ValueError("columns（正規フォーマットの列 ← 元データの列）を指定してください")
    row = dict(source.get("constants") or {})
    for key, src in columns.items():
        names = src if isinstance(src, list) else [src]
        values = [v for v in (get(n) for n in names) if v not in (None, "")]
        if key == "menus":
            row["menus"] = [str(u).strip() for v in values for u in str(v).split() if u.strip()]
        elif key in ("penNames", "tags"):
            row[key] = [str(v).strip() for v in values]
        else:
            row[key] = ";".join(str(v).strip() for v in values) if len(names) > 1 else (str(values[0]).strip() if values else "")
    return row


def read(source, path):
    path = Path(path)
    delimiter = source.get("delimiter") or ("\t" if path.suffix.lower() == ".tsv" else ",")
    with path.open(encoding=source.get("encoding", "utf-8-sig"), newline="") as f:
        reader = _csv.DictReader(f, delimiter=delimiter)
        headers = set(reader.fieldnames or [])
        missing = [n for src in (source.get("columns") or {}).values() for n in (src if isinstance(src, list) else [src]) if n not in headers]
        if missing:
            raise ValueError(f"元データに列がありません: {', '.join(missing)}（あるのは: {', '.join(reader.fieldnames or [])}）")
        return [
            map_record(lambda n, r=r: (r.get(n) or "").strip(), source)
            for r in reader
            if any((v or "").strip() for v in r.values())
        ]
