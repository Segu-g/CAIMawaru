"""プロジェクトの場所（find_root）のテスト。既定は CLI のコードがあるリポジトリ、--root は events/ のあるフォルダ。"""
import contextlib
import io
import os
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from caimawaru import project
from caimawaru.cli import main
from caimawaru.project import CliError, find_root

REPO = Path(__file__).resolve().parents[2]


class FindRootTest(unittest.TestCase):
    def setUp(self):
        self.base = Path(tempfile.mkdtemp()).resolve()

    def tearDown(self):
        shutil.rmtree(self.base)

    def test_default_is_the_checkout(self):
        self.assertEqual(find_root(), REPO)

    def test_default_without_pyproject_asks_for_root(self):
        with mock.patch.object(project, "CODE_ROOT", self.base):
            with self.assertRaises(CliError) as cm:
                find_root()
        self.assertIn("--root", str(cm.exception))

    def test_explicit_root_with_events(self):
        (self.base / "events").mkdir()
        self.assertEqual(find_root(self.base), self.base)

    def test_explicit_root_without_events(self):
        with self.assertRaises(CliError) as cm:
            find_root(self.base)
        self.assertIn("events/ がありません", str(cm.exception))

    def test_cli_uses_the_checkout_from_anywhere(self):
        (self.base / "events" / "other").mkdir(parents=True)  # 関係のない events/ があっても使わない
        (self.base / "events" / "other" / "event.json").write_text("{}", encoding="utf-8")
        out, err = io.StringIO(), io.StringIO()
        old = Path.cwd()
        os.chdir(self.base)
        try:
            with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
                code = main(["list"])
        finally:
            os.chdir(old)
        self.assertEqual(code, 0, err.getvalue())
        self.assertIn("example", out.getvalue().split())
        self.assertNotIn("other", out.getvalue().split())


if __name__ == "__main__":
    unittest.main()
