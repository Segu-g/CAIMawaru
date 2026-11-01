import { useState } from 'react';
import type { Filters } from '../types';

type Props = {
  filters: Filters;
  tags: string[];
  events: string[];
  myTags: string[];
  status: string;
  onChange: (patch: Partial<Filters>) => void;
  onReset: () => void;
};

// スマホでは検索欄だけ常に表示し、絞り込み条件は畳んでおく
export default function Controls({ filters, tags, events, myTags, status, onChange, onReset }: Props) {
  const active = [filters.event, filters.tag, filters.pick, filters.menu].filter(Boolean).length;
  const [open, setOpen] = useState(active > 0);

  return (
    <section className="controls" aria-label="絞り込み">
      <div className="search-row">
        <input
          type="search"
          value={filters.q}
          onChange={(e) => onChange({ q: e.target.value })}
          placeholder="サークル名・作家名・スペースで検索"
          autoComplete="off"
          enterKeyHint="search"
        />
        <button type="button" className="filter-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
          絞り込み{active > 0 && <span className="badge">{active}</span>}
        </button>
      </div>
      {open && (
        <div className="filter-grid">
          {events.length > 1 && (
            <label>
              イベント
              <select value={filters.event} onChange={(e) => onChange({ event: e.target.value })}>
                <option value="">すべて</option>
                {events.map((ev) => (
                  <option key={ev} value={ev}>{ev}</option>
                ))}
              </select>
            </label>
          )}
          {tags.length > 0 && (
            <label>
              ジャンル
              <select value={filters.tag} onChange={(e) => onChange({ tag: e.target.value })}>
                <option value="">すべて</option>
                {tags.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </label>
          )}
          <label>
            ★・タグ
            <select value={filters.pick} onChange={(e) => onChange({ pick: e.target.value as Filters['pick'] })}>
              <option value="">すべて</option>
              <option value="star">★</option>
              <option value="picked">★・タグ・購入済みのどれか</option>
              <option value="todo">未購入（★かタグあり）</option>
              <option value="bought">購入済み</option>
              <option value="none">どれもなし</option>
              {myTags.map((t) => (
                <option key={t} value={`tag:${t}`}>タグ: {t}</option>
              ))}
            </select>
          </label>
          <label>
            お品書き
            <select value={filters.menu} onChange={(e) => onChange({ menu: e.target.value as Filters['menu'] })}>
              <option value="">すべて</option>
              <option value="yes">あり</option>
              <option value="no">未確認</option>
            </select>
          </label>
          <label>
            並び順
            <select value={filters.sort} onChange={(e) => onChange({ sort: e.target.value as Filters['sort'] })}>
              <option value="space">スペース順</option>
              <option value="name">サークル名順</option>
            </select>
          </label>
          {active > 0 && <button type="button" className="reset" onClick={onReset}>条件をクリア</button>}
        </div>
      )}
      <p className="meta" aria-live="polite">{status}</p>
    </section>
  );
}
