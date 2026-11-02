"""X の URL の規則（お品書きの照合・検証で共通）。X のページは読まず、URL の文字列だけで判断する。

menu（照合）・build（検証と circles.json の生成）・edit（編集コマンド）がこのモジュールを使う。
"""
import re

# 照合の規則はエディタ（src/editor/menuMatch.ts）と同じ。tools/tests/fixtures/x_urls.json の例を両方のテストが確かめる。
# re.ASCII: 大文字小文字を区別しない照合で、[A-Za-z] が K（ケルビン記号）などに当たらないようにする（JavaScript と同じ）
X_POST = re.compile(
    r"https?://(?:www\.|mobile\.)?(?:x|twitter)\.com/([A-Za-z0-9_]{1,15})/status/([0-9]+)", re.IGNORECASE | re.ASCII
)
X_PROFILE = re.compile(
    r"https?://(?:www\.|mobile\.)?(?:x|twitter)\.com/([A-Za-z0-9_]{1,15})/?(?:[?#].*)?", re.IGNORECASE | re.ASCII | re.DOTALL
)
# X のページ（投稿でないものを menus.csv に登録していないかの確認に使う）
X_PAGE = re.compile(r"https?://(?:www\.|mobile\.)?(?:x|twitter)\.com/", re.IGNORECASE | re.ASCII)
# プロフィールの URL の形でも、アカウントではない X のページ
NOT_ACCOUNTS = frozenset({
    "home", "search", "explore", "i", "intent", "share", "hashtag", "messages", "notifications", "settings",
    "compose", "login", "signup", "tos", "privacy",
})


def normalize_url(url):
    """Xの投稿URLは https://x.com/<ID>/status/<番号> の形にそろえ、追跡用パラメータを落とす。

    (URL, 投稿したアカウントの ID) を返す。X の投稿でなければ ID は None。前後の空白は除く。
    """
    url = url.strip()
    m = X_POST.match(url)
    if m:
        return f"https://x.com/{m.group(1)}/status/{m.group(2)}", m.group(1)
    return url, None


def profile_handle(url):
    """X のプロフィールの URL ならアカウントの ID（小文字）。投稿・検索などのページは None。

    www.・mobile.・twitter.com、末尾の「/」、クエリ（?lang=ja）・「#」以降は受け付ける。
    """
    m = X_PROFILE.fullmatch(url.strip())
    return m.group(1).lower() if m and m.group(1).lower() not in NOT_ACCOUNTS else None


def x_handle(circle):
    """サークルの x 列のアカウントの ID（小文字）。"""
    return profile_handle(circle.get("x") or "")


def is_x_page(url):
    """X（x.com・twitter.com）のページの URL か。"""
    return bool(X_PAGE.match(url.strip()))
