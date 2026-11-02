// サークルの一覧（検索・絞り込み）と、選んだサークルの編集。
import { useMemo, useState } from 'react';
import CircleForm from './CircleForm';
import type { Doc } from './doc';
import { addCircle, type Dirty } from './edit';
import { keyAction } from './keys';
import { circleHay, searchCircles } from './menuMatch';
import { circleId, isDataRow } from './model';
import type { Issue } from './validate';
import type { Marks } from './workMarks';

type Props = {
  doc: Doc;
  issues: Issue[];
  selected: number | null;
  onSelect: (key: number | null) => void;
  edit: (fn: (doc: Doc) => Doc, ...which: (keyof Dirty)[]) => void;
  marks: Marks;
};

export default function CirclesTab({ doc, issues, selected, onSelect, edit, marks }: Props) {
  // 足した行に、最初に入力したとき入れる値（直前のサークルの参加イベント・出典）
  const [defaults, setDefaults] = useState<{ key: number; values: Record<string, string> } | null>(null);
  const [q, setQ] = useState('');
  const [event, setEvent] = useState('');
  const [menu, setMenu] = useState<'' | 'yes' | 'no'>('');

  // コメントの行は出さない。足したまま何も入れていない行は出す（保存はしない）
  const rows = useMemo(() => doc.circles.filter((c) => c.comment === undefined), [doc.circles]);
  const idCount = useMemo(() => {
    const n = new Map<string, number>();
    for (const c of rows) if (isDataRow(c.values, c.extra)) n.set(circleId(c.values), (n.get(circleId(c.values)) ?? 0) + 1);
    return n;
  }, [rows]);
  // 件数とイベントの一覧は、保存する行（値のある行）だけで数える（タブの件数と同じ）
  const dataRows = useMemo(() => rows.filter((c) => isDataRow(c.values, c.extra)), [rows]);
  const events = useMemo(() => [...new Set(dataRows.map((c) => c.values.event.trim()))].sort(), [dataRows]);
  const menuCount = useMemo(() => {
    const n = new Map<string, number>();
    for (const m of doc.menus) if (isDataRow(m.values, m.extra)) n.set(m.values.id.trim(), (n.get(m.values.id.trim()) ?? 0) + 1);
    return n;
  }, [doc.menus]);
  const withIssue = useMemo(() => new Set(issues.filter((i) => i.where === 'circle' && i.level === 'error').map((i) => i.key)), [issues]);

  // 検索は部分一致。スペース・id・@X の完全一致を先頭に並べる（ほかはファイルの順）
  const shown = useMemo(() => {
    const filtered = rows.filter((c) => {
      const v = c.values;
      if (event && v.event.trim() !== event) return false;
      const n = menuCount.get(circleId(v)) ?? 0;
      if (menu === 'yes' && !n) return false;
      if (menu === 'no' && n) return false;
      return true;
    });
    return searchCircles(filtered, q, circleHay);
  }, [rows, q, event, menu, menuCount]);

  const current = selected === null ? undefined : doc.circles.find((c) => c.key === selected);

  const add = () => {
    // 空の行として足す（何も入れずにやめたら保存しない）。絞り込みは外して、足した行が見えるようにする
    const res = addCircle(doc);
    const row = res.doc.circles[res.doc.circles.length - 1];
    edit((d) => ({ ...d, circles: [...d.circles, row] }), 'circles');
    const last = dataRows[dataRows.length - 1];
    setDefaults(last ? { key: res.key, values: { event: last.values.event.trim(), source: last.values.source.trim() } } : null);
    setQ('');
    setEvent('');
    setMenu('');
    onSelect(res.key);
  };

  return (
    <div className="ed-split">
      <section className="ed-list-pane" aria-label="サークルの一覧">
        <div className="ed-toolbar">
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="検索（サークル名・スペース・id・作家名など）"
            aria-label="検索"
            onKeyDown={(e) => {
              // Enter で先頭のサークルを開く（日本語の変換の確定は除く）
              if (keyAction(e) === 'enter' && shown.length) onSelect(shown[0].key);
            }}
          />
          <select value={event} onChange={(e) => setEvent(e.target.value)} aria-label="参加イベント">
            <option value="">すべてのイベント</option>
            {events.map((ev) => (
              <option key={ev} value={ev}>{ev || '（未入力）'}</option>
            ))}
          </select>
          <select value={menu} onChange={(e) => setMenu(e.target.value as typeof menu)} aria-label="お品書き">
            <option value="">お品書き: すべて</option>
            <option value="yes">お品書きあり</option>
            <option value="no">お品書きなし</option>
          </select>
          <button type="button" onClick={add}>＋ サークルを追加</button>
        </div>
        <p className="meta">
          {shown.filter((c) => isDataRow(c.values, c.extra)).length} / {dataRows.length} 件（ファイルの順）
          {rows.length > dataRows.length && `。ほかに、何も入れていない行が ${rows.length - dataRows.length} 件（保存しません）`}
        </p>
        <div className="ed-table-wrap">
          <table className="ed-table">
            <thead>
              <tr>
                <th>スペース</th>
                <th>サークル名</th>
                <th>参加イベント</th>
                <th>id</th>
                <th title="成人向け">成人</th>
                <th title="お品書きの数">お品書き</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((c) => {
                const v = c.values;
                const id = circleId(v);
                return (
                  <tr
                    key={c.key}
                    aria-selected={c.key === selected}
                    className={withIssue.has(c.key) ? 'has-error' : undefined}
                    onClick={() => onSelect(c.key)}
                  >
                    <td className="nowrap">{v.space}</td>
                    <td>
                      <button type="button" className="ed-row-link" onClick={(e) => { e.stopPropagation(); onSelect(c.key); }}>
                        {v.name || (isDataRow(v, c.extra) ? '（名前なし）' : '（空の行。保存しません）')}
                      </button>
                      {marks[id]?.later && <span className="ed-badge star" title="作業用の印（このブラウザだけ）">☆</span>}
                    </td>
                    <td>{v.event}</td>
                    <td className="nowrap ed-mono">
                      {v.id ? id : <span className="ed-derived" title="スペース番号から作る id">{id}</span>}
                      {(idCount.get(id) ?? 0) > 1 && <span className="ed-badge danger">重複</span>}
                    </td>
                    <td>{v.adult === '1' ? '成人' : v.adult && v.adult !== '0' ? v.adult : ''}</td>
                    <td className="num">{menuCount.get(id) || ''}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {shown.length === 0 && <p className="empty">該当するサークルはありません</p>}
        </div>
      </section>
      <section className="ed-detail-pane" aria-label="サークルの編集">
        {current ? (
          <CircleForm key={current.key} doc={doc} circle={current} issues={issues} edit={edit} onRemoved={() => onSelect(null)}
            defaults={defaults?.key === current.key ? defaults.values : undefined} onAddNext={add} onSelect={onSelect} />
        ) : (
          <p className="empty">一覧からサークルを選ぶと、ここで編集できます</p>
        )}
      </section>
    </div>
  );
}
