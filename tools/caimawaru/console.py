"""コマンドの出力で共通に使う文言と表示（ファイルは扱わない）。"""
import sys

DRY_RUN_NOTICE = "（--dry-run のため書き込みません）"


def print_warnings(messages):
    for message in messages:
        print(f"警告: {message}", file=sys.stderr)
