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

    def set_map_image(self, image):
        path = self.root / "events/example/event.json"
        config = json.loads(path.read_text(encoding="utf-8"))
        config["info"]["mapImage"] = image
        path.write_text(json.dumps(config, ensure_ascii=False), encoding="utf-8")

    def test_map_image_goes_to_circles_json(self):
        image = self.root / "events/example/public/data/map.svg"
        image.parent.mkdir(parents=True)
        image.write_text('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>', encoding="utf-8")
        self.set_map_image({"src": "data/map.svg", "alt": "架空の会場の配置図", "caption": "出典: 架空"})
        code, out, err = self.cli("data", "example")
        self.assertEqual(code, 0, err)
        self.assertNotIn("mapImage", err)
        data = json.loads((self.root / "events/example/public/data/circles.json").read_text(encoding="utf-8"))
        self.assertEqual(data["event"]["mapImage"], {"src": "data/map.svg", "alt": "架空の会場の配置図", "caption": "出典: 架空"})
        self.assertIn("cells", data["layout"])  # 描き起こしの配置図と両方あってよい
        # alt がなければ警告だけ
        self.set_map_image({"src": "data/map.svg"})
        code, _, err = self.cli("check", "example")
        self.assertEqual(code, 0)
        self.assertIn("info.mapImage.alt", err)

    def test_map_image_errors(self):
        (self.root / "events/example/public/data").mkdir(parents=True)
        (self.root / "events/example/public/data/map.gif").write_bytes(b"GIF89a")
        (self.root / "events/example/secret.png").write_bytes(b"")
        for image, message in (
            ("map.png", "info.mapImage は"),
            ({"alt": "x"}, "info.mapImage.src"),
            ({"src": "data/none.png", "alt": "x"}, "がありません"),
            ({"src": "data/map.gif", "alt": "x"}, ".png / .jpg"),
            ({"src": "../secret.png", "alt": "x"}, "相対パス"),
            ({"src": "/etc/x.png", "alt": "x"}, "相対パス"),
            ({"src": "https://example.com/map.png", "alt": "x"}, "相対パス"),
            ({"src": "data/配置図.png", "alt": "x"}, "相対パス"),
            ({"src": "data/map.svg", "alt": 1}, "info.mapImage.alt は文字列"),
        ):
            with self.subTest(image=image):
                self.set_map_image(image)
                code, _, err = self.cli("check", "example")
                self.assertEqual(code, 1)
                self.assertIn(message, err)

    def test_map_image_symlink_outside_public(self):
        (self.root / "events/example/public/data").mkdir(parents=True)
        (self.root / "events/example/secret.png").write_bytes(b"")
        try:
            (self.root / "events/example/public/data/link.png").symlink_to(self.root / "events/example/secret.png")
        except OSError:
            self.skipTest("シンボリックリンクを作れない環境")
        self.set_map_image({"src": "data/link.png", "alt": "x"})
        code, _, err = self.cli("check", "example")
        self.assertEqual(code, 1)
        self.assertIn("の外を指しています", err)

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
