# CAIMawaru

**C**ircle **A**rea **I**tinerary — 会場のサークルスペースを巡って「買い回る」ためのツール。

同人誌即売会の **サークルリスト＋会場配置図** のページを、イベントごとの設定ファイルと CSV から作る静的サイトです。
スマホで当日会場を回ることを前提に、配置図・検索・★／タグ／購入済みのチェック・お品書きリンクをまとめて表示します。

- **ページ**: Vite + React + TypeScript（`pnpm`）
- **イベントデータの CLI `caimawaru`**: Python 3（標準ライブラリのみ。`uv run caimawaru`）。データの検証・生成・取り込み
- 2つは互いを呼び出さない。境界はファイル（`circles.json`）だけ（[docs/architecture.md](docs/architecture.md)）
- イベントに依存する情報はすべて `events/<eventId>/` に置き、コードには書かない
- 出力は相対パスの静的ファイルなので、GitHub Pages・nginx などどこにでも置ける

`events/example/` に架空のサンプルイベントがあります。実在のイベントのデータは `.gitignore` でリポジトリから外してあり、
手元の `events/<eventId>/` に置いて使います（必要なら別の非公開リポジトリで管理してください）。

```sh
uv run caimawaru data example     # イベントデータを検証し、ページが読む circles.json を作る（Python）
pnpm install
pnpm dev example                  # ページの開発サーバ（Node）
```

## 必要なもの

