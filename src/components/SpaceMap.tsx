import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from 'react';
import type { Circle, Mine } from '../types';
import { svgRect, type Layout } from '../layout';
import { anchorView, clampView, fitView, toMap, viewBox, zoomAt, type Point, type Size, type View } from '../mapView';
import MapSheet from './MapSheet';
import { slotOf } from '../filter';

const TAP_SLOP = 8; // これ以上動いたらタップではなくドラッグ
const DOUBLE_TAP_MS = 300;
// 「配置図で見る」で拡大するときの表示幅。画面の幅 1px あたり配置図 1 単位（セル約45px）を目安に、
// スマホでは 420 を下限にする（PC の広い配置図で拡大しすぎないように幅に合わせる）
const focusWidth = (px: number) => Math.max(420, px);

type Props = {
  layout: Layout;
  bySpace: Map<string, Circle>;
  events: string[];
  eventSlots: Record<string, number> | undefined;
  mine: Mine;
  allTags: string[];
  visibleIds: Set<string>;
  filtered: boolean;
  selected: Circle | undefined;
  // 一覧から「配置図で見る」が押されるたびに増える。選択中のスペースへ拡大移動する
  focusKey: number;
  onSelect: (id: string | undefined) => void;
  onShowInList: (id: string) => void;
  onOpenMenus: (id: string) => void;
  onToggleStar: (id: string) => void;
  onToggleBought: (id: string) => void;
  onToggleTag: (id: string, tag: string) => void;
  onMemo: (id: string, text: string) => void;
  onClearFilters: () => void;
};

type Gesture = {
  anchor: Point; // 配置図上で掴んでいる点
  startW: number;
  startDist: number;
  startPx: Point;
  moved: boolean;
};

