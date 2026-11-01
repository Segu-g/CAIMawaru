"""イベントの指定（tools/events.py の take_event）のテスト。"""
import os
import unittest

os.environ.setdefault("EVENT", "example")  # events を読み込むとき（モジュールの読み込み時）に解決できるように
import events  # noqa: E402


class TakeEventTest(unittest.TestCase):
    def setUp(self):
        self.saved = os.environ.get("EVENT")

    def tearDown(self):
        if self.saved is None:
            os.environ.pop("EVENT", None)
        else:
            os.environ["EVENT"] = self.saved

    def test_first_argument(self):
        self.assertEqual(events.take_event(["example", "--check"]), ("example", ["--check"]))

    def test_event_option(self):
        self.assertEqual(events.take_event(["--check", "--event", "example"]), ("example", ["--check"]))
        self.assertEqual(events.take_event(["--event=example", "-"]), ("example", ["-"]))

    def test_environment_and_other_arguments_kept(self):
        os.environ["EVENT"] = "example"
        self.assertEqual(events.take_event(["https://example.com/"]), ("example", ["https://example.com/"]))
        os.environ.pop("EVENT")
        self.assertEqual(events.take_event(["--check"]), ("", ["--check"]))


if __name__ == "__main__":
    unittest.main()
