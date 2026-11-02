# イベントデータ（CAIMawaru が読むもの）

CAIMawaru がページを作るときに読むのは、この文書で決めた形のファイルだけです。
主催が配るデータの形式はイベントごとにばらばらなので、[インポーター](importers.md)で必ずこの形に変換してから使います。

```
主催の元データ（任意の形式）            イベントデータ（この文書）              ページ
events/<eventId>/sources/…   ──取り込み──▶  events/<eventId>/event.json      ──uv run caimawaru data──▶  public/data/circles.json
                          uv run          events/<eventId>/layout.json
                          caimawaru       events/<eventId>/data/circles.csv
                          import          events/<eventId>/data/menus.csv
```

- **eventId**: イベントを指す ID。`events/` の下のフォルダ名で、英数字・ハイフン・アンダースコア（例: `example`、`2030-05-05-mycon`）。
  コマンドでは `pnpm dev <eventId>` のように指定し、`storeId` の既定値と、ページの出力先（`dist/<eventId>/`）にもなる
- イベントデータは人もエージェントも直接編集してよい（取り込みは「取り込んだ列」だけを上書きし、それ以外は残す）
- 直接編集は、ファイルを書き換えるほか、`uv run caimawaru circle` / `menus` / `config` でもできる（README の「イベントデータを確かめる・編集する」）。
  コマンドは変更前 → 変更後を表示し（`--dry-run` は表示だけ）、変更で検証エラーが増えるなら書き込まない。
  エラーが増えたかは行番号を除いたメッセージで比べるので、同じ内容のエラーが別の行で出たり消えたりすると見分けられない。
  CSV は下の「CSV の書き方」の形で書き戻す
- ブラウザのエディタ（`pnpm editor`。README の「GUI で編集する」）でも編集でき、CSV は下の「CSV の書き方」の形で書き戻す
- `public/data/circles.json` は生成物で、直接編集しない
- 検証は `uv run caimawaru data <eventId> --check`（`tools/caimawaru/build.py`）。エラーがあると `circles.json` は更新されない

## event.json

イベントの設定とページに出すイベント情報。取り込みや生成では作られないので、人かエージェントが直接編集する
（`uv run caimawaru config set <eventId> info.venue "…"` のようにキーを `.` でつないで変えることもできる。ほかのキーと順は保つ）。

| キー | 必須 | 内容 |
|---|---|---|
| `storeId` | ✓ | ★・タグ・メモの保存先（localStorage のキー）。**公開後に変えると利用者の保存内容が読めなくなる** |
| `title` | ✓ | ページの `<title>` |
| `sources` | | 取り込み元の一覧（[importers.md](importers.md)）。イベントデータを直接書くイベントでは不要 |
| `info.name` / `date` / `venue` / `hours` | | イベント名・日付（YYYY-MM-DD）・会場・時間 |
| `info.links` | | 公式サイトなどのリンク `[{ "label", "url" }]` |
| `info.hashtags` | | 「Xでシェア」に付けるハッシュタグ |
| `info.eventSlots` | | 合同開催のイベント名（circles.csv の `event` と同じ文字列）→ 色の枠（1〜5）。載っていないイベントは灰色の「同時開催」 |
| `info.slotColors` | | 枠ごとの色の上書き `{ "1": { "light", "dark", "ink", "darkInk" } }`（既定は `src/style.css` の `--ev-1〜5`） |
| `info.halls` | | 同じサイト内の別ページへの切り替え `[{ "label", "url", "current" }]`（url は相対パス） |
| `info.contact` | | 修正・削除の依頼先 `{ "label", "url" }`（X の URL ならヘッダーに X のボタンも出る） |

## data/circles.csv

1行1サークル。UTF-8、最初の行（空行と `#` の行を除く）が列名。空行（値がすべて空の行も）と `#` の行（最初の値が `#` で始まる行。サークルの行をコメントにしたものも）は無視する。細かい読み方は下の「CSV の書き方」。

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
| `x` / `pixiv` / `booth` / `web` | | 各リンクの URL（http/https）。`x` は `https://x.com/<ID>` の形で書く（お品書きの照合では `twitter.com`・`www.`・`mobile.`・`?lang=ja` なども読む。照合できない URL は検証で警告） |
| `notes` | | 補足。欠席などの事情（健康・家族など）は書かない |
| `source` | | 情報の出典（公式リストの URL など） |

