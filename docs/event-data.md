# イベントデータ（CAIMawaru が読むもの）

CAIMawaru がページを作るときに読むのは、この文書で決めた形のファイルだけです。
主催が配るデータの形式はイベントごとにばらばらなので、[インポーター](importers.md)で必ずこの形に変換してから使います。

```
主催の元データ（任意の形式）            イベントデータ（この文書）              ページ
events/<eventId>/sources/…   ──取り込み──▶  events/<eventId>/event.json      ──pnpm data──▶  public/data/circles.json
                          pnpm import-    events/<eventId>/layout.json
                          circles         events/<eventId>/data/circles.csv
                                          events/<eventId>/data/menus.csv
```

- **eventId**: イベントを指す ID。`events/` の下のフォルダ名で、英数字・ハイフン・アンダースコア（例: `example`、`2030-05-05-mycon`）。
  コマンドでは `pnpm dev <eventId>` のように指定し、`storeId` と出力先（`dist/<eventId>/`）の既定値にもなる
- イベントデータは人もエージェントも直接編集してよい（取り込みは「取り込んだ列」だけを上書きし、それ以外は残す）
- `public/data/circles.json` は生成物で、直接編集しない
- 検証は `pnpm data <eventId> --check`（`tools/build.py`）。エラーがあると `circles.json` は更新されない

## event.json

イベントの設定とページに出すイベント情報。取り込みや生成では作られないので、人かエージェントが直接編集する。

| キー | 必須 | 内容 |
|---|---|---|
| `storeId` | ✓ | ★・タグ・メモの保存先（localStorage のキー）。**公開後に変えると利用者の保存内容が読めなくなる** |
| `title` | ✓ | ページの `<title>` |
| `outDir` | | `dist/` の下の出力先（既定は eventId）。1つのサイトに複数ページを置くときは `site` と `site/sub` のように入れ子にする |
| `sources` | | 取り込み元の一覧（[importers.md](importers.md)）。イベントデータを直接書くイベントでは不要 |
| `info.name` / `date` / `venue` / `hours` | | イベント名・日付（YYYY-MM-DD）・会場・時間 |
| `info.links` | | 公式サイトなどのリンク `[{ "label", "url" }]` |
| `info.hashtags` | | 「Xでシェア」に付けるハッシュタグ |
| `info.eventSlots` | | 合同開催のイベント名（circles.csv の `event` と同じ文字列）→ 色の枠（1〜5）。載っていないイベントは灰色の「同時開催」 |
| `info.slotColors` | | 枠ごとの色の上書き `{ "1": { "light", "dark", "ink", "darkInk" } }`（既定は `src/style.css` の `--ev-1〜5`） |
| `info.halls` | | 同じサイト内の別ページへの切り替え `[{ "label", "url", "current" }]`（url は相対パス） |
| `info.contact` | | 修正・削除の依頼先 `{ "label", "url" }`（X の URL ならヘッダーに X のボタンも出る） |

## data/circles.csv

1行1サークル。UTF-8、1行目は列名。空行と `#` で始まる行は無視する。

| 列 | 必須 | 内容 |
|---|---|---|
| `id` | | サークルの識別子（英数字とハイフン）。空欄ならスペース番号から作る（`A-10` → `a-10`）。menus.csv や閲覧者の ★ が参照するので、公開後は変えない |
| `space` | | スペース番号。複数なら `A-01,A-02`。配置図があるイベントでは配置図に存在する番号であること |
| `event` | | 参加イベント名（合同開催のどれか） |
| `name` | ✓ | サークル名 |
| `kana` | | サークル名の読み（検索と並べ替えに使う） |
| `penNames` | | 作家名。複数は `;` 区切り |
| `tags` | | 掲載側で付けるタグ。`;` 区切り |
| `adult` | | 成人向け頒布物があれば `1`、なければ `0` か空欄 |
| `x` / `pixiv` / `booth` / `web` | | 各リンクの URL（http/https） |
| `notes` | | 補足。欠席などの事情（健康・家族など）は書かない |
| `source` | | 情報の出典（公式リストの URL など） |

## data/menus.csv

お品書きのリンク。1サークル複数行可。

| 列 | 必須 | 内容 |
|---|---|---|
| `id` | ✓ | circles.csv の id |
| `url` | ✓ | お品書きの URL。X の投稿は `https://x.com/<ID>/status/<番号>`（画像の転載・本文の書き写しはしない） |
| `note` | | リンク名に添える説明（例: 新刊） |
| `checkedAt` | | 確認した日（YYYY-MM-DD） |

## layout.json

会場配置図（任意）。書き方は [layout.md](layout.md)。ないイベントは配置図なしのページになる。
