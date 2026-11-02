# 構成と依存関係

CAIMawaru は2つの独立したツールでできています。**互いを呼び出さず、境界はファイルだけ**です。

| | イベントデータの CLI | ページ |
|---|---|---|
| 言語・実行環境 | Python 3.10+（標準ライブラリのみ） | TypeScript / Node（Vite + React） |
| 入り口 | `uv run caimawaru <command>`（`pyproject.toml` の `[project.scripts]`） | `pnpm <command>`（`package.json` の `scripts`） |
| コード | `tools/caimawaru/` | `src/`・`vite.config.ts` |
| テスト | `tools/tests/`（`uv run python -m unittest discover -s tools/tests`） | `*.test.ts`（`pnpm test`） |
| 役割 | イベントデータの検証・生成・取り込み・編集 | ページの開発・ビルド |

## ファイルを介した依存

```
人・エージェント ──直接編集──▶ events/<eventId>/event.json ─┬──────────────▶ ページ（vite.config.ts: storeId・title）
                               events/<eventId>/layout.json  │
                               events/<eventId>/data/*.csv   │
                                        ▲                    │
主催の元データ ──▶ sources/ ──caimawaru import──┘                    │
                                                             ▼
                               caimawaru data ──書く──▶ events/<eventId>/public/data/circles.json ──読む──▶ ページ
```

イベントデータの直接編集は、ファイルを書き換えても、CLI の編集コマンド（`caimawaru circle`・`menus`・`config`）を使ってもよい。
コマンドは書き込む前に検証し、変更後に `circles.json` を作り直す。

| ファイル | 書く | 読む |
|---|---|---|
| `event.json` | 人・エージェント、CLI（`config set`・`config unset`。`new-event` が雛形） | CLI（全コマンド）、ページ（`vite.config.ts`: `storeId`・`title` だけ） |
| `layout.json` | 人・エージェント | CLI だけ（展開して `circles.json` に入れる） |
| `data/circles.csv`・`data/menus.csv` | 人・エージェント、CLI（`import`・`menu`・`circle add/set/remove`・`menus set/remove`） | CLI だけ |
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
        ├▶ edit.py ──────┬▶ build.py（書き込む前に一時フォルダの写しを検証、書き込み後に生成）
        │                └▶ menu.py（サークル指定の照合 find_circles・X の URL の正規化）
        └▶ new_event.py ─▶ project.py
importers/sockbase.py ──（--fetch のときだけ）──▶ list.sockbase.net（標準ライブラリの urllib で HTML を取得して保存）
```

- 外部のコマンドは起動しない（`subprocess` を使わない）。ネットワークに出るのは `import --fetch` だけ
- 島の番号の振り方・島の記号の位置・初期表示の範囲は `layout.py` だけが決める（ページは展開済みのセルを描く）

## ページの中の依存

```
pnpm dev <eventId> ──────▶ vite -- <eventId>                      ─┐
pnpm build <eventId> ────▶ tsc ─▶ vite build -- <eventId>          ├▶ vite.config.ts（eventId を引数から読む）
pnpm preview <eventId> ──▶ vite preview -- <eventId>              ─┘
pnpm test ───────────────▶ vitest（vite.config.ts はイベントを読まない）
```

- `package.json` の scripts は Vite をそのまま呼ぶだけ。独自のスクリプトや環境変数は使わない
- `vite.config.ts` は `--` より後ろの最初の引数を eventId として読む（Vite は `--` より後ろを使わない。`--` がないと
  Vite は eventId をプロジェクトのフォルダと解釈する）。引数は Node 標準の `util.parseArgs` で読み、eventId の後ろに Vite のオプションを書くと Vite に届かないのでエラーにする
- 1回のビルドは1イベント。複数のイベントはコマンドを並べて実行する
- `circles.json` がなければ、Python を呼ばずに「先に `uv run caimawaru data <eventId>`」と知らせて止まる
- 出力先は `dist/<eventId>/` で、ビルドのたびに Vite（`emptyOutDir`）が空にする。`vite.config.ts` 自身はファイルやフォルダを消したり書いたりしない
- 公開先での置き場所（同じサイトの下に複数ページを並べるなど）はデプロイの手順で決め、ビルドには持ち込まない

## 同じ規則を2か所に持っているもの

- `events/*/event.json` からイベントの一覧を作る処理（`tools/caimawaru/project.py` と `vite.config.ts`）。
  どちらも「`events/` の下で `event.json` があるフォルダ」というだけの規則
- サークルの複数スペース（`A-01,A-02`）の分け方（`tools/caimawaru/build.py` の `circle_spaces` と `src/filter.ts` の `spacesOf`）。
  「`,` で区切る」というだけの規則
