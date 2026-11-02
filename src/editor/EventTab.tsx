// event.json の編集。storeId・title と、ページに出すイベント情報（info）。ほかのキーはそのまま残す。
// 書き戻すと値やキーの順が変わってしまう event.json（doc.eventLocked）は、全体を読み取り専用にする。
// 想定と違う形の値（editableFields）は、その欄だけ読み取り専用にする。
import { useMemo, useState, type ReactNode } from 'react';
import type { Doc } from './doc';
import { editableFields, infoOf, setInfo, setTop, slotsLockReason, slotsToObject, type Dirty, type SlotRow } from './edit';
import { isDataRow, type Json, type JsonObject, type Link } from './model';
import type { Issue } from './validate';

type Props = {
  doc: Doc;
  issues: Issue[];
  edit: (fn: (doc: Doc) => Doc, ...which: (keyof Dirty)[]) => void;
  /** 入力中の eventSlots の行（タブを切り替えても消えないよう、エディタ全体で持つ。null は event.json のまま） */
  slotDraft: SlotRow[] | null;
  setSlotDraft: (rows: SlotRow[] | null) => void;
};

/** event.json の eventSlots を、画面で編集する行にする */
export function slotRowsOf(doc: Doc): SlotRow[] {
  const slots = infoOf(doc.event).eventSlots;
  return isObj(slots) ? Object.entries(slots).map(([name, slot]) => ({ name, slot })) : [];
}

const str = (v: Json | undefined) => (typeof v === 'string' ? v : '');
const isObj = (v: Json | undefined): v is JsonObject => !!v && typeof v === 'object' && !Array.isArray(v);

// 画面で編集する info のキー（それ以外は表示だけして残す）
const EDITED = ['name', 'date', 'venue', 'hours', 'links', 'hashtags', 'eventSlots', 'contact'];

/** 形が想定と違うので編集しない欄（中身をそのまま見せる） */
function Raw({ value, reason }: { value: Json | undefined; reason?: string | null }) {
  return (
    <p className="meta">
      {reason ?? '想定と違う形の値なので、ここでは編集しません（event.json を直接編集してください）'}: <code>{JSON.stringify(value)}</code>
    </p>
  );
}

/** ラベルつきの文字列の欄。形が違えば読み取り専用 */
function TextField({ label, value, ok, onChange, hint, ...rest }: { label: string; value: Json | undefined; ok: boolean; onChange: (v: string) => void; hint?: ReactNode; placeholder?: string; className?: string; readOnly?: boolean }) {
  return (
    <label>
      <span>{label}</span>
      {ok ? <input value={str(value)} onChange={(e) => onChange(e.target.value)} {...rest} /> : <Raw value={value} />}
      {hint && <small>{hint}</small>}
    </label>
  );
}

