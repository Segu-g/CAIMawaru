"""イベントの指定（tools/eventargs.py）のテスト。scripts/lib.test.ts と同じ規則を確かめる。"""
import os
import unittest

from eventargs import known_events, take_event

KNOWN = ["example", "other"]


class TakeEventTest(unittest.TestCase):
    def test_sample_event_exists(self):
        self.assertIn("example", known_events())

    def test_first_argument(self):
        self.assertEqual(take_event(["example", "--check"], KNOWN), ("example", ["--check"]))

    def test_event_option(self):
        self.assertEqual(take_event(["--check", "--event", "example"], KNOWN), ("example", ["--check"]))
        self.assertEqual(take_event(["--event=example", "-"], KNOWN), ("example", ["-"]))

    def test_both_same_ok_different_error(self):
        self.assertEqual(take_event(["example", "--event", "example"], KNOWN), ("example", []))
        with self.assertRaises(ValueError):
            take_event(["other", "--event", "example"], KNOWN)
        with self.assertRaises(ValueError):
            take_event(["--event"], KNOWN)

    def test_environment_not_used(self):
        os.environ["EVENT"] = "example"
        try:
            self.assertEqual(take_event(["https://example.com/"], KNOWN), ("", ["https://example.com/"]))
        finally:
            os.environ.pop("EVENT")


if __name__ == "__main__":
    unittest.main()
