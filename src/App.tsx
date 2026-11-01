import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Circle, CircleData, Filters, Pick } from './types';
import { allEvents, allTags, compareJa, isPicked, isTodo, matches, slotOf, sortCircles, spacesOf } from './filter';
import { useMine } from './useMine';
import Header from './components/Header';
import Controls from './components/Controls';
import CircleCard from './components/CircleCard';
import Settings from './components/Settings';
import { useTheme } from './useTheme';
import { useMediaQuery } from './useMediaQuery';
import SpaceMap from './components/SpaceMap';
import MenuDialog from './components/MenuDialog';
import { buildLayout } from './layout';
import { slotColorCss } from './slotColors';

// これ以上の幅（PC・タブレット横）では配置図と一覧を横に並べる。style.css の同じ値と合わせる
const WIDE_QUERY = '(min-width: 900px)';
// 配置図を載せるイベントか（events/<eventId>/layout.json があるか。vite.config.ts が設定）。載せない場合は一覧とマイリストだけ
const HAS_MAP = import.meta.env.VITE_HAS_MAP !== 'false';

const DATA_URL = `${import.meta.env.BASE_URL}data/circles.json`;

const initialFilters: Filters = { q: '', event: '', tag: '', pick: '', menu: '', sort: 'space' };

type Tab = 'map' | 'list' | 'mine';

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: CircleData };

