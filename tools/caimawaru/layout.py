"""会場配置図。events/<eventId>/layout.json（書き方は docs/layout.md）を、ページが描くだけの形に展開する。

島（islands）は番号の振り方に従って1スペースずつのセルに展開し、島の記号の位置・初期表示の範囲も決める。
番号の数え方はここだけにある（ページは展開済みのセルを描くだけ）。

展開した形（circles.json の layout。src/layout.ts の Layout 型）:
    { cells: [{space, island, number, x, y, w, h}], islandLabels: [{name, x, y, anchor}],
      hall, bounds, focus, entrances: [{label, rect}], landmarks: [{label, rect|points, kind}] }
"""
import re

DEFAULT_CELL = {"w": 45, "h": 26}
# 島の列数ごとの order（番号の振り方）。先頭が既定
ORDERS = {1: ("down", "up", "right", "left"), 2: ("up-down", "down-up", "right-left", "left-right")}
HORIZONTAL = ("right", "left", "right-left", "left-right")
LANDMARK_KINDS = ("queue", "facility", "company", "area", "other-event")
SPACE_PARTS = re.compile(r"^(.*?)[-‐]?(\d+)$")  # 「A-01」→ 島「A」と番号「01」

# 島の記号を島から離す量（スペース番号に重ならないように）
LABEL_ABOVE_GAP = 20
LABEL_LEFT_GAP = 22
LABEL_BASELINE = 0.7  # 横に並ぶ島で、記号の高さをセルの何割の位置にするか
# 全体の範囲（bounds）と初期表示の範囲（focus）の余白
BOUNDS_PADDING = 30
FOCUS_PADDING = 40


class LayoutError(ValueError):
    pass


# 番号 i（0 から）のスペースを置く位置（列, 行）。rows は島の1列のスペース数
SINGLE_COLUMN_POSITIONS = {
    "down": lambda i, rows: (0, i),
    "up": lambda i, rows: (0, rows - 1 - i),
    "right": lambda i, rows: (i, 0),
    "left": lambda i, rows: (rows - 1 - i, 0),
}
# 2列の島は1列目を数えてから、折り返して2列目を数える
FIRST_COLUMN_POSITIONS = {
    "up-down": lambda i, rows: (0, rows - 1 - i),
    "down-up": lambda i, rows: (0, i),
    "right-left": lambda i, rows: (i, 0),
    "left-right": lambda i, rows: (rows - 1 - i, 0),
}
SECOND_COLUMN_POSITIONS = {
    "up-down": lambda i, rows: (1, i),
    "down-up": lambda i, rows: (1, rows - 1 - i),
    "right-left": lambda i, rows: (rows - 1 - i, 1),
    "left-right": lambda i, rows: (i, 1),
}


def _island_positions(columns, order, rows):
    """島のスペースを番号の順に並べた位置（列, 行）のリスト。"""
    if columns == 1:
        return [SINGLE_COLUMN_POSITIONS[order](i, rows) for i in range(rows)]
    return ([FIRST_COLUMN_POSITIONS[order](i, rows) for i in range(rows)]
            + [SECOND_COLUMN_POSITIONS[order](i, rows) for i in range(rows)])


def _island_cells(island, cell_w, cell_h):
    name = island.get("name", "?")
    columns, rows = island.get("columns"), island.get("rows")
    if columns not in (1, 2) or not isinstance(rows, int) or rows < 1:
        raise LayoutError(f"島 {name}: columns は 1 か 2、rows は 1 以上の整数にしてください")
    order = island.get("order", ORDERS[columns][0])
    if order not in ORDERS[columns]:
        raise LayoutError(f"島 {name}: {columns}列の order は {' / '.join(ORDERS[columns])} のどれかです: {order}")
    first_number, separator, digits = island.get("start", 1), island.get("separator", "-"), island.get("digits", 2)
    left, top = island["x"], island["y"]

    cells = []
    for index, (column, row) in enumerate(_island_positions(columns, order, rows)):
        number = str(first_number + index).zfill(digits)
        cells.append({"space": f"{name}{separator}{number}", "island": name, "number": number,
                      "x": left + column * cell_w, "y": top + row * cell_h, "w": cell_w, "h": cell_h})
    return cells


