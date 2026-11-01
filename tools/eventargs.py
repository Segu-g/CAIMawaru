"""引数からイベント（eventId）を取り出す。tools/ のツールと scripts/lib.mjs で同じ規則にしてある。

    1. --event <eventId>（--event=<eventId>）
    2. 最初の引数がイベントのフォルダ名（events/ の下）なら、それ

両方あって値が違えばエラー。環境変数では指定しない（シェルに残った値で別のイベントを書き換えないように）。
"""
from pathlib import Path

EVENTS_DIR = Path(__file__).resolve().parent.parent / "events"


def known_events():
    return sorted(p.parent.name for p in EVENTS_DIR.glob("*/event.json"))


def take_event(argv, known=None):
    """argv からイベントの指定を取り除き、(eventId, 残りの引数) を返す。指定がなければ eventId は ""。

    --event と最初の引数の両方でイベントが指定され、値が違うときは ValueError。
    """
    known = known_events() if known is None else known
    rest = list(argv)
    option = None
    for i, arg in enumerate(rest):
        if arg == "--event":
            if i + 1 >= len(rest):
                raise ValueError("--event のあとに eventId を指定してください")
            option = rest[i + 1]
            del rest[i:i + 2]
            break
        if arg.startswith("--event="):
            option = arg.split("=", 1)[1]
            del rest[i]
            break
    positional = rest[0] if rest and rest[0] in known else None
    if option is not None and positional is not None and option != positional:
        raise ValueError(f"イベントが2つ指定されています（--event {option} と {positional}）")
    if positional is not None:
        rest = rest[1:]
    return (option if option is not None else positional or ""), rest
