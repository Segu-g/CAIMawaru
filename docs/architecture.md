# 構成と依存関係

CAIMawaru は2つの独立したツールでできています。**互いを呼び出さず、境界はファイルだけ**です。

| | イベントデータの CLI | ページ |
|---|---|---|
| 言語・実行環境 | Python 3.10+（標準ライブラリのみ） | TypeScript / Node（Vite + React） |
| 入り口 | `uv run caimawaru <command>`（`pyproject.toml` の `[project.scripts]`） | `pnpm <command>`（`package.json` の `scripts`） |
| コード | `tools/caimawaru/` | `src/`・`vite.config.ts`、エディタは `src/editor/`・`vite.editor.config.ts` |
| テスト | `tools/tests/`（`uv run python -m unittest discover -s tools/tests`） | `*.test.ts`（`pnpm test`） |
| 役割 | イベントデータの検証・生成・取り込み・編集 | ページの開発・ビルド、イベントデータのエディタ（ブラウザ） |

## ファイルを介した依存

```
人・エージェント ──直接編集──▶ events/<eventId>/event.json ─┬──────────────▶ ページ（vite.config.ts: storeId・title）
                               events/<eventId>/layout.json  │
                               events/<eventId>/data/*.csv   │
                                        ▲                    │
主催の元データ ──▶ sources/ ──caimawaru import──┘                    │
                                                             ▼
                               caimawaru data ──書く──▶ events/<eventId>/public/data/circles.json ──読む──▶ ページ

人 ──エディタ（ブラウザ。pnpm editor）──読み書き──▶ events/<eventId>/event.json・data/circles.csv・data/menus.csv
```

| ファイル | 書く | 読む |
|---|---|---|
| `event.json` | 人・エージェント（`caimawaru new-event` が雛形）、エディタ（ブラウザ） | CLI（全コマンド）、ページ（`vite.config.ts`: `storeId`・`title` だけ）、エディタ |
| `layout.json` | 人・エージェント | CLI だけ（展開して `circles.json` に入れる） |
| `data/circles.csv`・`data/menus.csv` | 人・エージェント、CLI（`import`・`menu`）、エディタ（ブラウザ） | CLI、エディタ |
| `sources/` | 人・エージェント、CLI（`import --fetch`） | CLI だけ（インポーター） |
| `public/data/circles.json` | CLI だけ（`caimawaru data`） | ページだけ（実行時に読み込む。`vite.config.ts` は配置図の有無を見る。テストは形を確かめる） |

エディタは、ページの中で唯一イベントデータを書くもので、書くのは利用者がブラウザで選んだフォルダの event.json・data/circles.csv・data/menus.csv だけです
（File System Access API。サーバや Node のスクリプトはファイルを書かない）。書式は CLI と同じで、同じ内容なら同じバイト列になります:

- CSV: UTF-8（BOM なし）、行末 CRLF。「,」「"」CR・LF を含む値だけ「"」で囲み、中の「"」は「""」にする（Python の csv の QUOTE_MINIMAL）。
  列名の行は決まった列（circles.csv: `id,space,event,name,kana,penNames,tags,adult,x,pixiv,booth,web,notes,source`、menus.csv: `id,url,note,checkedAt`）をこの順に、
  そのあとにファイルにあったほかの列を元の順に（値も残す）。行はファイルの順（足した行は最後）で、足りない値は空欄。空の行と、どの値も空か空白だけの行（`,,,`）は捨てる。
  コメントの行（最初の値が `#` で始まる）はその位置に残し、最初の値だけを1つの値として書く
- 列名が空・重複している CSV、列名より値が多い行がある CSV は、保存すると内容が失われるので開かない
- event.json: 字下げ2・非 ASCII のまま・キーの順を保つ・末尾の改行。読み込んだファイルが CRLF なら CRLF のまま

保存の前に、読み込んだ後でほかに（CLI・エージェントなど）変更されたファイルがあれば何も書きません。

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
pnpm editor ─────────────▶ vite --config vite.editor.config.ts        ─┐ エディタ（src/editor/。eventId を取らない）
pnpm build:editor ───────▶ tsc ─▶ vite build --config vite.editor.config.ts ─┘ → dist/editor/

ブラウザのエディタ ──showDirectoryPicker（利用者が選んだ events/<eventId>/）──▶ event.json・data/circles.csv・data/menus.csv を読み書き
```

- `package.json` の scripts は Vite をそのまま呼ぶだけ。独自のスクリプトや環境変数は使わない
- `vite.config.ts` は `--` より後ろの最初の引数を eventId として読む（Vite は `--` より後ろを使わない。`--` がないと
  Vite は eventId をプロジェクトのフォルダと解釈する）。引数は Node 標準の `util.parseArgs` で読み、eventId の後ろに Vite のオプションを書くと Vite に届かないのでエラーにする
- 1回のビルドは1イベント。複数のイベントはコマンドを並べて実行する
- `circles.json` がなければ、Python を呼ばずに「先に `uv run caimawaru data <eventId>`」と知らせて止まる
- 出力先は `dist/<eventId>/` で、ビルドのたびに Vite（`emptyOutDir`）が空にする。`vite.config.ts` 自身はファイルやフォルダを消したり書いたりしない
- 公開先での置き場所（同じサイトの下に複数ページを並べるなど）はデプロイの手順で決め、ビルドには持ち込まない
- エディタはイベントに依存しないので `vite.config.ts` を通さない。開発サーバもビルドもイベントのファイルを読み書きせず、読み書きはブラウザの中だけ。
  検証と `circles.json` の生成はしない（保存のあとに `uv run caimawaru data <eventId>` を案内するだけ）

## 同じ規則を2か所に持っているもの

- `events/*/event.json` からイベントの一覧を作る処理（`tools/caimawaru/project.py` と `vite.config.ts`）。
  どちらも「`events/` の下で `event.json` があるフォルダ」というだけの規則
- サークルの複数スペース（`A-01,A-02`）の分け方（`tools/caimawaru/build.py` の `circle_spaces` と `src/filter.ts` の `spacesOf`）。
  「`,` で区切る」というだけの規則
- イベントデータの CSV の読み書き（`tools/caimawaru/project.py` の `CIRCLE_COLS`・`MENU_COLS`・`read_rows`・`write_csv`・`make_id` と、
  `src/editor/csv.ts`・`src/editor/model.ts`）。上の書式（列の並び・CRLF・囲み方・空の行・コメントの行・ほかの列）。
  `src/editor/csv.test.ts` が events/example の CSV を読み直して同じバイト列になることと、それぞれの規則を確かめる
- 簡単な検証（`src/editor/validate.ts`）は `build.py` のエラーの一部と同じ規則。正式な検証は `build.py` だけ