function SpaceMap({
  layout, bySpace, events, eventSlots, mine, allTags, visibleIds, filtered, selected, focusKey,
  onSelect, onShowInList, onOpenMenus, onToggleStar, onToggleBought, onToggleTag, onMemo, onClearFilters,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<Size>({ w: 0, h: 0 });
  const [view, setView] = useState<View>();
  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<Gesture>(undefined);
  const lastTap = useRef({ t: 0, x: 0, y: 0 });
  const handledFocus = useRef(0);

  const mainEvents = events.filter((ev) => slotOf(ev, eventSlots) > 0).sort((a, b) => slotOf(a, eventSlots) - slotOf(b, eventSlots));
  const otherEvents = events.filter((ev) => slotOf(ev, eventSlots) === 0);

  // タブ切り替えで非表示→表示になったときもサイズを取り直す
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize({ w: width, h: height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const ready = size.w > 0 && size.h > 0;
  useEffect(() => {
    if (ready && !view) setView(fitView(layout.focus, size));
  }, [ready, view, size]);

  const apply = useCallback((v: View) => setView(clampView(v, layout.bounds, size)), [size, layout]);

  // 非表示中に要求された場合は、表示されてサイズが取れた時点で一度だけ処理する
  useEffect(() => {
    if (!focusKey || focusKey === handledFocus.current || !selected || !ready) return;
    handledFocus.current = focusKey;
    const cells = layout.cells.filter((c) => bySpace.get(c.space)?.id === selected.id);
    if (!cells.length) return;
    const cx = cells.reduce((s, c) => s + c.x + c.w / 2, 0) / cells.length;
    const cy = cells.reduce((s, c) => s + c.y + c.h / 2, 0) / cells.length;
    // 下のパネルに隠れないよう、少し上寄りに表示
    const w = focusWidth(size.w);
    apply({ cx, cy: cy + ((w * size.h) / size.w) * 0.15, w });
  }, [focusKey, ready, selected, bySpace, apply, size, layout]);

  // PC: ホイールで拡大縮小（ページのスクロールを止めるため passive: false で登録）
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || !view) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      apply(zoomAt(view, size, Math.exp(-e.deltaY * 0.0015), { x: e.clientX - r.left, y: e.clientY - r.top }));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [view, size, apply]);

  const local = (e: PointerEvent): Point => {
    const r = wrapRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  // 指の本数が変わるたびに掴み直す
  const regrip = (moved: boolean) => {
    if (!view) return;
    const pts = [...pointers.current.values()];
    if (!pts.length) { gesture.current = undefined; return; }
    const mid = { x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length };
    const dist = pts.length > 1 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : 1;
    gesture.current = { anchor: toMap(view, size, mid), startW: view.w, startDist: dist, startPx: mid, moved };
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if ((e.target as Element).closest('.map-tools, .map-chip')) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, local(e));
    regrip(pointers.current.size > 1 || !!gesture.current?.moved);
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g || !pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, local(e));
    const pts = [...pointers.current.values()];
    const mid = { x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length };
    if (!g.moved && Math.hypot(mid.x - g.startPx.x, mid.y - g.startPx.y) < TAP_SLOP && pts.length === 1) return;
    g.moved = true;
    const dist = pts.length > 1 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : g.startDist;
    apply(anchorView(g.anchor, mid, (g.startW * g.startDist) / dist, size));
  };

  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(e.pointerId)) return;
    const wasTap = !gesture.current?.moved && pointers.current.size === 1;
    const px = local(e);
    pointers.current.delete(e.pointerId);
    regrip(true);
    if (!wasTap || !view) return;

    const now = e.timeStamp;
    const last = lastTap.current;
    if (now - last.t < DOUBLE_TAP_MS && Math.hypot(px.x - last.x, px.y - last.y) < 30) {
      apply(zoomAt(view, size, 2, px));
      lastTap.current = { t: 0, x: 0, y: 0 };
      return;
    }
    lastTap.current = { t: now, x: px.x, y: px.y };
    const hit = document.elementFromPoint(e.clientX, e.clientY)?.closest<SVGGElement>('[data-circle]');
    const id = hit?.dataset.circle;
    onSelect(id && id !== selected?.id ? id : undefined);
  };

  const onPointerCancel = (e: PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);
    regrip(true);
  };

  const zoomCenter = (factor: number) => view && apply(zoomAt(view, size, factor, { x: size.w / 2, y: size.h / 2 }));

  return (
    <div className="space-map">
      <div
        className="map-canvas"
        ref={wrapRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
      >
        {view && ready && (
          <svg viewBox={viewBox(view, size)} width={size.w} height={size.h} role="group" aria-label="会場配置図">
            <rect className="hall" {...svgRect(layout.hall)} />
            {layout.entrances.map((en) => (
              <g key={`${en.label}-${en.rect.x}-${en.rect.y}`}>
                <rect className="entrance" {...svgRect(en.rect)} />
                <text className="lm-label" x={en.rect.x + en.rect.w + 8} y={en.rect.y + en.rect.h / 2}>{en.label}</text>
              </g>
            ))}

            {layout.landmarks.map((lm) => {
              const box = lm.rect ?? bbox(lm.points!);
              return (
                <g key={`${lm.label}-${box.x}-${box.y}`} className={`lm ${lm.kind}`}>
                  {lm.rect ? <rect {...svgRect(lm.rect)} /> : <polygon points={lm.points!.map((p) => p.join(',')).join(' ')} />}
                  <text
                    className="lm-label"
                    x={box.x + box.w / 2}
                    y={box.y + Math.min(box.h / 2, 60)}
                    textAnchor="middle"
                    writingMode={lm.kind === 'queue' ? 'vertical-rl' : undefined}
                  >
                    {lm.label}
                  </text>
                </g>
              );
            })}

            {layout.cells.map((cell) => {
              const c = bySpace.get(cell.space);
              // 購入済みは灰色にして、まだ回っていない★・タグを目立たせる
              const bought = !!c && !!mine.bought[c.id];
              const star = !!c && !bought && !!mine.stars[c.id];
              const tagged = !!c && !bought && !star && !!mine.tags[c.id]?.length;
              const cls = [
                'cell',
                c ? `taken ev-${slotOf(c.event, eventSlots)}` : 'vacant',
                bought ? 'bought' : '',
                star ? 'star' : '',
                tagged ? 'tagged' : '',
                c && filtered && !visibleIds.has(c.id) ? 'dim' : '',
                c && selected?.id === c.id ? 'selected' : '',
              ].join(' ');
              return (
                <g
                  key={cell.space}
                  className={cls}
                  data-space={cell.space}
                  data-circle={c?.id}
                  role={c ? 'button' : undefined}
                  tabIndex={c ? 0 : undefined}
                  aria-label={c ? `${cell.space} ${c.name}` : undefined}
                  onKeyDown={c ? (e) => {
                    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(c.id); }
                  } : undefined}
                >
                  <rect {...svgRect(cell)} />
                  {/* ★・タグは色に加えて記号でも示す */}
                  <text x={cell.x + cell.w / 2} y={cell.y + cell.h / 2}>{bought ? '✓' : star ? '★' : tagged ? '●' : ''}{cell.number}</text>
                </g>
              );
            })}

            {layout.islandLabels.map((l) => (
              <text key={l.name} className="island-label" x={l.x} y={l.y} textAnchor={l.anchor}>
                {l.name}
              </text>
            ))}
          </svg>
        )}

        <div className="map-tools">
          <button type="button" aria-label="拡大" onClick={() => zoomCenter(1.6)}>＋</button>
          <button type="button" aria-label="縮小" onClick={() => zoomCenter(1 / 1.6)}>−</button>
          <button type="button" aria-label="サークル配置を表示" onClick={() => apply(fitView(layout.focus, size))}>島</button>
          <button type="button" aria-label="会場全体を表示" onClick={() => apply(fitView(layout.bounds, size))}>全体</button>
        </div>

        {filtered && (
          <button type="button" className="map-chip" onClick={onClearFilters}>
            絞り込み中（該当以外を薄く表示）✕
          </button>
        )}
      </div>

      {selected ? (
        <MapSheet
          key={selected.id}
          circle={selected}
          eventSlot={slotOf(selected.event, eventSlots)}
          starred={!!mine.stars[selected.id]}
          bought={!!mine.bought[selected.id]}
          myTags={mine.tags[selected.id] ?? []}
          allTags={allTags}
          memo={mine.memos[selected.id] ?? ''}
          onClose={() => onSelect(undefined)}
          onShowInList={() => onShowInList(selected.id)}
          onOpenMenus={() => onOpenMenus(selected.id)}
          onToggleStar={() => onToggleStar(selected.id)}
          onToggleBought={() => onToggleBought(selected.id)}
          onToggleTag={(t) => onToggleTag(selected.id, t)}
          onMemo={(text) => onMemo(selected.id, text)}
        />
      ) : (
        <div className="map-legend">
          {mainEvents.map((ev) => (
            <span key={ev}><i className={`ev-${slotOf(ev, eventSlots)}`} />{ev}</span>
          ))}
          {otherEvents.length > 0 && <span><i className="ev-0" />同時開催（{otherEvents.join('・')}）</span>}
          <span><i className="star">★</i>★</span>
          <span><i className="tagged">●</i>タグ付き</span>
          <span><i className="bought">✓</i>購入済み</span>
        </div>
      )}
    </div>
  );
}

function bbox(points: [number, number][]) {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

export default memo(SpaceMap);
