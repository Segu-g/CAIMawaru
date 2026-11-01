# 新しいイベントを追加する

## 1. 主催の方針を確かめる

- サークル一覧・配置図の二次利用について、主催の注意書きを読む
  - 配置図の二次利用が「出展者に限る」などと制限されていれば、`layout.json` を作らず、公式配置図へのリンク（`info.links`）だけにする
- 公式サークルリストの場所（Sockbase など）を確かめる

## 2. フォルダを作る

```sh
pnpm new-event 2030-05-05-mycon --name "5/5 マイコン" --date 2030-05-05 --venue "○○会館" \
  --sockbase https://list.sockbase.net/circle-lists/xxxx --map
```

- slug（フォルダ名）は英数字・ハイフン。日付で始めると並びが分かりやすい
- `--map` で配置図の雛形 `layout.json` も作る
- 同じサイトに複数ページを置くとき（ホールが分かれている等）は、`--out-dir site` と `--out-dir site/hall2` のように入れ子にし、
  両方の `info.halls` に相互のリンク（相対パス）を書く

## 3. event.json を埋める

[README の event.json の表](../README.md#eventjson) を参照。

- `storeId` は公開後に変えない（利用者の ★・タグが読めなくなる）。ほかのイベントと重ならない名前にする
- 合同開催なら `info.eventSlots` にイベント名（circles.csv の `event` 列と同じ文字列）→ 枠 1〜5 を書く
- 色を変えるときは `info.slotColors`。配置図で隣り合う島の色が、色覚の違いでも区別できることを確かめる
  （例: シミュレータで P 型・D 型・T 型を確認。色だけに頼らず島の記号でも区別できるように）

## 4. サークル情報を入れる

### Sockbase から取り込む

公式リストは JavaScript で描画されるため、描画済みの HTML を保存してから取り込みます。

```sh
mkdir -p /tmp/sockbase
google-chrome --headless=new --virtual-time-budget=15000 --dump-dom <sockbase の URL> > /tmp/sockbase/list.html
EVENT=<slug> pnpm import:sockbase /tmp/sockbase/list.html
EVENT=<slug> pnpm data
```

- スペース・サークル名・ペンネーム・リンク・成人向け有無・お品書き URL は毎回上書き
- 手で書いた `tags` / `booth` / `notes` と、手で追加した `menus.csv` の行は残る
- 公式リストから消えたサークルは画面に表示される（配置変更・参加取り消し）

### 手で入れる

`events/<slug>/data/circles.csv` に行を追加し、`EVENT=<slug> pnpm data`。エラーがあると `circles.json` は更新されません。

## 5. 配置図を描き起こす（任意）

[docs/layout.md](layout.md) を参照。公式配置図のスペース数を `expectedSpaces` に書いておくと、数え間違いを検出できます。

## 6. 確かめる

```sh
EVENT=<slug> pnpm data
EVENT=<slug> pnpm dev     # スマホ幅（〜400px）と PC 幅の両方で見る
pnpm test                 # 全サークルのスペースが配置図にあるか等
pnpm build <slug>
```

## 7. 公開・当日の更新

- `dist/<outDir>/` を公開先に置く（README の「公開」）
- お品書きは `EVENT=<slug> pnpm menu <URL>` で追加し、`pnpm build <slug>` か `data/circles.json` の差し替えで反映
