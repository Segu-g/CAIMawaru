# CAIMawaru

**C**ircle **A**rea **I**tinerary — 会場のサークルスペースを巡って「買い回る」ためのツール。

同人誌即売会の **サークルリスト＋会場配置図** のページを、イベントごとの設定ファイルと CSV から作る静的サイトです。
スマホで当日会場を回ることを前提に、配置図・検索・★／タグ／購入済みのチェック・お品書きリンクをまとめて表示します。

- Vite + React + TypeScript（ページ）／ Python 3（データの生成・検証・取り込み。標準ライブラリのみ）
- イベントに依存する情報はすべて `events/<slug>/` に置き、コードには書かない
- 出力は相対パスの静的ファイルなので、GitHub Pages・nginx などどこにでも置ける

`events/example/` に架空のサンプルイベントがあります。実在のイベントのデータは `.gitignore` でリポジトリから外してあり、
手元の `events/<slug>/` に置いて使います（必要なら別の非公開リポジトリで管理してください）。

```sh
pnpm install
EVENT=example pnpm data     # CSV → circles.json を生成・検証
EVENT=example pnpm dev      # 開発サーバ
```

## 必要なもの

- Node.js（`.node-version`。fnm などで合わせる）と pnpm
- Python 3.10 以上
- Sockbase から取り込む場合は Google Chrome（headless で描画済み HTML を保存するため）

## イベントの置き方

1イベント（1ページ）＝ `events/<slug>/` の1フォルダです。

```
events/<slug>/
  event.json                 設定とイベント情報（手で編集）
  layout.json                会場配置図（任意。なければ配置図なしのページになる）
  data/circles.csv           サークル情報（手で編集・公式リストから取り込み）
  data/menus.csv             お品書きのURL（手で編集・pnpm menu）
  public/data/circles.json   ページが読み込むデータ（pnpm data が生成。手で編集しない）
```

新しいイベントは `pnpm new-event <slug>` で作ります。手順は [docs/new-event.md](docs/new-event.md)、
配置図の書き方は [docs/layout.md](docs/layout.md) にあります。

### event.json

| キー | 必須 | 内容 |
|---|---|---|
| `storeId` | ✓ | ★・タグ・メモの保存先（localStorage のキー）。**公開後に変えると利用者の保存内容が読めなくなる** |
| `title` | ✓ | ページの `<title>` |
| `outDir` | | `dist/` の下の出力先（既定は slug）。1つのサイトに複数ページを置くときは `site` と `site/sub` のように入れ子にする |
| `sockbase` | | Sockbase の公式サークルリストの URL（取り込み元。`source` 列にもなる） |
| `info.name` / `date` / `venue` / `hours` | | ページに出すイベント名・日付・会場・時間 |
| `info.links` | | 公式サイトなどのリンク `[{ "label", "url" }]` |
| `info.hashtags` | | 「Xでシェア」に付けるハッシュタグ |
| `info.eventSlots` | | 合同開催のイベント名 → 色の枠（1〜5）。載っていないイベントは灰色の「同時開催」 |
| `info.slotColors` | | 枠ごとの色の上書き `{ "1": { "light", "dark", "ink", "darkInk" } }`（既定は `src/style.css` の `--ev-1〜5`） |
| `info.halls` | | 同じサイト内の別ページへの切り替え `[{ "label", "url", "current" }]`（url は相対パス） |
| `info.contact` | | 修正・削除の依頼先 `{ "label", "url" }`（X の URL ならヘッダーに X のボタンも出る） |

### circles.csv / menus.csv

| ファイル | 列 |
|---|---|
| `circles.csv` | `id, space, event, name, kana, penNames, tags, adult, x, pixiv, booth, web, notes, source` |
| `menus.csv` | `id, url, note, checkedAt`（`id` は circles.csv の id。1サークル複数行可） |

- `space` は複数スペースなら `A-01,A-02` のように `,` 区切り
- `id` は空欄ならスペース番号から自動生成（`A-10` → `a-10`）
- `penNames` / `tags` は `;` 区切り、`adult` は成人向け頒布物ありなら `1`
- `#` で始まる行と空行は無視

