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
from caimawaru.project import Table, make_id

MAKE_ID_CASES = json.loads((Path(__file__).parent / "fixtures" / "make_id.json").read_text(encoding="utf-8"))["makeId"]


def row(**values):
    """circles.csv の1行（足りない列は空）"""
    return {**{col: "" for col in ic.CIRCLE_COLS}, **values}


def tmpfile(name, text):
    d = Path(tempfile.mkdtemp())
    p = d / name
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text, encoding="utf-8")
    return p


class MakeIdTest(unittest.TestCase):
    def test_same_table_as_editor(self):
        """fixtures/make_id.json はエディタ（src/editor/validate.test.ts）のテストも読む。CLI とエディタで同じ id になる"""
        for space, expected in MAKE_ID_CASES:
            with self.subTest(space=space):
                self.assertEqual(make_id(space), expected)


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
        imported = [ic.ImportedCircle({"id": "a-01", "space": "A-01", "name": "新名", "source": "s"}, [], {"id", "space", "name", "source"})]
        circles, _, report = ic.merge(imported, existing, [], "2030-01-01")
        self.assertEqual(circles[0]["name"], "新名")
        self.assertEqual(circles[0]["tags"], "既存タグ")
        self.assertEqual(circles[0]["notes"], "メモ")
        self.assertEqual(report.changed, ["a-01"])
        self.assertIn("tags", report.manual_cols)

    def test_menus_added_once_and_manual_menus_kept(self):
        manual = [{"id": "a-01", "url": "https://example.com/manual", "note": "", "checkedAt": "2030-01-01"}]
        imported = [ic.ImportedCircle({"id": "a-01", "space": "A-01"}, [("https://example.com/m", "")], {"id", "space"})]
        _, menus, report = ic.merge(imported, [], manual, "2030-01-02")
        self.assertEqual([m["url"] for m in menus], ["https://example.com/manual", "https://example.com/m"])
        self.assertEqual(report.added_menus, 1)
        _, menus2, report2 = ic.merge(imported, [], menus, "2030-01-03")
        self.assertEqual(len(menus2), 2)
        self.assertEqual(report2.added_menus, 0)

    def test_removed_and_orphan_menus_reported(self):
        existing = [{**{c: "" for c in ic.CIRCLE_COLS}, "id": "b-01"}]
        menus = [{"id": "b-01", "url": "https://example.com/m", "note": "", "checkedAt": ""}]
        imported = [ic.ImportedCircle({"id": "a-01"}, [], {"id"})]
        _, _, report = ic.merge(imported, existing, menus, "2030-01-01")
        self.assertEqual(report.removed, ["b-01"])
        self.assertEqual(report.orphan_menus, ["b-01"])

    def test_later_source_fills_values(self):
        imported = [
            ic.ImportedCircle({"id": "a-01", "name": "名前", "kana": ""}, [], {"id", "name", "kana"}),
            ic.ImportedCircle({"id": "a-01", "kana": "なまえ", "name": ""}, [], {"id", "kana", "name"}),
        ]
        circles, _, _ = ic.merge(imported, [], [], "2030-01-01")
        self.assertEqual((circles[0]["name"], circles[0]["kana"]), ("名前", "なまえ"))


    def imported(self, space, number, source=0, menus=(), **row):
        """取り込んだ1行（id を渡さなければスペース番号から作る）"""
        circle_id = row.pop("id", "")
        row = {"id": circle_id or make_id(space), "space": space, **row}
        return ic.ImportedCircle(row, list(menus), set(row), f"一覧 {number}件目", source, not circle_id)

    def test_same_id_in_one_source_keeps_both_and_reports(self):
        """同じ取り込み元の別の行が同じ id になっても、1つにまとめない（値とお品書きが黙って混ざらないように）"""
        first = self.imported("A-01", 1, name="甲")
        second = self.imported("A 01", 2, name="乙", menus=[("https://example.com/m", "")])
        circles, menus, report = ic.merge([first, second], [], [], "2030-01-01")
        self.assertEqual([(c["id"], c["space"], c["name"]) for c in circles], [("a-01", "A-01", "甲"), ("a-01", "A 01", "乙")])
        self.assertEqual([m["id"] for m in menus], ["a-01"])
        self.assertEqual(len(report.duplicates), 1)
        self.assertIn("一覧 1件目（スペース A-01 から作った id）、一覧 2件目（スペース A 01 から作った id）が同じ id 'a-01' です。",
                      report.duplicates[0])
        self.assertEqual(report.added, ["a-01", "a-01"])  # 新しいサークルは2つ

    def test_same_id_in_other_sources_is_the_same_circle(self):
        circles, _, report = ic.merge([self.imported("A-01", 1, source=0, name="甲"),
                                       self.imported("A-01", 1, source=1, kana="こう")], [], [], "2030-01-01")
        self.assertEqual([(c["name"], c["kana"]) for c in circles], [("甲", "こう")])
        self.assertEqual(report.duplicates, [])

    def test_derived_id_keeps_written_id_of_same_space(self):
        """スペース番号から作る id が今の circles.csv にないとき、同じスペース番号の行の id を使う（書いた id は変えない）"""
        existing = [{**{c: "" for c in ic.CIRCLE_COLS}, "id": "01", "space": "壁-01", "name": "甲"},
                    {**{c: "" for c in ic.CIRCLE_COLS}, "id": "b-01", "space": "B-01", "name": "乙"}]
        imported = [self.imported("壁-01", 1, name="甲"), self.imported("B-01", 2, name="乙"),
                    self.imported("エ-04", 3, id="x-1", name="丙")]
        circles, _, report = ic.merge(imported, existing, [], "2030-01-01")
        self.assertEqual([c["id"] for c in circles], ["01", "b-01", "x-1"])
        self.assertEqual(report.kept_ids, ["壁-01 は '01'（作ると '壁-01'）"])
        self.assertEqual((report.added, report.removed), (["x-1"], []))


    def test_operator_id_for_same_made_id_is_kept_on_reimport(self):
        """同じ取り込み元の A-01 と「A 01」（どちらも作ると a-01）。運用者が乙の id を a-01-b にしてお品書きを付けたあと、取り込み直しても保つ"""
        existing = [row(id="a-01", space="A-01", name="甲", notes="甲メモ"), row(id="a-01-b", space="A 01", name="乙", notes="乙メモ")]
        menus = [{"id": "a-01-b", "url": "https://example.com/m", "note": "", "checkedAt": ""}]
        circles, _, report = ic.merge([self.imported("A-01", 1, name="甲"), self.imported("A 01", 2, name="乙")], existing, menus, "2030-01-01")
        self.assertEqual([(c["id"], c["name"], c["notes"]) for c in circles], [("a-01", "甲", "甲メモ"), ("a-01-b", "乙", "乙メモ")])
        self.assertEqual((report.removed, report.orphan_menus, report.duplicates), ([], [], []))
        self.assertEqual(report.notices, ["一覧 1件目（スペース A-01）、一覧 2件目（スペース A 01）は、スペース番号から作ると同じ id 'a-01' ですが、"
                                          "circles.csv の id（'a-01', 'a-01-b'）で区別します"])
        self.assertEqual(report.old_rows, [0, 1])

    def test_duplicate_rows_in_circles_csv_are_matched_one_by_one(self):
        """circles.csv に同じ id の行が残っていても（id が空の A-01 と「A 01」）、行ごとに直接編集した列を保つ"""
        existing = [row(space="A-01", name="甲", notes="甲メモ"), row(space="A 01", name="乙", notes="乙メモ")]
        circles, _, report = ic.merge([self.imported("A-01", 1, name="甲"), self.imported("A 01", 2, name="乙")], existing, [], "2030-01-01")
        self.assertEqual([(c["id"], c["name"], c["notes"]) for c in circles], [("a-01", "甲", "甲メモ"), ("a-01", "乙", "乙メモ")])
        self.assertEqual(report.old_rows, [0, 1])
        self.assertEqual(len(report.duplicates), 1)  # まだ同じ id なので、検証でエラーになると知らせる
        self.assertEqual(report.removed, [])

    def test_rows_without_id_are_never_combined(self):
        """スペース番号から id を作れない行（「★」）は、別の取り込み元どうしでもまとめない"""
        circles, _, report = ic.merge([self.imported("★", 1, source=0, name="甲"), self.imported("★", 1, source=1, name="乙")],
                                      [], [], "2030-01-01")
        self.assertEqual([(c["id"], c["name"]) for c in circles], [("", "甲"), ("", "乙")])
        self.assertEqual(report.duplicates, [])

    def test_operator_ids_for_rows_without_id_are_kept(self):
        """「★」の2行に運用者が star-1・star-2 を付けたあと取り込み直しても、サークル名で対応付けて保つ"""
        existing = [row(id="star-1", space="★", name="甲"), row(id="star-2", space="★", name="乙")]
        circles, _, report = ic.merge([self.imported("★", 2, name="乙"), self.imported("★", 1, name="甲")], existing, [], "2030-01-01")
        self.assertEqual([(c["id"], c["name"]) for c in circles], [("star-2", "乙"), ("star-1", "甲")])
        self.assertEqual(report.removed, [])

    def test_kept_id_resolves_same_made_id_without_duplicate_error(self):
        """同じスペース番号の2行のうち、片方が既存の id を使い続けて重ならなくなったら、重複とは知らせない"""
        existing = [row(id="01", space="壁-01", name="甲")]
        circles, _, report = ic.merge([self.imported("壁-01", 1, name="甲"), self.imported("壁-01", 2, name="乙")], existing, [], "2030-01-01")
        self.assertEqual([(c["id"], c["name"]) for c in circles], [("01", "甲"), ("壁-01", "乙")])
        self.assertEqual(report.duplicates, [])
        self.assertEqual(len(report.notices), 1)
        self.assertIn("'01', '壁-01'", report.notices[0])

    def test_kept_id_with_other_name_is_warned(self):
        """使い続ける id の行とサークル名が違うとき（移動したサークルの ★ を別のサークルが引き継ぐ恐れ）は知らせる"""
        existing = [row(id="01", space="壁-01", name="甲")]
        circles, _, report = ic.merge([self.imported("壁-02", 1, name="甲"), self.imported("壁-01", 2, name="新")], existing, [], "2030-01-01")
        self.assertEqual([(c["id"], c["name"]) for c in circles], [("壁-02", "甲"), ("01", "新")])
        self.assertEqual(len(report.warnings), 1)
        self.assertIn("一覧 2件目（スペース 壁-01・新）: circles.csv の id '01'（甲）を使い続けますが、サークル名が違います", report.warnings[0])

    def test_extras_and_comments_follow_each_row(self):
        """同じ id の行が2つあっても、ほかの列の値と「#」の行は、それぞれの行に付いたまま"""
        table = Table(tmpfile("circles.csv", "id,space,name,memo\r\n# 甲の前\r\n,A-01,甲,甲の列\r\n# 乙の前\r\n,A 01,乙,乙の列\r\n"), ic.CIRCLE_COLS)
        circles, _, report = ic.merge([self.imported("A 01", 2, name="乙"), self.imported("A-01", 1, name="甲")], table.data_rows(), [], "2030-01-01")
        rows = ic.keep_extras_and_comments(table, circles, report.old_rows)
        memo = next(col for col in table.cols if col not in ic.CIRCLE_COLS)
        self.assertEqual(len(rows), 4)
        self.assertIs(rows[0], table.rows[2])  # 「# 乙の前」
        self.assertEqual((rows[1]["name"], rows[1][memo]), ("乙", "乙の列"))
        self.assertIs(rows[2], table.rows[0])  # 「# 甲の前」
        self.assertEqual((rows[3]["name"], rows[3][memo]), ("甲", "甲の列"))


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

    def test_searchable_circle_list(self):
        circle = {"spaceName": [0, "C-07"], "circleName": [0, "架空書房"], "links": [0, {}]}
        props = html.escape(json.dumps({"showSpaceName": [0, True], "circles": [1, [[0, circle]]]}), quote=True)
        p = tmpfile("list.html", f'<astro-island component-url="/_astro/SearchableCircleList.abc.js" props="{props}"></astro-island>')
        [row] = sockbase.read({}, p)
        self.assertEqual((row["id"], row["space"], row["name"]), ("c-07", "C-07", "架空書房"))

    def test_short_multi_space_is_written_in_full(self):
        """「A-03,04」は配置図の番号と合うよう「A-03,A-04」にする。id は書き直す前の spaceName から作る"""
        cases = {"A-03,04": ("A-03,A-04", "a-03-04"), "う-09,10": ("う-09,う-10", "う-09-10"),
                 "B-01,B-02": ("B-01,B-02", "b-01-b-02"), "1年C,D組": ("1年C,D組", "1年c-d組"), "C-05": ("C-05", "c-05")}
        circles = [[0, {"spaceName": [0, space], "circleName": [0, f"架空{n}"]}] for n, space in enumerate(cases)]
        props = html.escape(json.dumps({"circles": [1, circles]}), quote=True)
        p = tmpfile("list.html", f'<astro-island component-url="/_astro/SearchableCircleList.abc.js" props="{props}"></astro-island>')
        self.assertEqual([(r["space"], r["id"]) for r in sockbase.read({}, p)], list(cases.values()))

    def test_id_is_made_like_other_importers(self):
        """id は make_id と同じ規則（かな・漢字は残し、空白・記号は「-」）"""
        cases = {"エ-04": "エ-04", "ロ-01,ロ-02": "ロ-01-ロ-02", "A-01, A-02": "a-01-a-02", "Ａ－０１": "a-01"}
        circles = [[0, {"spaceName": [0, space], "circleName": [0, f"架空{n}"]}] for n, space in enumerate(cases)]
        props = html.escape(json.dumps({"circles": [1, circles]}), quote=True)
        p = tmpfile("list.html", f'<astro-island component-url="/_astro/SearchableCircleList.abc.js" props="{props}"></astro-island>')
        self.assertEqual([r["id"] for r in sockbase.read({}, p)], list(cases.values()))

    def test_before_layout_is_refused(self):
        """配置の発表前（spaceName がすべて null）は、id を作れないので取り込まない"""
        circles = [[0, {"id": [0, n], "spaceName": [0, None], "circleName": [0, f"架空{n}"]}] for n in (1, 2)]
        props = html.escape(json.dumps({"showSpaceName": [0, False], "circles": [1, circles]}), quote=True)
        p = tmpfile("list.html", f'<astro-island component-url="/_astro/SearchableCircleList.abc.js" props="{props}"></astro-island>')
        with self.assertRaises(ValueError) as cm:
            sockbase.read({}, p)
        self.assertIn("配置が発表される前", str(cm.exception))

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
