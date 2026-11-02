"""会場配置図。events/<eventId>/layout.json（書き方は docs/layout.md）を、ページが描くだけの形に展開する。

島（islands）は番号の振り方に従って1スペースずつのセルに展開し、島の記号の位置・初期表示の範囲も決める。
番号の数え方はここだけにある（ページは展開済みのセルを描くだけ）。

展開した形（circles.json の layout。src/layout.ts の Layout 型）:
    { cells: [{space, island, number, x, y, w, h}], islandLabels: [{name, x, y, anchor}],
      hall, bounds, focus, entrances: [{label, rect}], landmarks: [{label, rect|points, kind}] }
"""
import re

DEFAULT_CELL = {"w": 45, "h": 26}
ORDERS = {1: ("down", "up", "right", "left"), 2: ("up-down", "down-up", "right-left", "left-right")}
HORIZONTAL = ("right", "left", "right-left", "left-right")
LANDMARK_KINDS = ("queue", "facility", "company", "area", "other-event")
SPACE_PARTS = re.compile(r"^(.*?)[-‐]?(\d+)$")


class LayoutError(ValueError):
    pass


def _island_cells(isl, cw, ch):
    name = isl.get("name", "?")
    cols, n = isl.get("columns"), isl.get("rows")
    if cols not in (1, 2) or not isinstance(n, int) or n < 1:
        raise LayoutError(f"島 {name}: columns は 1 か 2、rows は 1 以上の整数にしてください")
    order = isl.get("order", ORDERS[cols][0])
    if order not in ORDERS[cols]:
        raise LayoutError(f"島 {name}: {cols}列の order は {' / '.join(ORDERS[cols])} のどれかです: {order}")
    start, sep, digits = isl.get("start", 1), isl.get("separator", "-"), isl.get("digits", 2)
    x0, y0 = isl["x"], isl["y"]

    def make(i, col, row):
        number = str(start + i).zfill(digits)
        return {"space": f"{name}{sep}{number}", "island": name, "number": number,
                "x": x0 + col * cw, "y": y0 + row * ch, "w": cw, "h": ch}

    if cols == 1:
        pos = {"down": lambda i: (0, i), "up": lambda i: (0, n - 1 - i),
               "right": lambda i: (i, 0), "left": lambda i: (n - 1 - i, 0)}[order]
        return [make(i, *pos(i)) for i in range(n)]
    first = {"up-down": lambda i: (0, n - 1 - i), "down-up": lambda i: (0, i),
             "right-left": lambda i: (i, 0), "left-right": lambda i: (n - 1 - i, 0)}[order]
    second = {"up-down": lambda i: (1, i), "down-up": lambda i: (1, n - 1 - i),
              "right-left": lambda i: (n - 1 - i, 1), "left-right": lambda i: (i, 1)}[order]
    return [make(i, *first(i)) for i in range(n)] + [make(n + i, *second(i)) for i in range(n)]


def _island_label(isl, cw, ch):
    label = isl.get("label", "auto")
    name = isl.get("name", "?")
    if label == "none":
        return None
    if label != "auto":
        return {"name": name, "x": label["x"], "y": label["y"], "anchor": label.get("anchor", "middle")}
    horizontal = isl.get("order", "") in HORIZONTAL
    # スペース番号に重ならないよう、縦の2列の島は上、それ以外は左にラベルを置く
    if isl.get("columns") == 2 and not horizontal:
        return {"name": name, "x": isl["x"] + cw, "y": isl["y"] - 20, "anchor": "middle"}
    return {"name": name, "x": isl["x"] - 22, "y": isl["y"] + ch * (0.7 if horizontal else 1), "anchor": "start"}


def bounds_of(rects, pad=0):
    x = min(r["x"] for r in rects) - pad
    y = min(r["y"] for r in rects) - pad
    x2 = max(r["x"] + r["w"] for r in rects) + pad
    y2 = max(r["y"] + r["h"] for r in rects) + pad
    return {"x": x, "y": y, "w": x2 - x, "h": y2 - y}


def expand(spec):
    """layout.json の内容を展開する。間違いがあれば LayoutError。"""
    if not isinstance(spec.get("hall"), dict):
        raise LayoutError("hall（ホールの矩形）がありません")
    cell = spec.get("cell") or DEFAULT_CELL
    cw, ch = cell["w"], cell["h"]
    islands = spec.get("islands", [])

    cells = [c for isl in islands for c in _island_cells(isl, cw, ch)]
    for c in spec.get("cells", []):
        if not c.get("space"):
            raise LayoutError(f"cells の要素に space がありません: {c}")
        m = SPACE_PARTS.match(c["space"])
        cells.append({"w": cw, "h": ch, "island": c.get("island", m.group(1) if m else ""),
                      "number": c.get("number", m.group(2) if m else c["space"]), **c})

    seen = set()
    for c in cells:
        if c["space"] in seen:
            raise LayoutError(f"スペース {c['space']} が重複しています")
        seen.add(c["space"])
    expected = spec.get("expectedSpaces")
    # 公式配置図のスペース数を書いておくと、描き起こしの数え間違いに気づける
    if expected is not None and expected != len(cells):
        raise LayoutError(f"スペース数 {len(cells)} が expectedSpaces {expected} と一致しません")
    for lm in spec.get("landmarks", []):
        if lm.get("kind") not in LANDMARK_KINDS:
            raise LayoutError(f"landmarks の {lm.get('label')}: kind は {' / '.join(LANDMARK_KINDS)} のどれかです")
        if not lm.get("rect") and not lm.get("points"):
            raise LayoutError(f"landmarks の {lm.get('label')}: rect か points が必要です")

    entrances = spec.get("entrances", [])
    return {
        "cells": cells,
        "islandLabels": [lb for lb in (_island_label(isl, cw, ch) for isl in islands) if lb],
        "hall": spec["hall"],
        "bounds": spec.get("bounds") or bounds_of([spec["hall"], *(e["rect"] for e in entrances)], 30),
        "focus": spec.get("focus") or (bounds_of(cells, 40) if cells else spec["hall"]),
        "entrances": entrances,
        "landmarks": spec.get("landmarks", []),
    }