## コマンド

イベントを対象にするコマンドは、環境変数 `EVENT` にフォルダ名を指定します。

| コマンド | 内容 |
|---|---|
| `pnpm new-event <slug> [--map] [--sockbase URL] …` | イベントのフォルダを作る |
| `EVENT=<slug> pnpm data` | CSV・設定・配置図を検証して `circles.json` を生成（`--check` で検証のみ） |
| `EVENT=<slug> pnpm dev` | 開発サーバ |
| `EVENT=<slug> pnpm menu <URL>…` | お品書きを登録（下記） |
| `EVENT=<slug> pnpm import:sockbase <html>` | Sockbase の公式サークルリストを取り込む |
| `pnpm build [<slug>…]` | 型チェック・データ検証のうえ全イベント（または指定イベント）を `dist/` にビルド |
| `pnpm check` | 全イベントのデータを検証 |
| `pnpm test` | テスト（配置図の組み立て・検索・保存形式など。生成済みの全イベントの配置図も確かめる） |

### お品書きを登録する

```sh
EVENT=<slug> pnpm menu https://x.com/<ID>/status/<番号>             # 投稿したアカウントからサークルを自動判定
EVENT=<slug> pnpm menu URL1 URL2 URL3                               # まとめて
EVENT=<slug> pnpm menu --circle A-05 --note 新刊 https://booth.pm/… # X 以外はサークルを指定
EVENT=<slug> pnpm menu -                                            # 1行ずつ貼り付け。Ctrl+D で終了
```

サークル指定はスペース番号・id・サークル名の一部・@X の ID のどれでもよく、登録後に `pnpm data` まで自動で実行します。

## 情報の集め方（方針）

- サークル名・スペース番号などの元データは **主催の公式サークル一覧** から作り、出典を `source` 列に書く
- お品書きは **投稿 URL へのリンクのみ** 掲載する。画像の転載・本文の書き写しはしない
- X は API や自動操作で収集しない（X の利用規約・開発者規約のため）。URL は人が閲覧して集める
- 品目・価格を載せる場合は、サークル本人の許可を得るか、X 以外（BOOTH 等）を出典にする
- 配置図は、主催が配置図の二次利用を制限していない場合だけ描き起こす（公式画像は転載しない）。制限があれば `layout.json` を置かず、公式配置図へのリンクだけにする
- サークルカット画像は取り込まない
- 公式リストに載っていないアカウントは載せない。欠席などの理由は書かない

## 公開

`pnpm build` で `dist/<outDir>/` ができるので、それを公開先に置きます（相対パス出力なのでサブパスでも可）。
データだけの更新なら、公開先の `data/circles.json` を差し替えるだけでも反映されます（ページは `no-cache` で読み込む）。

- CDN を挟む場合、公開前に **まだ置いていないファイルの公開 URL を開かない** でください。404 がキャッシュされてページが壊れることがあります（assets のファイル名にはビルドごとの接尾辞を付けて、事故を減らしています）
- アップロードは assets/ と data/ を先に、index.html を最後にすると、途中の状態で壊れません
- ページには `noindex` を付けています（イベント後に古い情報が検索に残らないように）

## 構成

| パス | 役割 |
|---|---|
| `events/` | イベントごとの設定とデータ |
| `src/` | ページ本体（React）。イベント固有の値は持たない |
| `src/layout.ts` | `layout.json` から配置図のセル・ラベルを組み立てる |
| `src/filter.ts` | 検索・絞り込み・並べ替え |
| `src/useMine.ts` | 閲覧者の ★・タグ・メモ（localStorage のみに保存） |
| `src/components/SpaceMap.tsx` | 配置図の描画とタッチ操作 |
| `tools/build.py` | CSV・設定・配置図の検証と `circles.json` の生成 |
| `tools/import_sockbase.py` | Sockbase の公式サークルリストの取り込み |
| `tools/add_menu.py` | お品書き URL の登録 |
| `tools/new_event.py` | イベントの雛形作成 |
| `scripts/` | 全イベントのビルド・検証 |

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
