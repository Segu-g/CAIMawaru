"""お品書きの登録（caimawaru menu）とサークルの照合のテスト。X の URL の例は fixtures/x_urls.json（エディタのテストと共通）。"""
import json
import shutil
import unittest
from pathlib import Path

from caimawaru.menu import find_circles
from caimawaru.xurl import TRIM, normalize_url, profile_handle, trim, x_handle
from helpers import example_root, run_cli

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

    def test_trim(self):
        for raw, expected in X_URLS["trim"]:
            with self.subTest(raw=raw):
                self.assertEqual(trim(raw), expected)

    def test_trim_covers_python_strip(self):
        """TRIM は str.strip() が除く文字をすべて含み、加えて U+FEFF（JavaScript の trim() が除く）だけを足したもの。"""
        python_ws = {chr(i) for i in range(0x110000) if chr(i).isspace()}
        self.assertEqual(set(TRIM), python_ws | {"\ufeff"})
        self.assertEqual(len(TRIM), len(set(TRIM)))

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
        self.root = example_root()
        data = self.root / "events" / "example" / "data"
        self.circles, self.menus = data / "circles.csv", data / "menus.csv"
        text = self.circles.read_bytes().decode("utf-8")
        old = "a-02,A-02,サンプル即売会,まどろみ書房,,作家2,,0,,"
        self.assertIn(old, text)
        self.circles.write_bytes(text.replace(old, ",A-02,サンプル即売会,まどろみ書房,,作家2,,0,https://www.x.com/Madoromi_Ex/,").encode("utf-8"))

    def tearDown(self):
        shutil.rmtree(self.root)

    def cli(self, *args):
        return run_cli(self.root, *args)

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

    def test_dry_run_shows_id_to_write(self):
        before = self.menus.read_bytes()
        code, out, err = self.cli("menu", "example", "--circle", "A-02", "--dry-run", "https://example.com/circle2/menu")
        self.assertEqual(code, 0, err)
        self.assertIn("✓ a-02  A-02 まどろみ書房", out)
        self.assertEqual(self.menus.read_bytes(), before)

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



class BuildXRuleTest(unittest.TestCase):
    """build（check・data）は caimawaru menu と同じ X の規則（xurl）で x 列とお品書きの URL を見る。"""

    def setUp(self):
        self.root = example_root()
        self.dir = self.root / "events" / "example"
        self.circles, self.menus = self.dir / "data" / "circles.csv", self.dir / "data" / "menus.csv"

    def tearDown(self):
        shutil.rmtree(self.root)

    def cli(self, *args):
        code, out, err = run_cli(self.root, *args)
        return code, out + err

    def set_x(self, space, x):
        text = self.circles.read_bytes().decode("utf-8")
        old = f"{space.lower()},{space},サンプル即売会,"
        line = next(l for l in text.split("\r\n") if l.startswith(old))
        cols = line.split(",")
        cols[8] = x
        self.circles.write_bytes(text.replace(line, ",".join(cols)).encode("utf-8"))

    def add_menus(self, *rows):
        with self.menus.open("ab") as f:
            f.write("".join(f"{r}\r\n" for r in rows).encode("utf-8"))

    def built(self):
        return {c["id"]: c for c in json.loads((self.dir / "public" / "data" / "circles.json").read_text(encoding="utf-8"))["circles"]}

    def test_x_column_follows_x_handle(self):
        self.set_x("A-01", "https://mobile.twitter.com/Example_User?lang=ja")
        self.set_x("A-02", "https://x.com/home")
        code, out = self.cli("data", "example")
        self.assertEqual(code, 0, out)
        self.assertNotIn("https://mobile.twitter.com/Example_User?lang=ja", out)
        self.assertIn("x が X のアカウントの URL ではありません（https://x.com/<ID> の形にしてください）: https://x.com/home", out)
        self.assertEqual(self.built()["a-01"]["links"]["x"], "https://mobile.twitter.com/Example_User?lang=ja")

    def test_menu_posts_accepted_by_menu_are_posts_in_build(self):
        self.add_menus("a-02,http://www.twitter.com/example_user/status/7?s=20,,2030-01-01",
                       "a-02,https://x.com/example_user/status/7,,2030-01-01",
                       "a-02,https://www.x.com/home,,2030-01-01")
        code, out = self.cli("data", "example")
        self.assertEqual(code, 0, out)
        self.assertNotIn("http://www.twitter.com/example_user/status/7?s=20", out)
        self.assertIn("同じURLが重複しています: https://x.com/example_user/status/7", out)
        self.assertIn("Xの投稿ではないページです（プロフィール等を登録していませんか）: https://www.x.com/home", out)
        self.assertEqual([m["url"] for m in self.built()["a-02"]["menus"]],
                         ["https://x.com/example_user/status/7", "https://www.x.com/home"])

    def test_check_accepts_what_menu_matches(self):
        """caimawaru menu が X の投稿から照合して書いた行は、check で警告にならない。"""
        self.set_x("A-02", "https://www.x.com/Example_User/")
        code, out = self.cli("menu", "example", "https://mobile.twitter.com/example_user/status/9?s=20")
        self.assertEqual(code, 0, out)
        code, out = self.cli("check")
        self.assertEqual(code, 0, out)
        self.assertIn("エラー 0 件、警告 0 件", out)


if __name__ == "__main__":
    unittest.main()
