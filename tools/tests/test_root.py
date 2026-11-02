"""イベントのフォルダ（find_events_dir）のテスト。既定はカレントディレクトリの events/、--events-dir で指定でき、上にはたどらない。"""
import os
import shutil
import tempfile
import unittest
from pathlib import Path

from caimawaru.project import CliError, find_events_dir


class FindEventsDirTest(unittest.TestCase):
    def setUp(self):
        self.base = Path(tempfile.mkdtemp()).resolve()
        self.old = Path.cwd()

    def tearDown(self):
        os.chdir(self.old)
        shutil.rmtree(self.base)

    def test_default_is_events_in_cwd(self):
        (self.base / "events").mkdir()
        os.chdir(self.base)
        self.assertEqual(find_events_dir(), self.base / "events")

    def test_does_not_walk_up(self):
        (self.base / "events").mkdir()
        (self.base / "sub").mkdir()
        os.chdir(self.base / "sub")
        with self.assertRaises(CliError) as cm:
            find_events_dir()
        self.assertIn("--events-dir", str(cm.exception))

    def test_explicit(self):
        (self.base / "data").mkdir()
        self.assertEqual(find_events_dir(self.base / "data"), self.base / "data")

    def test_explicit_missing(self):
        with self.assertRaises(CliError):
            find_events_dir(self.base / "nothing")


if __name__ == "__main__":
    unittest.main()
