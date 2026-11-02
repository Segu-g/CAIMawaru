"""主催が配る任意の形式のサークル情報を、CAIMawaru のイベントデータ（docs/event-data.md）の行に変換するインポーター。

インポーターは tools/caimawaru/importers/<type>.py に置き、次を定義する:

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

event.json の type には、このフォルダにあるモジュールの名前だけを書ける（ファイルのパスは指定できない）。
イベントのフォルダなど、リポジトリの外の Python は読み込まない（受け取ったイベントのデータでコードが実行されないように）。
新しい形式は、ここにモジュールを足してテスト（tools/tests/）を書く。
"""
import importlib
import pkgutil
import re

TYPE_NAME = re.compile(r"[a-z][a-z0-9_]*")


def available():
    """使えるインポーターの type（このパッケージのモジュール名。_ で始まるものは除く）。"""
    return sorted(m.name for m in pkgutil.iter_modules(__path__) if not m.name.startswith("_") and not m.ispkg)


def load(source: dict):
    """source（event.json の sources の1要素）に対応するインポーターのモジュールを返す。"""
    kind = source.get("type", "")
    names = available()
    # 名前の形と一覧の両方で確かめ、パスや親パッケージを指す値（"../x"・"caimawaru.cli" など）を読み込まない
    if not isinstance(kind, str) or not TYPE_NAME.fullmatch(kind) or kind not in names:
        raise ValueError(f"不明な type です: {kind!r}（{', '.join(names)} のどれか）")
    mod = importlib.import_module(f"{__name__}.{kind}")
    if not callable(getattr(mod, "read", None)):
        raise ValueError(f"インポーター {kind} に read(source, path) がありません")
    return mod