def _island_label(island, cell_w, cell_h):
    label = island.get("label", "auto")
    name = island.get("name", "?")
    if label == "none":
        return None
    if label != "auto":
        return {"name": name, "x": label["x"], "y": label["y"], "anchor": label.get("anchor", "middle")}
    is_horizontal = island.get("order", "") in HORIZONTAL
    # スペース番号に重ならないよう、縦の2列の島は上、それ以外は左にラベルを置く
    if island.get("columns") == 2 and not is_horizontal:
        return {"name": name, "x": island["x"] + cell_w, "y": island["y"] - LABEL_ABOVE_GAP, "anchor": "middle"}
    baseline = LABEL_BASELINE if is_horizontal else 1
    return {"name": name, "x": island["x"] - LABEL_LEFT_GAP, "y": island["y"] + cell_h * baseline, "anchor": "start"}


def _free_cell(cell, cell_w, cell_h):
    """cells に直接書いたセル。island・number を省くとスペース番号から分ける。"""
    if not cell.get("space"):
        raise LayoutError(f"cells の要素に space がありません: {cell}")
    parts = SPACE_PARTS.match(cell["space"])
    island = parts.group(1) if parts else ""
    number = parts.group(2) if parts else cell["space"]
    return {"w": cell_w, "h": cell_h, "island": cell.get("island", island), "number": cell.get("number", number), **cell}


def bounds_of(rects, pad=0):
    left = min(rect["x"] for rect in rects) - pad
    top = min(rect["y"] for rect in rects) - pad
    right = max(rect["x"] + rect["w"] for rect in rects) + pad
    bottom = max(rect["y"] + rect["h"] for rect in rects) + pad
    return {"x": left, "y": top, "w": right - left, "h": bottom - top}


def _check_cells(spec, cells):
    seen = set()
    for cell in cells:
        if cell["space"] in seen:
            raise LayoutError(f"スペース {cell['space']} が重複しています")
        seen.add(cell["space"])
    expected = spec.get("expectedSpaces")
    # 公式配置図のスペース数を書いておくと、描き起こしの数え間違いに気づける
    if expected is not None and expected != len(cells):
        raise LayoutError(f"スペース数 {len(cells)} が expectedSpaces {expected} と一致しません")


def _check_landmarks(landmarks):
    for landmark in landmarks:
        if landmark.get("kind") not in LANDMARK_KINDS:
            raise LayoutError(f"landmarks の {landmark.get('label')}: kind は {' / '.join(LANDMARK_KINDS)} のどれかです")
        if not landmark.get("rect") and not landmark.get("points"):
            raise LayoutError(f"landmarks の {landmark.get('label')}: rect か points が必要です")


def expand(spec):
    """layout.json の内容を展開する。間違いがあれば LayoutError。"""
    if not isinstance(spec.get("hall"), dict):
        raise LayoutError("hall（ホールの矩形）がありません")
    cell = spec.get("cell") or DEFAULT_CELL
    cell_w, cell_h = cell["w"], cell["h"]
    islands = spec.get("islands", [])

    cells = [island_cell for island in islands for island_cell in _island_cells(island, cell_w, cell_h)]
    cells += [_free_cell(free_cell, cell_w, cell_h) for free_cell in spec.get("cells", [])]
    _check_cells(spec, cells)
    _check_landmarks(spec.get("landmarks", []))

    hall = spec["hall"]
    entrances = spec.get("entrances", [])
    labels = (_island_label(island, cell_w, cell_h) for island in islands)
    return {
        "cells": cells,
        "islandLabels": [label for label in labels if label],
        "hall": hall,
        "bounds": spec.get("bounds") or bounds_of([hall, *(entrance["rect"] for entrance in entrances)], BOUNDS_PADDING),
        "focus": spec.get("focus") or (bounds_of(cells, FOCUS_PADDING) if cells else hall),
        "entrances": entrances,
        "landmarks": spec.get("landmarks", []),
    }
