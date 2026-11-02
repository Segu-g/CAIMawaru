// お品書き探し: サークルを1つずつ回って、X などで見つけたお品書きの URL を貼り付けて登録する。
// 「X を開く」は人が新しいタブで開くリンクだけで、このページは X を読まない。
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { keyAction } from './keys';
import type { Doc } from './doc';
import { addMenu, menusOf, replaceMenu, updateCircle, type Dirty } from './edit';
import { checkMenuUrl, circleHay, profileUrl, searchCircles, xHandleOf } from './menuMatch';
import { circleId, isDataRow, isHttpUrl, type Row } from './model';
import type { Mark, Marks } from './workMarks';

type Status = 'todo' | 'done' | 'all';
type MarkFilter = '' | 'later' | 'memo' | 'any';

type Props = {
  doc: Doc;
  edit: (fn: (doc: Doc) => Doc, ...which: (keyof Dirty)[]) => void;
  marks: Marks;
  setMark: (id: string, change: Mark) => void;
  marksSaved: boolean;
  selected: number | null;
  onSelect: (key: number | null) => void;
  onOpenCircle: (key: number) => void;
};

const short = (url: string) => url.replace(/^https?:\/\/(www\.)?/, '');

export default function HuntTab({ doc, edit, marks, setMark, marksSaved, selected, onSelect, onOpenCircle }: Props) {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<Status>('todo');
  const [markFilter, setMarkFilter] = useState<MarkFilter>('');
  const [event, setEvent] = useState('');
  // 絞り込みを変えるまでは、登録して条件から外れたサークルも一覧に残す（行の位置がずれないように）
  const [keep, setKeep] = useState<Set<number>>(new Set());
  useEffect(() => setKeep(new Set()), [q, status, markFilter, event]);

  const circles = useMemo(() => doc.circles.filter((c) => c.comment === undefined && isDataRow(c.values, c.extra)), [doc.circles]);
  const menuCount = useMemo(() => {
    const n = new Map<string, number>();
    for (const m of doc.menus) if (isDataRow(m.values, m.extra)) n.set(m.values.id.trim(), (n.get(m.values.id.trim()) ?? 0) + 1);
    return n;
  }, [doc.menus]);
  const events = useMemo(() => [...new Set(circles.map((c) => c.values.event.trim()))].sort(), [circles]);
  const todo = circles.filter((c) => !menuCount.get(circleId(c.values))).length;

  const shown = useMemo(() => {
    const filtered = circles.filter((c) => {
      if (keep.has(c.key)) return true;
      const id = circleId(c.values);
      const n = menuCount.get(id) ?? 0;
      if (status === 'todo' && n) return false;
      if (status === 'done' && !n) return false;
      if (event && c.values.event.trim() !== event) return false;
      const m = marks[id];
      if (markFilter === 'later' && !m?.later) return false;
      if (markFilter === 'memo' && !m?.memo) return false;
      if (markFilter === 'any' && !m) return false;
      return true;
    });
    return searchCircles(filtered, q, (c) => circleHay(c) + '\n' + (marks[circleId(c.values)]?.memo ?? ''));
  }, [circles, keep, menuCount, status, event, marks, markFilter, q]);

  const index = shown.findIndex((c) => c.key === selected);
  const current = index >= 0 ? shown[index] : undefined;
  const move = (delta: number) => {
    if (!shown.length) return;
    const next = index < 0 ? (delta > 0 ? 0 : shown.length - 1) : Math.min(Math.max(index + delta, 0), shown.length - 1);
    onSelect(shown[next].key);
  };

  // 選んだ行を見えるところに
  const list = useRef<HTMLOListElement>(null);
  useEffect(() => {
    list.current?.querySelector('[aria-current="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  return (
    <section className="ed-hunt" aria-label="お品書き探し">
      <div className="ed-toolbar">
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="検索（スペース・名前・@ID・メモ）" aria-label="サークルを検索"
          data-search
          onKeyDown={(e) => {
            const k = keyAction(e);
            if (k === 'enter' && shown.length) onSelect(shown[0].key);
            if (k === 'down') {
              e.preventDefault();
              move(1);
            }
          }} />
        <select value={status} onChange={(e) => setStatus(e.target.value as Status)} aria-label="お品書きの登録">
          <option value="todo">お品書き未登録</option>
          <option value="done">登録済み</option>
          <option value="all">すべて</option>
        </select>
        <select value={markFilter} onChange={(e) => setMarkFilter(e.target.value as MarkFilter)} aria-label="作業用の印">
          <option value="">印: すべて</option>
          <option value="later">☆ あとで</option>
          <option value="memo">メモあり</option>
          <option value="any">印かメモあり</option>
        </select>
        {events.length > 1 && (
          <select value={event} onChange={(e) => setEvent(e.target.value)} aria-label="参加イベント">
            <option value="">すべてのイベント</option>
            {events.map((ev) => <option key={ev} value={ev}>{ev || '（未入力）'}</option>)}
          </select>
        )}
      </div>
      <p className="meta">
        お品書き未登録 {todo} / {circles.length} サークル。表示 {shown.length} 件（ファイルの順）。
        貼り付け欄で <kbd>Enter</kbd> 登録して次へ・<kbd>Shift</kbd>+<kbd>Enter</kbd> 登録してこのサークルにもう1件・<kbd>↑</kbd><kbd>↓</kbd> サークルを移る
      </p>
      <ol className="ed-hunt-list" ref={list}>
        {shown.map((c) => {
          const id = circleId(c.values);
          const handle = xHandleOf(c.values);
          const n = menuCount.get(id) ?? 0;
          const m = marks[id];
          const isCurrent = c.key === current?.key;
          return (
            <li key={c.key} aria-current={isCurrent ? 'true' : undefined} className={isCurrent ? 'open' : undefined}>
              <button type="button" className="ed-hunt-row" onClick={() => onSelect(isCurrent ? null : c.key)} aria-expanded={isCurrent}>
                <span className="ed-hunt-space">{c.values.space}</span>
                <span className="ed-hunt-name">{c.values.name || '（名前なし）'}</span>
                <span className="ed-hunt-x">{handle ? `@${handle}` : c.values.x.trim() ? 'X（形が違う）' : 'X なし'}</span>
                <span className={n ? 'ed-hunt-count done' : 'ed-hunt-count'}>{n ? `お品書き ${n}` : '未登録'}</span>
                <span className="ed-hunt-marks">
                  {m?.later && <span className="ed-badge star" title="あとで">☆ あとで</span>}
                  {m?.memo && <span className="ed-hunt-memo" title={m.memo}>{m.memo}</span>}
                </span>
              </button>
              {isCurrent && (
                <HuntDetail
                  key={c.key}
                  doc={doc}
                  circle={c}
                  edit={edit}
                  mark={m}
                  setMark={(change) => setMark(id, change)}
                  marksSaved={marksSaved}
                  onDone={(stay) => {
                    setKeep((k) => new Set(k).add(c.key));
                    if (!stay) move(1);
                  }}
                  onMove={move}
                  onOpenCircle={() => onOpenCircle(c.key)}
                />
              )}
            </li>
          );
        })}
      </ol>
      {shown.length === 0 && (
        <p className="empty">{status === 'todo' && !q && !markFilter && !event ? 'すべてのサークルにお品書きがあります' : '該当するサークルはありません'}</p>
      )}
    </section>
  );
}

type DetailProps = {
  doc: Doc;
  circle: Row;
  edit: Props['edit'];
  mark: Mark | undefined;
  setMark: (change: Mark) => void;
  marksSaved: boolean;
  /** 登録した。stay は同じサークルに残る */
  onDone: (stay: boolean) => void;
  onMove: (delta: number) => void;
  onOpenCircle: () => void;
};

function HuntDetail({ doc, circle, edit, mark, setMark, marksSaved, onDone, onMove, onOpenCircle }: DetailProps) {
  const v = circle.values;
  const id = circleId(v);
  const handle = xHandleOf(v);
  const menus = menusOf(doc, circle);
  const [url, setUrl] = useState('');
  const [note, setNote] = useState('');
  // 'add' か、差し替えるお品書きの key
  const [mode, setMode] = useState<'add' | number>('add');
  // 投稿者を X に登録するのは、運用者が選んだときだけ（既定はオフ）
  const [alsoX, setAlsoX] = useState(false);
  const [done, setDone] = useState('');
  const [notice, setNotice] = useState('');
  const paste = useRef<HTMLInputElement>(null);
  useEffect(() => paste.current?.focus(), []);

  // 差し替える行が（ほかのタブでの削除・付け替えなどで）なくなっていたら、追加に戻して知らせる
  const target = mode === 'add' ? undefined : menus.find((m) => m.key === mode);
  useEffect(() => {
    if (mode !== 'add' && !target) {
      setMode('add');
      setNotice('差し替えるお品書きがなくなっていたので（削除されたか、ほかのサークルに付け替えられた）、「追加する」に戻しました');
    }
  }, [mode, target]);
  const replacing = target?.key;
  const check = url.trim() ? checkMenuUrl(doc, circle.key, url, replacing) : null;
  // X のないサークルに投稿を登録するとき、投稿者をサークルの X にもできる（ほかのサークルの X なら出さない）
  const offerX = !v.x.trim() && !!check?.handle && !check.error && !check.otherOwner;
  const profileForX = !v.x.trim() && check?.profile ? check.profile : null;

  const register = (stay: boolean) => {
    if (!check) return;
    if (profileForX) {
      edit((d) => updateCircle(d, circle.key, 'x', profileUrl(profileForX)), 'circles');
      setUrl('');
      setDone(`X に @${profileForX} を登録しました。続けてお品書きの投稿を貼り付けてください`);
      return;
    }
    if (check.error) return;
    if (mode !== 'add' && !target) {
      setMode('add');
      setNotice('差し替えるお品書きがなくなっていたので、登録しませんでした。「追加する」に戻したので、もう一度登録してください');
      return;
    }
    const n = note.trim();
    const withX = offerX && alsoX ? check.handle : null;
    edit((d) => {
      let next = replacing === undefined ? addMenu(d, id, check.url, n).doc : replaceMenu(d, replacing, check.url, n || undefined);
      if (withX) next = updateCircle(next, circle.key, 'x', profileUrl(withX));
      return next;
    }, 'menus', ...(withX ? (['circles'] as const) : []));
    setUrl('');
    setNote('');
    setMode('add');
    setAlsoX(false);
    setNotice('');
    setDone(`${replacing === undefined ? '登録' : '差し替え'}しました: ${short(check.url)}${withX ? `（X に @${withX} も登録）` : ''}`);
    onDone(stay);
    if (stay) paste.current?.focus();
  };

  const keys = (e: KeyboardEvent<HTMLInputElement>) => {
    const k = keyAction(e);
    if (k === 'enter' || k === 'shift-enter') {
      e.preventDefault();
      register(k === 'shift-enter');
    } else if (k === 'down' || k === 'up') {
      e.preventDefault();
      onMove(k === 'down' ? 1 : -1);
    }
  };

  return (
    <div className="ed-hunt-detail">
      <div className="ed-hunt-links">
        {handle ? (
          <a href={v.x.trim()} target="_blank" rel="noopener noreferrer" className="ed-linkbutton">X を開く（@{handle}）↗</a>
        ) : v.x.trim() && isHttpUrl(v.x.trim()) ? (
          <a href={v.x.trim()} target="_blank" rel="noopener noreferrer" className="ed-linkbutton">X を開く ↗</a>
        ) : null}
        {(['pixiv', 'booth', 'web'] as const).filter((k) => isHttpUrl(v[k].trim())).map((k) => (
          <a key={k} href={v[k].trim()} target="_blank" rel="noopener noreferrer">{k === 'web' ? 'Web' : k === 'booth' ? 'BOOTH' : 'pixiv'} ↗</a>
        ))}
        <button type="button" onClick={onOpenCircle}>サークルを編集</button>
      </div>
      {!v.x.trim() && <p className="meta">X が未登録です。見つけたアカウントの URL（https://x.com/…）を下に貼ると、このサークルの X に登録します。</p>}

      {menus.length > 0 && (
        <ul className="ed-hunt-menus" aria-label="登録済みのお品書き">
          {menus.map((m) => (
            <li key={m.key}>
              <a href={m.values.url.trim()} target="_blank" rel="noopener noreferrer">{short(m.values.url.trim())}</a>
              {m.values.note && <span className="ed-hunt-note">{m.values.note}</span>}
              <span className="meta">{m.values.checkedAt}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="ed-hunt-paste">
        <label className="ed-hunt-url">
          <span>{v.x.trim() ? 'お品書きの URL' : 'お品書きの URL、または X の URL'}</span>
          <input ref={paste} type="url" value={url} onChange={(e) => { setUrl(e.target.value); setDone(''); }} onKeyDown={keys}
            placeholder="https://x.com/…/status/…" aria-describedby={`hunt-check-${circle.key}`} />
        </label>
        <label>
          <span>説明（任意）</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} onKeyDown={keys} placeholder="例: 新刊" />
        </label>
        {menus.length > 0 && (
          <label>
            <span>登録のしかた</span>
            <select value={String(replacing ?? 'add')} onChange={(e) => { setNotice(''); setMode(e.target.value === 'add' ? 'add' : Number(e.target.value)); }}>
              <option value="add">追加する</option>
              {menus.map((m) => <option key={m.key} value={m.key}>差し替え: {short(m.values.url.trim()).slice(0, 40)}</option>)}
            </select>
          </label>
        )}
        <button type="button" className="ed-primary" onClick={() => register(false)} disabled={!check || (!!check.error && !profileForX)}>
          {profileForX ? 'X に登録' : replacing === undefined ? '登録' : '差し替え'}
        </button>
      </div>
      <div id={`hunt-check-${circle.key}`} className="ed-hunt-check" aria-live="polite">
        {check?.url && check.url !== url.trim() && !check.error && <p className="meta">登録する形: {check.url}</p>}
        {check?.error && !profileForX && <p className="ed-inline-error">{check.error}</p>}
        {profileForX && <p className="meta">X のプロフィールの URL です。<kbd>Enter</kbd> でこのサークルの X に @{profileForX} を登録します</p>}
        {check?.warnings.map((w, i) => <p key={i} className="ed-inline-warn">⚠ {w}</p>)}
        {offerX && (
          <label className="ed-check">
            <input type="checkbox" checked={alsoX} onChange={(e) => setAlsoX(e.target.checked)} />
            投稿者 @{check!.handle} をこのサークルの X にも登録する
          </label>
        )}
        {notice && <p className="ed-inline-warn" role="alert">⚠ {notice}</p>}
        {done && <p className="ed-inline-ok" role="status">✓ {done}</p>}
      </div>

      <div className="ed-hunt-marks-edit">
        <button type="button" aria-pressed={!!mark?.later} onClick={() => setMark({ later: !mark?.later })}>
          {mark?.later ? '☆ あとで（付けている）' : '☆ あとで'}
        </button>
        <label className="ed-hunt-memo-input">
          <span className="ed-sr">作業メモ</span>
          <input value={mark?.memo ?? ''} onChange={(e) => setMark({ memo: e.target.value })} placeholder="作業メモ（例: 11/20 に告知予定）" />
        </label>
        <small className="meta">印とメモはこのブラウザにだけ保存します（ファイルには書きません）{marksSaved ? '' : '。保存できませんでした（ブラウザの設定を確かめてください）'}</small>
      </div>
    </div>
  );
}
