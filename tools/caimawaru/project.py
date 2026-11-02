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
        return json.loads(self.config_json.read_text(encoding="utf-8"))

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
    """イベントデータの CSV を読む。空行と「#」で始まる行は無視し、値の前後の空白を除く。"""
    if not path.exists():
        return []
    with path.open(encoding="utf-8-sig", newline="") as f:
        return [
            {k: (v or "").strip() for k, v in row.items() if k}
            for row in csv.DictReader(f)
            if any((v or "").strip() for v in row.values())
            and not (row.get("id") or row.get("space") or "").startswith("#")
        ]


def read_rows(path):
    """CSV をそのまま読む（書き戻す前提。空白や「#」の行も残す）。"""
    if not path.exists():
        return []
    with path.open(encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


def read_table(path):
    """CSV を見出しと行のまま読む（書き戻す前提。空白・「#」の行・イベントデータにない列も残す）。"""
    if not path.exists():
        return [], []
    with path.open(encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        rows = []
        for row in reader:
            if None in row:
                raise CliError(f"{path.name}:{reader.line_num}: 列の数が見出しより多い行があります。直してから実行してください")
            rows.append(row)
        return list(reader.fieldnames or []), rows


def format_csv(cols, rows):
    """write_csv が書く内容（列は cols の順、改行は CRLF）を文字列で返す。"""
    buf = io.StringIO(newline="")
    w = csv.DictWriter(buf, fieldnames=cols, extrasaction="ignore")
    w.writeheader()
    w.writerows(rows)
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
