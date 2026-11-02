# CAIMawaru

**C**ircle **A**rea **I**tinerary — 会場のサークルスペースを巡って「買い回る」ためのツール。

同人誌即売会の **サークルリスト＋会場配置図** のページを、イベントごとの設定ファイルと CSV から作る静的サイトです。
スマホで当日会場を回ることを前提に、配置図・検索・★／タグ／購入済みのチェック・お品書きリンクをまとめて表示します（[ページの機能](docs/viewer.md)）。

- イベントの情報はすべて `events/<eventId>/` の設定ファイルと CSV に置き、コードはどのイベントでも同じ
- サークルとお品書きは、ブラウザのエディタ（GUI）かコマンドで登録する。主催の公式リスト（Sockbase・配布 CSV など）も取り込める
- 出力は相対パスの静的ファイルなので、GitHub Pages・nginx などどこにでも置ける
- Claude Code などのエージェントに作業を手伝わせることを想定している（作業ルールの [CLAUDE.md](CLAUDE.md)、差分を確かめてから書く編集コマンド。[はじめに の「エージェントに手伝ってもらう」](docs/getting-started.md#エージェントに手伝ってもらう)）

## 読む人別の案内

| こんな人 | 読むもの |
|---|---|
| イベントのサークルリストのページを作りたい（主催・スタッフ） | [はじめに](docs/getting-started.md) → [エディタ](docs/editor.md) |
| 公式リストの取り込み・コマンドでの編集・公開をする（運用者・エージェント） | [はじめに](docs/getting-started.md) → [コマンド](docs/cli.md)・[取り込み](docs/importers.md)・[配置図](docs/layout.md) |
| サークル情報・お品書きの集め方と守ること | [はじめに の「サークルとお品書きを集める」](docs/getting-started.md#4-サークルとお品書きを集める) |
| コードを直したい（コントリビューター） | [CONTRIBUTING.md](CONTRIBUTING.md) → [構成と依存関係](docs/architecture.md) |
| 仕組み・データの仕様を詳しく知りたい | [イベントデータの仕様](docs/event-data.md)・[構成と依存関係](docs/architecture.md)・[取り込み](docs/importers.md)・[配置図](docs/layout.md)・[ページの機能](docs/viewer.md) |
| エージェント（Claude Code など） | [CLAUDE.md](CLAUDE.md) |

## 試す

[uv](https://docs.astral.sh/uv/) と Node.js・pnpm を入れて（[はじめに の「用意する」](docs/getting-started.md#0-用意する)）、架空のサンプルイベント `events/example/` を表示します。

```sh
uv run caimawaru data example     # イベントデータを検証し、ページが読む circles.json を作る（Python）
pnpm install
pnpm dev example                  # ページの開発サーバ（Node）
```

## ライセンス

MIT License（[LICENSE](LICENSE)）。各イベントのサークル情報・配置図の権利は、それぞれの主催・サークルにあります。