## data/menus.csv

お品書きのリンク。1サークル複数行可。

| 列 | 必須 | 内容 |
|---|---|---|
| `id` | ✓ | circles.csv の id |
| `url` | ✓ | お品書きの URL。X の投稿は `https://x.com/<ID>/status/<番号>`（画像の転載・本文の書き写しはしない）。`twitter.com`・`www.`・`mobile.`・`?s=20` などの付いた投稿も、`circles.json` ではこの形にそろえる |
| `note` | | リンク名に添える説明（例: 新刊） |
| `checkedAt` | | 確認した日（YYYY-MM-DD） |

## CSV の書き方（保存時の形）

CLI（`import`・`menu`・`circle`・`menus`）とページ側の編集画面は、circles.csv・menus.csv を同じ規則で読み、同じ形で保存する
（`tools/caimawaru/project.py` の `read_table`・`format_csv`）。この形で保存されたファイルなら、どれで保存しても変えた行だけが差分になる。
読み込みを止めるのは、受け付けて保存し直すとデータが失われるか変わってしまうときだけ（いまは CSV として読めないときだけ）で、
それ以外の気になる点は検証（`check`）と編集コマンドの警告で知らせる。

### 読み方

1. UTF-8 として読む（先頭の BOM は無視する）。改行は CRLF・LF のどちらでもよい
2. CSV として区切る（`,` 区切り、`"` で囲んだ値の中の `""` は `"`、囲んだ値の中の改行は値の一部）。
   **CSV として読めないとき**（`"` で始めた値が閉じずにファイルが終わる、閉じた `"` の直後が `,` でも改行でもない）と、
   UTF-8 でないときは、エラーにして読まない（`menus.csv: 3行目から始まる行を CSV として読めません（…）`。行番号は読めない行が始まった行）
3. 値がない行（空行）と、値がすべて空か空白だけの行（`,,,`・` , ` など）は飛ばす（見出しの前でも後でも）
4. 最初の値が `#` で始まる行は **`#` の行**（コメント）。見出しの前にあってもよい。値は数も中身もそのまま持つ
5. それ以外で最初の行が **見出し**。見出しの各列は次のどれか
   - 上の表の列名（`id`・`space`…）の、最初に出てきたもの → その列
   - それ以外（表にない列名・空の列名・2回目以降に出てきた表の列名）→ **ファイルにだけある列**。名前ではなく位置で扱う
6. 見出しより後の行は、値が見出しより多ければ `#` の行にする（下の「保存する形」）。そうでなければデータの行で、足りない値は空

警告（データは失わない）:

| 場合 | 警告 |
|---|---|
| 見出しに上の表の列が1つもない | `circles.csv: サークルの列が見つかりません（…）`・`menus.csv: お品書きの列が見つかりません（…）` |
| 上の表の列名が2回以上ある | `circles.csv: name 列が2つあります。最初の列を使います` |
| 値が見出しより多い行 | `menus.csv: 3行目は見出しより列が多いため、コメント行にしました`（行番号はファイルの行） |

`id` 列がない見出しは警告しない（circles.csv の id はいままでどおりスペース番号から作る）。

### 保存する形

- 文字コードは UTF-8（BOM なし）、改行は CRLF（最後の行のあとにも）
- 値は必要なときだけ `"` で囲み、値の中の `"` は `""` にする（`,`・`"`・CR・LF を含む値。Python の `csv` の既定 `QUOTE_MINIMAL`）
- 並びは「見出しより前の `#` の行（元の順）」→「見出し」→「見出しより後の行（元の順）」
- 見出しは、上の表の列を表の順にすべて並べ（ファイルになかった列も足す）、そのあとにファイルにだけある列を元の順で、
  元の列名のまま（空なら空、重複していればそのまま）続ける。見出しを値の多い行に合わせて広げることはしない
