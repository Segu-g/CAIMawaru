"""主催が配る任意の形式のサークル情報を、CAIMawaru のイベントデータ（docs/event-data.md）の行に変換するインポーター。

インポーターは tools/importers/<type>.py に置き、次を定義する:

    DESCRIPTION = "一行の説明"
    DEFAULT_FILE = "sources/xxx"              # 任意。source に file がないときの元データの置き場所
    def read(source: dict, path: Path) -> list[dict]:
        '''path の元データを読み、イベントデータの列名をキーにした行を返す。'''
    def fetch(source: dict, path: Path) -> None:   # 任意
        '''元データを取得して path に保存する（caimawaru import <eventId> --fetch）。'''

read が返す行:
    - キーは circles.csv の列名（id, space, event, name, kana, penNames, tags, adult, x, pixiv, booth, web, notes, source）の一部
    - 加えて "menus": お品書きの URL のリスト（文字列か {"url", "note"}）
    - 値は文字列のほか、penNames / tags は list、adult は bool でもよい（共通処理で正規化する）
    - id か space のどちらかは必須
    - 返さなかった列は「直接編集する列」として、既存の circles.csv の値が残る

イベント固有の形式には、events/<eventId>/ に置いた Python ファイルを type "python" で指定できる（同じ read / fetch を定義する）。
"""
import importlib
import importlib.util
from pathlib import Path

BUILTIN = ("sockbase", "csv", "json")


def load(source: dict, event_dir: Path):
    """source（event.json の sources の1要素）に対応するインポーターのモジュールを返す。"""
    kind = source.get("type", "")
    if kind == "python":
        module = source.get("module", "")
        path = (event_dir / module).resolve()
        if not module or not path.is_file():
            raise ValueError(f"type python の module が見つかりません: {module}")
        spec = importlib.util.spec_from_file_location(f"event_importer_{path.stem}", path)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
    elif kind in BUILTIN:
        mod = importlib.import_module(f"caimawaru.importers.{kind}")
    else:
        raise ValueError(f"不明な type です: {kind!r}（{', '.join(BUILTIN)}, python のどれか）")
    if not callable(getattr(mod, "read", None)):
        raise ValueError(f"インポーター {kind} に read(source, path) がありません")
    return mod
