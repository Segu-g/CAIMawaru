import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { MapImage as MapImageInfo } from '../types';
import { fitView, viewBox, type Size } from '../mapView';
import { usePanZoom } from '../usePanZoom';

// 画像の大きさが取れないとき（大きさを書いていない SVG など）に仮に使う大きさ。縦横比は画像のまま描く
const FALLBACK_SIZE: Size = { w: 1000, h: 1000 };

const DEFAULT_ALT = '会場の配置図（画像）';

type Props = { image: MapImageInfo };

/**
 * 配置図の画像（event.json の info.mapImage。layout.json がないイベントだけ）を、拡大縮小・移動できるように表示する。
 * スペースの選択や強調はしない。大きく見るときもページの中の全画面表示にし、画像のファイルの URL へは移動させない。
 */
export default function MapImage({ image }: Props) {
  // src は events/<eventId>/public/ からの相対パス（build.py が検証済み）。ページの URL からの相対で読む
  const url = `${import.meta.env.BASE_URL}${image.src}`;
  const alt = image.alt || DEFAULT_ALT;
  const [natural, setNatural] = useState<Size | 'error'>();
  const [full, setFull] = useState(false);
  const fullButton = useRef<HTMLButtonElement>(null);
  const wasFull = useRef(false);
  // 閉じたら「全画面で見る」にフォーカスを戻す（押してもフォーカスが移らないブラウザがあるため、自分で戻す）。
  // 開いている間はダイアログの外を操作できないので、ダイアログが閉じたあと（この effect）で戻す
  useEffect(() => {
    if (wasFull.current && !full) fullButton.current?.focus();
    wasFull.current = full;
  }, [full]);

  useEffect(() => {
    const img = new Image();
    img.onload = () => setNatural(img.naturalWidth && img.naturalHeight ? { w: img.naturalWidth, h: img.naturalHeight } : FALLBACK_SIZE);
    img.onerror = () => setNatural('error');
    img.src = url;
    return () => { img.onload = null; img.onerror = null; };
  }, [url]);

  return (
    <div className="space-map map-image">
      {natural === 'error' ? (
        <p className="empty">配置図の画像を読み込めませんでした。</p>
      ) : natural ? (
        <ImageCanvas url={url} size={natural} alt={alt} />
      ) : (
        <p className="empty">読み込み中…</p>
      )}
      <div className="map-legend map-caption">
        {image.caption && <span>{image.caption}</span>}
        {natural && natural !== 'error' && (
          <button ref={fullButton} type="button" aria-haspopup="dialog" onClick={() => setFull(true)}>全画面で見る</button>
        )}
      </div>
      {full && natural && natural !== 'error' && (
        <FullScreen url={url} size={natural} alt={alt} caption={image.caption} onClose={() => setFull(false)} />
      )}
    </div>
  );
}

// 全画面表示。✕・Esc で閉じる（<dialog> の showModal で、開いている間はフォーカスが中にとどまる）
function FullScreen({ url, size, alt, caption, onClose }: { url: string; size: Size; alt: string; caption?: string; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog ref={ref} className="map-full" aria-label={`${alt}（全画面）`} onCancel={(e) => { e.preventDefault(); onClose(); }}>
      <div className="map-full-head">
        <span>{caption}</span>
        <button type="button" className="sheet-close" aria-label="全画面表示を閉じる" onClick={onClose}>✕</button>
      </div>
      <ImageCanvas url={url} size={size} alt={alt} />
    </dialog>
  );
}

function ImageCanvas({ url, size: natural, alt }: { url: string; size: Size; alt: string }) {
  const bounds = useMemo(() => ({ x: 0, y: 0, w: natural.w, h: natural.h }), [natural]);
  const { wrapRef, size, view, ready, apply, zoomCenter, handlers } = usePanZoom(bounds, bounds);

  // キーボード: ＋／−で拡大縮小、0 で全体、矢印で移動
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!view || e.target !== e.currentTarget || e.ctrlKey || e.metaKey || e.altKey) return;
    const step = view.w * 0.15;
    const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (e.key === '+' || e.key === '=') zoomCenter(1.6);
    else if (e.key === '-') zoomCenter(1 / 1.6);
    else if (e.key === '0') apply(fitView(bounds, size));
    else if (moves[e.key]) apply({ ...view, cx: view.cx + moves[e.key][0], cy: view.cy + moves[e.key][1] });
    else return;
    e.preventDefault();
  };

  // 読み上げのラベルは画像の説明の1か所だけ（描画する svg は読み上げない）。操作のキーは aria-keyshortcuts で示す
  return (
    <div
      className="map-canvas"
      ref={wrapRef}
      {...handlers}
      tabIndex={0}
      role="group"
      aria-label={alt}
      aria-keyshortcuts="+ - 0 ArrowLeft ArrowRight ArrowUp ArrowDown"
      onKeyDown={onKeyDown}
    >
      {view && ready && (
        <svg viewBox={viewBox(view, size)} width={size.w} height={size.h} aria-hidden="true">
          <image href={url} x={0} y={0} width={natural.w} height={natural.h} />
        </svg>
      )}
      <div className="map-tools">
        <button type="button" aria-label="拡大" onClick={() => zoomCenter(1.6)}>＋</button>
        <button type="button" aria-label="縮小" onClick={() => zoomCenter(1 / 1.6)}>−</button>
        <button type="button" aria-label="画像全体を表示" onClick={() => apply(fitView(bounds, size))}>全体</button>
      </div>
    </div>
  );
}
