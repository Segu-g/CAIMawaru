"""プロジェクトの場所とイベント（events/<eventId>/）の読み込み。"""
import csv
import io
import json
import re
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlparse

EVENT_ID = re.compile(r"[0-9A-Za-z][0-9A-Za-z_-]*")


class CliError(Exception):
    """利用者に知らせて終了するエラー（終了コード 1）。"""


class DuplicateKeyError(ValueError):
    """JSON のオブジェクトに同じキーが2回ある（json は黙って後の値だけを残すので、エラーにする）。"""


def _no_duplicate_keys(pairs):
    keys = [k for k, _ in pairs]
    dup = sorted({k for k in keys if keys.count(k) > 1})
    if dup:
        raise DuplicateKeyError(f"同じキーが2回以上あります: {', '.join(dup)}")
    return dict(pairs)


def parse_json(text):
    """JSON を読む。キーの重複は DuplicateKeyError、書き方の誤りは json.JSONDecodeError（どちらも ValueError）。"""
    return json.loads(text, object_pairs_hook=_no_duplicate_keys)


def find_root(start=None):
    """start（既定はカレントディレクトリ）から上にたどり、events/ を持つフォルダを返す。"""
    here = Path(start or Path.cwd()).resolve()
    for d in (here, *here.parents):
        if (d / "events").is_dir():
            return d
    raise CliError(f"events/ のあるフォルダが見つかりません（{here} から上を探しました）。--root で指定してください")


def known_events(root):
    return sorted(p.parent.name for p in (Path(root) / "events").glob("*/event.json"))


@dataclass(frozen=True)
class Event:
    """events/<eventId>/ の各ファイルの場所。"""

    root: Path
    id: str

    @property
    def dir(self):
        return self.root / "events" / self.id

    @property
    def config_json(self):
        return self.dir / "event.json"

    @property
    def layout_json(self):
        return self.dir / "layout.json"

    @property
    def data(self):
        return self.dir / "data"

    @property
    def circles_csv(self):
        return self.data / "circles.csv"

    @property
    def menus_csv(self):
        return self.data / "menus.csv"

    @property
    def out_json(self):
        return self.dir / "public" / "data" / "circles.json"

    def config(self):
        return parse_json(self.config_json.read_text(encoding="utf-8"))

    def rel(self, path):
        """表示用に、プロジェクトからの相対パスにする。"""
        try:
            return Path(path).resolve().relative_to(self.root).as_posix()
        except ValueError:
            return str(path)


def load_event(root, event_id):
    known = known_events(root)
    if event_id not in known:
        names = ", ".join(known) or "events/ にイベントがありません。caimawaru new-event <eventId> で作成できます"
        raise CliError(f"イベント '{event_id}' がありません（{names}）")
    return Event(Path(root), event_id)


# --- CSV とURL（データの読み書きで共通）---

CIRCLE_COLS = ["id", "space", "event", "name", "kana", "penNames", "tags", "adult",
               "x", "pixiv", "booth", "web", "notes", "source"]
MENU_COLS = ["id", "url", "note", "checkedAt"]


def read_csv(path):
    """イベントデータの CSV を読む。空行（値がすべて空白の行も）と「#」の行（最初の値が「#」で始まる）は無視し、値の前後の空白を除く。"""
    if not path.exists():
        return []
    with path.open(encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        first = (reader.fieldnames or [None])[0]
        return [
            {k: (v or "").strip() for k, v in row.items() if k}
            for row in reader
            if any((v or "").strip() for v in row.values() if isinstance(v, str))
            and not (row.get(first) or "").startswith("#")
        ]


# 書き戻すときの CSV の形（docs/event-data.md の「CSV の書き方」。ページ側の編集画面も同じ形で書く）:
#   UTF-8（BOM なし）・改行 CRLF・必要なときだけ「"」で囲む（「"」は2つ重ねる）。見出しはイベントデータの列の順、
#   そのあとにファイルにだけある列を元の順で。行は元の順で、足りない値は空。空行と、値がすべて空（空白だけ）の行は落とす。
#   「#」の行（最初の値が「#」で始まる行）はその位置に、読んだときの値のまま（値の数も変えず、埋めない）書く
COMMENT = object()  # コメント行の dict のキー（列名と重ならない）


def is_comment(row):
    return COMMENT in row


def read_table(path):
    """CSV を見出しと行で読む（書き戻す前提。値は空白も含めてそのまま、コメント行・ファイルにだけある列も残す）。

    コメント行は {COMMENT: 値のリスト}（値の数は見出しと違ってもよい）。見出しに空の列名・重複した列名があるとき、値が見出しより多い行があるときは
    読み落とさないようにエラーにする。
    """
    if not path.exists():
        return [], []
    with path.open(encoding="utf-8-sig", newline="") as f:
        reader = csv.reader(f)
        header, rows = None, []
        for values in reader:
            where = f"{path.name}:{reader.line_num}"
            if not any(v.strip() for v in values):
                continue  # 空行・値がすべて空の行（「,,,」）
            if values[0].startswith("#"):
                if header is None:
                    raise CliError(f"{where}: 見出しの行より前に「#」の行があります。見出し（列名）を1行目にしてください")
                rows.append({COMMENT: values})
                continue
            if header is None:
                header = values
                if any(not c.strip() for c in header):
                    raise CliError(f"{where}: 見出しに空の列名があります。列名を付けるか、その列を消してから実行してください")
                dup = sorted({c for c in header if header.count(c) > 1})
                if dup:
                    raise CliError(f"{where}: 見出しの列名が重複しています: {', '.join(dup)}。直してから実行してください")
                continue
            if len(values) > len(header):
                raise CliError(f"{where}: 列の数が見出しより多い行があります。直してから実行してください")
            rows.append(dict(zip(header, values + [""] * (len(header) - len(values)))))
        return header or [], rows


class Table:
    """書き戻す前提の CSV。cols はイベントデータの列（決まった順）＋ファイルにだけある列（元の順）。"""

    def __init__(self, path, base_cols):
        self.path = path
        header, self.rows = read_table(path)
        self.cols = list(base_cols) + [c for c in header if c not in base_cols]

    def data_rows(self):
        return [r for r in self.rows if not is_comment(r)]

    def text(self):
        return format_csv(self.cols, self.rows)

    def write(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.path.open("w", encoding="utf-8", newline="") as f:
            f.write(self.text())


def format_csv(cols, rows):
    """上の形の CSV を文字列で返す（write_csv が書く内容）。rows は dict（cols にないキーは無視）かコメント行。"""
    buf = io.StringIO(newline="")
    w = csv.writer(buf)  # 既定: QUOTE_MINIMAL・改行 CRLF
    w.writerow(cols)
    for row in rows:
        if is_comment(row):
            w.writerow(row[COMMENT])
        else:
            w.writerow(["" if row.get(c) is None else row[c] for c in cols])
    return buf.getvalue()


def write_csv(path, cols, rows):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as f:
        f.write(format_csv(cols, rows))


def is_http_url(value):
    u = urlparse(value)
    return u.scheme in ("http", "https") and bool(u.netloc)


def make_id(space):
    return re.sub(r"[^0-9A-Za-z]+", "-", space).strip("-").lower()
