# 新しいイベントを追加する

## 1. 主催の方針を確かめる

- サークル一覧・配置図の二次利用について、主催の注意書きを読む
  - 配置図の二次利用が「出展者に限る」などと制限されていれば、`layout.json` を作らず、公式配置図へのリンク（`info.links`）だけにする
- 公式サークルリストがどこで・どの形式で配られているか（Sockbase、配布 CSV、サイトなど）を確かめる

## 2. フォルダを作る

```sh
pnpm new-event 2030-05-05-mycon --name "5/5 マイコン" --date 2030-05-05 --venue "○○会館" \
  --sockbase https://list.sockbase.net/circle-lists/xxxx --map   # Sockbase 以外なら --sockbase は付けない
```

- slug（フォルダ名）は英数字・ハイフン。日付で始めると並びが分かりやすい
- `--map` で配置図の雛形 `layout.json` も作る
- 同じサイトに複数ページを置くとき（ホールが分かれている等）は、`--out-dir site` と `--out-dir site/hall2` のように入れ子にし、
  両方の `info.halls` に相互のリンク（相対パス）を書く

## 3. event.json を埋める

[format.md の event.json](format.md#eventjson) を参照。

- `storeId` は公開後に変えない（利用者の ★・タグが読めなくなる）。ほかのイベントと重ならない名前にする
- 合同開催なら `info.eventSlots` にイベント名（circles.csv の `event` 列と同じ文字列）→ 枠 1〜5 を書く
- 色を変えるときは `info.slotColors`。配置図で隣り合う島の色が、色覚の違いでも区別できることを確かめる
  （例: シミュレータで P 型・D 型・T 型を確認。色だけに頼らず島の記号でも区別できるように）

## 4. サークル情報を入れる

主催の元データを `sources/` に置き、`event.json` の `sources` に形式を書いて取り込みます（[importers.md](importers.md)）。

```sh
EVENT=<slug> pnpm import-circles --fetch --dry-run   # Sockbase なら取得もまとめて。まず差分を確認
EVENT=<slug> pnpm import-circles --fetch
```

- Sockbase 以外（配布 CSV・JSON など）は、元データを `sources/` に保存して `type` と `columns` を書く
- 組み込みで読めない形式は、イベントのフォルダに Python のインポーターを置く（type: python）
- 元データがなければ、`data/circles.csv` に直接書いてもよい（[format.md](format.md)）
- 取り込み後も `tags`・`notes` など取り込まない列は手で書ける。次の取り込みでも残る

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
