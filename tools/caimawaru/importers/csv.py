"""CSV / TSV（主催が配る表、スプレッドシートの書き出しなど）。

event.json:
    {
      "type": "csv",
      "file": "sources/official.csv",
      "encoding": "utf-8-sig",           # 任意（Excel の CSV なら "cp932" など）
      "delimiter": ",",                  # 任意（拡張子 .tsv なら既定はタブ）
      "columns": {                       # イベントデータの列 ← 元データの列名（複数なら ";" でつなぐ）
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

from caimawaru.project import LIST_COLS

DESCRIPTION = "CSV / TSV（列名の対応表で読み取る）"


def source_names(spec):
    """columns の値（元データの列名か、そのリスト）を列名のリストにする。"""
    return spec if isinstance(spec, list) else [spec]


def map_record(get, source):
    """get(元データの列名) で値を返す関数から、イベントデータの行を作る（json インポーターと共用）。"""
    columns = source.get("columns") or {}
    if not columns:
        raise ValueError("columns（イベントデータの列 ← 元データの列）を指定してください")
    row = dict(source.get("constants") or {})
    for key, spec in columns.items():
        names = source_names(spec)
        values = [str(value).strip() for value in (get(name) for name in names) if value not in (None, "")]
        if key == "menus":
            row["menus"] = [url for value in values for url in value.split()]  # 空白区切りで複数
        elif key in LIST_COLS:
            row[key] = values
        elif len(names) > 1:
            row[key] = ";".join(values)
        else:
            row[key] = values[0] if values else ""
    return row


def read(source, path):
    path = Path(path)
    delimiter = source.get("delimiter") or ("\t" if path.suffix.lower() == ".tsv" else ",")
    with path.open(encoding=source.get("encoding", "utf-8-sig"), newline="") as f:
        reader = _csv.DictReader(f, delimiter=delimiter)
        headers = set(reader.fieldnames or [])
        missing = [name for spec in (source.get("columns") or {}).values() for name in source_names(spec) if name not in headers]
        if missing:
            raise ValueError(f"元データに列がありません: {', '.join(missing)}（あるのは: {', '.join(reader.fieldnames or [])}）")
        return [
            map_record(lambda name, record=record: (record.get(name) or "").strip(), source)
            for record in reader
            if any((value or "").strip() for value in record.values())
        ]
