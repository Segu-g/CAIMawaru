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


# このファイルは <リポジトリ>/tools/caimawaru/project.py（uv は編集可能な形で入れるので、ここがリポジトリそのもの）
CODE_ROOT = Path(__file__).resolve().parents[2]


def find_root(root=None):
    """プロジェクトのフォルダを返す。既定は CLI のコードがあるリポジトリ（どこから実行しても同じ）。

    root（--root）を指定したときは、そのフォルダに events/ があることだけを確かめる。
    """
    if root is None:
        if not (CODE_ROOT / "pyproject.toml").is_file():
            raise CliError(f"CLI のコードがリポジトリの中にありません（{CODE_ROOT}）。--root でリポジトリのフォルダを指定してください")
        return CODE_ROOT
    try:
        root = Path(root).resolve()
    except OSError as e:  # 相対パスでカレントディレクトリが消えている など
        raise CliError(f"--root に指定したフォルダを確かめられません（{root}: {e}）") from e
    if not (root / "events").is_dir():
        raise CliError(f"--root に指定したフォルダに events/ がありません（{root}）")
    return root


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


def read_csv(path, base_cols, warnings=None):
    """イベントデータの CSV のデータの行を読む（read_table と同じ規則。「#」の行は除く）。

    返す dict のキーは base_cols の列（見出しにない列は空）、値は前後の空白を除いたもの。
    読み方の警告（列の重複・列の多い行など）は warnings（リスト）に足す。
    """
    t = read_table(path, base_cols)
    if warnings is not None:
        warnings.extend(t.warnings)
    return [{c: (row.get(c) or "").strip() for c in base_cols} for row in t.rows if not is_comment(row)]


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


def is_comment(row):
    return COMMENT in row


@dataclass
class ParsedCsv:
    keys: list      # 見出しの各位置のキー（base_cols の列は列名、それ以外は Extra）
    head: list      # 見出しより前の「#」の行
    rows: list      # 見出しより後の行（キーの dict か、コメント行 {COMMENT: 値のリスト}）
    warnings: list  # 読み方の警告


def read_table(path, base_cols):
    """CSV を書き戻す前提で読む（値は空白も含めてそのまま。コメント行・ファイルにだけある列も残す）。

    データを失わずに読める CSV は受け付け、気になる点は warnings にする。CSV として読めないときだけ CliError。
    """
    out = ParsedCsv([], [], [], [])
    if not path.exists():
        return out
    kind = "サークル" if list(base_cols) == CIRCLE_COLS else "お品書き"
    try:
        with path.open(encoding="utf-8-sig", newline="") as f:
            reader = csv.reader(f, strict=True)
            header, start = None, 1
            for values in reader:
                line, start = start, reader.line_num + 1  # この行が始まった行（値の中の改行で複数行になることがある）
                if not any(v.strip() for v in values):
                    continue  # 空行・値がすべて空の行（「,,,」）
                if values[0].startswith("#"):
                    (out.rows if header is not None else out.head).append({COMMENT: values})
                    continue
                if header is None:
                    header = values
                    out.keys = []
                    for c in values:
                        if c in base_cols and c not in out.keys:
                            out.keys.append(c)
                        else:
                            out.keys.append(Extra(c))
                    for c in base_cols:
                        n = values.count(c)
                        if n > 1:
                            out.warnings.append(f"{path.name}: {c} 列が{n}つあります。最初の列を使います")
                    if not any(c in base_cols for c in values):
                        out.warnings.append(f"{path.name}: {kind}の列が見つかりません（見出しに {', '.join(base_cols)} のどれもありません）")
                    continue
                if len(values) > len(header):
                    out.warnings.append(f"{path.name}: {line}行目は見出しより列が多いため、コメント行にしました")
                    out.rows.append({COMMENT: ["#" + values[0], *values[1:]]})
                    continue
                out.rows.append(dict(zip(out.keys, values + [""] * (len(header) - len(values)))))
    except csv.Error as e:
        raise CliError(f"{path.name}: {start}行目から始まる行を CSV として読めません（{e}）。引用符（\"）の閉じ忘れなどを直してください")
    except UnicodeDecodeError as e:
        raise CliError(f"{path.name}: UTF-8 として読めません（{e}）。UTF-8 で保存し直してください")
    return out


class Table:
    """書き戻す前提の CSV。cols はイベントデータの列（決まった順）＋ファイルにだけある列（Extra、元の順）。"""

    def __init__(self, path, base_cols):
        self.path = path
        t = read_table(path, base_cols)
        self.head, self.rows, self.warnings = t.head, t.rows, t.warnings
        self.cols = list(base_cols) + [k for k in t.keys if isinstance(k, Extra)]

    @property
    def names(self):
        """列名 → キー。ファイルにだけある列は、列名が空でなく1つだけ（イベントデータの列名とも違う）ものを名前で指定できる。"""
        labels = [c.label if isinstance(c, Extra) else c for c in self.cols]
        return {c.label if isinstance(c, Extra) else c: c for c in self.cols
                if not isinstance(c, Extra) or (c.label.strip() and labels.count(c.label) == 1)}

    def data_rows(self):
        return [r for r in self.rows if not is_comment(r)]

    def text(self):
        return format_csv(self.cols, self.rows, self.head)

    def write(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.path.open("w", encoding="utf-8", newline="") as f:
            f.write(self.text())


def format_csv(cols, rows, head=()):
    """上の形の CSV を文字列で返す（write_csv が書く内容）。

    cols は列名か Extra、rows は dict（cols にないキーは無視）かコメント行、head は見出しより前のコメント行。
    """
    buf = io.StringIO(newline="")
    w = csv.writer(buf)  # 既定: QUOTE_MINIMAL・改行 CRLF
    for row in head:
        w.writerow(row[COMMENT])
    w.writerow([c.label if isinstance(c, Extra) else c for c in cols])
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
