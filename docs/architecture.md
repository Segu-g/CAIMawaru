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

イベントデータの直接編集は、ファイルを書き換えても、CLI の編集コマンド（`caimawaru circle`・`menus`・`config`）やブラウザのエディタ（`pnpm editor`）を使ってもよい。
コマンドは書き込む前に検証し、変更後に `circles.json` を作り直す。

| ファイル | 書く | 読む |
|---|---|---|
| `event.json` | 人・エージェント、CLI（`config set`・`config unset`。`new-event` が雛形）、エディタ（ブラウザ） | CLI（全コマンド）、ページ（`vite.config.ts`: `storeId`・`title` だけ）、エディタ |
| `layout.json` | 人・エージェント | CLI だけ（展開して `circles.json` に入れる） |
| `data/circles.csv`・`data/menus.csv` | 人・エージェント、CLI（`import`・`menu`・`circle add/set/remove`・`menus set/remove`）、エディタ（ブラウザ） | CLI、エディタ |
| `sources/` | 人・エージェント、CLI（`import --fetch`） | CLI だけ（インポーター） |
| `public/data/circles.json` | CLI だけ（`caimawaru data`） | ページだけ（実行時に読み込む。`vite.config.ts` は配置図の有無を見る。テストは形を確かめる） |

エディタは、ページの中で唯一イベントデータを書くもので、書くのは利用者がブラウザで選んだフォルダの event.json・data/circles.csv・data/menus.csv だけです
（File System Access API。サーバや Node のスクリプトはファイルを書かない）。書式は CLI と同じで、同じ内容なら同じバイト列になります:

- CSV: [docs/event-data.md の「CSV の書き方（保存時の形）」](event-data.md#csv-の書き方保存時の形)の形（`src/editor/csv.ts`。CLI は `project.py` の `format_csv`）。
  エディタは「そのまま書き戻して値が失われたり変わったりするときだけ読まない」方針で、次のように読む
  （CLI と同じ規則で、docs/event-data.md の「CSV の書き方」の入力と出力の対応と一致する）。知らせは開いたときに出し、編集は止めない:
  - 見出しの前の空の行・値がすべて空（空白だけ）の行は飛ばす。見出しの前の `#` の行はコメントの行として、見出しの前にそのまま書く
  - `id` 列のない見出しも読む（id はスペース番号から作る）。決まった列が1つもない見出しは、すべての列をほかの列（位置で扱う）として読み、
    「サークルの列が見つかりません」（menus.csv は「お品書きの列が…」）と知らせる
  - 決まった列の名前が2回あれば、最初の列を決まった列にし、後の列はほかの列として列名と値を残す（「url 列が 2 つあります…」と知らせる）
  - 見出しより値が多い行は、どの列の値か決まらないので、最初の値の前に `#` を付けたコメントの行にする（値はすべて残し、見出しは変えない。
    `a-01,…` は `#a-01,…`、最初の値が空なら `#`）。一覧と確認には出さず、「3 行目は見出しより列が多いため、コメント行にしました」と知らせる
  - 読まないのは、そのまま書き戻すと値が変わるときだけ: UTF-8 でないファイル（Shift_JIS など。置き換え文字で保存しないよう、
    `TextDecoder` の `fatal` で確かめる）、CSV として読めないファイル（`"` が閉じないままファイルが終わる、閉じた `"` のすぐ後ろに `,`・行末以外がある
    `"ab"c` のような形。Python の `csv` の `strict=True` と同じ。メッセージはその行の始まりの行番号を示す）
  - 画面で足したまま何も入れていない行は書かない
- event.json: 字下げ2・非 ASCII のまま・キーの順を保つ・末尾の改行。読み込んだファイルが CRLF なら CRLF のまま。
  ただし JavaScript では元どおりに書けないもの（数字だけのキーの並び、`1.0`・2^53 を超える整数・`-0` などの数値の書き方、指数表記の数値（`1.5e-7`。Python は `1.5e-07` と書く）、同じキーの重複、`__proto__` というキー）が
  あるファイルは、値を黙って変えないよう、イベント情報を読み取り専用で開き、event.json は書かない（`src/editor/jsonCheck.ts`）。
  想定と違う形の値（文字列のはずが数値など）の欄と、数字だけのイベント名がある eventSlots も、その欄だけ読み取り専用にする

保存の前に、読み込んだ後でほかに（CLI・エージェントなど）変更されたファイルがあれば何も書きません。
書くファイルすべての書き込み口を先に用意し（権限がなければ何も書かない）、途中で失敗したときは、書けたファイルと書けなかったファイルを知らせ、
書けなかったファイルは未保存のまま残します。保存後の状態はフォルダを読み直さず、書いた中身から作ります
（読み直すと、その間に CLI が書いた内容を「保存した内容」と取り違えて、次の保存で上書きしてしまうため）。
開発サーバ（`pnpm editor`）が配るのは `src/` と依存パッケージだけで、`events/` のファイルは配りません（`server.fs.allow`）。

`circles.json` の形は `src/types.ts` の `CircleData` で、ページと CLI の取り決めです。変えるときは両方を直し、
`src/layout.test.ts`（ページ側から見た形）と `tools/tests/`（CLI 側の出力）のテストを合わせます。

## CLI の中の依存

```
cli.py ─┬▶ build.py ──▶ layout.py
        │     ├──────▶ project.py
        │     └──────▶ xurl.py（X の URL の規則。menu・edit も使う）
        ├▶ importing.py ─┬▶ importers/（sockbase・csv・json）
        │                └▶ build.py（取り込み後の検証・生成。同じプロセス内で関数として呼ぶ）
        ├▶ menu.py ──────┬▶ build.py
        │                └▶ xurl.py（X の投稿 URL の正規化・x 列のアカウント）
        ├▶ edit.py ──────┬▶ build.py（書き込む前に一時フォルダの写しを検証、書き込み後に生成）
        │                ├▶ menu.py（サークル指定の照合 find_circles）
        │                └▶ xurl.py（X の URL の正規化）
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
- イベントデータの CSV の読み書き（`tools/caimawaru/project.py` の `CIRCLE_COLS`・`MENU_COLS`・`read_table`・`format_csv`・`make_id` と、
  `src/editor/csv.ts`・`src/editor/model.ts`）。docs/event-data.md の「CSV の書き方」（列の並び・CRLF・囲み方・空の行・`#` の行・ほかの列）。
  `src/editor/csv.test.ts` が events/example の CSV を読み直して同じバイト列になることと、それぞれの規則を確かめる
- サークルの id（空欄ならスペース番号から作る。`tools/caimawaru/project.py` の `circle_id` と `src/editor/model.ts` の `circleId`）。
  build・import・menu・編集コマンドはどれも `circle_id` を使う
- X の URL の規則（`tools/caimawaru/xurl.py` の `normalize_url`・`profile_handle`・`x_handle`・`is_x_page` と `src/editor/menuMatch.ts` の
  `normalizeUrl`・`profileHandle`・`xHandleOf`・`isXPage`）。CLI では照合（`menu.py` の `find_circles`）と検証・生成（`build.py`。x 列が照合できるか、
  お品書きが X の投稿か、投稿の URL の正規化と重複）が同じ関数を使い、エディタでは `findCircles` と `validate.ts` が使う。例は `tools/tests/fixtures/x_urls.json` にまとめ、
  `tools/tests/test_menu.py` と `src/editor/menuMatch.test.ts` がそれぞれこのファイルを読んで確かめる（互いのコードは呼ばない）
- 簡単な検証（`src/editor/validate.ts`）は `build.py` のエラーの一部と同じ規則。正式な検証は `build.py` だけ
