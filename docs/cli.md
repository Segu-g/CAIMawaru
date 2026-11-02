# コマンド

イベントデータは Python の CLI（`uv run caimawaru`）、ページは Node（`pnpm`）で扱います。2つは互いを呼び出しません（[architecture.md](architecture.md)）。
手順の流れは [getting-started.md](getting-started.md)、各コマンドの細かいオプションは `uv run caimawaru <command> --help`。

## イベントデータ（Python: `uv run caimawaru <command>`）

| コマンド | 内容 |
|---|---|
| `uv run caimawaru list` | イベントの一覧 |
| `uv run caimawaru new-event <eventId> [--name …] [--date …] [--venue …] [--sockbase URL] [--map]` | イベントのフォルダを作る |
| `uv run caimawaru import <eventId> [--fetch] [--input FILE] [--dry-run] [--no-build]` | 主催の元データ（sources）をイベントデータに取り込む（[importers.md](importers.md)） |
| `uv run caimawaru importers` | 使えるインポーターの一覧 |
| `uv run caimawaru menu <eventId> <URL>…` | お品書きを登録（下記） |
| `uv run caimawaru circle list\|show\|add\|set\|remove <eventId> …` | サークル（circles.csv）を確かめる・編集する（下記） |
| `uv run caimawaru menus list\|set\|remove <eventId> …` | お品書き（menus.csv）を確かめる・変更・削除する |
| `uv run caimawaru config get\|set\|unset <eventId> …` | event.json の値を確かめる・変更する |
| `uv run caimawaru data <eventId> [--check]` | イベントデータを検証し、ページが読む `circles.json` を生成（`--check` は検証のみ） |
| `uv run caimawaru check [<eventId>…]` | イベントデータを検証（省略すると全イベント） |

`<eventId>` はイベントのフォルダ名（`events/` の下）。リポジトリのフォルダで実行する（イベントのフォルダは `events/`。ほかの場所のイベントを扱うときは `--events-dir` で指定する）。

### お品書きを登録する

```sh
uv run caimawaru menu <eventId> "https://x.com/<ID>/status/<番号>"                # 投稿したアカウントからサークルを自動判定
uv run caimawaru menu <eventId> "URL1" "URL2" "URL3"                               # まとめて
uv run caimawaru menu <eventId> --circle A-05 --note "新刊" "https://booth.pm/…"   # X 以外はサークルを指定
uv run caimawaru menu <eventId> -                                                  # 1行ずつ貼り付け。Ctrl+D（Windows は Ctrl+Z → Enter）で終了
```

サークル指定はスペース番号・id・サークル名の一部・@X の ID のどれでもよく、登録後に `uv run caimawaru data` まで自動で実行します（`--dry-run` は判定結果の表示だけ）。
id 列が空のサークルは、スペース番号から作った id（`A-10` → `a-10`）で menus.csv に書きます（`--dry-run` でも、書く id を表示します）。
X の投稿からの自動判定と @X の ID での指定は、サークルの `x` 列のプロフィールの URL（`x.com`・`twitter.com`、`www.`・`mobile.` 付き、
末尾の `/`・`?lang=ja`・`#…` があってもよい）と照らし合わせます。`x.com/home`・`x.com/search` などアカウントではないページは照合しません。`caimawaru check`・`data` も同じ規則で、照合できない `x` 列を警告します。

### イベントデータを確かめる・編集する

CSV や JSON を直接編集する代わりに、コマンドで確かめて変えられます（エージェントはこちらを使う）。

```sh
uv run caimawaru circle list <eventId> [<サークル指定>] [--event <イベント名>] [--json]   # 一覧
uv run caimawaru circle show <eventId> A-01 --json                                      # 1件の全列とお品書き
uv run caimawaru circle set <eventId> A-01 notes="新刊あり" tags="新刊;グッズ" --dry-run   # 変化だけ表示
uv run caimawaru circle add <eventId> space=A-10 name="サークル名" event="サンプル即売会" source="公式サークル一覧"
uv run caimawaru circle remove <eventId> A-10 [--with-menus]                            # お品書きがあれば --with-menus が要る
uv run caimawaru menus list <eventId> [<サークル指定>] [--json]
uv run caimawaru menus set <eventId> A-01 note="既刊" [--url URL] [--all]
uv run caimawaru menus remove <eventId> A-01 [--url URL] [--all]
uv run caimawaru config get <eventId> [info.venue]                                      # 値を JSON で表示
uv run caimawaru config set <eventId> info.venue "サンプル会館"                           # 文字列
uv run caimawaru config set <eventId> info.eventSlots.併設オンリー 2 --json               # 数・配列・オブジェクトは --json
uv run caimawaru config unset <eventId> info.contact
```

- 列は `列名=値`（値を空にすると空欄）。event.json のキーは `.` 区切り（配列は番号: `info.links.0.url`）。
  `.` を含むキーは、親のオブジェクトごと `--json` で書く（例: `config set <eventId> info.eventSlots '{"A.B": 1}' --json`）
- 書き込むコマンドは、変更前 → 変更後の差分を表示し、変更後のイベントデータを検証してから書き込みます。
  変更で新しいエラーが出るなら書き込みません（行番号を除いたメッセージで比べるので、同じ内容のエラーが別の行に移ると見分けられません）。
  `--dry-run` は差分と検証だけ。書き込み後は `uv run caimawaru data` まで実行します（`--no-build` で省略）
- 複数のファイルを書き換えるとき（id の変更・`--with-menus`）は、先にすべてのファイルを開けることを確かめ、1つでも開けなければどれも書き換えません
- サークル指定が複数のサークルに当たると、候補を表示して止まります（スペース番号か id で指定し直す）
- サークルの `id` と `storeId` は公開後に変えないので、変えるには `--force` が要ります（id を変えると menus.csv の id も書き換える）
- CSV は決まった形（[event-data.md の「CSV の書き方」](event-data.md#csv-の書き方保存時の形)。取り込み・`menu`・[エディタ](editor.md)と同じ）で書き戻します。
  イベントデータにない列と `#` の行は残し、空行は落とし、改行は CRLF にそろえます。その形で保存されたファイルなら、差分は変えた行だけです

## ページ（Node: `pnpm <command>`）

| コマンド | 内容 |
|---|---|
| `pnpm dev <eventId>` | 開発サーバ |
| `pnpm build <eventId>` | 型チェックのうえ、そのイベントのページを `dist/<eventId>/` にビルド |
| `pnpm preview <eventId>` | ビルド結果の確認（先に `pnpm build <eventId>`） |
| `pnpm editor` | イベントデータの[エディタ](editor.md)の開発サーバ。イベントを指定しない |
| `pnpm build:editor` | エディタを静的なページとして `dist/editor/` にビルド |
| `pnpm test` / `pnpm typecheck` | テスト・型チェック（[CONTRIBUTING.md](../CONTRIBUTING.md)） |

ページのコマンドは Vite をそのまま呼びます（`pnpm build example` は `vite build -- example`）。1回に1イベントで、
複数のイベントはコマンドを並べて実行します（`pnpm build a && pnpm build b`）。Vite のオプションを付けるときは
`pnpm exec vite --host -- example` のように `--` の前に書きます。

ページのコマンドは `circles.json` を読むだけで、Python は呼びません。`circles.json` がなければ、先に `uv run caimawaru data <eventId>` を実行するよう知らせて止まります。