export default function EventTab({ doc, issues, edit, slotDraft, setSlotDraft }: Props) {
  const event = doc.event;
  const info = infoOf(event);
  const ok = editableFields(event);
  const locked = doc.eventLocked.length > 0;
  const [unlock, setUnlock] = useState(false);
  const change = (fn: (e: JsonObject) => JsonObject) => edit((d) => ({ ...d, event: fn(d.event) }), 'event');
  const setI = (key: string, value: Json | undefined) => change((e) => setInfo(e, key, value));

  // リンクは label・url 以外のキーも残すため、元のオブジェクトを書き換える
  const links: JsonObject[] = ok.links && Array.isArray(info.links) ? info.links.filter(isObj) : [];
  const hashtags: string[] = ok.hashtags && Array.isArray(info.hashtags) ? info.hashtags.filter((t): t is string => typeof t === 'string') : [];
  const contact = isObj(info.contact) ? info.contact : null;
  const others = [
    ...Object.keys(event).filter((k) => !['storeId', 'title', 'info'].includes(k)),
    ...Object.keys(info).filter((k) => !EDITED.includes(k)).map((k) => `info.${k}`),
  ];
  const mine = issues.filter((i) => i.where === 'event');

  // eventSlots は入力中の行を手元に持ち、確定（フォーカスを外す・枠を選ぶ・削除）したときに、空・重複がなければ反映する
  const slots = slotDraft ?? slotRowsOf(doc);
  const setSlots = setSlotDraft;
  const check = slotsToObject(slots);
  const slotError = slotDraft !== null && !check.ok ? check.message : '';
  const commitSlots = (rows: SlotRow[]) => {
    setSlots(rows);
    const res = slotsToObject(rows);
    if (!res.ok) return;
    if (JSON.stringify(res.value) !== JSON.stringify(info.eventSlots ?? {})) setI('eventSlots', res.value);
  };

  // circles.csv に出てくる参加イベント（eventSlots の候補）
  const circleEvents = useMemo(
    () => [...new Set(doc.circles.filter((c) => isDataRow(c.values, c.extra)).map((c) => c.values.event.trim()).filter(Boolean))].sort(),
    [doc.circles],
  );
  const unslotted = circleEvents.filter((ev) => !slots.some((s) => s.name.trim() === ev));

  const setLinks = (next: JsonObject[]) => setI('links', next);
  const setLink = (i: number, key: keyof Link, value: string) => setLinks(links.map((x, j) => (j === i ? { ...x, [key]: value } : x)));

  return (
    <section className="ed-event">
      {locked && (
        <div className="ed-box warn" role="status">
          <p><strong>event.json は読み取り専用で開いています。</strong>このエディタ（JavaScript）で書き戻すと、次のところが変わってしまうためです:</p>
          <ul className="ed-list">
            {doc.eventLocked.map((m, i) => <li key={i}>{m}</li>)}
          </ul>
          <p>event.json は直接編集してください。サークルとお品書きはこのまま編集・保存できます。</p>
        </div>
      )}
      {mine.length > 0 && (
        <ul className="ed-inline-issues">
          {mine.map((i, n) => <li key={n} className={i.level}>{i.message}</li>)}
        </ul>
      )}

      <fieldset className="ed-locked" disabled={locked}>
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
          <TextField label="storeId（必須）" value={event.storeId} ok={ok.storeId} readOnly={!unlock} className="ed-mono"
            onChange={(v) => change((ev) => setTop(ev, 'storeId', v))} hint="★・タグ・メモの保存先（localStorage のキー）" />
          <TextField label="title（必須）" value={event.title} ok={ok.title} onChange={(v) => change((ev) => setTop(ev, 'title', v))} hint="ページの <title>" />
        </div>

        <h2>イベント情報（info）</h2>
        <div className="ed-fields">
          <TextField label="イベント名（name）" value={info.name} ok={ok.name} onChange={(v) => setI('name', v)} />
          <TextField label="日付（date）" value={info.date} ok={ok.date} onChange={(v) => setI('date', v)} placeholder="YYYY-MM-DD" />
          <TextField label="会場（venue）" value={info.venue} ok={ok.venue} onChange={(v) => setI('venue', v)} />
          <TextField label="時間（hours）" value={info.hours} ok={ok.hours} onChange={(v) => setI('hours', v)} placeholder="開場 11:00 / 閉会 15:00" />
        </div>

        <h3>リンク（links）</h3>
        <p className="meta">公式サイトなど。ページのイベント情報に並ぶ</p>
        {ok.links ? (
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
        ) : <Raw value={info.links} />}

        <h3>ハッシュタグ（hashtags）</h3>
        <p className="meta">「Xでシェア」に付ける。「#」は付けない</p>
        {ok.hashtags ? (
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
        ) : <Raw value={info.hashtags} />}

        <h3>イベントの色（eventSlots）</h3>
        <p className="meta">合同開催のイベント名（circles.csv の参加イベントと同じ文字列）→ 色の枠 1〜5。載っていないイベントは灰色の「同時開催」</p>
        {ok.eventSlots ? (
          <div className="ed-pairs">
            {slots.map((s, i) => (
              <div className="ed-pair" key={i}>
                <input
                  value={s.name}
                  onChange={(e) => setSlots(slots.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                  onBlur={() => commitSlots(slots)}
                  list="ed-circle-events"
                  aria-label="イベント名"
                />
                <select value={String(s.slot)} onChange={(e) => commitSlots(slots.map((x, j) => (j === i ? { ...x, slot: Number(e.target.value) } : x)))} aria-label="色の枠">
                  {[1, 2, 3, 4, 5].map((k) => <option key={k} value={String(k)}>枠 {k}</option>)}
                  {![1, 2, 3, 4, 5].includes(s.slot as number) && <option value={String(s.slot)}>{String(s.slot)}（不正な値）</option>}
                </select>
                <span className="ed-pair-actions">
                  <button type="button" className="danger" onClick={() => commitSlots(slots.filter((_, j) => j !== i))}>削除</button>
                </span>
              </div>
            ))}
            {slotError && <p className="ed-inline-error" role="alert">{slotError}（直すまで event.json には反映しません）</p>}
            <datalist id="ed-circle-events">
              {circleEvents.map((ev) => <option key={ev} value={ev} />)}
            </datalist>
            <div className="ed-row-buttons">
              <button type="button" onClick={() => commitSlots([...slots, { name: unslotted[0] ?? '', slot: Math.min(slots.length + 1, 5) }])}>＋ イベントを追加</button>
              {unslotted.length > 0 && <span className="meta">色の枠がない参加イベント: {unslotted.join('・')}</span>}
            </div>
          </div>
        ) : <Raw value={info.eventSlots} reason={slotsLockReason(event)} />}

        <h3>修正・削除の依頼先（contact）</h3>
        <p className="meta">X の URL ならヘッダーに X のボタンも出る。両方を空欄にすると contact を消す</p>
        {ok.contact ? (
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
        ) : <Raw value={info.contact} />}
      </fieldset>

      {others.length > 0 && (
        <p className="meta ed-others">
          ここで編集しないキー（{others.join('・')}）は、そのまま残します。変えるときは event.json を直接編集してください（docs/event-data.md）。
        </p>
      )}
    </section>
  );
}
