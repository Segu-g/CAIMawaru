"""テストで共通に使う、一時フォルダのリポジトリと CLI の呼び出し。"""
import contextlib
import io
import shutil
import tempfile
from pathlib import Path

from caimawaru.cli import main

REPO = Path(__file__).resolve().parents[2]


def example_root():
    """events/example（public/ を除く）を <一時フォルダ>/events/example に写し、その一時フォルダを返す。後で shutil.rmtree で消す。"""
    root = Path(tempfile.mkdtemp())
    shutil.copytree(REPO / "events" / "example", root / "events" / "example", ignore=shutil.ignore_patterns("public"))
    return root


def run_cli(root, *args):
    """caimawaru --events-dir <root>/events <args> を同じプロセスで動かし、(終了コード, 標準出力, 標準エラー) を返す。"""
    out, err = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        code = main(["--events-dir", str(Path(root) / "events"), *args])
    return code, out.getvalue(), err.getvalue()
