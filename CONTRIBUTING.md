# コードを直す人へ

CAIMawaru は、イベントデータを扱う Python の CLI（`tools/caimawaru/`）と、ページ・エディタ（`src/`。Vite + React + TypeScript）の
2つでできています。互いを呼び出さず、境界はファイル（`circles.json`）だけです。依存関係とファイルの読み書きは [docs/architecture.md](docs/architecture.md)。

## 開発の準備

[getting-started.md の「用意する」](docs/getting-started.md#0-用意する)と同じです（uv・Node.js と pnpm）。`events/example/`（架空）で動かして確かめます。

## 確かめる

CI（`.github/workflows/ci.yml`。Linux・macOS・Windows）と同じものを手元で通してください。

```sh
uv run python -m unittest discover -s tools/tests   # CLI（配置図の展開・取り込み・編集・CLI）
uv run caimawaru check                               # 全イベントのイベントデータの検証
pnpm test                                            # ページとエディタ（検索・保存形式・配置図の操作、circles.json の形、CSV の読み書き）
pnpm build example                                   # 型チェックとビルド（変更に関わるイベントも）
pnpm build:editor                                    # エディタ（src/editor/）を変えたとき
```

- `events/example/public/data/circles.json` はリポジトリに入っていて、CI は `uv run caimawaru data example` で作り直したものと同じかを確かめる
- 画面の変更は、スマホ幅（〜400px）と PC 幅（900px 以上）の両方で見る。横にはみ出しやすい（グリッドは `minmax(0,1fr)`、見出しは `min-width:0`）。入力欄は 16px（iOS の自動拡大対策）

## コードの約束

- **イベントに依存する情報はコードに書かない。** イベント名・日付・会場・URL・色・配置図・出力先などは `events/<eventId>/` に置き、
  `src/`・`tools/`・`vite.config.ts`・`index.html` はどのイベントでも同じにする。新しい種類の情報が要るなら event.json のキーを足し、
  `tools/caimawaru/build.py` で検証し、[docs/event-data.md](docs/event-data.md) に書く
- 実在のイベントのデータ・サークル名・アカウント・URL を、コード・テスト・ドキュメント・コミットに書かない（`events/example/` は架空）
- 主催の元データの形式ごとの事情は、インポーター（`tools/caimawaru/importers/`）に閉じ込める。新しい形式は架空のデータでテストを書く（[docs/importers.md](docs/importers.md)）。
  リポジトリの外の Python を読み込んで実行する仕組みは作らない
- CLI とページは互いを起動しない。外部のコマンドも起動しない（`subprocess`・`child_process` を使わず、Python は標準ライブラリだけ）
- `circles.json` の形（`src/types.ts` の `CircleData`）や CSV の列・書式を変えるときは、CLI とページ（エディタ）の両側とテストを直す。
  2か所に同じ規則を持っているものは [architecture.md の「同じ規則を2か所に持っているもの」](docs/architecture.md#同じ規則を2か所に持っているもの)
- エディタはブラウザの中だけでファイルを書く（ファイルを書くサーバや Node のスクリプトを作らない）
- 配置図の番号の振り方・島の記号の位置は `tools/caimawaru/layout.py` だけで決める（ページは展開済みのセルを描く）

## 構成

| パス | 言語 | 役割 |
|---|---|---|
| `events/` | — | イベントごとのイベントデータと元データ（リポジトリには `example/` だけ） |
| `src/` | TS | ページ本体（React）。イベント固有の値は持たない |
| `src/types.ts` | TS | `circles.json` の形（CLI との取り決め） |
| `src/layout.ts` | TS | 配置図の型（展開済みのセルを描くだけ） |
| `src/filter.ts` | TS | 検索・絞り込み・並べ替え |
| `src/useMine.ts` | TS | 閲覧者の ★・タグ・メモ（localStorage のみに保存） |
| `src/components/SpaceMap.tsx` | TS | 配置図の描画とタッチ操作 |
| `vite.config.ts` | TS | ページのビルド設定。引数の eventId から `event.json` を読み、出力先などを決める |
| `src/editor/` | TS | イベントデータのエディタ（ブラウザで event.json・data/*.csv を編集して書き戻す） |
| `vite.editor.config.ts` | TS | エディタのビルド設定（イベントに依存しない） |
| `tools/caimawaru/cli.py` | Python | `caimawaru` コマンドの入り口 |
| `tools/caimawaru/project.py` | Python | イベントのフォルダ・CSV の読み書き・サークルの id |
| `tools/caimawaru/build.py` | Python | イベントデータの検証と `circles.json` の生成 |
| `tools/caimawaru/layout.py` | Python | `layout.json` の展開（島の番号の振り方・記号の位置・表示範囲） |
| `tools/caimawaru/importing.py` | Python | 取り込みの共通処理（正規化・既存データとの合流） |
| `tools/caimawaru/importers/` | Python | 元データの形式ごとのインポーター（sockbase・csv・json） |
| `tools/caimawaru/menu.py` | Python | お品書き URL の登録 |
| `tools/caimawaru/xurl.py` | Python | X の URL の規則（照合・検証で共通。エディタの `menuMatch.ts` と同じ） |
| `tools/caimawaru/edit.py` | Python | イベントデータを確かめる・編集する（circle・menus・config） |
| `tools/caimawaru/console.py` | Python | 警告の表示と `--dry-run` の文言 |
| `tools/caimawaru/new_event.py` | Python | イベントの雛形作成 |
| `tools/tests/` | Python | CLI・配置図の展開・取り込み・編集のテスト |

エージェント向けの作業ルールは [CLAUDE.md](CLAUDE.md)。
