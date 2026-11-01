import type { ReactNode } from 'react';
import type { EventInfo } from '../types';
import ExtLink from './ExtLink';
import { pageUrl, xShareUrl } from '../share';

const isX = (url: string) => /^https:\/\/(x|twitter)\.com\//.test(url);

// X のロゴ（作成者の X へのリンクに使う）
function XLogo() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"
      />
    </svg>
  );
}

// スマホで配置図を広く使えるよう、イベント情報と設定は畳んでおく
export default function Header({ event, settings }: { event: EventInfo | undefined; settings: ReactNode }) {
  const meta = [event?.date, event?.venue].filter(Boolean).join(' / ');
  const contact = event?.contact;
  return (
    <header className="site-header">
      <details>
        <summary>
          <h1>{event?.name ? `${event.name} サークルリスト` : 'サークルリスト'}</h1>
          {event?.halls && (
            <nav className="hall-switch" aria-label="ホールの切り替え">
              {event.halls.map((h) => h.current
                ? <span key={h.label} aria-current="page">{h.label}</span>
                : <a key={h.label} href={h.url}>{h.label}</a>)}
            </nav>
          )}
          <span className="info-icon" aria-label="イベント情報と設定">i</span>
        </summary>
        <div className="event-info">
          {event && (
            <div className="share-row">
              <a
                className="button-link share-x"
                href={xShareUrl(`${event.name} サークルリスト`, pageUrl(), event.hashtags)}
                target="_blank"
                rel="noopener noreferrer"
              >
                Xでシェア
              </a>
              {contact && isX(contact.url) && (
                <a
                  className="button-link x-profile"
                  href={contact.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`作成者の ${contact.label}`}
                  title={`作成者の ${contact.label}`}
                >
                  <XLogo />
                </a>
              )}
            </div>
          )}
          {meta && <p className="meta">{meta}</p>}
          {event?.hours && <p className="meta">{event.hours}</p>}
          {event?.updatedAt && <p className="meta">サークル情報の更新: {event.updatedAt}</p>}
          <p className="meta links">
            {event?.links.map((l) => (
              <ExtLink key={l.url} href={l.url}>{l.label}</ExtLink>
            ))}
            {event?.hashtags.map((tag) => {
              const t = tag.replace(/^#/, '');
              return (
                <ExtLink key={t} href={`https://x.com/hashtag/${encodeURIComponent(t)}`}>
                  #{t}
                </ExtLink>
              );
            })}
          </p>
          <p className="meta">お品書きは各サークルの投稿へのリンクです。内容・最新情報は必ずリンク先でご確認ください。</p>
          {contact && (
            <p className="meta">
              掲載内容の修正・削除のご依頼は <ExtLink href={contact.url}>{contact.label}</ExtLink> までお知らせください。
            </p>
          )}
          <p className="meta">「お品書きを見る」を押すと、X の公式埋め込みで投稿を読み込みます。その際、X があなたの閲覧データを取得する場合があります（X のプライバシーポリシーに従います）。押さない限り X のスクリプトは読み込みません。</p>
          {settings}
        </div>
      </details>
    </header>
  );
}
