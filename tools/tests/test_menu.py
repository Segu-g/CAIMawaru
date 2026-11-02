"""お品書きの登録（caimawaru menu）とサークルの照合のテスト。X の URL の例は fixtures/x_urls.json（エディタのテストと共通）。"""
import contextlib
import io
import json
import shutil
import tempfile
import unittest
from pathlib import Path

from caimawaru.cli import main
from caimawaru.menu import find_circles, normalize_url, profile_handle, x_handle

REPO = Path(__file__).resolve().parents[2]
X_URLS = json.loads((Path(__file__).parent / "fixtures" / "x_urls.json").read_text(encoding="utf-8"))


class XUrlTest(unittest.TestCase):
    """src/editor/menuMatch.test.ts も同じ例を確かめる（規則がずれないように）。"""

    def test_profile_handle(self):
        for url, expected in X_URLS["profileHandle"]:
            with self.subTest(url=url):
                self.assertEqual(profile_handle(url), expected)
                self.assertEqual(x_handle({"x": url}), expected)

    def test_normalize_url(self):
        for raw, url, handle in X_URLS["normalizeUrl"]:
            with self.subTest(raw=raw):
                self.assertEqual(normalize_url(raw), (url, handle))

    def test_x_handle_without_x_column(self):
        self.assertIsNone(x_handle({}))
        self.assertIsNone(x_handle({"x": None}))

    def test_find_circles_by_widened_x(self):
        circles = [{"id": "a-01", "space": "A-01", "name": "星屑通信", "x": "https://mobile.twitter.com/Hoshikuzu_Ex?lang=ja"},
                   {"id": "a-02", "space": "A-02", "name": "検索", "x": "https://x.com/search"}]
        self.assertEqual([c["id"] for c in find_circles(circles, "@hoshikuzu_ex")], ["a-01"])
        self.assertEqual(find_circles(circles, "search"), [])  # x.com/search はアカウントではない


class BlankIdTest(unittest.TestCase):
    """id 列が空のサークルは、スペース番号から作った id（build と同じ）で扱う。"""

    def setUp(self):
        self.root = Path(tempfile.mkdtemp())
        shutil.copytree(REPO / "events" / "example", self.root / "events" / "example",
                        ignore=shutil.ignore_patterns("public"))
        data = self.root / "events" / "example" / "data"
        self.circles, self.menus = data / "circles.csv", data / "menus.csv"
        text = self.circles.read_bytes().decode("utf-8")
        old = "a-02,A-02,サンプル即売会,まどろみ書房,,作家2,,0,,"
        self.assertIn(old, text)
        self.circles.write_bytes(text.replace(old, ",A-02,サンプル即売会,まどろみ書房,,作家2,,0,https://www.x.com/Madoromi_Ex/,").encode("utf-8"))

    def tearDown(self):
        shutil.rmtree(self.root)

    def cli(self, *args):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = main(["--root", str(self.root), *args])
        return code, out.getvalue(), err.getvalue()

    def last_menu(self):
        return self.menus.read_bytes().decode("utf-8").split("\r\n")[-2]

    def test_menu_by_space_writes_derived_id(self):
        code, _, err = self.cli("menu", "example", "--circle", "A-02", "https://example.com/circle2/menu")
        self.assertEqual(code, 0, err)
        self.assertTrue(self.last_menu().startswith("a-02,https://example.com/circle2/menu,,"), self.last_menu())

    def test_menu_by_derived_id(self):
        code, out, err = self.cli("menu", "example", "--circle", "a-02", "--dry-run", "https://example.com/circle2/menu")
        self.assertEqual(code, 0, err)
        self.assertIn("まどろみ書房", out)

    def test_menu_from_x_post_matches_widened_x_column(self):
        code, _, err = self.cli("menu", "example", "https://twitter.com/madoromi_ex/status/123?s=20")
        self.assertEqual(code, 0, err)
        self.assertTrue(self.last_menu().startswith("a-02,https://x.com/madoromi_ex/status/123,,"), self.last_menu())

    def test_duplicate_is_detected_with_derived_id(self):
        self.assertEqual(self.cli("menu", "example", "--circle", "A-02", "https://example.com/m")[0], 0)
        before = self.menus.read_bytes()
        code, out, _ = self.cli("menu", "example", "--circle", "A-02", "https://example.com/m")
        self.assertIn("登録済み", out)
        self.assertEqual(self.menus.read_bytes(), before)

    def test_edit_commands_use_derived_id(self):
        self.assertEqual(self.cli("menu", "example", "--circle", "A-02", "https://example.com/m")[0], 0)
        code, out, err = self.cli("circle", "show", "example", "@madoromi_ex", "--json")
        self.assertEqual(code, 0, err)
        c = json.loads(out)
        self.assertEqual(c["id"], "a-02")
        self.assertEqual([m["url"] for m in c["menus"]], ["https://example.com/m"])
        code, out, err = self.cli("menus", "list", "example", "a-02", "--json")
        self.assertEqual(code, 0, err)
        self.assertEqual([m["url"] for m in json.loads(out)], ["https://example.com/m"])
        code, _, err = self.cli("circle", "remove", "example", "A-02", "--dry-run")
        self.assertNotEqual(code, 0)
        self.assertIn("お品書きが 1 件", err)


if __name__ == "__main__":
    unittest.main()
