"""Sockbase（https://list.sockbase.net/）の公式サークルリスト。

元データは、ブラウザで描画済みの HTML（JavaScript で描画されるため）。
ページ内の astro-island の props を読む。サークル一覧（SearchableCircleCardRack の circles）は配置図の有無に
かかわらず載っているのでそれを優先し、なければ配置図（SpaceMapViewer の spaces）から読む。
Sockbase 側の変更で壊れることがある。

event.json:
    { "type": "sockbase", "url": "https://list.sockbase.net/circle-lists/<id>" }
"""
import html
import json
import re
import shutil
import subprocess
from pathlib import Path

DESCRIPTION = "Sockbase の公式サークルリスト（描画済み HTML）"
DEFAULT_FILE = "sources/sockbase.html"


def _astro(v):
    # Astro の props シリアライズ形式 [型, 値]（0=値, 1=配列）を素の値に戻す
    if isinstance(v, list) and len(v) == 2 and isinstance(v[0], int):
        t, x = v
        return [_astro(i) for i in x] if t == 1 else _astro(x)
    if isinstance(v, dict):
        return {k: _astro(x) for k, x in v.items()}
    if isinstance(v, list):
        return [_astro(i) for i in v]
    return v


# サークルの一覧が入っている部品と、その props のキー（先にあるものを優先）
COMPONENTS = (("SearchableCircleCardRack", "circles"), ("SpaceMapViewer", "spaces"))
ISLAND = re.compile(r'<astro-island[^>]*component-url="[^"]*/([A-Za-z]+)\.[^"]*"[^>]*props="([^"]*)"')


def _circles(src):
    islands = {name: props for name, props in ISLAND.findall(src)}
    for name, key in COMPONENTS:
        if name in islands:
            records = _astro(json.loads(html.unescape(islands[name]))).get(key)
            if isinstance(records, list):
                return records
    raise ValueError("サークルデータが見つかりません。描画済みの HTML（--dump-dom の出力）を指定してください")


def _text(d, key):
    """項目がない・null でも空文字として読む。"""
    v = (d or {}).get(key)
    return v.strip() if isinstance(v, str) else ""


def read(source, path):
    rows = []
    for s in _circles(Path(path).read_text(encoding="utf-8")):
        links = s.get("links") or {}
        space = _text(s, "spaceName")
        menu = _text(links, "menuURL")
        rows.append({
            "id": space.replace(",", "-").lower(),
            "space": space,
            "event": _text(s, "eventName"),
            "name": _text(s, "circleName"),
            "kana": _text(s, "circleNameYomi"),
            "penNames": _text(s, "penName"),
            "adult": bool(s.get("hasAdult")),
            "x": _text(links, "twitterScreenName"),     # ID だけ。共通処理で URL にする
            "pixiv": _text(links, "pixivUserId"),       # 数字だけ。共通処理で URL にする
            "web": _text(links, "websiteURL"),
            "menus": [menu] if menu else [],
        })
    # サークルカット画像は取り込まない（署名付き URL で期限切れになるうえ、転載になる）
    return rows


def fetch(source, path):
    """headless Chrome で公式リストを描画し、HTML を保存する。"""
    url = source.get("url", "")
    if not url.startswith("https://list.sockbase.net/"):
        raise ValueError(f"Sockbase の公式リストの URL ではありません: {url!r}")
    chrome = next((c for c in ("google-chrome", "chromium", "chromium-browser") if shutil.which(c)), None)
    if not chrome:
        raise RuntimeError("Google Chrome（または Chromium）が見つかりません。ブラウザで描画済みの HTML を保存して file に置いてください")
    out = subprocess.run(
        [chrome, "--headless=new", "--disable-gpu", "--virtual-time-budget=15000", "--dump-dom", url],
        check=True, capture_output=True, text=True, timeout=120,
    ).stdout
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text(out, encoding="utf-8")
