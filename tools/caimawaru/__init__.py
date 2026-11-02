"""CAIMawaru のイベントデータを扱う Python ツール（CLI: caimawaru）。

    uv run caimawaru --help

ページ（Vite + React）とはプロセスとして呼び合わない。境界は events/<eventId>/public/data/circles.json だけで、
これを書くのがこのツール（caimawaru data）、読むのがページ。依存関係は docs/architecture.md。
"""
