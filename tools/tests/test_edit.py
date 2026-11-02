"""イベントデータの編集コマンド（caimawaru circle / menus / config）のテスト。events/example を一時フォルダに写して使う。"""
import contextlib
import io
import json
import shutil
import tempfile
import unittest
from pathlib import Path

from caimawaru.cli import main
from caimawaru.project import CIRCLE_COLS, MENU_COLS, format_csv, read_table

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
            code = main(["--root", str(self.root), *args])
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
        _, circles = read_table(self.circles)
        _, menus = read_table(self.menus)
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
        _, menus = read_table(self.menus)
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
            _, rows = read_table(path)
            self.assertEqual(format_csv(cols, rows).encode("utf-8"), path.read_bytes())

    def test_extra_columns_and_comment_rows_are_kept(self):
        lines = self.circles.read_bytes().decode("utf-8").split("\r\n")
        lines[0] += ",memo"
        lines[1] += ",手元のメモ"
        lines.insert(2, "# コメント行" + "," * 14)
        self.circles.write_bytes("\r\n".join(lines).encode("utf-8"))
        code, _, err = self.cli("circle", "set", "example", "A-02", "notes=x", "memo=追記", "--no-build")
        self.assertEqual(code, 0, err)
        out = self.circles.read_bytes().decode("utf-8")
        self.assertIn("手元のメモ", out)
        self.assertIn("# コメント行", out)
        self.assertIn(",x,架空の公式サークル一覧,追記", out)


if __name__ == "__main__":
    unittest.main()