export default function App() {
  const [load, setLoad] = useState<LoadState>({ status: 'loading' });
  const [filters, setFilters] = useState(initialFilters);
  const { mine, allTags: myTagList, toggleStar, toggleBought, toggleTag, setMemo, replace, merge, reset } = useMine();
  const { theme, setTheme } = useTheme();
  const wide = useMediaQuery(WIDE_QUERY);
  const [minePick, setMinePick] = useState<Pick>('picked');
  const [tab, setTab] = useState<Tab>(HAS_MAP ? 'map' : 'list');
  const [selectedId, setSelectedId] = useState<string>();
  const [mapFocus, setMapFocus] = useState(0);
  const [cardFocus, setCardFocus] = useState<string>();
  const [menuFor, setMenuFor] = useState<string>();
  const scrollRef = useRef<HTMLElement>(null);

  useEffect(() => {
    fetch(DATA_URL, { cache: 'no-cache' })
      .then((res) => {
        if (!res.ok) throw new Error(String(res.status));
        return res.json() as Promise<CircleData>;
      })
      .then((data) => setLoad({ status: 'ready', data }))
      .catch((err: Error) => setLoad({ status: 'error', message: err.message }));
  }, []);

  const circles = load.status === 'ready' ? load.data.circles : [];
  const event = load.status === 'ready' ? load.data.event : undefined;
  const layoutSpec = load.status === 'ready' ? load.data.layout : undefined;
  const layout = useMemo(() => (layoutSpec ? buildLayout(layoutSpec) : undefined), [layoutSpec]);
  const tags = useMemo(() => allTags(circles), [circles]);
  const events = useMemo(() => allEvents(circles), [circles]);
  const visible = useMemo(
    () => sortCircles(circles.filter((c) => matches(c, filters, mine)), filters.sort),
    [circles, filters, mine],
  );
  // マイリストは会場を回る順（スペース順）
  const picked = useMemo(
    () => circles.filter((c) => isPicked(mine, c.id)).sort((a, b) => compareJa(a.space, b.space)),
    [circles, mine],
  );
  const pickedShown = useMemo(
    () => picked.filter((c) => matches(c, { ...initialFilters, pick: minePick }, mine)),
    [picked, minePick, mine],
  );
  const usedTags = useMemo(() => myTagList.filter((t) => picked.some((c) => mine.tags[c.id]?.includes(t))), [myTagList, picked, mine.tags]);

  const bySpace = useMemo(() => {
    const m = new Map<string, Circle>();
    for (const c of circles) for (const s of spacesOf(c)) m.set(s, c);
    return m;
  }, [circles]);
  const visibleIds = useMemo(() => new Set(visible.map((c) => c.id)), [visible]);
  const filtered = visible.length !== circles.length;
  const selected = circles.find((c) => c.id === selectedId);

  // イベントごとの色の上書き（event.slotColors）
  const slotCss = useMemo(() => slotColorCss(event?.slotColors), [event?.slotColors]);

  useEffect(() => {
    document.title = `${event?.name ?? ''} サークルリスト`.trim();
  }, [event?.name]);

  const update = useCallback((patch: Partial<Filters>) => setFilters((f) => ({ ...f, ...patch })), []);
  const clearFilters = useCallback(() => setFilters((f) => ({ ...initialFilters, sort: f.sort })), []);

  // お品書きのシート。開くたびに履歴を1つ積み、スマホの「戻る」で閉じられるようにする
  const openMenus = useCallback((id: string) => {
    history.pushState({ menuDialog: id }, '');
    setMenuFor(id);
  }, []);
  const closeMenus = useCallback(() => {
    if (history.state?.menuDialog) history.back(); // popstate で閉じる
    else setMenuFor(undefined);
  }, []);
  useEffect(() => {
    const onPop = () => setMenuFor(history.state?.menuDialog);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const menuCircle = circles.find((c) => c.id === menuFor);

  // 横並びのときは配置図が常に見えているので、右側は一覧かマイリスト
  const showMapPane = HAS_MAP && (wide || tab === 'map');
  const pane: Tab = tab === 'map' && (wide || !HAS_MAP) ? 'list' : tab;

  // 一覧・チェック → 配置図（横並びのときはタブを切り替えない）
  const showOnMap = useCallback((id: string) => {
    setSelectedId(id);
    if (!wide) setTab('map');
    setMapFocus((n) => n + 1);
  }, [wide]);

  // 配置図 → 一覧。絞り込みで隠れていれば解除してから移動する
  const showInList = useCallback((id: string) => {
    if (!visibleIds.has(id)) clearFilters();
    setTab('list');
    setCardFocus(id);
  }, [visibleIds, clearFilters]);

  useEffect(() => {
    if (!cardFocus || pane !== 'list') return;
    document.getElementById(`c-${cardFocus}`)?.scrollIntoView({ block: 'center' });
    setCardFocus(undefined);
  }, [cardFocus, pane, visible]);

  // 同じタブをもう一度押したら先頭へ戻る
  const switchTab = (t: Tab) => {
    if (t === pane) scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    else setTab(t);
  };

  const card = (c: Circle) => (
    <CircleCard
      key={c.id}
      circle={c}
      eventSlot={slotOf(c.event, event?.eventSlots)}
      starred={!!mine.stars[c.id]}
      bought={!!mine.bought[c.id]}
      myTags={mine.tags[c.id] ?? []}
      allTags={myTagList}
      selected={c.id === selectedId}
      memo={mine.memos[c.id] ?? ''}
      onToggleStar={() => toggleStar(c.id)}
      onToggleBought={() => toggleBought(c.id)}
      onToggleTag={(t) => toggleTag(c.id, t)}
      onMemo={(text) => setMemo(c.id, text)}
      onTag={(t) => { update({ tag: t }); setTab('list'); }}
      onEvent={(ev) => { update({ event: ev }); setTab('list'); }}
      onShowOnMap={HAS_MAP ? () => showOnMap(c.id) : undefined}
      onOpenMenus={() => openMenus(c.id)}
    />
  );

  return (
    <div className={`app ${HAS_MAP ? '' : 'no-map'}`}>
      {slotCss && <style>{slotCss}</style>}
      <Header
        event={event}
        settings={<Settings mine={mine} theme={theme} onTheme={setTheme} onReplace={replace} onMerge={merge} onReset={reset} />}
      />

      {/* 配置図は表示範囲（拡大状態）を保つため、タブを切り替えても破棄しない */}
      {HAS_MAP && (
      <div className="view map-view" hidden={!showMapPane}>
        {load.status === 'ready' && circles.length > 0 && layout ? (
          <SpaceMap
            layout={layout}
            bySpace={bySpace}
            events={events}
            eventSlots={event?.eventSlots}
            mine={mine}
            allTags={myTagList}
            visibleIds={visibleIds}
            filtered={filtered}
            selected={selected}
            focusKey={mapFocus}
            onSelect={setSelectedId}
            onShowInList={showInList}
            onOpenMenus={openMenus}
            onToggleStar={toggleStar}
            onToggleBought={toggleBought}
            onToggleTag={toggleTag}
            onMemo={setMemo}
            onClearFilters={clearFilters}
          />
        ) : (
          <Status load={load} />
        )}
      </div>
      )}

      <main className="view scroll list-view" ref={scrollRef} hidden={showMapPane && !wide}>
        {pane === 'list' && (
          <>
            <Controls
              filters={filters}
              tags={tags}
              events={events}
              myTags={myTagList}
              onChange={update}
              onReset={clearFilters}
              status={`${visible.length} / ${circles.length} サークル`}
            />
            <div className="list">
              <Status load={load} />
              {load.status === 'ready' && circles.length > 0 && visible.length === 0 && (
                <p className="empty">条件に一致するサークルがありません。</p>
              )}
              {visible.map(card)}
            </div>
          </>
        )}
        {pane === 'mine' && (
          <>
            <div className="list">
              <p className="meta">★・タグ・購入済みのサークルをスペース順に表示しています。</p>
              {picked.length > 0 && (
                <div className="chips" role="group" aria-label="マイリストの絞り込み">
                  {([['picked', `すべて ${picked.length}`],
                    ['todo', `未購入 ${picked.filter((c) => isTodo(mine, c.id)).length}`],
                    ['bought', `購入済み ${picked.filter((c) => mine.bought[c.id]).length}`],
                    ['star', `★ ${picked.filter((c) => mine.stars[c.id]).length}`],
                    ...usedTags.map((t) => [`tag:${t}`, `${t} ${picked.filter((c) => mine.tags[c.id]?.includes(t)).length}`])] as [Pick, string][])
                    .map(([value, label]) => (
                      <button key={value} type="button" className="chip" aria-pressed={minePick === value} onClick={() => setMinePick(value)}>
                        {label}
                      </button>
                    ))}
                </div>
              )}
              {picked.length === 0 && (
                <p className="empty">まだ★やタグを付けたサークルはありません。配置図や一覧で ☆ を押すか、「タグ・メモ」からタグを付けてください。</p>
              )}
              {pickedShown.map(card)}
            </div>
            <p className="meta mine-note">★・購入済み・タグ・メモの書き出し・読み込みは、画面上部の「i」から行えます。</p>
          </>
        )}
      </main>

      {menuCircle && (
        <MenuDialog
          key={menuCircle.id}
          circle={menuCircle}
          eventSlot={slotOf(menuCircle.event, event?.eventSlots)}
          starred={!!mine.stars[menuCircle.id]}
          bought={!!mine.bought[menuCircle.id]}
          onToggleStar={() => toggleStar(menuCircle.id)}
          onToggleBought={() => toggleBought(menuCircle.id)}
          onShowOnMap={HAS_MAP ? () => { closeMenus(); showOnMap(menuCircle.id); } : undefined}
          onClose={closeMenus}
        />
      )}

      <nav className="tabbar" aria-label="表示切り替え">
        {([
          ['map', '配置図'],
          ['list', '一覧'],
          ['mine', `マイリスト${picked.length ? ` ${picked.length}` : ''}`],
        ] as const).filter(([t]) => t !== 'map' || (HAS_MAP && !wide)).map(([t, label]) => (
          <button key={t} type="button" aria-current={pane === t ? 'page' : undefined} onClick={() => switchTab(t)}>
            {label}
          </button>
        ))}
      </nav>
    </div>
  );
}

function Status({ load }: { load: LoadState }) {
  if (load.status === 'loading') return <p className="empty">読み込み中…</p>;
  if (load.status === 'error') return <p className="empty">データを読み込めませんでした（{load.message}）。</p>;
  if (load.data.circles.length === 0) return <p className="empty">サークル情報はまだ登録されていません。</p>;
  return null;
}
