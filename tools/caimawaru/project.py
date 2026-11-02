"""プロジェクトの場所とイベント（events/<eventId>/）の読み込み。"""
import csv
import io
import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlparse

EVENT_ID = re.compile(r"[0-9A-Za-z][0-9A-Za-z_-]*")

DRY_RUN_NOTICE = "（--dry-run のため書き込みません）"


class CliError(Exception):
    """利用者に知らせて終了するエラー（終了コード 1）。"""


class DuplicateKeyError(ValueError):
    """JSON のオブジェクトに同じキーが2回ある（json は黙って後の値だけを残すので、エラーにする）。"""


def _no_duplicate_keys(pairs):
    keys = [key for key, _ in pairs]
    duplicates = sorted({key for key in keys if keys.count(key) > 1})
    if duplicates:
        raise DuplicateKeyError(f"同じキーが2回以上あります: {', '.join(duplicates)}")
    return dict(pairs)


def parse_json(text):
    """JSON を読む。キーの重複は DuplicateKeyError、書き方の誤りは json.JSONDecodeError（どちらも ValueError）。"""
    return json.loads(text, object_pairs_hook=_no_duplicate_keys)


def format_json(value):
    """イベントのフォルダに書く JSON の形（インデント 2・日本語はそのまま・末尾に改行）。"""
    return json.dumps(value, ensure_ascii=False, indent=2) + "\n"


def print_warnings(messages):
    for message in messages:
        print(f"警告: {message}", file=sys.stderr)


def find_events_dir(events_dir=None):
    """イベントのフォルダ（<eventId>/ を並べたフォルダ）を返す。既定はカレントディレクトリの events/。上にはたどらない。"""
    path = Path(events_dir) if events_dir is not None else Path("events")
    if not path.is_dir():
        raise CliError(f"{path.resolve()} がありません。リポジトリのフォルダで実行するか、--events-dir で指定してください")
    return path.resolve()


def known_events(events_dir):
    return sorted(config.parent.name for config in Path(events_dir).glob("*/event.json"))


@dataclass(frozen=True)
class Event:
    """events/<eventId>/ の各ファイルの場所。"""

    events_dir: Path
    id: str

    @property
    def dir(self):
        return self.events_dir / self.id

    @property
    def config_json(self):
        return self.dir / "event.json"

    @property
    def layout_json(self):
        return self.dir / "layout.json"

    @property
    def data_dir(self):
        return self.dir / "data"

    @property
    def circles_csv(self):
        return self.data_dir / "circles.csv"

    @property
    def menus_csv(self):
        return self.data_dir / "menus.csv"

    @property
    def sources_dir(self):
        return self.dir / "sources"

    @property
    def out_json(self):
        return self.dir / "public" / "data" / "circles.json"

    def config(self):
        return parse_json(self.config_json.read_text(encoding="utf-8"))

    def rel(self, path):
        """表示用に、イベントのフォルダの親からの相対パス（events/<eventId>/…）にする。"""
        try:
            return Path(path).resolve().relative_to(self.events_dir.parent).as_posix()
        except ValueError:
            return str(path)


def load_event(events_dir, event_id):
    known = known_events(events_dir)
    if event_id not in known:
        names = ", ".join(known) or "イベントがありません。caimawaru new-event <eventId> で作成できます"
        raise CliError(f"イベント '{event_id}' がありません（{names}）")
    return Event(Path(events_dir), event_id)


# --- CSV とURL（データの読み書きで共通）---

CIRCLE_COLS = ["id", "space", "event", "name", "kana", "penNames", "tags", "adult",
               "x", "pixiv", "booth", "web", "notes", "source"]
MENU_COLS = ["id", "url", "note", "checkedAt"]  # id はお品書きのサークルの id（コードでは circle_ref と呼ぶ）
# 値を「;」区切りのリストとして読む列
LIST_COLS = ("penNames", "tags")


