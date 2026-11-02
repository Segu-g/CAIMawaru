"""取り込み（tools/caimawaru/importing.py と tools/caimawaru/importers/）のテスト。データはすべて架空。

    uv run python -m unittest discover -s tools/tests
"""
import html
import json
import tempfile
import unittest
from pathlib import Path

from caimawaru import importers
from caimawaru import importing as ic
from caimawaru.importers import csv as csv_importer
from caimawaru.importers import json as json_importer
from caimawaru.importers import sockbase


def tmpfile(name, text):
    d = Path(tempfile.mkdtemp())
    p = d / name
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text, encoding="utf-8")
    return p


class NormalizeTest(unittest.TestCase):
    def norm(self, raw, source=None):
        warnings = []
        row, menus = ic.normalize(raw, source or {"type": "csv", "url": "https://example.com/list"}, warnings, "t")
        return row, menus, warnings

    def test_x_handle_and_pixiv_id_become_urls(self):
        row, _, _ = self.norm({"space": "A-01", "x": "@example_user", "pixiv": "123"})
        self.assertEqual(row["x"], "https://x.com/example_user")
        self.assertEqual(row["pixiv"], "https://www.pixiv.net/users/123")

    def test_id_from_space_and_source_from_url(self):
        row, _, _ = self.norm({"space": "A-01,A-02"})
        self.assertEqual(row["id"], "a-01-a-02")
        self.assertEqual(row["source"], "https://example.com/list")

    def test_lists_and_adult(self):
        row, _, w = self.norm({"space": "A-01", "penNames": ["作家1", "作家2;作家3"], "adult": "あり"})
        self.assertEqual(row["penNames"], "作家1;作家2;作家3")
        self.assertEqual(row["adult"], "1")
        self.assertEqual(self.norm({"space": "A-01", "adult": False})[0]["adult"], "0")
        self.assertEqual(self.norm({"space": "A-01", "adult": "たぶん"})[0]["adult"], "")
        self.assertEqual(w, [])

    def test_unknown_column_warns(self):
        _, _, w = self.norm({"space": "A-01", "price": "500"})
        self.assertEqual(len(w), 1)

    def test_menus(self):
        _, menus, _ = self.norm({"space": "A-01", "menus": ["https://example.com/m", {"url": "https://example.com/n", "note": "新刊"}, ""]})
        self.assertEqual(menus, [("https://example.com/m", ""), ("https://example.com/n", "新刊")])


class MergeTest(unittest.TestCase):
    def test_manual_columns_kept_and_imported_columns_overwritten(self):
        existing = [{**{c: "" for c in ic.CIRCLE_COLS}, "id": "a-01", "space": "A-01", "name": "旧名", "tags": "既存タグ", "notes": "メモ"}]
        imported = [({"id": "a-01", "space": "A-01", "name": "新名", "source": "s"}, [], {"id", "space", "name", "source"})]
        circles, _, report = ic.merge(imported, existing, [], "2030-01-01")
        self.assertEqual(circles[0]["name"], "新名")
        self.assertEqual(circles[0]["tags"], "既存タグ")
        self.assertEqual(circles[0]["notes"], "メモ")
        self.assertEqual(report.changed, ["a-01"])
        self.assertIn("tags", report.manual_cols)

    def test_menus_added_once_and_manual_menus_kept(self):
        manual = [{"id": "a-01", "url": "https://example.com/manual", "note": "", "checkedAt": "2030-01-01"}]
        imported = [({"id": "a-01", "space": "A-01"}, [("https://example.com/m", "")], {"id", "space"})]
        _, menus, report = ic.merge(imported, [], manual, "2030-01-02")
        self.assertEqual([m["url"] for m in menus], ["https://example.com/manual", "https://example.com/m"])
        self.assertEqual(report.added_menus, 1)
        _, menus2, report2 = ic.merge(imported, [], menus, "2030-01-03")
        self.assertEqual(len(menus2), 2)
        self.assertEqual(report2.added_menus, 0)

    def test_removed_and_orphan_menus_reported(self):
        existing = [{**{c: "" for c in ic.CIRCLE_COLS}, "id": "b-01"}]
        menus = [{"id": "b-01", "url": "https://example.com/m", "note": "", "checkedAt": ""}]
        imported = [({"id": "a-01"}, [], {"id"})]
        _, _, report = ic.merge(imported, existing, menus, "2030-01-01")
        self.assertEqual(report.removed, ["b-01"])
        self.assertEqual(report.orphan_menus, ["b-01"])

    def test_later_source_fills_values(self):
        imported = [
            ({"id": "a-01", "name": "名前", "kana": ""}, [], {"id", "name", "kana"}),
            ({"id": "a-01", "kana": "なまえ", "name": ""}, [], {"id", "kana", "name"}),
        ]
        circles, _, _ = ic.merge(imported, [], [], "2030-01-01")
        self.assertEqual((circles[0]["name"], circles[0]["kana"]), ("名前", "なまえ"))


class CsvImporterTest(unittest.TestCase):
    def test_columns_mapping_constants_and_menus(self):
        p = tmpfile("list.csv", "配置,名前,代表,寄稿,お品書き\nA-01,星屑通信,作家1,作家2,https://example.com/a https://example.com/b\n,,,,\n")
        rows = csv_importer.read({"columns": {"space": "配置", "name": "名前", "penNames": ["代表", "寄稿"], "menus": "お品書き"},
                                  "constants": {"event": "サンプル"}}, p)
        self.assertEqual(rows, [{"event": "サンプル", "space": "A-01", "name": "星屑通信", "penNames": ["作家1", "作家2"],
                                 "menus": ["https://example.com/a", "https://example.com/b"]}])

    def test_tsv_and_missing_column(self):
        p = tmpfile("list.tsv", "配置\t名前\nA-01\t星屑通信\n")
        self.assertEqual(csv_importer.read({"columns": {"space": "配置", "name": "名前"}}, p)[0]["name"], "星屑通信")
        with self.assertRaises(ValueError):
            csv_importer.read({"columns": {"space": "スペース"}}, p)


