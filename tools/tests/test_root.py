"""プロジェクトの場所（find_root）を決めるテスト。一時フォルダの中にリポジトリやほかのフォルダを作って確かめる。"""
import contextlib
import io
import os
import shutil
import tempfile
import unittest
from pathlib import Path

from caimawaru.cli import main
from caimawaru.project import CliError, find_root

PYPROJECT = '[project]\nname = "caimawaru"\n'
FOREIGN = '[project]\nname = "something-else"\n'


class TempRepo(unittest.TestCase):
    def setUp(self):
        # base/events/           … リポジトリの外にある、関係のない events/
        # base/events/repo/      … CAIMawaru のリポジトリ
        self.base = Path(tempfile.mkdtemp()).resolve()
        (self.base / "events").mkdir()
        self.repo = self.base / "events" / "repo"
        (self.repo / "events" / "sample").mkdir(parents=True)
        (self.repo / "pyproject.toml").write_text(PYPROJECT, encoding="utf-8")
        (self.repo / "tools" / "sub").mkdir(parents=True)

    def tearDown(self):
        shutil.rmtree(self.base)


class FindRootTest(TempRepo):
    def test_repo_root(self):
        self.assertEqual(find_root(self.repo), self.repo)

    def test_subdirectory(self):
        self.assertEqual(find_root(self.repo / "tools" / "sub"), self.repo)
        self.assertEqual(find_root(self.repo / "events" / "sample"), self.repo)

    def test_outside_with_ancestor_events_is_refused(self):
        outside = self.base / "events" / "other"
        outside.mkdir()
        for start in (self.base, outside):
            with self.assertRaises(CliError) as cm:
                find_root(start)
            self.assertIn("--root", str(cm.exception))

    def test_nested_foreign_pyproject_stops_the_search(self):
        foreign = self.repo / "vendor" / "lib"
        foreign.mkdir(parents=True)
        (foreign / "pyproject.toml").write_text(FOREIGN, encoding="utf-8")
        (foreign / "src").mkdir()
        with self.assertRaises(CliError) as cm:
            find_root(foreign / "src")
        self.assertIn("別のプロジェクト", str(cm.exception))

    def test_broken_pyproject_is_not_caimawaru(self):
        (self.repo / "pyproject.toml").write_text("[project\n", encoding="utf-8")
        with self.assertRaises(CliError):
            find_root(self.repo)

    def test_explicit_root_valid(self):
        self.assertEqual(find_root(self.repo, explicit=True), self.repo)

    def test_explicit_root_must_be_the_repo_itself(self):
        for d in (self.repo / "tools", self.base):  # 中のフォルダでも、events/ があるだけのフォルダでもだめ
            with self.assertRaises(CliError) as cm:
                find_root(d, explicit=True)
            self.assertIn("pyproject.toml がありません", str(cm.exception))
        foreign = self.base / "foreign"
        foreign.mkdir()
        (foreign / "pyproject.toml").write_text(FOREIGN, encoding="utf-8")
        with self.assertRaises(CliError) as cm:
            find_root(foreign, explicit=True)
        self.assertIn("CAIMawaru のリポジトリではありません", str(cm.exception))


class CliRootTest(TempRepo):
    def cli(self, *args, cwd):
        out, err = io.StringIO(), io.StringIO()
        old = Path.cwd()
        os.chdir(cwd)
        try:
            with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
                code = main(list(args))
        finally:
            os.chdir(old)
        return code, out.getvalue(), err.getvalue()

    def test_cli_refuses_outside_and_does_not_write(self):
        before = sorted(self.base.rglob("*"))
        code, _, err = self.cli("list", cwd=self.base)
        self.assertEqual(code, 1)
        self.assertIn("--root", err)
        self.assertEqual(sorted(self.base.rglob("*")), before)

    def test_cli_with_root_from_outside(self):
        code, _, err = self.cli("--root", str(self.repo), "list", cwd=self.base)
        self.assertEqual(code, 0, err)
        code, _, err = self.cli("--root", str(self.base), "list", cwd=self.base)
        self.assertEqual(code, 1)
        self.assertIn("pyproject.toml がありません", err)


if __name__ == "__main__":
    unittest.main()
