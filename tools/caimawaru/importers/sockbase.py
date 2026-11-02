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
    raise ValueError("サークルデータが見つかりません。Sockbase の公式リストのページの HTML か確かめてください")


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


HOST = "list.sockbase.net"


def _is_official(url):
    u = urllib.parse.urlsplit(url)
    return u.scheme == "https" and u.hostname == HOST


def fetch(source, path):
    """公式リストのページの HTML を取得して保存する（標準ライブラリの urllib。外部のコマンドは起動しない）。"""
    url = source.get("url", "")
    if not _is_official(url):
        raise ValueError(f"Sockbase の公式リストの URL ではありません: {url!r}")
    req = urllib.request.Request(url, headers={"User-Agent": "caimawaru"})
    with urllib.request.urlopen(req, timeout=60) as res:
        # リダイレクトで別のサイトに移っていないこと
        if not _is_official(res.geturl()):
            raise ValueError(f"Sockbase 以外のページに移動しました: {res.geturl()!r}")
        body = res.read().decode(res.headers.get_content_charset() or "utf-8")
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text(body, encoding="utf-8")
