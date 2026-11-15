"""CLI（caimawaru）を通しで動かすテスト。events/example を一時フォルダに写して使う。"""
import json
import shutil
import unittest

from helpers import example_root, run_cli

# 各形式の先頭のバイト（中身の形式の検証に使う）
PNG = b"\x89PNG\r\n\x1a\n" + b"\0" * 8
JPEG = b"\xff\xd8\xff\xe0" + b"\0" * 8
WEBP = b"RIFF\0\0\0\0WEBPVP8 "


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

    def set_map_image(self, image, keep_layout=False):
        """info.mapImage を書く。画像は layout.json がないイベントだけで使うので、ふつうは layout.json を消す。"""
        if not keep_layout:
            (self.root / "events/example/layout.json").unlink(missing_ok=True)
        path = self.root / "events/example/event.json"
        config = json.loads(path.read_text(encoding="utf-8"))
        config["info"]["mapImage"] = image
        path.write_text(json.dumps(config, ensure_ascii=False), encoding="utf-8")

    def write_public(self, name, content):
        path = self.root / "events/example/public" / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content.encode("utf-8") if isinstance(content, str) else content)
        return path

    def circles_json(self):
        return json.loads((self.root / "events/example/public/data/circles.json").read_text(encoding="utf-8"))

    def test_map_image_goes_to_circles_json(self):
        self.write_public("data/map.webp", WEBP)
        self.set_map_image({"src": "data/map.webp", "alt": "架空の会場の配置図", "caption": "出典: 架空"})
        code, out, err = self.cli("data", "example")
        self.assertEqual(code, 0, err)
        self.assertNotIn("mapImage", err)
        data = self.circles_json()
        self.assertEqual(data["event"]["mapImage"], {"src": "data/map.webp", "alt": "架空の会場の配置図", "caption": "出典: 架空"})
        self.assertNotIn("layout", data)
        for name, content in (("data/map.png", PNG), ("data/map.jpg", JPEG), ("data/map.JPEG", JPEG)):
            with self.subTest(name=name):
                self.write_public(name, content)
                self.set_map_image({"src": name, "alt": "x"})
                code, _, err = self.cli("check", "example")
                self.assertEqual(code, 0, err)
        # alt がない・知らないキーは警告だけ
        self.set_map_image({"src": "data/map.webp", "width": 10})
        code, _, err = self.cli("check", "example")
        self.assertEqual(code, 0)
        self.assertIn("info.mapImage.alt", err)
        self.assertIn("info.mapImage.width は使いません", err)

    def test_map_image_is_not_used_with_layout(self):
        self.write_public("data/map.png", PNG)
        self.set_map_image({"src": "data/map.png", "alt": "x"}, keep_layout=True)
        code, _, err = self.cli("data", "example")
        self.assertEqual(code, 0, err)
        self.assertIn("info.mapImage は使いません", err)
        self.assertIn("public/ のファイルは公開されます", err)
        data = self.circles_json()
        self.assertNotIn("mapImage", data["event"])
        self.assertIn("cells", data["layout"])
        # 使わないので、ファイルがない・src の形が違うのは警告だけ
        for image in ({"src": "data/none.png"}, {"src": "../x.png"}, {"src": "data/none.svg"}, "map.png"):
            with self.subTest(image=image):
                self.set_map_image(image, keep_layout=True)
                code, _, err = self.cli("check", "example")
                self.assertEqual(code, 0, err)
                self.assertIn("info.mapImage は使いません", err)
        # ファイルがあれば公開されるので、形式は確かめる
        self.write_public("data/map.svg", "<svg/>")
        self.write_public("data/fake.png", "<html><script>alert(1)</script></html>")
        for src, message in (("data/map.svg", "PNG・JPEG・WebP に書き出してください"), ("data/fake.png", "の中身が PNG ではありません")):
            with self.subTest(src=src):
                self.set_map_image({"src": src}, keep_layout=True)
                code, _, err = self.cli("check", "example")
                self.assertEqual(code, 1)
                self.assertIn(message, err)

    def test_map_image_errors(self):
        self.write_public("data/map.gif", b"GIF89a")
        self.write_public("data/map.png", PNG)
        (self.root / "events/example/secret.png").write_bytes(PNG)
        for image, message in (
            ("map.png", "info.mapImage は"),
            ({"alt": "x"}, "info.mapImage.src"),
            ({"src": "data/none.png", "alt": "x"}, "がありません"),
            ({"src": "data/MAP.png", "alt": "x"}, "大文字小文字"),  # 区別しないファイルシステムでもエラー
            ({"src": "Data/map.png", "alt": "x"}, "大文字小文字"),
            ({"src": "data/map.gif", "alt": "x"}, "PNG・JPEG・WebP（.png / .jpg / .jpeg / .webp）"),
            ({"src": "data/map.svg", "alt": "x"}, "SVG などは PNG・JPEG・WebP に書き出してください"),  # ファイルがなくても
            ({"src": "../secret.png", "alt": "x"}, "相対パス"),
            ({"src": "/etc/x.png", "alt": "x"}, "相対パス"),
            ({"src": "https://example.com/map.png", "alt": "x"}, "相対パス"),
            ({"src": "data/配置図.png", "alt": "x"}, "相対パス"),
            ({"src": "data/map.png", "alt": 1}, "info.mapImage.alt は文字列"),
        ):
            with self.subTest(image=image):
                self.set_map_image(image)
                code, _, err = self.cli("check", "example")
                self.assertEqual(code, 1)
                self.assertIn(message, err)

    def test_map_image_content_must_match_extension(self):
        """名前だけ変えた HTML・SVG など、中身が拡張子の形式でないファイルはエラー（ブラウザが中身から形式を推測することがあるため）。"""
        for name, content, message in (
            ("data/map.png", "<html><script>alert(1)</script></html>", "の中身が PNG ではありません（画像でないか、使えない形式）"),
            ("data/map.png", '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>', "の中身が PNG ではありません"),
            ("data/map.png", b"", "の中身が PNG ではありません"),
            ("data/map.webp", b"RIFF\0\0\0\0AVI LIST", "の中身が WebP ではありません"),
            ("data/map.jpg", PNG, "の中身が JPEG ではありません（PNG）"),
            ("data/map.webp", b"GIF89a", "の中身が WebP ではありません"),
        ):
            with self.subTest(name=name, content=content):
                self.write_public(name, content)
                self.set_map_image({"src": name, "alt": "x"})
                code, _, err = self.cli("check", "example")
                self.assertEqual(code, 1)
                self.assertIn(message, err)

    def test_map_image_symlink_outside_public(self):
        (self.root / "events/example/public/data").mkdir(parents=True)
        (self.root / "events/example/secret.png").write_bytes(PNG)
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
