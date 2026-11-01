import { useEffect, useRef, useState } from 'react';
import type { Circle } from '../types';
import { validMenus } from '../filter';
import { postIdOf } from '../xEmbed';
import { PostEmbed } from './PostEmbed';
import { BoughtButton, StarButton } from './CircleCard';

type Props = {
  circle: Circle;
  eventSlot: number;
  starred: boolean;
  bought: boolean;
  onToggleStar: () => void;
  onToggleBought: () => void;
  onShowOnMap?: () => void; // 配置図のないイベントでは渡さない
  onClose: () => void;
};

// お品書きを画面下からのシートで表示する（履歴の扱いは App 側。スマホの「戻る」でも閉じる）
export default function MenuDialog({ circle: c, eventSlot, starred, bought, onToggleStar, onToggleBought, onShowOnMap, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const menus = validMenus(c);
  const [index, setIndex] = useState(0);
  const menu = menus[Math.min(index, menus.length - 1)];
  const postId = menu && postIdOf(menu.url);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => dialog?.close();
  }, []);

  return (
    <dialog
      ref={ref}
      className="menu-dialog"
      aria-labelledby="menu-dialog-title"
      // Esc はブラウザ任せにせず、履歴と合わせて閉じる
      onCancel={(e) => { e.preventDefault(); onClose(); }}
      // 背景（シートの外）を押したら閉じる
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="dialog-body">
        <header className="card-head dialog-head">
          <span className="space">{c.space}</span>
          <span className="name" id="menu-dialog-title">{c.name}</span>
          <button type="button" className="sheet-close" aria-label="お品書きを閉じる" onClick={onClose}>✕</button>
        </header>
        <div className="tags">
          <span className={`tag event ev-${eventSlot}`}>{c.event}</span>
          {c.adult && <span className="tag adult">成人向けあり</span>}
          {c.penNames.length > 0 && <span className="pen">{c.penNames.join('、')}</span>}
        </div>

        {menus.length > 1 && (
          <nav className="pager" aria-label="お品書きの切り替え">
            <button type="button" aria-label="前のお品書き" disabled={index === 0} onClick={() => setIndex(index - 1)}>‹</button>
            <span aria-live="polite">{index + 1} / {menus.length}</span>
            <button type="button" aria-label="次のお品書き" disabled={index >= menus.length - 1} onClick={() => setIndex(index + 1)}>›</button>
          </nav>
        )}

        <div className="dialog-content">
          {menu && postId && <PostEmbed key={menu.url} id={postId} url={menu.url} note={menu.note} />}
          {menu && !postId && (
            <div className="external-menu">
              {menu.note && <p className="meta">{menu.note}</p>}
              <p className="meta">このお品書きはX以外のページにあります。</p>
              <a className="button-link" href={menu.url} target="_blank" rel="noopener noreferrer">リンク先で開く</a>
            </div>
          )}
        </div>

        <footer className="dialog-foot">
          <StarButton name={c.name} starred={starred} onClick={onToggleStar} />
          <BoughtButton name={c.name} bought={bought} onClick={onToggleBought} />
          {onShowOnMap && <button type="button" onClick={onShowOnMap}>配置図で見る</button>}
          {postId && <a className="button-link quiet" href={menu.url} target="_blank" rel="noopener noreferrer">Xで開く</a>}
        </footer>
      </div>
    </dialog>
  );
}
