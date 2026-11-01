# 構成と依存関係

CAIMawaru は2つの独立したツールでできています。**互いを呼び出さず、境界はファイルだけ**です。

| | イベントデータの CLI | ページ |
|---|---|---|
| 言語・実行環境 | Python 3.10+（標準ライブラリのみ） | TypeScript / Node（Vite + React） |
| 入り口 | `uv run caimawaru <command>`（`pyproject.toml` の `[project.scripts]`） | `pnpm <command>`（`package.json` の `scripts`） |
| コード | `tools/caimawaru/` | `src/`・`scripts/`・`vite.config.ts` |
| テスト | `tools/tests/`（`uv run python -m unittest discover -s tools/tests`） | `*.test.ts`（`pnpm test`） |
| 役割 | イベントデータの検証・生成・取り込み・編集 | ページの開発・ビルド |

## ファイルを介した依存

```
人・エージェント ──直接編集──▶ events/<eventId>/event.json ─┬──────────────▶ ページ（vite.config.ts: storeId・title・outDir）
                               events/<eventId>/layout.json  │
                               events/<eventId>/data/*.csv   │
                                        ▲                    │
主催の元データ ──▶ sources/ ──caimawaru import──┘                    │
                                                             ▼
                               caimawaru data ──書く──▶ events/<eventId>/public/data/circles.json ──読む──▶ ページ
```

| ファイル | 書く | 読む |
|---|---|---|
| `event.json` | 人・エージェント（`caimawaru new-event` が雛形） | CLI（全コマンド）、ページ（`vite.config.ts`・`scripts/build-all.mjs`: `storeId`・`title`・`outDir` だけ） |
| `layout.json` | 人・エージェント | CLI だけ（展開して `circles.json` に入れる） |
| `data/circles.csv`・`data/menus.csv` | 人・エージェント、CLI（`import`・`menu`） | CLI だけ |
| `sources/` | 人・エージェント、CLI（`import --fetch`） | CLI だけ（インポーター） |
| `public/data/circles.json` | CLI だけ（`caimawaru data`） | ページだけ（実行時に読み込む。`vite.config.ts` は配置図の有無を見る。テストは形を確かめる） |

`circles.json` の形は `src/types.ts` の `CircleData` で、ページと CLI の取り決めです。変えるときは両方を直し、
`src/layout.test.ts`（ページ側から見た形）と `tools/tests/`（CLI 側の出力）のテストを合わせます。

## CLI の中の依存

```
cli.py ─┬▶ build.py ──▶ layout.py
        │     └──────▶ project.py
        ├▶ importing.py ─┬▶ importers/（sockbase・csv・json、イベントごとの python）
        │                └▶ build.py（取り込み後の検証・生成。同じプロセス内で関数として呼ぶ）
        ├▶ menu.py ──────▶ build.py
        └▶ new_event.py ─▶ project.py
importers/sockbase.py ──（--fetch のときだけ）──▶ google-chrome（headless で公式リストを描画して保存）
```

- 外部のプロセスを起動するのは、Sockbase の取得（Chrome）だけ
- 島の番号の振り方・島の記号の位置・初期表示の範囲は `layout.py` だけが決める（ページは展開済みのセルを描く）

## ページの中の依存

```
pnpm dev / preview ──▶ scripts/vite.mjs ──▶ vite（vite.config.ts）
pnpm build ──────────▶ scripts/build-all.mjs ─┬▶ tsc
                                               └▶ vite build（イベントごと。vite.config.ts）
pnpm test ───────────▶ vitest
```

- `scripts/` は node_modules の実行ファイルを同じ Node で起動する（シェルを通さないので OS に依存しない）
- イベントは最初の引数で指定し、`scripts/` から `vite.config.ts` へは内部用の環境変数 `CAIMAWARU_EVENT_ID` で渡す
- `circles.json` がなければ、Python を呼ばずに「先に `uv run caimawaru data <eventId>`」と知らせて止まる

## 同じ規則を2か所に持っているもの

- `events/*/event.json` からイベントの一覧を作る処理（`tools/caimawaru/project.py` と `scripts/lib.mjs`・`vite.config.ts`）。
  どちらも「`events/` の下で `event.json` があるフォルダ」というだけの規則
- サークルの複数スペース（`A-01,A-02`）の分け方（`tools/caimawaru/build.py` の `circle_spaces` と `src/filter.ts` の `spacesOf`）。
  「`,` で区切る」というだけの規則
