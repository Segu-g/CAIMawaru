// サークルを選ぶ欄（検索できるコンボボックス）。スペース・名前・読み・@X の ID・id で絞り込み、↑↓ と Enter で選ぶ。
import { useId, useMemo, useRef, useState } from 'react';
import { circleHay, searchCircles } from './menuMatch';
import { circleId, isDataRow, type Row } from './model';

type Props = {
  circles: Row[];
  /** 選んでいるサークルの id */
  value: string;
  onChange: (id: string) => void;
  label: string;
  /** value の id のサークルがないときの表示 */
  missing?: string;
};

const MAX = 40;
const text = (c: Row) => `${c.values.space} ${c.values.name}`.trim();

export default function CirclePicker({ circles, value, onChange, label, missing }: Props) {
  const [query, setQuery] = useState<string | null>(null); // null は閉じている
  const [active, setActive] = useState(0);
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);
  const rows = useMemo(() => {
    const seen = new Set<string>();
    // id ごとに最初のサークル（id の重複は確認タブで知らせる）
    return circles.filter((c) => {
      if (c.comment !== undefined || !isDataRow(c.values, c.extra)) return false;
      const id = circleId(c.values);
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  }, [circles]);
  const current = rows.find((c) => circleId(c.values) === value);
  const open = query !== null;
  const shown = useMemo(() => (open ? searchCircles(rows, query, circleHay).slice(0, MAX) : []), [open, rows, query]);

  const choose = (c: Row | undefined) => {
    if (c) onChange(circleId(c.values));
    setQuery(null);
  };

  return (
    <span className="ed-picker">
      <input
        ref={input}
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && shown[active] ? `${listId}-${active}` : undefined}
        className={current ? undefined : 'invalid'}
        value={open ? query : current ? `${text(current)}（${value}）` : missing ?? value}
        placeholder="スペース・名前・@ID で検索"
        onFocus={(e) => {
          setQuery('');
          setActive(0);
          e.currentTarget.select();
        }}
        onBlur={() => setQuery(null)}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
        }}
        onKeyDown={(e) => {
          if (!open) return;
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, shown.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            choose(shown[active]);
            input.current?.blur();
          } else if (e.key === 'Escape') {
            setQuery(null);
            input.current?.blur();
          }
        }}
      />
      {open && (
        <ul className="ed-picker-list" role="listbox" id={listId} aria-label={label}>
          {shown.map((c, i) => (
            <li
              key={c.key}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              // 入力欄のフォーカスを外さずに選ぶ
              onMouseDown={(e) => {
                e.preventDefault();
                choose(c);
                input.current?.blur();
              }}
            >
              <span className="ed-mono">{c.values.space}</span> {c.values.name}
              <span className="ed-picker-id">{circleId(c.values)}</span>
            </li>
          ))}
          {shown.length === 0 && <li className="empty" role="option" aria-disabled="true" aria-selected="false">該当するサークルはありません</li>}
        </ul>
      )}
    </span>
  );
}