def split_list(value):
    """「;」区切りの値（penNames・tags）をリストにする。"""
    return [item.strip() for item in value.split(";") if item.strip()]


def stripped(row, key):
    """行の値（前後の空白を除く）。列がない・None なら空文字。"""
    return (row.get(key) or "").strip()


def read_csv(path, base_cols, warnings=None):
    """イベントデータの CSV のデータの行を読む（read_table と同じ規則。「#」の行は除く）。

    返す dict のキーは base_cols の列（見出しにない列は空）、値は前後の空白を除いたもの。
    読み方の警告（列の重複・列の多い行など）は warnings（リスト）に足す。
    """
    parsed = read_table(path, base_cols)
    if warnings is not None:
        warnings.extend(parsed.warnings)
    return [{col: stripped(row, col) for col in base_cols} for row in parsed.rows if not is_comment(row)]


# 書き戻すときの CSV の形（docs/event-data.md の「CSV の書き方」。ページ側の編集画面も同じ形で書く）:
#   UTF-8（BOM なし）・改行 CRLF・必要なときだけ「"」で囲む（「"」は2つ重ねる）。
#   見出しの前の「#」の行 → 見出し（イベントデータの列の順、そのあとにファイルにだけある列を元の順で。
#   ファイルにだけある列は位置で扱うので、列名は空・重複でもよい）→ 行（元の順。足りない値は空）。
#   空行と、値がすべて空（空白だけ）の行は落とす。
#   「#」の行（最初の値が「#」で始まる行）はその位置に、読んだときの値のまま（値の数も変えず、埋めない）書く。
#   見出しより値が多い行は、最初の値の頭に「#」を付けて「#」の行にする（値はそのまま）
COMMENT = object()  # コメント行の dict のキー（列名と重ならない）


class Extra:
    """ファイルにだけある列。名前ではなく位置で扱う（列名は空でも重複していてもよい）。行の dict のキーにする。"""

    __slots__ = ("label",)

    def __init__(self, label):
        self.label = label

    def __repr__(self):
        return f"Extra({self.label!r})"


def column_label(key):
    """見出しに書く列名（イベントデータの列は列名そのもの、ファイルにだけある列は元の列名）。"""
    return key.label if isinstance(key, Extra) else key


def is_comment(row):
    return COMMENT in row


@dataclass
class ParsedCsv:
    keys: list      # 見出しの各位置のキー（base_cols の列は列名、それ以外は Extra）
    head: list      # 見出しより前の「#」の行
    rows: list      # 見出しより後の行（キーの dict か、コメント行 {COMMENT: 値のリスト}）
    warnings: list  # 読み方の警告


def _header_keys(header, base_cols):
    """見出しの各位置のキー。イベントデータの列名でも、2回目以降はファイルにだけある列として扱う。"""
    keys = []
    for label in header:
        keys.append(label if label in base_cols and label not in keys else Extra(label))
    return keys


def _header_warnings(file_name, header, base_cols):
    warnings = []
    for col in base_cols:
        count = header.count(col)
        if count > 1:
            warnings.append(f"{file_name}: {col} 列が{count}つあります。最初の列を使います")
    if not any(label in base_cols for label in header):
        table_kind = "サークル" if list(base_cols) == CIRCLE_COLS else "お品書き"
        warnings.append(f"{file_name}: {table_kind}の列が見つかりません（見出しに {', '.join(base_cols)} のどれもありません）")
    return warnings


