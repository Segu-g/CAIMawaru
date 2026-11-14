"""CLI（caimawaru）を通しで動かすテスト。events/example を一時フォルダに写して使う。"""
import json
import shutil
import unittest

from helpers import example_root, run_cli


class CliTest(unittest.TestCase):
    def setUp(self):
        self.root = example_root()

    def tearDown(self):
        shutil.rmtree(self.root)

    def cli(self, *args):
        return run_cli(self.root, *args)

    def test_data_writes_circles_json_with_expanded_layout(self):
        code, out, _ = self.cli("data", "example")
        self.assertEqual(code, 0, out)
        data = json.loads((self.root / "events/example/public/data/circles.json").read_text(encoding="utf-8"))
        self.assertEqual(len(data["circles"]), 12)
        self.assertIn("cells", data["layout"])
        self.assertNotIn("islands", data["layout"])

    def test_check_does_not_write(self):
        code, _, _ = self.cli("check")
        self.assertEqual(code, 0)
        self.assertFalse((self.root / "events/example/public/data/circles.json").exists())

    def test_validation_error(self):
        csv = self.root / "events/example/data/circles.csv"
        csv.write_text(csv.read_text(encoding="utf-8") + "z-99,Z-99,サンプル即売会,配置図にない,,,,0,,,,,,架空\n", encoding="utf-8")
        code, _, err = self.cli("data", "example", "--check")
        self.assertEqual(code, 1)
        self.assertIn("Z-99", err)

    def test_id_duplicates_are_errors_and_id_text_is_warned(self):
        csv = self.root / "events/example/data/circles.csv"
        csv.write_text(csv.read_text(encoding="utf-8")
                       + ",Ａ－０１,サンプル即売会,全角,,,,0,,,,,,架空\n"     # 作ると a-01（2行目の id 列と重複）
                       + ",★,サンプル即売会,記号だけ,,,,0,,,,,,架空\n"
                       + "B-01,B-02,サンプル即売会,大文字,,,,0,,,,,,架空\n"  # b-01 と大文字・小文字だけ違う
                       + "\"x 1,y\",A-02,サンプル即売会,空白,,,,0,,,,,,架空\n", encoding="utf-8")
        code, _, err = self.cli("data", "example", "--check")
        self.assertEqual(code, 1)
        self.assertIn("エラー: circles.csv:14（スペース Ａ－０１ から作った id）: id 'a-01' が circles.csv:2（id 列）と重複しています", err)
        self.assertIn("エラー: circles.csv:15: スペース番号 '★' から id を作れません", err)
        self.assertIn("警告: circles.csv:16: id 'B-01' に大文字が入っています", err)
        self.assertIn("警告: circles.csv:16: id 'B-01' は circles.csv:6 の id 'b-01' と大文字・小文字だけが違います", err)
        self.assertIn("警告: circles.csv:17: id 'x 1,y' に空白・「,」が入っています", err)
        self.assertNotIn("id もスペース番号もありません", err)

    def test_id_whitespace_is_the_same_set_as_the_editor(self):
        """空白とみなす文字は xurl.TRIM（str.isspace と JavaScript の \\s の両方。エディタの validate.ts と同じ）"""
        from caimawaru.build import check_id_text
        for ch in ("\x1c", "\x85", "\ufeff", "\u3000", "\t"):
            with self.subTest(ch=repr(ch)):
                self.assertIn("空白", check_id_text(f"a{ch}1", {"id": f"a{ch}1"}))
        self.assertIsNone(check_id_text("a-1", {"id": "a-1"}))

    def test_updated_at_changes_only_with_circles(self):
        from caimawaru import build
        from caimawaru.project import load_event
        event = load_event(self.root / "events", "example")
        r = build.validate(event)
        self.assertEqual(build.write_output(event, r, today="2030-01-01")["event"]["updatedAt"], "2030-01-01")
        # サークル情報が同じなら、イベント情報だけ変わっても日付はそのまま
        r.info = {**r.info, "venue": "別の会場"}
        self.assertEqual(build.write_output(event, r, today="2030-01-02")["event"]["updatedAt"], "2030-01-01")
        r.circles[0] = {**r.circles[0], "name": "変更後"}
        self.assertEqual(build.write_output(event, r, today="2030-01-03")["event"]["updatedAt"], "2030-01-03")

    def test_broken_files_are_errors_not_tracebacks(self):
        (self.root / "events/example/layout.json").write_text('{"hall": {"x": 0, "y": 0, "w": 1, "h": 1}, "islands": {}}', encoding="utf-8")
        code, _, err = self.cli("check", "example")
        self.assertEqual(code, 1)
        self.assertIn("layout.json", err)
        (self.root / "events/example/layout.json").write_text("[]", encoding="utf-8")
        self.assertEqual(self.cli("check", "example")[0], 1)
        (self.root / "events/example/event.json").write_text("{", encoding="utf-8")
        code, _, err = self.cli("import", "example", "--dry-run")
        self.assertEqual(code, 1)
        self.assertIn("event.json", err)

    def test_unknown_event(self):
        code, _, err = self.cli("data", "nosuch")
        self.assertEqual(code, 1)
        self.assertIn("nosuch", err)

    def test_import_dry_run_and_menu_dry_run(self):
        code, out, _ = self.cli("import", "example", "--dry-run")
        self.assertEqual(code, 0, out)
        self.assertIn("--dry-run", out)
        self.assertIn("架空の公式サークル一覧: 12 件", out)  # sources の label で報告する
        code, out, _ = self.cli("menu", "example", "--circle", "A-02", "--dry-run", "https://example.com/m")
        self.assertEqual(code, 0, out)
        self.assertIn("1 件を登録できます", out)

    def test_new_event(self):
        code, _, _ = self.cli("new-event", "2030-01-01-test", "--map", "--sockbase", "https://list.sockbase.net/circle-lists/x")
        self.assertEqual(code, 0)
        config = json.loads((self.root / "events/2030-01-01-test/event.json").read_text(encoding="utf-8"))
        self.assertEqual(config["sources"], [{"type": "sockbase", "url": "https://list.sockbase.net/circle-lists/x"}])
        code, _, _ = self.cli("new-event", "2030-01-01-test")
        self.assertEqual(code, 1)  # すでにある
        code, out, _ = self.cli("list")
        self.assertEqual(out.split(), ["2030-01-01-test", "example"])


if __name__ == "__main__":
    unittest.main()