- データの行は、見出しの各列の値（足りない値・ファイルになかった列は空）
- `#` の行は、読んだときの値をそのまま書く（値の数は見出しと違ってよく、埋めも削りもしない）
- 値が見出しより多かった行は、最初の値の頭に `#` を付け、ほかはそのままの `#` の行にする（`a-01,A-01,…` → `#a-01,A-01,…`、最初の値が空なら `#`）。
  検証・ページのデータには入らない。`#` を外し、見出しを直せば元に戻せる
- 空行と、値がすべて空（空白だけ）の行は書かない
- `#` の行の値は元の並びのままなので、見出しの列が上の順でなかったファイルでは、書き直した見出しと `#` の行の列がずれる（外すときは列を並べ直す）
- `import` は取り込み結果の順に並べ直すので、見出しより後の `#` の行は元のファイルで次にあったサークルの前に置く
  （そのサークルが消えたら次に残るサークルの前、なければ最後）。見出しより前の `#` の行はそのまま見出しの前

例（menus.csv。`␍␊` は CRLF）:

| 読むファイル | 保存する内容 |
|---|---|
| `id,url,note,checkedAt␊a-01,https://example.com/m,,2030-01-01␊␊`（BOM・LF・空行） | `id,url,note,checkedAt␍␊a-01,https://example.com/m,,2030-01-01␍␊` |
| `␍␊ , ␍␊# 前書き,"a,b"␍␊id,url,note,checkedAt␍␊a-01,https://example.com/m,,␍␊` | `# 前書き,"a,b"␍␊id,url,note,checkedAt␍␊a-01,https://example.com/m,,␍␊` |
| `url,note␍␊https://example.com/m,x␍␊`（id 列がない） | `id,url,note,checkedAt␍␊,https://example.com/m,x,␍␊` |
| `a,b␍␊1,2␍␊`（表の列がない。警告） | `id,url,note,checkedAt,a,b␍␊,,,,1,2␍␊` |
| `id,url,note,note␍␊a-01,https://example.com/m,a,b␍␊`（警告） | `id,url,note,checkedAt,note␍␊a-01,https://example.com/m,a,,b␍␊` |
| `id,id,url,note,checkedAt,extra␍␊a-01,https://example.com/m,a,b␍␊`（警告。2つ目の `id` はファイルにだけある列） | `id,url,note,checkedAt,id,extra␍␊a-01,a,b,,https://example.com/m,␍␊` |
| `id,url,note,checkedAt␍␊a-01,https://example.com/m,a,b,extra␍␊`（2行目に警告） | `id,url,note,checkedAt␍␊#a-01,https://example.com/m,a,b,extra␍␊` |
| `id,url␍␊a-01,https://example.com/m␍␊a-02,https://example.com/n,"x,y"␍␊,u,e␍␊`（3・4行目に警告） | `id,url,note,checkedAt␍␊a-01,https://example.com/m,,␍␊#a-02,https://example.com/n,"x,y"␍␊#,u,e␍␊` |
| `# だけ␍␊`（`#` の行だけ） | `# だけ␍␊id,url,note,checkedAt␍␊` |
| `id,url,note,checkedAt␍␊# メモ, 続き␍␊a-01,https://example.com/m␍␊` | `id,url,note,checkedAt␍␊# メモ, 続き␍␊a-01,https://example.com/m,,␍␊` |
| `checkedAt,note,url,id,by␍␊2030-01-01,,https://example.com/m,a-01,人␍␊` | `id,url,note,checkedAt,by␍␊a-01,https://example.com/m,,2030-01-01,人␍␊` |
| `id,url,note,checkedAt,␍␊a-01,https://example.com/m,,,名前のない列␍␊` | `id,url,note,checkedAt,␍␊a-01,https://example.com/m,,,名前のない列␍␊` |

編集コマンドで名前を指定して変えられるのは、上の表の列と、列名が空でなく1つだけ（表の列名とも違う）のファイルにだけある列。

## layout.json

会場配置図（任意）。書き方は [layout.md](layout.md)。ないイベントは配置図なしのページになる。
