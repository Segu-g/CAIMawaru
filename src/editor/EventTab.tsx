// event.json の編集。storeId・title と、ページに出すイベント情報（info）。ほかのキーはそのまま残す。
import { useMemo, useState } from 'react';
import type { Doc } from './doc';
import { infoOf, setInfo, setTop, type Dirty } from './edit';
import { isDataRow, type Json, type JsonObject, type Link } from './model';
import type { Issue } from './validate';

type Props = {
  doc: Doc;
  issues: Issue[];
  edit: (fn: (doc: Doc) => Doc, ...which: (keyof Dirty)[]) => void;
};

const str = (v: Json | undefined) => (typeof v === 'string' ? v : '');
const isObj = (v: Json | undefined): v is JsonObject => !!v && typeof v === 'object' && !Array.isArray(v);

// 画面で編集する info のキー（それ以外は表示だけして残す）
const EDITED = ['name', 'date', 'venue', 'hours', 'links', 'hashtags', 'eventSlots', 'contact'];

export default function EventTab({ doc, issues, edit }: Props) {
  const event = doc.event;
  const info = infoOf(event);
  const [unlock, setUnlock] = useState(false);
  const change = (fn: (e: JsonObject) => JsonObject) => edit((d) => ({ ...d, event: fn(d.event) }), 'event');
  const setI = (key: string, value: Json | undefined) => change((e) => setInfo(e, key, value));

  // リンクは label・url 以外のキーも残すため、元のオブジェクトを書き換える
  const links: JsonObject[] = Array.isArray(info.links) ? info.links.map((l) => (isObj(l) ? l : {})) : [];
  const hashtags: string[] = Array.isArray(info.hashtags) ? info.hashtags.map((t) => str(t)) : [];
  const slots: [string, Json][] = isObj(info.eventSlots) ? Object.entries(info.eventSlots) : [];
  const contact = isObj(info.contact) ? info.contact : null;
  const others = [
    ...Object.keys(event).filter((k) => !['storeId', 'title', 'info'].includes(k)),
    ...Object.keys(info).filter((k) => !EDITED.includes(k)).map((k) => `info.${k}`),
  ];
  const mine = issues.filter((i) => i.where === 'event');

  // circles.csv に出てくる参加イベント（eventSlots の候補）
  const circleEvents = useMemo(
    () => [...new Set(doc.circles.filter((c) => isDataRow(c.values)).map((c) => c.values.event.trim()).filter(Boolean))].sort(),
    [doc.circles],
  );
  const unslotted = circleEvents.filter((ev) => !slots.some(([k]) => k === ev));

  const setLinks = (next: JsonObject[]) => setI('links', next);
  const setLink = (i: number, key: keyof Link, value: string) => setLinks(links.map((x, j) => (j === i ? { ...x, [key]: value } : x)));
  const setSlots = (next: [string, Json][]) => setI('eventSlots', Object.fromEntries(next));

  return (
    <section className="ed-event">
      {mine.length > 0 && (
        <ul className="ed-inline-issues">
          {mine.map((i, n) => <li key={n} className={i.level}>{i.message}</li>)}
        </ul>
      )}

      <h2>ページの設定</h2>
      <div className="ed-box danger">
        <p>
          <strong>storeId は公開後に変えないでください。</strong>
          閲覧者の ★・タグ・メモ・購入済みは storeId ごとにブラウザに保存されているので、変えると全員の保存内容が読めなくなります。
        </p>
        <label className="ed-check">
          <input type="checkbox" checked={unlock} onChange={(e) => setUnlock(e.target.checked)} />
          まだ公開していないので storeId を変える
        </label>
      </div>
      <div className="ed-fields">
        <label>
          <span>storeId（必須）</span>
          <input value={str(event.storeId)} readOnly={!unlock} onChange={(e) => change((ev) => setTop(ev, 'storeId', e.target.value))} className="ed-mono" />
          <small>★・タグ・メモの保存先（localStorage のキー）</small>
        </label>
        <label>
          <span>title（必須）</span>
          <input value={str(event.title)} onChange={(e) => change((ev) => setTop(ev, 'title', e.target.value))} />
          <small>ページの &lt;title&gt;</small>
        </label>
      </div>

      <h2>イベント情報（info）</h2>
      <div className="ed-fields">
        <label>
          <span>イベント名（name）</span>
          <input value={str(info.name)} onChange={(e) => setI('name', e.target.value)} />
        </label>
        <label>
          <span>日付（date）</span>
          <input value={str(info.date)} onChange={(e) => setI('date', e.target.value)} placeholder="YYYY-MM-DD" />
        </label>
        <label>
          <span>会場（venue）</span>
          <input value={str(info.venue)} onChange={(e) => setI('venue', e.target.value)} />
        </label>
        <label>
          <span>時間（hours）</span>
          <input value={str(info.hours)} onChange={(e) => setI('hours', e.target.value)} placeholder="開場 11:00 / 閉会 15:00" />
        </label>
      </div>

      <h3>リンク（links）</h3>
      <p className="meta">公式サイトなど。ページのイベント情報に並ぶ</p>
      <div className="ed-pairs">
        {links.map((l, i) => (
          <div className="ed-pair" key={i}>
            <input value={str(l.label)} onChange={(e) => setLink(i, 'label', e.target.value)} placeholder="表示名" aria-label="リンクの表示名" />
            <input type="url" value={str(l.url)} onChange={(e) => setLink(i, 'url', e.target.value)} placeholder="https://…" aria-label="リンクの URL" />
            <span className="ed-pair-actions">
              <button type="button" disabled={i === 0} onClick={() => setLinks(links.map((x, j) => (j === i - 1 ? links[i] : j === i ? links[i - 1] : x)))} aria-label="上へ">↑</button>
              <button type="button" className="danger" onClick={() => setLinks(links.filter((_, j) => j !== i))}>削除</button>
            </span>
          </div>
        ))}
        <div>
          <button type="button" onClick={() => setLinks([...links, { label: '', url: '' }])}>＋ リンクを追加</button>
        </div>
      </div>

      <h3>ハッシュタグ（hashtags）</h3>
      <p className="meta">「Xでシェア」に付ける。「#」は付けない</p>
      <div className="ed-pairs">
        {hashtags.map((t, i) => (
          <div className="ed-pair narrow" key={i}>
            <input value={t} onChange={(e) => setI('hashtags', hashtags.map((x, j) => (j === i ? e.target.value : x)))} aria-label="ハッシュタグ" />
            <span className="ed-pair-actions">
              <button type="button" className="danger" onClick={() => setI('hashtags', hashtags.filter((_, j) => j !== i))}>削除</button>
            </span>
          </div>
        ))}
        <div>
          <button type="button" onClick={() => setI('hashtags', [...hashtags, ''])}>＋ ハッシュタグを追加</button>
        </div>
      </div>

      <h3>イベントの色（eventSlots）</h3>
      <p className="meta">合同開催のイベント名（circles.csv の参加イベントと同じ文字列）→ 色の枠 1〜5。載っていないイベントは灰色の「同時開催」</p>
      <div className="ed-pairs">
        {slots.map(([name, n], i) => (
          <div className="ed-pair" key={i}>
            <input value={name} onChange={(e) => setSlots(slots.map((x, j) => (j === i ? [e.target.value, x[1]] : x)))} list="ed-circle-events" aria-label="イベント名" />
            <select value={String(n)} onChange={(e) => setSlots(slots.map((x, j) => (j === i ? [x[0], Number(e.target.value)] : x)))} aria-label="色の枠">
              {[1, 2, 3, 4, 5].map((k) => <option key={k} value={String(k)}>枠 {k}</option>)}
              {![1, 2, 3, 4, 5].includes(n as number) && <option value={String(n)}>{String(n)}（不正な値）</option>}
            </select>
            <span className="ed-pair-actions">
              <button type="button" className="danger" onClick={() => setSlots(slots.filter((_, j) => j !== i))}>削除</button>
            </span>
          </div>
        ))}
        <datalist id="ed-circle-events">
          {circleEvents.map((ev) => <option key={ev} value={ev} />)}
        </datalist>
        <div className="ed-row-buttons">
          <button type="button" onClick={() => setSlots([...slots, [unslotted[0] ?? '', Math.min(slots.length + 1, 5)]])}>＋ イベントを追加</button>
          {unslotted.length > 0 && <span className="meta">色の枠がない参加イベント: {unslotted.join('・')}</span>}
        </div>
      </div>

      <h3>修正・削除の依頼先（contact）</h3>
      <p className="meta">X の URL ならヘッダーに X のボタンも出る。両方を空欄にすると contact を消す</p>
      <div className="ed-pairs">
        <div className="ed-pair">
          <input
            value={str(contact?.label)}
            onChange={(e) => setI('contact', e.target.value || str(contact?.url) ? { ...(contact ?? {}), label: e.target.value, url: str(contact?.url) } : undefined)}
            placeholder="表示名"
            aria-label="依頼先の表示名"
          />
          <input
            type="url"
            value={str(contact?.url)}
            onChange={(e) => setI('contact', e.target.value || str(contact?.label) ? { ...(contact ?? {}), label: str(contact?.label), url: e.target.value } : undefined)}
            placeholder="https://…"
            aria-label="依頼先の URL"
          />
        </div>
      </div>

      {others.length > 0 && (
        <p className="meta ed-others">
          ここで編集しないキー（{others.join('・')}）は、そのまま残します。変えるときは event.json を直接編集してください（docs/event-data.md）。
        </p>
      )}
    </section>
  );
}
