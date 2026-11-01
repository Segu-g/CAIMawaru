import { useState } from 'react';
import type { Circle } from '../types';
import { validMenus } from '../filter';
import ExtLink from './ExtLink';
import MineEditor from './MineEditor';
import { BoughtButton, StarButton } from './CircleCard';

type Props = {
  circle: Circle;
  eventSlot: number;
  starred: boolean;
  bought: boolean;
  myTags: string[];
  allTags: string[];
  memo: string;
  onClose: () => void;
  onShowInList: () => void;
  onOpenMenus: () => void;
  onToggleStar: () => void;
  onToggleBought: () => void;
  onToggleTag: (tag: string) => void;
  onMemo: (text: string) => void;
};

// 配置図でスペースを押したときに下に出るサークル情報
export default function MapSheet({
  circle: c, eventSlot, starred, bought, myTags, allTags, memo, onClose, onShowInList, onOpenMenus, onToggleStar, onToggleBought, onToggleTag, onMemo,
}: Props) {
  const menus = validMenus(c);
  const [editing, setEditing] = useState(false);

  return (
    <div className="map-sheet" aria-live="polite">
      <div className="card-head">
        <span className="space">{c.space}</span>
        <span className="name">{c.name}</span>
        <span className="head-buttons">
          <BoughtButton name={c.name} bought={bought} onClick={onToggleBought} />
          <StarButton name={c.name} starred={starred} onClick={onToggleStar} />
        </span>
        <button type="button" className="sheet-close" aria-label="閉じる" onClick={onClose}>✕</button>
      </div>
      <div className="links">
        {c.penNames.length > 0 && <span className="pen">{c.penNames.join('、')}</span>}
        <span className={`tag event ev-${eventSlot}`}>{c.event}</span>
        {bought && <span className="tag bought-tag">✓ 購入済み</span>}
        {c.adult && <span className="tag adult">成人向けあり</span>}
        {myTags.map((t) => <span key={t} className="tag mine-tag">{t}</span>)}
      </div>
      <div className="links">
        {menus.map((m, i) => (
          <ExtLink key={m.url} href={m.url} className="menu-link">お品書き{menus.length > 1 ? i + 1 : ''}</ExtLink>
        ))}
        {menus.length === 0 && <span className="pending">お品書き未確認</span>}
        <ExtLink href={c.links.x}>X</ExtLink>
      </div>
      {c.notes && <p className="notes">{c.notes}</p>}
      {memo && !editing && <p className="memo-view">メモ: {memo}</p>}

      <div className="actions">
        {menus.length > 0 && (
          <button type="button" aria-haspopup="dialog" onClick={onOpenMenus}>
            お品書きを見る{menus.length > 1 ? `（${menus.length}）` : ''}
          </button>
        )}
        <button type="button" onClick={onShowInList}>一覧で見る</button>
        <button type="button" aria-expanded={editing} onClick={() => setEditing(!editing)}>タグ・メモ</button>
      </div>

      {editing && (
        <MineEditor name={c.name} tags={myTags} allTags={allTags} memo={memo} onToggleTag={onToggleTag} onMemo={onMemo} />
      )}
    </div>
  );
}
