"""Sockbase（https://list.sockbase.net/）の公式サークルリスト。

元データは、公式リストのページの HTML。サークルの情報はページ内の astro-island の props に入っていて、
サーバが返す HTML にそのまま含まれる（ブラウザで描画しなくてよい）。サークル一覧（SearchableCircleCardRack の circles）は配置図の有無に
かかわらず載っているのでそれを優先し、なければ配置図（SpaceMapViewer の spaces）から読む。
Sockbase 側の変更で壊れることがある。

event.json:
    { "type": "sockbase", "url": "https://list.sockbase.net/circle-lists/<id>" }
"""
import html
import json
import re
import urllib.parse
import urllib.request
from pathlib import Path

DESCRIPTION = "Sockbase の公式サークルリスト（ページの HTML）"
DEFAULT_FILE = "sources/sockbase.html"


ASTRO_ARRAY = 1  # Astro の props の [型, 値] で、値が配列であることを表す型


def _astro(value):
    # Astro の props シリアライズ形式 [型, 値]（0=値, 1=配列）を素の値に戻す
    if isinstance(value, list) and len(value) == 2 and isinstance(value[0], int):
        kind, inner = value
        return [_astro(item) for item in inner] if kind == ASTRO_ARRAY else _astro(inner)
    if isinstance(value, dict):
        return {key: _astro(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_astro(item) for item in value]
    return value


# サークルの一覧が入っている部品と、その props のキー（先にあるものを優先）
COMPONENTS = (("SearchableCircleCardRack", "circles"), ("SpaceMapViewer", "spaces"))
ISLAND = re.compile(r'<astro-island[^>]*component-url="[^"]*/([A-Za-z]+)\.[^"]*"[^>]*props="([^"]*)"')


def _circles(page_html):
    islands = {name: props for name, props in ISLAND.findall(page_html)}
    for name, key in COMPONENTS:
        if name in islands:
            records = _astro(json.loads(html.unescape(islands[name]))).get(key)
            if isinstance(records, list):
                return records
    raise ValueError("サークルデータが見つかりません。Sockbase の公式リストのページの HTML か確かめてください")


def _text(record, key):
    """項目がない・null でも空文字として読む。"""
    value = (record or {}).get(key)
    return value.strip() if isinstance(value, str) else ""


def read(source, path):
    rows = []
    for circle in _circles(Path(path).read_text(encoding="utf-8")):
        links = circle.get("links") or {}
        space = _text(circle, "spaceName")
        menu = _text(links, "menuURL")
        rows.append({
            "id": space.replace(",", "-").lower(),
            "space": space,
            "event": _text(circle, "eventName"),
            "name": _text(circle, "circleName"),
            "kana": _text(circle, "circleNameYomi"),
            "penNames": _text(circle, "penName"),
            "adult": bool(circle.get("hasAdult")),
            "x": _text(links, "twitterScreenName"),     # ID だけ。共通処理で URL にする
            "pixiv": _text(links, "pixivUserId"),       # 数字だけ。共通処理で URL にする
            "web": _text(links, "websiteURL"),
            "menus": [menu] if menu else [],
        })
    # サークルカット画像は取り込まない（署名付き URL で期限切れになるうえ、転載になる）
    return rows


HOST = "list.sockbase.net"
FETCH_TIMEOUT_SECONDS = 60


def _is_official(url):
    parts = urllib.parse.urlsplit(url)
    return parts.scheme == "https" and parts.hostname == HOST


def fetch(source, path):
    """公式リストのページの HTML を取得して保存する（標準ライブラリの urllib。外部のコマンドは起動しない）。"""
    url = source.get("url", "")
    if not _is_official(url):
        raise ValueError(f"Sockbase の公式リストの URL ではありません: {url!r}")
    request = urllib.request.Request(url, headers={"User-Agent": "caimawaru"})
    with urllib.request.urlopen(request, timeout=FETCH_TIMEOUT_SECONDS) as response:
        # リダイレクトで別のサイトに移っていないこと
        if not _is_official(response.geturl()):
            raise ValueError(f"Sockbase 以外のページに移動しました: {response.geturl()!r}")
        body = response.read().decode(response.headers.get_content_charset() or "utf-8")
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text(body, encoding="utf-8")