def read_table(path, base_cols):
    """CSV を書き戻す前提で読む（値は空白も含めてそのまま。コメント行・ファイルにだけある列も残す）。

    データを失わずに読める CSV は受け付け、気になる点は warnings にする。CSV として読めないときだけ CliError。
    """
    parsed = ParsedCsv([], [], [], [])
    if not path.exists():
        return parsed
    try:
        with path.open(encoding="utf-8-sig", newline="") as f:
            reader = csv.reader(f, strict=True)
            header = None
            record_start = 1  # 今読んでいる行が始まった行（値の中の改行で複数行になることがある）
            for values in reader:
                line_number, record_start = record_start, reader.line_num + 1
                if not any(value.strip() for value in values):
                    continue  # 空行・値がすべて空の行（「,,,」）
                if values[0].startswith("#"):
                    (parsed.rows if header is not None else parsed.head).append({COMMENT: values})
                    continue
                if header is None:
                    header = values
                    parsed.keys = _header_keys(header, base_cols)
                    parsed.warnings.extend(_header_warnings(path.name, header, base_cols))
                    continue
                if len(values) > len(header):
                    parsed.warnings.append(f"{path.name}: {line_number}行目は見出しより列が多いため、コメント行にしました")
                    parsed.rows.append({COMMENT: ["#" + values[0], *values[1:]]})
                    continue
                padded = values + [""] * (len(header) - len(values))
                parsed.rows.append(dict(zip(parsed.keys, padded)))
    except csv.Error as e:
        raise CliError(f"{path.name}: {record_start}行目から始まる行を CSV として読めません（{e}）。引用符（\"）の閉じ忘れなどを直してください")
    except UnicodeDecodeError as e:
        raise CliError(f"{path.name}: UTF-8 として読めません（{e}）。UTF-8 で保存し直してください")
    return parsed


class Table:
    """書き戻す前提の CSV。cols はイベントデータの列（決まった順）＋ファイルにだけある列（Extra、元の順）。"""

    def __init__(self, path, base_cols):
        self.path = path
        parsed = read_table(path, base_cols)
        self.head, self.rows, self.warnings = parsed.head, parsed.rows, parsed.warnings
        self.cols = list(base_cols) + [key for key in parsed.keys if isinstance(key, Extra)]

    @property
    def names(self):
        """列名 → キー。ファイルにだけある列は、列名が空でなく1つだけ（イベントデータの列名とも違う）ものを名前で指定できる。"""
        labels = [column_label(key) for key in self.cols]
        return {column_label(key): key for key in self.cols
                if not isinstance(key, Extra) or (key.label.strip() and labels.count(key.label) == 1)}

    def data_rows(self):
        return [row for row in self.rows if not is_comment(row)]

    def text(self):
        return format_csv(self.cols, self.rows, self.head)

    def write(self):
        _write_text(self.path, self.text())


def format_csv(cols, rows, head=()):
    """上の形の CSV を文字列で返す（write_csv が書く内容）。

    cols は列名か Extra、rows は dict（cols にないキーは無視）かコメント行、head は見出しより前のコメント行。
    """
    buf = io.StringIO(newline="")
    writer = csv.writer(buf)  # 既定: QUOTE_MINIMAL・改行 CRLF
    for row in head:
        writer.writerow(row[COMMENT])
    writer.writerow([column_label(key) for key in cols])
    for row in rows:
        if is_comment(row):
            writer.writerow(row[COMMENT])
        else:
            writer.writerow(["" if row.get(key) is None else row[key] for key in cols])
    return buf.getvalue()


def write_csv(path, cols, rows):
    _write_text(path, format_csv(cols, rows))


def _write_text(path, text):
    """改行を変換せずに書く（CSV の CRLF をそのまま書くため）。"""
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as f:
        f.write(text)


def is_http_url(value):
    parts = urlparse(value)
    return parts.scheme in ("http", "https") and bool(parts.netloc)


def make_id(space):
    return re.sub(r"[^0-9A-Za-z]+", "-", space).strip("-").lower()


def circle_id(row):
    """circles.csv の行の id。空欄ならスペース番号から作る（前後の空白は除く）。menus.csv はこの id を参照する。

    build・import・menu・編集コマンドはどれもこの id を使う（エディタの circleId と同じ規則）。
    """
    return stripped(row, "id") or make_id(stripped(row, "space"))