class JsonImporterTest(unittest.TestCase):
    def test_nested_paths(self):
        data = {"data": {"circles": [{"booth": {"code": "A-01"}, "name": "星屑通信", "members": ["作家1", "作家2"],
                                      "sns": {"twitter": "example_user"}, "menu_urls": ["https://example.com/m"]}]}}
        p = tmpfile("c.json", json.dumps(data))
        rows = json_importer.read({"records": "data.circles", "columns": {
            "space": "booth.code", "name": "name", "penNames": "members", "x": "sns.twitter", "menus": "menu_urls"}}, p)
        self.assertEqual(rows[0]["space"], "A-01")
        self.assertEqual(rows[0]["penNames"], ["作家1;作家2"])
        self.assertEqual(rows[0]["menus"], ["https://example.com/m"])
        row, _ = ic.normalize(rows[0], {}, [], "t")
        self.assertEqual(row["penNames"], "作家1;作家2")
        self.assertEqual(row["x"], "https://x.com/example_user")

    def test_records_must_be_array(self):
        p = tmpfile("c.json", '{"a": 1}')
        with self.assertRaises(ValueError):
            json_importer.read({"records": "a", "columns": {"name": "n"}}, p)


class SockbaseImporterTest(unittest.TestCase):
    def test_parses_astro_props(self):
        # Astro の props は [型, 値] 形式（0=値, 1=配列）
        space = {"spaceName": [0, "A-01,A-02"], "eventName": [0, "サンプル"], "circleName": [0, "星屑通信"],
                 "circleNameYomi": [0, "ほしくずつうしん"], "penName": [0, "作家1"], "hasAdult": [0, False],
                 "links": [0, {"twitterScreenName": [0, "example_user"], "pixivUserId": [0, "123"],
                               "websiteURL": [0, ""], "menuURL": [0, "https://example.com/m"]}]}
        props = html.escape(json.dumps({"spaces": [1, [[0, space]]]}), quote=True)
        p = tmpfile("list.html", f'<astro-island component-url="/x/SpaceMapViewer.js" props="{props}"></astro-island>')
        [row] = sockbase.read({}, p)
        self.assertEqual(row["id"], "a-01-a-02")
        self.assertEqual(row["menus"], ["https://example.com/m"])
        norm, _ = ic.normalize(row, {"url": "https://list.sockbase.net/circle-lists/example"}, [], "t")
        self.assertEqual(norm["x"], "https://x.com/example_user")
        self.assertEqual(norm["adult"], "0")

    def test_circle_list_without_map(self):
        """配置図のないリストはサークル一覧（SearchableCircleCardRack）だけ。項目が欠けていても読む"""
        circle = {"spaceName": [0, "B-03"], "circleName": [0, "架空工房"], "hasAdult": [0, True],
                  "links": [0, {"twitterScreenName": [0, None]}]}
        props = html.escape(json.dumps({"circles": [1, [[0, circle]]]}), quote=True)
        p = tmpfile("list.html", f'<astro-island component-url="/x/SearchableCircleCardRack.abc.js" props="{props}"></astro-island>')
        [row] = sockbase.read({}, p)
        self.assertEqual((row["space"], row["name"], row["kana"], row["x"], row["menus"], row["adult"]),
                         ("B-03", "架空工房", "", "", [], True))

    def test_prefers_circle_list_over_map(self):
        def island(comp, key, name):
            rec = {"spaceName": [0, "A-01"], "circleName": [0, name]}
            props = html.escape(json.dumps({key: [1, [[0, rec]]]}), quote=True)
            return f'<astro-island component-url="/x/{comp}.js" props="{props}"></astro-island>'
        p = tmpfile("list.html", island("SpaceMapViewer", "spaces", "配置図") + island("SearchableCircleCardRack", "circles", "一覧"))
        self.assertEqual([r["name"] for r in sockbase.read({}, p)], ["一覧"])

    def test_not_rendered_html(self):
        with self.assertRaises(ValueError):
            sockbase.read({}, tmpfile("list.html", "<html></html>"))

    def test_fetch_only_official_list(self):
        # ネットワークに出る前に止まること
        for url in ("https://example.com/", "http://list.sockbase.net/circle-lists/x",
                    "https://list.sockbase.net.example.com/circle-lists/x", "https://evil.example/?https://list.sockbase.net/"):
            with self.subTest(url=url), self.assertRaises(ValueError):
                sockbase.fetch({"url": url}, Path("/nonexistent"))


class LoaderTest(unittest.TestCase):
    def test_builtin_types(self):
        self.assertEqual(importers.available(), ["csv", "json", "sockbase"])
        self.assertTrue(callable(importers.load({"type": "csv"}).read))

    def test_only_modules_in_the_package(self):
        # ファイルのパス・親パッケージのモジュール・パッケージにない名前は読み込まない
        p = tmpfile("my_importer.py", "raise SystemExit('実行されてはいけない')\n")
        for kind in ("excel", "python", str(p), "../cli", "caimawaru.cli", "cli", "__init__", "", None):
            with self.subTest(kind=kind), self.assertRaises(ValueError):
                importers.load({"type": kind, "module": str(p)})


if __name__ == "__main__":
    unittest.main()
