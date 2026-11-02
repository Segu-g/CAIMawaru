"""イベントデータの編集コマンド（caimawaru circle / menus / config）のテスト。events/example を一時フォルダに写して使う。"""
import contextlib
import io
import json
import os
import shutil
import stat
import tempfile
import unittest
from pathlib import Path

from caimawaru.cli import main
from caimawaru.project import CIRCLE_COLS, COMMENT, MENU_COLS, Table, format_csv, read_csv, read_table

REPO = Path(__file__).resolve().parents[2]


class EditTest(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp())
        shutil.copytree(REPO / "events" / "example", self.root / "events" / "example",
                        ignore=shutil.ignore_patterns("public"))
        self.dir = self.root / "events" / "example"
        self.circles = self.dir / "data" / "circles.csv"
        self.menus = self.dir / "data" / "menus.csv"
        self.config = self.dir / "event.json"
        self.out = self.dir / "public" / "data" / "circles.json"

    def tearDown(self):
        shutil.rmtree(self.root)

    def cli(self, *args):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = main(["--events-dir", str(self.root / "events"), *args])
        return code, out.getvalue(), err.getvalue()

    def snapshot(self):
        return {p: p.read_bytes() for p in (self.circles, self.menus, self.config)}

    def circle_json(self, query):
        code, out, err = self.cli("circle", "show", "example", query, "--json")
        self.assertEqual(code, 0, err)
        return json.loads(out)

    # --- 確かめる ---

    def test_list_and_show(self):
        code, out, _ = self.cli("circle", "list", "example", "--json")
        self.assertEqual(code, 0)
        circles = json.loads(out)
        self.assertEqual(len(circles), 12)
        self.assertEqual(list(circles[0])[:len(CIRCLE_COLS)], CIRCLE_COLS)
        code, out, _ = self.cli("circle", "list", "example", "--event", "併設オンリー")
        self.assertEqual(len(out.splitlines()), 4)
        c = self.circle_json("A-01")
        self.assertEqual(c["name"], "星屑通信")
        self.assertEqual(c["menus"], [{"url": "https://example.com/circle1/menu", "note": "新刊", "checkedAt": "2030-01-01"}])
        # 複数スペースの片方・サークル名の一部でも引ける
        self.assertEqual(self.circle_json("A-04")["id"], "a-03-a-04")
        self.assertEqual(self.circle_json("ひこうき")["id"], "c-01")
        code, out, _ = self.cli("menus", "list", "example", "c-01", "--json")
        self.assertEqual([m["id"] for m in json.loads(out)], ["c-01"])
        code, out, _ = self.cli("config", "get", "example", "info.eventSlots")
        self.assertEqual(json.loads(out), {"サンプル即売会": 1, "併設オンリー": 2})

    def test_unknown_and_ambiguous(self):
        code, _, err = self.cli("circle", "show", "example", "存在しない")
        self.assertEqual(code, 1)
        self.assertIn("該当するサークルがありません", err)
        self.assertNotIn("Traceback", err)
        # サークル名の一部が2件に当たる例を作る
        before = self.snapshot()
        code, _, err = self.cli("circle", "add", "example", "space=A-10", "name=ソーダ水2号", "event=サンプル即売会", "source=架空")
        self.assertEqual(code, 0, err)
        code, _, err = self.cli("circle", "set", "example", "ソーダ水", "notes=x")
        self.assertEqual(code, 1)
        self.assertIn("候補が複数", err)
        self.assertIn("壁-02", err)
        self.assertIn("A-10", err)
        self.assertNotEqual(self.snapshot(), before)  # add だけが書いた
        code, _, err = self.cli("circle", "set", "example", "A-02", "nosuch=x")
        self.assertEqual(code, 1)
        self.assertIn("nosuch", err)
        code, _, err = self.cli("config", "get", "example", "info.nosuch")
        self.assertEqual(code, 1)
        self.assertIn("info.nosuch", err)

    # --- 書き込む ---

    def test_dry_run_does_not_write(self):
        before = self.snapshot()
        for args in (("circle", "set", "example", "A-01", "notes=新刊あり"),
                     ("circle", "add", "example", "space=A-10", "name=新規", "event=サンプル即売会", "source=架空"),
                     ("circle", "remove", "example", "A-01", "--with-menus"),
                     ("menus", "set", "example", "A-01", "note=既刊"),
                     ("menus", "remove", "example", "C-01"),
                     ("config", "set", "example", "info.venue", "別の会場"),
                     ("config", "unset", "example", "info.hours")):
            code, out, err = self.cli(*args, "--dry-run")
            self.assertEqual(code, 0, (args, err))
            self.assertIn("--dry-run", out)
            self.assertIn("\n-", out)  # 差分（変更前 → 変更後）を表示する
        self.assertEqual(self.snapshot(), before)
        self.assertFalse(self.out.exists())

    def test_set_round_trip_changes_only_that_line(self):
        old = self.circles.read_bytes().splitlines(keepends=True)
        code, out, err = self.cli("circle", "set", "example", "A-01", "notes=新刊あり", "tags=新刊;グッズ")
        self.assertEqual(code, 0, err)
        self.assertIn('notes: "" → "新刊あり"', out)
        new = self.circles.read_bytes().splitlines(keepends=True)
        self.assertEqual(len(old), len(new))
        self.assertEqual([i for i, (a, b) in enumerate(zip(old, new)) if a != b], [1])
        self.assertTrue(new[1].endswith(b"\r\n"))
        c = self.circle_json("A-01")
        self.assertEqual((c["notes"], c["tags"]), ("新刊あり", "新刊;グッズ"))
        # 書き込んだあと circles.json も作り直す
        data = json.loads(self.out.read_text(encoding="utf-8"))
        self.assertEqual(data["circles"][0]["tags"], ["新刊", "グッズ"])
        # 同じ値なら書き込まない
        code, out, _ = self.cli("circle", "set", "example", "A-01", "notes=新刊あり")
        self.assertIn("変更はありません", out)

    def test_validation_refuses_to_write(self):
        before = self.snapshot()
        for args in (("circle", "set", "example", "A-02", "adult=2"),
                     ("circle", "set", "example", "A-02", "web=not-a-url"),
                     ("circle", "add", "example", "space=Z-99", "name=配置図にない"),
                     ("menus", "set", "example", "A-01", "id=nosuch"),
                     ("config", "set", "example", "info.eventSlots.併設オンリー", "9", "--json")):
            code, _, err = self.cli(*args)
            self.assertEqual(code, 1, args)
            self.assertIn("書き込みません", err)
        self.assertEqual(self.snapshot(), before)

    def test_existing_errors_do_not_block_unrelated_edits(self):
        # すでにあるエラー（宙に浮いたお品書き）はそのままでも、ほかの編集はできる
        self.menus.write_bytes(self.menus.read_bytes() + b"zz-1,https://example.com/orphan,,\r\n")
        code, _, err = self.cli("circle", "set", "example", "A-02", "notes=メモ", "--no-build")
        self.assertEqual(code, 0, err)
        # 宙に浮いたお品書きも id で指定して消せる
        code, _, err = self.cli("menus", "remove", "example", "zz-1")
        self.assertEqual(code, 0, err)
        self.assertNotIn(b"orphan", self.menus.read_bytes())

    def test_remove_with_menus(self):
        before_menus = self.menus.read_bytes()
        code, _, err = self.cli("circle", "remove", "example", "A-01")
        self.assertEqual(code, 1)
        self.assertIn("--with-menus", err)
        self.assertIn("https://example.com/circle1/menu", err)
        self.assertEqual(self.menus.read_bytes(), before_menus)
        code, out, err = self.cli("circle", "remove", "example", "A-01", "--with-menus")
        self.assertEqual(code, 0, err)
        circles = read_table(self.circles, CIRCLE_COLS).rows
        menus = read_table(self.menus, MENU_COLS).rows
        self.assertNotIn("a-01", [c["id"] for c in circles])
        self.assertEqual([m["id"] for m in menus], ["c-01"])
        # お品書きのないサークルはそのまま消せる
        code, _, err = self.cli("circle", "remove", "example", "A-02", "--no-build")
        self.assertEqual(code, 0, err)

    def test_id_change_needs_force_and_moves_menus(self):
        code, _, err = self.cli("circle", "set", "example", "C-01", "id=c-99")
        self.assertEqual(code, 1)
        self.assertIn("--force", err)
        code, _, err = self.cli("circle", "set", "example", "C-01", "id=c-99", "--force")
        self.assertEqual(code, 0, err)
        menus = read_table(self.menus, MENU_COLS).rows
        self.assertEqual([m["id"] for m in menus], ["a-01", "c-99"])

    def test_menus_set_and_remove(self):
        self.assertEqual(self.cli("menu", "example", "--circle", "A-01", "https://example.com/circle1/menu2")[0], 0)
        code, _, err = self.cli("menus", "remove", "example", "A-01")
        self.assertEqual(code, 1)
        self.assertIn("--url", err)
        code, _, err = self.cli("menus", "set", "example", "A-01", "--url", "https://example.com/circle1/menu2", "note=既刊")
        self.assertEqual(code, 0, err)
        self.assertEqual([m["note"] for m in self.circle_json("A-01")["menus"]], ["新刊", "既刊"])
        code, _, err = self.cli("menus", "remove", "example", "A-01", "--all")
        self.assertEqual(code, 0, err)
        self.assertEqual(self.circle_json("A-01")["menus"], [])

    def test_config_set_preserves_other_keys(self):
        old = json.loads(self.config.read_text(encoding="utf-8"))
        code, _, err = self.cli("config", "set", "example", "info.venue", "別の会場")
        self.assertEqual(code, 0, err)
        code, _, err = self.cli("config", "set", "example", "info.contact",
                                '{"label": "問い合わせ", "url": "https://example.com/contact"}', "--json")
        self.assertEqual(code, 0, err)
        text = self.config.read_text(encoding="utf-8")
        new = json.loads(text)
        self.assertEqual(new["info"]["venue"], "別の会場")
        self.assertEqual(new["info"]["contact"]["url"], "https://example.com/contact")
        old["info"]["venue"] = new["info"]["venue"]
        old["info"]["contact"] = new["info"]["contact"]
        self.assertEqual(new, old)
        self.assertEqual(list(new), list(old))  # キーの順も保つ
        self.assertEqual(text, json.dumps(new, ensure_ascii=False, indent=2) + "\n")
        code, _, err = self.cli("config", "unset", "example", "info.contact")
        self.assertEqual(code, 0, err)
        self.assertNotIn("contact", json.loads(self.config.read_text(encoding="utf-8"))["info"])
        # storeId は --force がなければ変えない
        code, _, err = self.cli("config", "set", "example", "storeId", "other")
        self.assertEqual(code, 1)
        self.assertIn("--force", err)

    def test_csv_rewrite_is_byte_stable(self):
        for path, cols in ((self.circles, CIRCLE_COLS), (self.menus, MENU_COLS)):
            self.assertEqual(Table(path, cols).text().encode("utf-8"), path.read_bytes())

    def write_circles_with_extras(self):
        """「memo」列・コメント行・空行を足した circles.csv にする（直接編集でありうる形）。"""
        lines = self.circles.read_bytes().decode("utf-8").split("\r\n")
        lines[0] += ",memo"
        lines[1] += ",手元のメモ"
        lines[2:2] = [self.COMMENT_ROWS[0], "", *self.COMMENT_ROWS[1:]]
        self.circles.write_bytes("\r\n".join(lines).encode("utf-8"))

    # 1行目は1列のコメント、2行目はサークルの行をコメントにしたもの、3行目は「,」「"」を含み列が見出しより多いもの
    COMMENT_ROWS = ["# コメント行",
                    "#a-99,A-99,サンプル即売会,消したサークル,,作家99,,0,,,,https://example.com/circle99,,架空の公式サークル一覧",
                    '"# メモ, ""引用"" つき",' + "," * 15 + "x"]

    def test_extra_columns_and_comment_rows_are_kept(self):
        self.write_circles_with_extras()
        code, _, err = self.cli("circle", "set", "example", "A-02", "notes=x", "memo=追記", "--no-build")
        self.assertEqual(code, 0, err)
        lines = self.circles.read_bytes().decode("utf-8").split("\r\n")
        self.assertTrue(lines[0].endswith(",source,memo"))
        self.assertTrue(lines[1].endswith(",手元のメモ"))
        self.assertEqual(lines[2:5], self.COMMENT_ROWS)  # 位置も値もそのまま（空行は落とす）
        self.assertTrue(lines[5].endswith(",x,架空の公式サークル一覧,追記"))

    def canonical(self, text):
        """menus.csv に text を書いて読み直したときの (保存する内容, 警告)。保存した内容は読み直しても変わらないこと。"""
        self.menus.write_bytes(text.encode("utf-8"))
        t = Table(self.menus, MENU_COLS)
        out = t.text()
        self.menus.write_bytes(out.encode("utf-8"))
        self.assertEqual(Table(self.menus, MENU_COLS).text(), out, "読み直すと変わる")
        return out, t.warnings

    def test_lenient_input_is_kept(self):
        H = "id,url,note,checkedAt\r\n"
        cases = [
            # 見出しより前: 空行・空白だけの行は落とし、「#」の行は見出しの前にそのまま残す
            ('\r\n , \r\n# 前書き,"a,b"\r\n#2\r\nid,url,note,checkedAt\r\na-01,https://example.com/m,,\r\n',
             '# 前書き,"a,b"\r\n#2\r\n' + H + "a-01,https://example.com/m,,\r\n", []),
            # id 列がない（id はスペース番号から作る。menus.csv では空のまま）
            ("url,note\r\nhttps://example.com/m,x\r\n", H + ",https://example.com/m,x,\r\n", []),
            # イベントデータの列が1つもない: すべてファイルにだけある列
            ("a,b\r\n1,2\r\n", "id,url,note,checkedAt,a,b\r\n,,,,1,2\r\n",
             ["menus.csv: お品書きの列が見つかりません（見出しに id, url, note, checkedAt のどれもありません）"]),
            # イベントデータの列名が2つ: 最初の列を使い、後の列はファイルにだけある列
            ("id,url,note,note\r\na-01,https://example.com/m,x,y\r\n",
             "id,url,note,checkedAt,note\r\na-01,https://example.com/m,x,,y\r\n",
             ["menus.csv: note 列が2つあります。最初の列を使います"]),
            # 見出しより値が多い行: 最初の値の頭に「#」を付けてコメント行にする（見出しは広げない）
            ('id,url\r\na-01,https://example.com/m\r\na-02,https://example.com/n,"x,y"\r\n,u,e\r\n',
             H + 'a-01,https://example.com/m,,\r\n#a-02,https://example.com/n,"x,y"\r\n#,u,e\r\n',
             ["menus.csv: 3行目は見出しより列が多いため、コメント行にしました",
              "menus.csv: 4行目は見出しより列が多いため、コメント行にしました"]),
            # ページ側の編集画面と同じ出力になること
            ("id,url,note,note\r\na-01,https://example.com/m,a,b\r\n",
             "id,url,note,checkedAt,note\r\na-01,https://example.com/m,a,,b\r\n",
             ["menus.csv: note 列が2つあります。最初の列を使います"]),
            ("id,id,url,note,checkedAt,extra\r\na-01,https://example.com/m,a,b\r\n",
             "id,url,note,checkedAt,id,extra\r\na-01,a,b,,https://example.com/m,\r\n",
             ["menus.csv: id 列が2つあります。最初の列を使います"]),
            (H + "a-01,https://example.com/m,a,b,extra\r\n", H + "#a-01,https://example.com/m,a,b,extra\r\n",
             ["menus.csv: 2行目は見出しより列が多いため、コメント行にしました"]),
            # 「#」の行だけで見出しがない
            ("# だけ\r\n", "# だけ\r\n" + H, []),
        ]
        for text, expected, warnings in cases:
            self.assertEqual(self.canonical(text), (expected, warnings), text)
        # 検証（read_csv）も同じ読み方: 重複した列は最初の列、列の多い行はデータにしない
        self.menus.write_bytes("id,url,note,note\r\na-01,https://example.com/m,x,y\r\na-01,https://example.com/z,,,\r\n".encode("utf-8"))
        warnings = []
        self.assertEqual(read_csv(self.menus, MENU_COLS, warnings),
                         [{"id": "a-01", "url": "https://example.com/m", "note": "x", "checkedAt": ""}])
        self.assertEqual(len(warnings), 2)
        code, _, err = self.cli("check", "example")
        self.assertEqual(code, 0, err)
        self.assertIn("note 列が2つあります", err)
        self.assertIn("3行目は見出しより列が多い", err)
        # 編集コマンドも警告を出し、同じ形で書く
        code, _, err = self.cli("menus", "set", "example", "A-01", "note=既刊", "--no-build")
        self.assertEqual(code, 0, err)
        self.assertIn("警告: menus.csv: note 列が2つあります", err)
        self.assertEqual(self.menus.read_bytes().decode("utf-8"),
                         "id,url,note,checkedAt,note\r\na-01,https://example.com/m,既刊,,y\r\n#a-01,https://example.com/z,,,\r\n")

    def test_unparsable_csv_is_a_clean_error(self):
        before = self.snapshot()
        self.menus.write_bytes(b'id,url,note,checkedAt\r\n\r\na-01,"https://example.com/m,,\r\nb,c\r\n')
        for args in (("check", "example"), ("menus", "list", "example"), ("circle", "set", "example", "A-02", "notes=x"),
                     ("menu", "example", "--circle", "A-02", "https://example.com/m2"), ("import", "example")):
            code, _, err = self.cli(*args)
            self.assertEqual(code, 1, args)
            self.assertIn("menus.csv: 3行目から始まる行を CSV として読めません", err)
            self.assertNotIn("Traceback", err)
        self.menus.write_bytes("id,url\r\n".encode("cp932") + "お品書き".encode("cp932") + b"\r\n")
        code, _, err = self.cli("menus", "list", "example")
        self.assertEqual(code, 1)
        self.assertIn("UTF-8", err)
        self.assertEqual(self.snapshot()[self.circles], before[self.circles])

    def test_canonical_form(self):
        cases = [
            ("﻿id,url,note,checkedAt\na-01,https://example.com/m,,2030-01-01\n\n",  # BOM・LF・空行
             "id,url,note,checkedAt\r\na-01,https://example.com/m,,2030-01-01\r\n"),
            ("id,url,note,checkedAt\r\n# メモ, 続き\r\na-01,https://example.com/m\r\n",  # コメント行はそのまま・足りない値は埋める
             "id,url,note,checkedAt\r\n# メモ, 続き\r\na-01,https://example.com/m,,\r\n"),
            ('id,url,note,checkedAt\r\n#a-01,https://example.com/m,"a,b",,"""x""",\r\n',  # 列が多いコメント行もそのまま
             'id,url,note,checkedAt\r\n#a-01,https://example.com/m,"a,b",,"""x""",\r\n'),
            ('id,url,note,checkedAt\r\n"# a\nb",c\r\n',  # 引用符は必要なときだけ
             'id,url,note,checkedAt\r\n"# a\nb",c\r\n'),
            ('id,url,note,checkedAt\r\na-01,https://example.com/m,"""新刊"", 既刊",2030-01-01\r\n',  # 引用符
             'id,url,note,checkedAt\r\na-01,https://example.com/m,"""新刊"", 既刊",2030-01-01\r\n'),
            ("id,url,note,checkedAt\r\n,,,\r\n , ,\t,\r\na-01,https://example.com/m,,\r\n",  # 値がすべて空の行は空行と同じ
             "id,url,note,checkedAt\r\na-01,https://example.com/m,,\r\n"),
            ("id,url,note,checkedAt\r\n,#x,,\r\n",  # 「#」の行は最初の値が「#」で始まる行だけ
             "id,url,note,checkedAt\r\n,#x,,\r\n"),
            ("checkedAt,note,url,id,by\r\n2030-01-01,,https://example.com/m,a-01,人\r\n",  # 列の順・ファイルにだけある列
             "id,url,note,checkedAt,by\r\na-01,https://example.com/m,,2030-01-01,人\r\n"),
        ]
        for text, expected in cases:
            self.assertEqual(self.canonical(text), (expected, []), text)
        # read_csv（検証・生成が読む）も同じ規則でコメント行と空行を見分ける
        other = self.root / "other.csv"
        other.write_bytes(("id,space,event,name\r\n# メモ,A-01,,\r\n,,,\r\n,#A-10,,番号が「#」で始まる\r\n").encode("utf-8"))
        self.assertEqual([(c["id"], c["space"]) for c in read_csv(other, CIRCLE_COLS)], [("", "#A-10")])
        self.assertEqual(format_csv(MENU_COLS, [{COMMENT: ["# a,b", "c"]}]), 'id,url,note,checkedAt\r\n"# a,b",c\r\n')
        # 編集コマンドも同じ形で書く
        self.menus.write_bytes(cases[0][0].encode("utf-8"))
        code, out, err = self.cli("menus", "set", "example", "A-01", "note=既刊", "--no-build")
        self.assertEqual(code, 0, err)
        self.assertIn("CRLF", out)
        self.assertEqual(self.menus.read_bytes(),
                         "id,url,note,checkedAt\r\na-01,https://example.com/m,既刊,2030-01-01\r\n".encode("utf-8"))

    def test_unnamed_and_repeated_extra_columns_are_kept_by_position(self):
        # 見出しの最後が「,」（列名が空の列）・列名が空の列が2つ・同じ列名の列が2つ
        circles = self.circles.read_bytes().decode("utf-8").split("\r\n")
        circles[0] += ",,memo,,memo"
        circles[1] += ",空1,メモ1,空2,メモ2"
        self.circles.write_bytes("\r\n".join(circles).encode("utf-8"))
        menus = self.menus.read_bytes().decode("utf-8").split("\r\n")
        menus[0] += ","
        menus[1] += ",名前のない列"
        self.menus.write_bytes("\r\n".join(menus).encode("utf-8"))

        def check():
            c = self.circles.read_bytes().decode("utf-8").split("\r\n")
            self.assertTrue(c[0].endswith(",source,,memo,,memo"), c[0])
            self.assertTrue(c[1].endswith(",空1,メモ1,空2,メモ2"), c[1])
            m = self.menus.read_bytes().decode("utf-8").split("\r\n")
            self.assertEqual(m[0], "id,url,note,checkedAt,")
            self.assertTrue(m[1].endswith(",名前のない列"), m[1])

        code, _, err = self.cli("circle", "set", "example", "A-01", "notes=x", "--no-build")
        self.assertEqual(code, 0, err)
        self.assertEqual(self.circle_json("A-01")["notes"], "x")
        check()
        code, _, err = self.cli("menus", "set", "example", "A-01", "note=既刊", "--no-build")
        self.assertEqual(code, 0, err)
        check()
        code, _, err = self.cli("import", "example", "--no-build")
        self.assertEqual(code, 0, err)
        check()
        code, _, err = self.cli("menu", "example", "--circle", "A-02", "https://example.com/circle2/menu")
        self.assertEqual(code, 0, err)
        check()
        self.assertTrue(self.menus.read_bytes().decode("utf-8").split("\r\n")[-2].startswith("a-02,https://example.com/circle2/menu,,"))
        # 列名が空・重複している列は名前で指定できない
        code, _, err = self.cli("circle", "set", "example", "A-01", "memo=y")
        self.assertEqual(code, 1)
        self.assertIn("列 'memo' はありません", err)
        # 検証・生成（read_csv）もこの列を気にしない
        self.assertEqual(self.cli("check", "example")[0], 0)

    def test_partial_write_failure_changes_nothing(self):
        self.menus.chmod(stat.S_IREAD)
        try:
            if os.access(self.menus, os.W_OK):
                self.skipTest("読み取り専用にできない環境（root など）")
            before = self.snapshot()
            for args in (("circle", "set", "example", "C-01", "id=c-99", "--force"),
                         ("circle", "remove", "example", "A-01", "--with-menus")):
                code, _, err = self.cli(*args)
                self.assertEqual(code, 1, args)
                self.assertIn("書き込めません", err)
                self.assertNotIn("Traceback", err)
                self.assertEqual(self.snapshot(), before)
        finally:
            self.menus.chmod(stat.S_IREAD | stat.S_IWRITE)

    def test_wrong_typed_config_is_an_error_not_a_traceback(self):
        before = self.snapshot()
        for key, value, *flags in (("info.contact", "foo"), ("info.links", "x"), ("info", "title"),
                                   ("info.eventSlots", "3"), ("info.eventSlots", "3", "--json"),
                                   ("info.hashtags", "タグ"), ("info.slotColors", '{"1": "red"}', "--json"),
                                   ("info.halls", "x"), ("info.venue", "1", "--json"), ("title", "[]", "--json")):
            code, _, err = self.cli("config", "set", "example", key, value, *flags)
            self.assertEqual(code, 1, (key, value))
            self.assertIn("書き込みません", err)
            self.assertNotIn("Traceback", err)
        self.assertEqual(self.snapshot(), before)
        # 直接編集で型が違う event.json でも、検証や編集が例外で止まらない
        self.config.write_text('{"storeId": "example", "title": "t", "info": {"contact": "foo", "links": "x"}}', encoding="utf-8")
        code, _, err = self.cli("check", "example")
        self.assertEqual(code, 1)
        self.assertIn("info.links は配列", err)
        self.assertNotIn("Traceback", err)
        code, _, err = self.cli("circle", "set", "example", "A-02", "notes=x", "--no-build")
        self.assertEqual(code, 0, err)
        self.config.write_text("[]", encoding="utf-8")
        self.assertEqual(self.cli("check", "example")[0], 1)

    def test_id_change_to_existing_id_is_refused(self):
        before = self.snapshot()
        code, _, err = self.cli("circle", "set", "example", "C-01", "id=a-01", "--force")
        self.assertEqual(code, 1)
        self.assertIn("すでにあります", err)
        self.assertEqual(self.snapshot(), before)

    def test_menus_set_normalizes_x_url(self):
        code, _, err = self.cli("menus", "set", "example", "A-01",
                                "url=https://twitter.com/example_user/status/1234567890?s=20", "--no-build")
        self.assertEqual(code, 0, err)
        self.assertEqual(self.circle_json("A-01")["menus"][0]["url"], "https://x.com/example_user/status/1234567890")

    def test_empty_query_matches_nothing(self):
        # スペースも X も空欄のサークルがあっても、空・「@」だけの指定には当たらない
        code, _, err = self.cli("circle", "add", "example", "id=nospace", "name=未配置", "--no-build")
        self.assertEqual(code, 0, err)
        for q in ("", " ", "@"):
            code, _, err = self.cli("circle", "show", "example", q)
            self.assertEqual(code, 1, repr(q))
            self.assertIn("該当するサークルがありません", err)

    def test_import_and_menu_keep_extra_columns_and_comments(self):
        self.write_circles_with_extras()
        self.menus.write_bytes(self.menus.read_bytes().replace(
            b"checkedAt\r\n", "checkedAt,by\r\n# menus のメモ\r\n".encode("utf-8"), 1))
        code, _, err = self.cli("import", "example", "--no-build")
        self.assertEqual(code, 0, err)
        code, _, err = self.cli("menu", "example", "--circle", "A-02", "https://example.com/circle2/menu")
        self.assertEqual(code, 0, err)
        circles = self.circles.read_bytes().decode("utf-8").split("\r\n")
        self.assertTrue(circles[0].endswith(",source,memo"))
        self.assertTrue(circles[1].endswith(",手元のメモ"))
        self.assertEqual(circles[2:5], self.COMMENT_ROWS)
        menus = self.menus.read_bytes().decode("utf-8").split("\r\n")
        self.assertEqual(menus[:2], ["id,url,note,checkedAt,by", "# menus のメモ"])
        self.assertTrue(menus[-2].startswith("a-02,https://example.com/circle2/menu,"))

    def test_import_and_menu_are_byte_identical_for_normal_data(self):
        before = self.snapshot()
        self.assertEqual(self.cli("import", "example", "--no-build")[0], 0)
        self.assertEqual(self.snapshot(), before)  # example は取り込み結果そのもの
        self.assertEqual(self.cli("menu", "example", "--circle", "A-02", "https://example.com/circle2/menu")[0], 0)
        old, new = before[self.menus], self.menus.read_bytes()
        self.assertTrue(new.startswith(old))
        self.assertTrue(new[len(old):].startswith(b"a-02,https://example.com/circle2/menu,,"))


    def test_null_and_wrong_typed_info_values_are_errors(self):
        before = self.snapshot()
        for key, value in (("info.links", "null"), ("info.hashtags", "null"), ("info.contact", "[]"),
                           ("info.contact", '""'), ("info.contact", "null"), ("info.halls", "null"),
                           ("info.eventSlots", "null")):
            code, _, err = self.cli("config", "set", "example", key, value, "--json")
            self.assertEqual(code, 1, (key, value))
            self.assertIn(key, err)
            self.assertNotIn("Traceback", err)
        self.assertEqual(self.snapshot(), before)

    def test_import_ignores_whitespace_in_existing_values(self):
        circles = self.circles.read_bytes().decode("utf-8").replace(",星屑通信,", ", 星屑通信 ,", 1)
        self.circles.write_bytes(circles.encode("utf-8"))
        self.menus.write_bytes(self.menus.read_bytes().replace(
            b"a-01,https://example.com/circle1/menu,", b" a-01 , https://example.com/circle1/menu ,", 1))
        code, out, err = self.cli("import", "example", "--dry-run")
        self.assertEqual(code, 0, err)
        self.assertIn("変更 0", out)
        self.assertIn("お品書きの追加 0 件", out)

    def test_duplicate_keys_in_event_json(self):
        text = self.config.read_text(encoding="utf-8").replace('"title":', '"title": "古い題名",\n  "title":', 1)
        self.config.write_text(text, encoding="utf-8")
        code, _, err = self.cli("check", "example")
        self.assertEqual(code, 1)
        self.assertIn("title", err)
        self.assertIn("2回以上", err)
        before = self.snapshot()
        for args in (("config", "set", "example", "info.venue", "x"), ("config", "unset", "example", "info.hours"),
                     ("config", "get", "example")):
            code, _, err = self.cli(*args)
            self.assertEqual(code, 1, args)
            self.assertIn("2回以上", err)
            self.assertNotIn("Traceback", err)
        self.assertEqual(self.snapshot(), before)
        self.config.write_text(text.replace('"title": "古い題名",\n  ', "", 1), encoding="utf-8")
        code, _, err = self.cli("config", "set", "example", "info.contact", '{"label": "a", "label": "b"}', "--json")
        self.assertEqual(code, 1)
        self.assertIn("2回以上", err)

    def test_import_keys_existing_rows_by_derived_id(self):
        lines = self.circles.read_bytes().decode("utf-8").split("\r\n")
        lines[0] += ",memo"
        lines = [lines[0]] + [l + ("," if l else "") for l in lines[1:]]
        lines[2] = lines[2].replace("a-02,", " a-02 ,", 1) + "前後に空白"
        lines[4] = lines[4].replace("a-09,", ",", 1) + "id が空"
        lines.insert(4, "# a-09 の前のコメント")
        self.circles.write_bytes("\r\n".join(lines).encode("utf-8"))
        code, _, err = self.cli("import", "example", "--no-build")
        self.assertEqual(code, 0, err)
        out = self.circles.read_bytes().decode("utf-8").split("\r\n")
        self.assertTrue(out[2].startswith("a-02,") and out[2].endswith(",前後に空白"), out[2])
        self.assertEqual(out[4], "# a-09 の前のコメント")
        self.assertTrue(out[5].startswith("a-09,") and out[5].endswith(",id が空"), out[5])

    def test_crlf_notice_only_when_record_ends_change(self):
        self.menus.write_bytes('id,url,note,checkedAt\r\na-01,https://example.com/m,"1行目\n2行目",2030-01-01\r\n'.encode("utf-8"))
        code, out, err = self.cli("menus", "set", "example", "A-01", "checkedAt=2030-01-02", "--dry-run")
        self.assertEqual(code, 0, err)
        self.assertNotIn("CRLF", out)
        self.menus.write_bytes('id,url,note,checkedAt\na-01,https://example.com/m,"1行目\n2行目",2030-01-01\n'.encode("utf-8"))
        code, out, err = self.cli("menus", "set", "example", "A-01", "checkedAt=2030-01-02", "--dry-run")
        self.assertIn("CRLF", out)

    def test_bom_input_is_written_without_bom(self):
        self.circles.write_bytes(b"\xef\xbb\xbf" + self.circles.read_bytes())
        self.assertEqual(self.circle_json("A-01")["id"], "a-01")  # BOM があっても id 列として読む
        code, _, err = self.cli("circle", "set", "example", "A-01", "notes=x", "--no-build")
        self.assertEqual(code, 0, err)
        self.assertTrue(self.circles.read_bytes().startswith(b"id,space,"))

    def test_config_unset_array_element(self):
        code, _, err = self.cli("config", "set", "example", "info.hashtags", '["a", "b", "c"]', "--json")
        self.assertEqual(code, 0, err)
        code, _, err = self.cli("config", "unset", "example", "info.hashtags.1")
        self.assertEqual(code, 0, err)
        self.assertEqual(json.loads(self.config.read_text(encoding="utf-8"))["info"]["hashtags"], ["a", "c"])
        code, _, err = self.cli("config", "unset", "example", "info.hashtags.5")
        self.assertEqual(code, 1)
        self.assertNotIn("Traceback", err)


if __name__ == "__main__":
    unittest.main()
