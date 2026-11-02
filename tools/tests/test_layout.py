"""配置図の展開（caimawaru.layout）のテスト。番号の振り方はここだけで決まる。"""
import unittest

from caimawaru.layout import LayoutError, expand

HALL = {"x": 0, "y": 0, "w": 1000, "h": 600}


def cells_of(spec):
    return {c["space"]: c for c in expand({"hall": HALL, **spec})["cells"]}


class IslandOrderTest(unittest.TestCase):
    def test_two_columns_up_down_default(self):
        """2列（既定 up-down）: 左列は下から、右列は上から"""
        c = cells_of({"islands": [{"name": "A", "x": 0, "y": 0, "rows": 3, "columns": 2}]})
        self.assertGreater(c["A-01"]["y"], c["A-03"]["y"])
        self.assertEqual(c["A-03"]["y"], c["A-04"]["y"])
        self.assertGreater(c["A-04"]["x"], c["A-03"]["x"])
        self.assertEqual(c["A-06"]["y"], c["A-01"]["y"])

    def test_two_columns_down_up(self):
        c = cells_of({"islands": [{"name": "A", "x": 0, "y": 0, "rows": 3, "columns": 2, "order": "down-up"}]})
        self.assertLess(c["A-01"]["y"], c["A-03"]["y"])
        self.assertEqual(c["A-04"]["y"], c["A-03"]["y"])

    def test_two_columns_right_left(self):
        """横向きの島: 上の行を左から、下の行を右から"""
        c = cells_of({"islands": [{"name": "A", "x": 0, "y": 0, "rows": 3, "columns": 2, "order": "right-left"}]})
        self.assertLess(c["A-01"]["x"], c["A-03"]["x"])
        self.assertEqual(c["A-04"]["x"], c["A-03"]["x"])
        self.assertGreater(c["A-04"]["y"], c["A-03"]["y"])

    def test_one_column_start_separator_digits(self):
        c = cells_of({"cell": {"w": 10, "h": 5},
                      "islands": [{"name": "Z", "x": 0, "y": 0, "rows": 3, "columns": 1, "start": 7, "separator": "", "digits": 3}]})
        self.assertEqual(c["Z008"]["y"] - c["Z007"]["y"], 5)
        self.assertEqual(c["Z009"]["x"], c["Z007"]["x"])

    def test_two_columns_left_right(self):
        """横向きの島（left-right）: 上の行を右から、下の行を左から"""
        c = cells_of({"islands": [{"name": "A", "x": 0, "y": 0, "rows": 3, "columns": 2, "order": "left-right"}]})
        self.assertGreater(c["A-01"]["x"], c["A-03"]["x"])
        self.assertEqual(c["A-04"]["x"], c["A-03"]["x"])
        self.assertGreater(c["A-04"]["y"], c["A-03"]["y"])
        self.assertEqual(c["A-06"]["x"], c["A-01"]["x"])

    def test_one_column_orders(self):
        def first_last(order):
            c = cells_of({"islands": [{"name": "B", "x": 0, "y": 0, "rows": 3, "columns": 1, "order": order}]})
            return c["B-01"], c["B-03"]
        a, b = first_last("down")
        self.assertLess(a["y"], b["y"])
        a, b = first_last("up")
        self.assertGreater(a["y"], b["y"])
        self.assertEqual(a["x"], b["x"])
        a, b = first_last("right")
        self.assertLess(a["x"], b["x"])
        self.assertEqual(a["y"], b["y"])
        a, b = first_last("left")
        self.assertGreater(a["x"], b["x"])

    def test_unknown_order(self):
        with self.assertRaises(LayoutError):
            expand({"hall": HALL, "islands": [{"name": "A", "x": 0, "y": 0, "rows": 3, "columns": 2, "order": "zigzag"}]})


class ExpandTest(unittest.TestCase):
    def test_free_cells(self):
        c = cells_of({"cells": [{"space": "壁-01", "x": 5, "y": 5}]})
        self.assertEqual(c["壁-01"], {"space": "壁-01", "island": "壁", "number": "01", "x": 5, "y": 5, "w": 45, "h": 26})

    def test_focus_and_bounds_defaults(self):
        out = expand({"hall": HALL, "cells": [{"space": "X-01", "x": 100, "y": 100, "w": 10, "h": 10}],
                      "entrances": [{"label": "出入口", "rect": {"x": -20, "y": 0, "w": 10, "h": 10}}]})
        self.assertEqual(out["focus"], {"x": 60, "y": 60, "w": 90, "h": 90})
        self.assertEqual(out["bounds"], {"x": -50, "y": -30, "w": 1080, "h": 660})

    def test_island_labels(self):
        out = expand({"hall": HALL, "islands": [
            {"name": "A", "x": 100, "y": 100, "rows": 2, "columns": 2},
            {"name": "B", "x": 300, "y": 100, "rows": 2, "columns": 1},
            {"name": "C", "x": 500, "y": 100, "rows": 2, "columns": 2, "label": "none"},
        ]})
        self.assertEqual(out["islandLabels"], [
            {"name": "A", "x": 145, "y": 80, "anchor": "middle"},
            {"name": "B", "x": 278, "y": 126, "anchor": "start"},
        ])

    def test_duplicates_and_expected_count(self):
        with self.assertRaises(LayoutError):
            expand({"hall": HALL, "cells": [{"space": "X-01", "x": 0, "y": 0}, {"space": "X-01", "x": 50, "y": 0}]})
        with self.assertRaises(LayoutError):
            expand({"hall": HALL, "expectedSpaces": 3, "cells": [{"space": "X-01", "x": 0, "y": 0}]})


if __name__ == "__main__":
    unittest.main()