- ページ: Node.js（`.node-version`。fnm などで合わせる）と pnpm
- イベントデータの CLI: [uv](https://docs.astral.sh/uv/)（Python 3.10 以上を自動で用意する）。uv を使わない場合は `pip install -e .` で `caimawaru` コマンドが入る
- Linux・macOS・Windows で動く（CI で3つの OS を確かめている）

## イベントの置き方

1イベント（1ページ）＝ `events/<eventId>/` の1フォルダです。主催が配る **元データ（任意の形式）** と、
CAIMawaru が読む **イベントデータ** を分けています。

```
events/<eventId>/
  event.json                 設定とイベント情報（直接編集）          ┐
  layout.json                会場配置図（任意。なければ配置図なし）  │ イベントデータ
  data/circles.csv           サークル情報                            │ （docs/event-data.md）
  data/menus.csv             お品書きのURL                           ┘
  sources/                   主催の元データ（Sockbase の HTML・配布 CSV など。任意の形式）
  public/data/circles.json   ページが読み込むデータ（uv run caimawaru data が生成。直接編集しない）
```

- [docs/event-data.md](docs/event-data.md) — イベントデータの仕様（event.json・circles.csv・menus.csv）
- [docs/importers.md](docs/importers.md) — 元データの取得と変換（Sockbase・CSV・JSON・独自形式）
- [docs/layout.md](docs/layout.md) — 配置図の書き方
- [docs/new-event.md](docs/new-event.md) — 新しいイベントを追加する手順（`uv run caimawaru new-event <eventId>` で雛形を作る）

## コマンド

### イベントデータ（Python: `uv run caimawaru <command>`）

| コマンド | 内容 |
|---|---|
| `uv run caimawaru list` | イベントの一覧 |
| `uv run caimawaru new-event <eventId> [--map] [--sockbase URL] …` | イベントのフォルダを作る |
| `uv run caimawaru import <eventId> [--fetch] [--dry-run]` | 主催の元データ（sources）をイベントデータに取り込む |
| `uv run caimawaru importers` | 使えるインポーターの一覧 |
| `uv run caimawaru menu <eventId> <URL>…` | お品書きを登録（下記） |
| `uv run caimawaru circle list\|show\|add\|set\|remove <eventId> …` | サークル（circles.csv）を確かめる・編集する（下記） |
| `uv run caimawaru menus list\|set\|remove <eventId> …` | お品書き（menus.csv）を確かめる・変更・削除する |
| `uv run caimawaru config get\|set\|unset <eventId> …` | event.json の値を確かめる・変更する |
| `uv run caimawaru data <eventId> [--check]` | イベントデータを検証し、ページが読む `circles.json` を生成（`--check` は検証のみ） |
| `uv run caimawaru check [<eventId>…]` | イベントデータを検証（省略すると全イベント） |
| `uv run python -m unittest discover -s tools/tests` | テスト（配置図の展開・取り込み・編集・CLI） |

`<eventId>` はイベントのフォルダ名（`events/` の下）。プロジェクトのフォルダの中ならどこから実行してもよい（`--root` で指定も可）。

### ページ（Node: `pnpm <command>`）

| コマンド | 内容 |
|---|---|
| `pnpm dev <eventId>` | 開発サーバ |
| `pnpm build <eventId>` | 型チェックのうえ、そのイベントのページを `dist/<eventId>/` にビルド |
| `pnpm preview <eventId>` | ビルド結果の確認（先に `pnpm build <eventId>`） |
| `pnpm test` | テスト（検索・保存形式・配置図の操作など、生成済みの `circles.json` の形） |

ページのコマンドは Vite をそのまま呼びます（`pnpm build example` は `vite build -- example`）。1回に1イベントで、
複数のイベントはコマンドを並べて実行します（`pnpm build a && pnpm build b`）。Vite のオプションを付けるときは
`pnpm exec vite --host -- example` のように `--` の前に書きます。

ページのコマンドは `circles.json` を読むだけで、Python は呼びません。`circles.json` がなければ、先に `uv run caimawaru data <eventId>` を実行するよう知らせて止まります。

### お品書きを登録する

```sh
uv run caimawaru menu <eventId> "https://x.com/<ID>/status/<番号>"                # 投稿したアカウントからサークルを自動判定
uv run caimawaru menu <eventId> "URL1" "URL2" "URL3"                               # まとめて
uv run caimawaru menu <eventId> --circle A-05 --note "新刊" "https://booth.pm/…"   # X 以外はサークルを指定
uv run caimawaru menu <eventId> -                                                  # 1行ずつ貼り付け。Ctrl+D（Windows は Ctrl+Z → Enter）で終了
```

サークル指定はスペース番号・id・サークル名の一部・@X の ID のどれでもよく、登録後に `uv run caimawaru data` まで自動で実行します。

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
- CSV は決まった形（[docs/event-data.md の「CSV の書き方」](docs/event-data.md#csv-の書き方保存時の形)。取り込み・`menu` と同じ）で書き戻します。
  イベントデータにない列と `#` の行は残し、空行は落とし、改行は CRLF にそろえます。その形で保存されたファイルなら、差分は変えた行だけです

## 情報の集め方（方針）

- サークル名・スペース番号などの元データは **主催の公式サークル一覧** から作り、出典を `source` 列に書く
- お品書きは **投稿 URL へのリンクのみ** 掲載する。画像の転載・本文の書き写しはしない
- X は API や自動操作で収集しない（X の利用規約・開発者規約のため）。URL は人が閲覧して集める
- 品目・価格を載せる場合は、サークル本人の許可を得るか、X 以外（BOOTH 等）を出典にする
- 配置図は、主催が配置図の二次利用を制限していない場合だけ描き起こす（公式画像は転載しない）。制限があれば `layout.json` を置かず、公式配置図へのリンクだけにする
- サークルカット画像は取り込まない
- 公式リストに載っていないアカウントは載せない。欠席などの理由は書かない

## 公開

`uv run caimawaru data <eventId>` でデータを作ってから `pnpm build <eventId>` すると `dist/<eventId>/` ができるので、それを公開先に置きます（相対パス出力なのでサブパスでも可。複数のページを同じサイトの下に並べるときも、置き場所はアップロード先で決めます）。
データだけの更新なら、公開先の `data/circles.json` を差し替えるだけでも反映されます（ページは `no-cache` で読み込む）。

- CDN を挟む場合、公開前に **まだ置いていないファイルの公開 URL を開かない** でください。404 がキャッシュされてページが壊れることがあります
- アップロードは assets/ と data/ を先に、index.html を最後にすると、途中の状態で壊れません
- ページには `noindex` を付けています（イベント後に古い情報が検索に残らないように）

## 構成

依存関係（どれがどれを呼ぶか・どのファイルを読み書きするか）は [docs/architecture.md](docs/architecture.md)。

| パス | 言語 | 役割 |
|---|---|---|
| `events/` | — | イベントごとのイベントデータと元データ |
| `src/` | TS | ページ本体（React）。イベント固有の値は持たない |
| `src/layout.ts` | TS | 配置図の型（展開済みのセルを描くだけ） |
| `src/filter.ts` | TS | 検索・絞り込み・並べ替え |
| `src/useMine.ts` | TS | 閲覧者の ★・タグ・メモ（localStorage のみに保存） |
| `src/components/SpaceMap.tsx` | TS | 配置図の描画とタッチ操作 |
| `vite.config.ts` | TS | ページのビルド設定。引数の eventId から `event.json` を読み、出力先などを決める |
| `tools/caimawaru/cli.py` | Python | `caimawaru` コマンドの入り口 |
| `tools/caimawaru/build.py` | Python | イベントデータの検証と `circles.json` の生成 |
| `tools/caimawaru/layout.py` | Python | `layout.json` の展開（島の番号の振り方・記号の位置・表示範囲） |
| `tools/caimawaru/importing.py` | Python | 取り込みの共通処理（正規化・既存データとの合流） |
| `tools/caimawaru/importers/` | Python | 元データの形式ごとのインポーター（sockbase・csv・json） |
| `tools/caimawaru/menu.py` | Python | お品書き URL の登録 |
| `tools/caimawaru/edit.py` | Python | イベントデータを確かめる・編集する（circle・menus・config） |
| `tools/caimawaru/new_event.py` | Python | イベントの雛形作成 |
| `tools/tests/` | Python | CLI・配置図の展開・取り込み・編集のテスト |

## 閲覧者向けの機能

スマホでの利用を前提に、画面下のタブで切り替える。幅 900px 以上（PC・タブレット横）では左に配置図、右に一覧・マイリストを並べる。

- **配置図**: 2本指で拡大縮小・1本指で移動・ダブルタップで拡大（PCはホイール）。＋／−、「島」（サークル配置部分）、「全体」ボタン
  - スペースをタップするとサークル情報を表示（★・タグ・メモ、お品書きのシート、一覧への移動）
  - イベント色は `event.json` の `info.eventSlots`（イベント名 → 枠 1〜5）で割り当て、色は `info.slotColors` で上書きできる。枠のないイベントは灰色の「同時開催」
  - ★は黄＋★記号、タグ付きは濃い灰色＋●記号、購入済みは薄い灰色＋✓記号で表示（色だけに頼らない）。一覧で絞り込み中は該当以外を薄く表示
  - 配置図は公式配置図を元に `layout.json` に描き起こしたもの（公式画像は転載しない）。`layout.json` がないイベントは配置図なしで一覧とマイリストだけになる
- **一覧**: 検索（サークル名・作家名・イベント・スペース・自分のタグ・メモ）、絞り込み（イベント・★/タグ・お品書き有無）、並べ替え
  - 各カードに ✓（購入済みにする）・☆（★を付ける）と「お品書きを見る」「配置図で見る」「タグ・メモ」
- **お品書きのシート**: 「お品書きを見る」で画面下からシートを開き、X 公式の埋め込みで投稿を表示（押すまで X のスクリプトは読み込まない）
  - 複数あるときは ‹ › で切り替え。X 以外（pixiv・BOOTH 等）はリンク先を開くボタン
  - ✕・背景タップ・Esc・スマホの「戻る」で閉じる（履歴を1つ積むので、戻ってもページから離れない）
  - シートの下から ★ と「配置図で見る」
- **マイリスト**: ★・タグ・購入済みのサークルをスペース順に表示（会場を回る順）。未購入・購入済み・★・タグごとに絞り込み
- **購入済み**: 当日買ったら ✓。配置図では灰色＋✓ になり、まだ回っていない★・タグが目立つ
- 自分用のタグは「気になる」「新刊」「グッズ」のほか自由に追加できる
- ★・タグ・メモはブラウザの localStorage のみに保存（旧形式の「絶対行く」「気になる」は自動で ★ と「気になる」タグに移行）
- **設定**（画面上部の「i」）: 表示テーマ（自動・ライト・ダーク）と、★・購入済み・タグ・メモの書き出し（ファイル保存・コピー）／読み込み（ファイル・貼り付け。読み込む前に内容を表示し、「今の内容に追加」か「置き換える」を選ぶ）

## ライセンス

MIT License（[LICENSE](LICENSE)）。各イベントのサークル情報・配置図の権利は、それぞれの主催・サークルにあります。
