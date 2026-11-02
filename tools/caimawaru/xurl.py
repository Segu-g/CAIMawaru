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
# URL をそろえるときの X の正規の場所（twitter.com・www.・mobile. はこれに置き換える）
X_ORIGIN = "https://x.com"
# X のページ（投稿でないものを menus.csv に登録していないかの確認に使う）
X_PAGE = re.compile(r"https?://(?:www\.|mobile\.)?(?:x|twitter)\.com/", re.IGNORECASE | re.ASCII)
# URL の前後から除く空白。Python の str.strip() と JavaScript の trim() は対象が少し違う（U+FEFF・\x1c〜\x1f・U+0085）ので、
# 両方が除く文字をまとめて明示する（menuMatch.ts の TRIM と同じ並び）
TRIM = (
    "\t\n\x0b\x0c\r\x1c\x1d\x1e\x1f \x85\xa0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006"
    "\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff"
)
# プロフィールの URL の形でも、アカウントではない X のページ
NOT_ACCOUNTS = frozenset({
    "home", "search", "explore", "i", "intent", "share", "hashtag", "messages", "notifications", "settings",
    "compose", "login", "signup", "tos", "privacy",
})


def trim(url):
    """前後の空白（TRIM の文字）を除く。"""
    return url.strip(TRIM)


def normalize_url(url):
    """Xの投稿URLは https://x.com/<ID>/status/<番号> の形にそろえ、追跡用パラメータを落とす。

    (URL, 投稿したアカウントの ID) を返す。X の投稿でなければ ID は None。前後の空白（TRIM）は除く。
    """
    url = trim(url)
    post = X_POST.match(url)
    if post:
        handle, post_id = post.groups()
        return f"{X_ORIGIN}/{handle}/status/{post_id}", handle
    return url, None


def profile_handle(url):
    """X のプロフィールの URL ならアカウントの ID（小文字）。投稿・検索などのページは None。

    www.・mobile.・twitter.com、末尾の「/」、クエリ（?lang=ja）・「#」以降は受け付ける。
    """
    profile = X_PROFILE.fullmatch(trim(url))
    if not profile:
        return None
    handle = profile.group(1).lower()
    return handle if handle not in NOT_ACCOUNTS else None


def x_handle(circle):
    """サークルの x 列のアカウントの ID（小文字）。"""
    return profile_handle(circle.get("x") or "")


def is_x_page(url):
    """X（x.com・twitter.com）のページの URL か。"""
    return bool(X_PAGE.match(trim(url)))
