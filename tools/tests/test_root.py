"""プロジェクトの場所（find_root）のテスト。カレントディレクトリか --root の events/ のあるフォルダで、上にはたどらない。"""
import os
import shutil
import tempfile
import unittest
from pathlib import Path

from caimawaru.project import CliError, find_root


class FindRootTest(unittest.TestCase):
    def setUp(self):
        self.base = Path(tempfile.mkdtemp()).resolve()
        self.old = Path.cwd()

    def tearDown(self):
        os.chdir(self.old)
        shutil.rmtree(self.base)

    def test_cwd_with_events(self):
        (self.base / "events").mkdir()
        os.chdir(self.base)
        self.assertEqual(find_root(), self.base)

    def test_does_not_walk_up(self):
        (self.base / "events").mkdir()
        (self.base / "sub").mkdir()
        os.chdir(self.base / "sub")
        with self.assertRaises(CliError) as cm:
            find_root()
        self.assertIn("events/ がありません", str(cm.exception))

    def test_explicit_root(self):
        (self.base / "events").mkdir()
        self.assertEqual(find_root(self.base), self.base)

    def test_explicit_root_without_events(self):
        with self.assertRaises(CliError):
            find_root(self.base)


if __name__ == "__main__":
    unittest.main()
