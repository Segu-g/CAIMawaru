# はじめに — イベントのページを作る

イベントのサークルリスト＋配置図のページを作り、公開するまでの手順です。
サークルとお品書きの登録は、ブラウザの[エディタ](editor.md)でも、[コマンド](cli.md)でもできます（どちらも同じファイルを同じ形で書く）。

## 0. 用意する

- [uv](https://docs.astral.sh/uv/)（イベントデータの CLI。Python 3.10 以上を自動で用意する）。uv を使わない場合は `pip install -e .` で `caimawaru` コマンドが入る
- Node.js（`.node-version`。fnm などで合わせる）と pnpm（ページとエディタ）
- エディタを使うなら PC の Chrome か Edge
- Linux・macOS・Windows で動く

```sh
pnpm install
uv run caimawaru data example     # 架空のサンプルイベント（events/example/）を検証して circles.json を作る
pnpm dev example                  # 表示された URL を開くと、サンプルのページが見られる
```

コマンドはリポジトリのフォルダで実行します。

### エージェントに手伝ってもらう

Claude Code などのコーディングエージェントを、作業の手伝いとして使うことを想定しています。
リポジトリのフォルダでエージェントを起動すると、作業ルール（[CLAUDE.md](../CLAUDE.md)）を読んで動きます。
たとえば、公式リストの取り込み、サークル情報の確認や修正、検証、ビルドを頼めます。

- エージェントは、ファイルを直接書き換えるより[編集コマンド](cli.md)を使い、`--dry-run` で差分と検証結果を見てから書き込みます
- エディタで開いている間にエージェントがファイルを変えても、エディタは保存の前に気づき、上書きしません
- 公開（アップロード）や、公式リストにないアカウントを載せるかどうかは、エージェントに決めさせず、人が判断します

## 1. 主催の方針を確かめる

- サークル一覧・配置図の二次利用について、主催の注意書きを読む
  - 配置図の二次利用が「出展者に限る」などと制限されていれば、`layout.json` を作らず、公式配置図へのリンク（`info.links`）だけにする
- 公式サークルリストがどこで・どの形式で配られているか（Sockbase、配布 CSV、サイトなど）を確かめる。サークル情報の出典は公式リストにする

## 2. フォルダを作る

```sh
uv run caimawaru new-event 2030-05-05-mycon --name "5/5 マイコン" --date 2030-05-05 --venue "○○会館" \
  --sockbase https://list.sockbase.net/circle-lists/xxxx --map   # Sockbase 以外なら --sockbase は付けない
```

- eventId（フォルダ名）は英数字・ハイフン・アンダースコア。日付で始めると並びが分かりやすい
- `--map` で配置図の雛形 `layout.json` も作る（主催が配置図の二次利用を認めているときだけ）
- 同じサイトに複数ページを置くとき（ホールが分かれている等）は、イベントを分けて作り、両方の `info.halls` に相互のリンクを書く

1イベント（1ページ）＝ `events/<eventId>/` の1フォルダです。主催が配る **元データ（任意の形式）** と、
CAIMawaru が読む **イベントデータ**（[event-data.md](event-data.md)）を分けています。

```
events/<eventId>/
  event.json                 設定とイベント情報                     ┐
  layout.json                会場配置図（任意。なければ配置図なし）  │ イベントデータ
  data/circles.csv           サークル情報                            │
  data/menus.csv             お品書きのURL                           ┘
  sources/                   主催の元データ（Sockbase の HTML・配布 CSV など。任意の形式）
  public/data/circles.json   ページが読み込むデータ（uv run caimawaru data が生成。直接編集しない）
```

実在のイベントの `events/<eventId>/` は `.gitignore` でこのリポジトリから外してあります（必要なら別の非公開リポジトリで管理してください）。

## 3. event.json を埋める

エディタの「イベント情報」タブ、`uv run caimawaru config set`、またはファイルの直接編集で書きます。キーは [event-data.md の event.json](event-data.md#eventjson)。

- `storeId` は公開後に変えない（利用者の ★・タグ・メモが読めなくなる）。ほかのイベントと重ならない名前にする
- 修正・削除の依頼先（`info.contact`）を書いておく

### 合同開催の色

- 合同開催なら `info.eventSlots` にイベント名（circles.csv の `event` 列と同じ文字列）→ 枠 1〜5 を書く。枠のないイベントは灰色の「同時開催」
- 既定の色は色覚の違いに配慮した配色（`src/style.css` の `--ev-1〜5`）。`info.slotColors` で変えるときは、配置図で隣り合う島の色が
  色覚の違いでも区別できることを確かめる（例: シミュレータで P 型・D 型・T 型を確認。色だけに頼らず島の記号でも区別できるように）

## 4. サークルとお品書きを集める

集め方ごとに、手順と守ることを書きます。どの場合も、サークル情報の出典を `source` 列に書き、欠席などの事情（健康・家族など）は `notes` に書きません。
サークルカット画像・公式の配置図画像は取り込みません。

### 公式リストを取り込む

主催の元データを `sources/` に置き、`event.json` の `sources` に形式を書いて取り込みます（[importers.md](importers.md)）。

```sh
uv run caimawaru import <eventId> --fetch --dry-run   # Sockbase なら取得もまとめて。まず差分を確認
uv run caimawaru import <eventId> --fetch
```

- Sockbase 以外（配布 CSV・JSON など）は、元データを `sources/` に保存して `type` と `columns` を書く。組み込みで読めない形式はインポーターを足す（[importers.md の「新しい形式」](importers.md#新しい形式)）
- 取り込むのは主催の公式な情報だけ。利用規約で自動取得や二次配布を制限しているサービスからは取得しない
- `--dry-run` で差分を見てから取り込む。取り込み元から消えたサークル（配置変更・参加取り消しの可能性）と、宙に浮いたお品書きが表示される
- `tags`・`notes` など取り込まない列は、取り込み後に編集しても次の取り込みで残る

### 公式リストにないサークルを手で登録する

元データがないイベントや、当日の追加・配置変更などは、エディタの「＋ サークルを追加」（[editor.md](editor.md#サークルの登録と変更)）か
`uv run caimawaru circle add <eventId> space=A-10 name="…" event="…" source="…" --dry-run` で登録します（[cli.md](cli.md#イベントデータを確かめる編集する)）。

- `source` 列に、その情報をどこで確かめたか（主催の告知など）を書く
- サークルの `id` はスペース番号から作られる。公開後に変えない（利用者の ★ が外れる）

### X アカウントを補う

公式リストに X がないサークルの `x` 列を埋めるときの手順です。

- エディタの「お品書き探し」で、X が空のサークルにアカウントの URL（`https://x.com/<ID>`）を貼る。または `uv run caimawaru circle set <eventId> A-01 x=https://x.com/<ID> --dry-run`
- 公式リストにないアカウント（検索で見つけたものなど）を載せるかは、運用者が決める（エージェントは自分で決めて載せない）
- X は人がブラウザで見て確かめる。API・自動操作・スクレイピングでは集めない

### お品書きを集める

お品書きは **投稿の URL へのリンクだけ** を載せます。画像の転載・本文の書き写しはしません。

- エディタ: 「お品書き探し」タブでサークルを1つずつ回り、見つけた投稿の URL を貼る（[editor.md の「お品書き探し」](editor.md#お品書き探し)）
- コマンド: `uv run caimawaru menu <eventId> <URL>…`。X の投稿なら投稿したアカウントからサークルを判定する（[cli.md の「お品書きを登録する」](cli.md#お品書きを登録する)）。
  直し・削除は `uv run caimawaru menus set` / `menus remove`
- X の URL は人が閲覧して集める（API や自動操作は使わない）
- 品目・価格を載せるのは、サークル本人の許可があるときか、X 以外（BOOTH 等）が出典のときだけ

## 5. 配置図を描き起こす（任意）

主催が配置図の二次利用を制限していないときだけ、公式配置図を見ながら `layout.json` に描き起こします（[layout.md](layout.md)）。
公式配置図のスペース数を `expectedSpaces` に書いておくと、数え間違いを検出できます。

## 6. 確かめる

```sh
uv run caimawaru data <eventId>    # 検証して circles.json を作る（エディタで保存したあとも実行する）
pnpm dev <eventId>                 # スマホ幅（〜400px）と PC 幅の両方で見る
```

## 7. ビルドして公開する

```sh
uv run caimawaru data <eventId>
pnpm build <eventId>               # → dist/<eventId>/
```

`dist/<eventId>/` を公開先に置きます。相対パスの静的ファイルなので、GitHub Pages・nginx などどこでも、サブパスでも動きます。
複数のページを同じサイトの下に並べるとき（例: `site/` と `site/hall2/`）の置き場所は、アップロード先で決めます。

- CDN を挟む場合、公開前に **まだ置いていないファイルの公開 URL を開かない**（404 がキャッシュされてページが壊れることがある）
- アップロードは assets/ と data/ を先に、index.html を最後にすると、途中の状態で壊れない
- ページには `noindex` を付けている（イベント後に古い情報が検索に残らないように）

## 8. 当日までの更新

お品書きを足したり直したりしたら、`uv run caimawaru data <eventId>` のあと、`pnpm build <eventId>` で上げ直すか、
公開先の `data/circles.json` だけを差し替えます（ページは `no-cache` で読み込むので、データだけの更新でも反映される）。
