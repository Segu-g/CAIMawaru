import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import type { MapImage as MapImageInfo } from '../types';
import { fitView, viewBox, type Size } from '../mapView';
import { usePanZoom } from '../usePanZoom';

// 画像の大きさが取れないとき（大きさを書いていない SVG など）に仮に使う大きさ。縦横比は画像のまま描く
const FALLBACK_SIZE: Size = { w: 1000, h: 1000 };

const DEFAULT_ALT = '会場の配置図（画像）';

type Props = { image: MapImageInfo };

/**
 * 公式の配置図などの画像（event.json の info.mapImage）を、拡大縮小・移動できるように表示する。
 * スペースの選択や強調はしない（描き起こしの配置図 layout.json の役目）。
 */
export default function MapImage({ image }: Props) {
  // src は events/<eventId>/public/ からの相対パス（build.py が検証済み）。ページの URL からの相対で読む
  const url = `${import.meta.env.BASE_URL}${image.src}`;
  const [natural, setNatural] = useState<Size | 'error'>();

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
        <ImageCanvas url={url} size={natural} alt={image.alt || DEFAULT_ALT} />
      ) : (
        <p className="empty">読み込み中…</p>
      )}
      <div className="map-legend map-caption">
        {image.caption && <span>{image.caption}</span>}
        <a href={url} target="_blank" rel="noopener noreferrer">画像だけを開く</a>
      </div>
    </div>
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

  return (
    <div
      className="map-canvas"
      ref={wrapRef}
      {...handlers}
      tabIndex={0}
      role="group"
      aria-label={`${alt}（＋・−で拡大縮小、矢印で移動、0 で全体）`}
      onKeyDown={onKeyDown}
    >
      {view && ready && (
        <svg viewBox={viewBox(view, size)} width={size.w} height={size.h} role="img" aria-label={alt}>
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
