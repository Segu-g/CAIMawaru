import { memo, useState } from 'react';
import type { Circle, LinkKey } from '../types';
import { validMenus } from '../filter';
import ExtLink from './ExtLink';
import MineEditor from './MineEditor';

const LINK_LABELS: Record<LinkKey, string> = { x: 'X', pixiv: 'pixiv', booth: 'BOOTH', web: 'Web' };

type Props = {
  circle: Circle;
  eventSlot: number;
  starred: boolean;
  bought: boolean;
  myTags: string[];
  allTags: string[];
  selected: boolean;
  memo: string;
  onToggleStar: () => void;
  onToggleBought: () => void;
  onToggleTag: (tag: string) => void;
  onMemo: (text: string) => void;
  onTag: (tag: string) => void;
  onEvent: (event: string) => void;
  onShowOnMap?: () => void; // 配置図のないイベントでは渡さない
  onOpenMenus: () => void;
};

function CircleCard({
  circle: c, eventSlot, starred, bought, myTags, allTags, selected, memo: memoText,
  onToggleStar, onToggleBought, onToggleTag, onMemo, onTag, onEvent, onShowOnMap, onOpenMenus,
}: Props) {
  const menus = validMenus(c);
  const [editing, setEditing] = useState(false);

  return (
    <article className={`card ${starred ? 'starred' : ''} ${bought ? 'bought' : ''} ${selected ? 'selected' : ''}`} id={`c-${c.id}`}>
      <div className="card-head">
        <span className="space">{c.space || '—'}</span>
        <span className="name">{c.name}</span>
        {c.penNames.length > 0 && <span className="pen">{c.penNames.join('、')}</span>}
        <span className="head-buttons">
          <BoughtButton name={c.name} bought={bought} onClick={onToggleBought} />
          <StarButton name={c.name} starred={starred} onClick={onToggleStar} />
        </span>
      </div>

      <div className="tags">
        {c.event && (
          <button type="button" className={`tag event ev-${eventSlot}`} onClick={() => onEvent(c.event)}>
            {c.event}
          </button>
        )}
        {bought && <span className="tag bought-tag">✓ 購入済み</span>}
        {c.adult && <span className="tag adult">成人向けあり</span>}
        {c.tags.map((t) => (
          <button key={t} type="button" className="tag" onClick={() => onTag(t)}>
            {t}
          </button>
        ))}
        {myTags.map((t) => <span key={t} className="tag mine-tag">{t}</span>)}
      </div>

      <div className="links">
        {menus.length > 0 ? (
          menus.map((m, i) => (
            <ExtLink key={m.url} href={m.url} className="menu-link">
              お品書き{menus.length > 1 ? i + 1 : ''}
              {m.note && `（${m.note}）`}
            </ExtLink>
          ))
        ) : (
          <span className="pending">お品書き未確認</span>
        )}
        {(Object.keys(LINK_LABELS) as LinkKey[]).map((key) => (
          <ExtLink key={key} href={c.links[key]}>
            {LINK_LABELS[key]}
          </ExtLink>
        ))}
      </div>

      {c.notes && <p className="notes">{c.notes}</p>}
      {memoText && !editing && <p className="memo-view">メモ: {memoText}</p>}

      <div className="actions">
        {menus.length > 0 && (
          <button type="button" aria-haspopup="dialog" onClick={onOpenMenus}>
            お品書きを見る{menus.length > 1 ? `（${menus.length}）` : ''}
          </button>
        )}
        {onShowOnMap && <button type="button" onClick={onShowOnMap}>配置図で見る</button>}
        <button type="button" aria-expanded={editing} onClick={() => setEditing(!editing)}>タグ・メモ</button>
      </div>

      {editing && (
        <MineEditor name={c.name} tags={myTags} allTags={allTags} memo={memoText} onToggleTag={onToggleTag} onMemo={onMemo} />
      )}
    </article>
  );
}

export function StarButton({ name, starred, onClick }: { name: string; starred: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      className="star-btn"
      aria-pressed={starred}
      aria-label={starred ? `${name} の★を外す` : `${name} に★を付ける`}
      onClick={onClick}
    >
      {starred ? '★' : '☆'}
    </button>
  );
}

// 当日、買い物を済ませたら押す
export function BoughtButton({ name, bought, onClick }: { name: string; bought: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      className="bought-btn"
      aria-pressed={bought}
      aria-label={bought ? `${name} の購入済みを取り消す` : `${name} を購入済みにする`}
      onClick={onClick}
    >
      ✓
    </button>
  );
}

export default memo(CircleCard);
