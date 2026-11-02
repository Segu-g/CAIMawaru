// お品書き（menus.csv の1行）の編集。URL・説明・確認した日。
import type { ReactNode } from 'react';
import type { Doc } from './doc';
import { removeMenu, updateMenu, type Dirty } from './edit';
import { isHttpUrl, today, type Row } from './model';

type Props = {
  menu: Row;
  edit: (fn: (doc: Doc) => Doc, ...which: (keyof Dirty)[]) => void;
  /** 先頭に置く欄（「お品書き」タブではサークルの選択） */
  lead?: ReactNode;
};

export default function MenuRow({ menu, edit, lead }: Props) {
  const v = menu.values;
  const set = (col: string, value: string) => edit((d) => updateMenu(d, menu.key, col, value), 'menus');
  const url = v.url.trim();
  return (
    <div className="ed-menu">
      {lead}
      <input type="url" value={v.url} onChange={(e) => set('url', e.target.value)} placeholder="URL" aria-label="お品書きの URL" className="ed-menu-url" />
      <input value={v.note} onChange={(e) => set('note', e.target.value)} placeholder="説明（例: 新刊）" aria-label="説明（note）" />
      <span className="ed-menu-date">
        <input value={v.checkedAt} onChange={(e) => set('checkedAt', e.target.value)} placeholder="YYYY-MM-DD" aria-label="確認した日（checkedAt）" />
        <button type="button" onClick={() => set('checkedAt', today())} title="確認した日を今日にする">今日</button>
      </span>
      <span className="ed-menu-actions">
        {/* 利用者が貼った URL を新しいタブで開くだけ（このページは中身を読み込まない） */}
        {isHttpUrl(url) && <a href={url} target="_blank" rel="noopener noreferrer">開く</a>}
        <button
          type="button"
          className="danger"
          onClick={() => confirm(`このお品書きを削除しますか？\n${url}`) && edit((d) => removeMenu(d, menu.key), 'menus')}
        >
          削除
        </button>
      </span>
    </div>
  );
}
