// イベントデータのエディタ。利用者が選んだ events/<eventId>/ の event.json・data/circles.csv・data/menus.csv を
// ブラウザの中で編集し、同じフォルダに書き戻す（Chrome・Edge の File System Access API）。
// 正式な検証と circles.json の生成は Python の uv run caimawaru data <eventId>（ページからは実行しない）。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import CirclesTab from './CirclesTab';
import { loadDoc, serializeCircles, serializeEvent, serializeMenus, type Doc, type LoadNote } from './doc';
import type { Dirty } from './edit';
import EventTab from './EventTab';
import { slotsToObject, type SlotRow } from './edit';
import { changedSince, findEventDirs, readAll, saveFiles, type DirHandleLike, type FilePath, type Snapshots } from './folder';
import HuntTab from './HuntTab';
import MenusTab from './MenusTab';
import { circleId, isDataRow } from './model';
import { checkCircles, checkEvent, checkMenus, type Issue } from './validate';
import { loadMarks, saveMarks, setMark as setMarkIn, type Mark, type Marks } from './workMarks';

/** loadId は読み込むたびに変わる番号（読み込み直したときに、画面の入力中の状態を作り直すため） */
type Opened = { dir: DirHandleLike; snapshots: Snapshots; doc: Doc; notes: LoadNote[]; dirty: Dirty; loadId: number };
let loads = 0;
type Tab = 'hunt' | 'circles' | 'menus' | 'event' | 'issues';
type Status =
  | { kind: 'none' }
  | { kind: 'error'; message: string }
  | { kind: 'saved'; files: FilePath[] }
  | { kind: 'partial'; saved: FilePath[]; failed: FilePath; unsaved: FilePath[]; message: string }
  | { kind: 'conflict'; files: FilePath[] };

const CLEAN: Dirty = { event: false, circles: false, menus: false };
const DIRTY_FILE: Record<keyof Dirty, FilePath> = { event: 'event.json', circles: 'data/circles.csv', menus: 'data/menus.csv' };

type Picker = (options: { id?: string; mode: 'read' | 'readwrite' }) => Promise<DirHandleLike>;
const picker = (): Picker | undefined => (window as unknown as { showDirectoryPicker?: Picker }).showDirectoryPicker;

async function openFolder(dir: DirHandleLike): Promise<Opened> {
  const snapshots = await readAll(dir);
  if (!snapshots['event.json'].exists) throw new Error(`${dir.name}/ に event.json がありません`);
  const text = (p: FilePath) => (snapshots[p].exists ? snapshots[p].text : null);
  const { doc, notes } = loadDoc({ event: snapshots['event.json'].text, circles: text('data/circles.csv'), menus: text('data/menus.csv') });
  return { dir, snapshots, doc, notes, dirty: CLEAN, loadId: ++loads };
}

function Unsupported() {
  // File System Access API は安全な接続（https か localhost）でだけ使える。Chrome でも http://<IP アドレス> などでは使えない
  const insecure = !window.isSecureContext;
  return (
    <main className="ed-start">
      <h1>イベントデータの編集</h1>
      <div className="ed-box danger">
        {insecure ? (
          <>
            <p><strong>このアドレスでは使えません。</strong></p>
            <p>
              フォルダのファイルを直接読み書きする機能（File System Access API）は、安全な接続でだけ使えます。
              <code>http://localhost:…</code>（<code>pnpm editor</code> が表示するアドレス）か、<code>https://</code> のアドレスで開いてください。
              <code>http://192.168.…</code> のような IP アドレスや、<code>file://</code> では使えません。
            </p>
          </>
        ) : (
          <>
            <p><strong>このブラウザでは使えません。</strong></p>
            <p>
              フォルダのファイルを直接読み書きする機能（File System Access API の <code>showDirectoryPicker</code>）が必要です。
              PC の Chrome か Edge で開いてください（Firefox・Safari・スマホのブラウザは対応していません）。
            </p>
          </>
        )}
        <p>
          ブラウザを使わずに編集するときは、<code>events/&lt;eventId&gt;/</code> の event.json・data/circles.csv・data/menus.csv を直接編集し、
          <code>uv run caimawaru data &lt;eventId&gt;</code> で検証してください（docs/event-data.md）。
        </p>
      </div>
    </main>
  );
}

function NextStep({ eventId }: { eventId: string }) {
  const command = `uv run caimawaru data ${eventId}`;
  const [copied, setCopied] = useState(false);
  return (
    <span className="ed-next">
      次に、ターミナルで検証して circles.json を作り直してください: <code>{command}</code>
      <button
        type="button"
        onClick={() => navigator.clipboard?.writeText(command).then(() => setCopied(true), () => {})}
      >
        {copied ? 'コピーしました' : 'コピー'}
      </button>
    </span>
  );
}

export default function Editor() {
  const [opened, setOpened] = useState<Opened | null>(null);
  const [candidates, setCandidates] = useState<{ label: string; dir: DirHandleLike }[] | null>(null);
  const [status, setStatus] = useState<Status>({ kind: 'none' });
  const [external, setExternal] = useState<FilePath[]>([]);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<Tab>('circles');
  const [selected, setSelected] = useState<number | null>(null);
  const [huntSelected, setHuntSelected] = useState<number | null>(null);
  // 作業用の印・メモ（このブラウザの localStorage だけ。イベントのファイルには書かない）
  const [marks, setMarks] = useState<Marks>({});
  const [marksSaved, setMarksSaved] = useState(true);
  // 入力中の eventSlots の行（イベント情報タブを離れても残す。null は event.json のまま）
  const [slotDraft, setSlotDraft] = useState<SlotRow[] | null>(null);
  const slotPending = slotDraft ? slotsToObject(slotDraft) : null;
  const slotError = slotPending && !slotPending.ok ? slotPending.message : '';

  const dirty = !!opened && (opened.dirty.event || opened.dirty.circles || opened.dirty.menus);
  const eventId = opened?.dir.name ?? '';
  const storage = typeof localStorage === 'undefined' ? undefined : localStorage;
  useEffect(() => setMarks(eventId ? loadMarks(storage, eventId) : {}), [eventId, storage]);
  const setMark = useCallback((id: string, change: Mark) => {
    setMarks((m) => {
      const next = setMarkIn(m, id, change);
      setMarksSaved(saveMarks(storage, eventId, next));
      return next;
    });
  }, [storage, eventId]);

  const open = useCallback(async (dir: DirHandleLike) => {
    setBusy(true);
    try {
      const o = await openFolder(dir);
      setOpened(o);
      setCandidates(null);
      setStatus({ kind: 'none' });
      setExternal([]);
      setSelected(null);
      setHuntSelected(null);
      setSlotDraft(null);
    } catch (e) {
      setStatus({ kind: 'error', message: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }, []);

  const pick = async () => {
    if ((dirty || slotError) && !confirm('保存していない変更があります。破棄して別のフォルダを開きますか？')) return;
    let dir: DirHandleLike;
    try {
      dir = await picker()!({ id: 'caimawaru-event', mode: 'readwrite' });
    } catch (e) {
      if ((e as { name?: string }).name !== 'AbortError') setStatus({ kind: 'error', message: `フォルダを開けません: ${(e as Error).message}` });
      return;
    }
    let found: Awaited<ReturnType<typeof findEventDirs>>;
    try {
      found = await findEventDirs(dir);
    } catch (e) {
      setStatus({ kind: 'error', message: `フォルダを読めません: ${(e as Error).message}` });
      return;
    }
    if (found.isEvent) return open(dir);
    if (found.candidates.length) {
      setCandidates(found.candidates);
      setStatus({ kind: 'none' });
    } else {
      setStatus({ kind: 'error', message: `${dir.name}/ はイベントのフォルダではありません。event.json のある events/<eventId>/ を選んでください` });
    }
  };

  const reload = async () => {
    if (!opened) return;
    if ((dirty || slotError) && !confirm('保存していない変更を破棄して、ファイルから読み込み直しますか？')) return;
    await open(opened.dir);
  };

  /** 編集する。which は書き換わるファイル */
  const edit = useCallback((fn: (doc: Doc) => Doc, ...which: (keyof Dirty)[]) => {
    setOpened((o) => {
      if (!o) return o;
      const dirtyNext = { ...o.dirty };
      for (const w of which) dirtyNext[w] = true;
      return { ...o, doc: fn(o.doc), dirty: dirtyNext };
    });
    setStatus((s) => (s.kind === 'saved' ? { kind: 'none' } : s));
  }, []);

  const issues = useMemo<Issue[]>(
    () => (opened ? [...checkEvent(opened.doc.event), ...checkCircles(opened.doc.circles), ...checkMenus(opened.doc.menus, opened.doc.circles)] : []),
    [opened],
  );
  const errors = issues.filter((i) => i.level === 'error').length;

  const save = async () => {
    if (!opened || (!dirty && !slotError)) return;
    if (slotError) {
      const go = confirm(`イベント情報の「イベントの色（eventSlots）」の入力に問題があり、まだ event.json に反映していません:\n${slotError}\n\nこの入力は保存されません。ほかの変更だけを保存しますか？`);
      if (!go) return setTab('event');
      if (!dirty) return;
    }
    if (errors && !confirm(`確認でエラーが ${errors} 件あります（「確認」タブ）。このまま保存しますか？\nエラーがあると uv run caimawaru data は circles.json を作りません。`)) return;
    const { doc } = opened;
    const writes: Partial<Record<FilePath, string>> = {};
    // 書き戻すと値が変わる event.json は書かない（画面でも編集できないようにしてある）
    if (opened.dirty.event && !doc.eventLocked.length) writes['event.json'] = serializeEvent(doc);
    if (opened.dirty.circles) writes['data/circles.csv'] = serializeCircles(doc);
    if (opened.dirty.menus) writes['data/menus.csv'] = serializeMenus(doc);
    setBusy(true);
    try {
      const res = await saveFiles(opened.dir, opened.snapshots, writes);
      if (res.kind === 'conflict') {
        setStatus({ kind: 'conflict', files: res.changed });
        return;
      }
      // 書けたファイルだけを「保存済み」にする（保存中に編集されていたら、そのファイルは未保存のまま）
      setOpened((o) => {
        if (!o) return o;
        const next = { ...o.dirty };
        for (const k of Object.keys(DIRTY_FILE) as (keyof Dirty)[]) {
          if (res.written.includes(DIRTY_FILE[k]) && o.doc === doc) next[k] = false;
        }
        return { ...o, snapshots: res.snapshots, dirty: next, notes: res.kind === 'saved' ? [] : o.notes };
      });
      setExternal([]);
      if (res.kind === 'saved') setStatus({ kind: 'saved', files: res.written });
      else {
        const unsaved = (Object.keys(writes) as FilePath[]).filter((p) => !res.written.includes(p));
        setStatus({ kind: 'partial', saved: res.written, failed: res.failed, unsaved, message: res.message });
      }
    } catch (e) {
      setStatus({ kind: 'error', message: `保存できませんでした: ${(e as Error).message}` });
    } finally {
      setBusy(false);
    }
  };

  // ほかのウィンドウ（ターミナル・エディタ）から戻ってきたら、ファイルが変わっていないか確かめる
  useEffect(() => {
    if (!opened) return;
    const { dir, snapshots } = opened;
    let cancelled = false;
    const check = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const changed = changedSince(snapshots, await readAll(dir));
        if (!cancelled) setExternal(changed);
      } catch {
        // 確かめられなくても、保存の前にもう一度確かめる
      }
    };
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', check);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', check);
      document.removeEventListener('visibilitychange', check);
    };
  }, [opened]);

  // 保存していない変更があるときは、閉じる前に確かめる
  useEffect(() => {
    if (!dirty && !slotError) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, slotError]);

  // Ctrl+S（⌘S）で保存、「/」で検索欄へ。入力中の欄は先に確定させる（フォーカスを外すと確定する欄があるため）
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        (document.activeElement as HTMLElement | null)?.blur?.();
        setTimeout(() => saveRef.current(), 0);
        return;
      }
      const el = e.target as HTMLElement;
      const typing = el.closest?.('input, textarea, select, [contenteditable="true"]');
      if (e.key === '/' && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const search = document.querySelector<HTMLInputElement>('.ed-main input[type="search"]');
        if (search) {
          e.preventDefault();
          search.focus();
          search.select();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /** 確認の項目から、その行を開く */
  const jump = (issue: Issue) => {
    if (!opened) return;
    if (issue.where === 'event') return setTab('event');
    if (issue.where === 'circle') {
      setSelected(issue.key ?? null);
      return setTab('circles');
    }
    const menu = opened.doc.menus.find((m) => m.key === issue.key);
    const circle = menu && opened.doc.circles.find((c) => isDataRow(c.values, c.extra) && circleId(c.values) === menu.values.id.trim());
    if (circle) {
      setSelected(circle.key);
      setTab('circles');
    } else setTab('menus');
  };

  if (!picker()) return <Unsupported />;

  const statusBox = (
    <>
      {status.kind === 'error' && <div className="ed-box danger" role="alert">{status.message}</div>}
      {status.kind === 'conflict' && (
        <div className="ed-box danger" role="alert">
          <p>
            <strong>保存しませんでした。</strong>読み込んだ後に、ほかで（CLI・エージェント・別のエディタなど）次のファイルが変更されています:{' '}
            {status.files.join('・')}
          </p>
          <p>上書きすると、その変更が消えます。読み込み直してから、もう一度編集してください（この画面での変更は破棄されます）。</p>
          <button type="button" onClick={() => opened && open(opened.dir)}>読み込み直す</button>
        </div>
      )}
      {status.kind === 'partial' && (
        <div className="ed-box danger" role="alert">
          <p>
            <strong>保存が途中で失敗しました</strong>（{status.failed}: {status.message}）。
          </p>
          <p>保存できたファイル: {status.saved.length ? status.saved.join('・') : 'なし'}</p>
          <p>保存できなかったファイル（未保存のまま）: {status.unsaved.join('・')}</p>
          <p>原因（ファイルの権限・ディスクの空きなど）を確かめてから、もう一度「保存」してください。</p>
        </div>
      )}
      {status.kind === 'saved' && (
        <div className="ed-box ok" role="status">
          <p>{status.files.join('・')} を保存しました。</p>
          <p><NextStep eventId={eventId} /></p>
        </div>
      )}
      {status.kind !== 'conflict' && external.length > 0 && (
        <div className="ed-box warn" role="status">
          <p>読み込んだ後に、ほかで {external.join('・')} が変更されました。このままでは保存できません（上書きしないため）。</p>
          <button type="button" onClick={reload}>読み込み直す</button>
        </div>
      )}
    </>
  );

  if (!opened) {
    return (
      <main className="ed-start">
        <h1>イベントデータの編集</h1>
        <p>
          イベントのフォルダ <code>events/&lt;eventId&gt;/</code> を選ぶと、サークル（data/circles.csv）・お品書き（data/menus.csv）・
          イベント情報（event.json）をこの画面で編集して、同じフォルダに保存できます。
        </p>
        <ul className="meta ed-list">
          <li>読み書きするのは選んだフォルダの event.json・data/circles.csv・data/menus.csv だけです（layout.json は変えません）</li>
          <li>ファイルはこの PC の中だけで扱い、どこにも送りません</li>
          <li>保存の前に、読み込んだ後でほかに（CLI・エージェントなど）変更されていないかを確かめ、変更されていたら上書きしません</li>
          <li>保存したあとは、ターミナルで <code>uv run caimawaru data &lt;eventId&gt;</code> を実行して検証・生成します</li>
        </ul>
        <div>
          <button type="button" className="ed-primary" onClick={pick} disabled={busy}>
            イベントのフォルダを選ぶ
          </button>
        </div>
        <p className="meta">ブラウザがフォルダの編集の許可を求めてきたら「ファイルを編集」を選んでください。</p>
        {candidates && (
          <div className="ed-box">
            <p>選んだフォルダの中にイベントがあります。編集するイベントを選んでください:</p>
            <div className="ed-candidates">
              {candidates.map((c) => (
                <button type="button" key={c.label} onClick={() => open(c.dir)} disabled={busy}>
                  {c.label}
                </button>
              ))}
            </div>
          </div>
        )}
        {statusBox}
      </main>
    );
  }

  const { doc } = opened;
  const circleCount = doc.circles.filter((c) => isDataRow(c.values, c.extra)).length;
  const menuCount = doc.menus.filter((m) => isDataRow(m.values, m.extra)).length;
  const withMenu = new Set(doc.menus.filter((m) => isDataRow(m.values, m.extra)).map((m) => m.values.id.trim()));
  const todo = doc.circles.filter((c) => c.comment === undefined && isDataRow(c.values, c.extra) && !withMenu.has(circleId(c.values))).length;
  const tabs: [Tab, string][] = [
    ['circles', `サークル（${circleCount}）`],
    ['hunt', `お品書き探し（未登録 ${todo}）`],
    ['menus', `お品書き（${menuCount}）`],
    ['event', slotError ? 'イベント情報（未反映の入力あり）' : 'イベント情報'],
    ['issues', `確認（${issues.length ? `エラー ${errors}・警告 ${issues.length - errors}` : 'OK'}）`],
  ];

  return (
    <div className="ed-app">
      <header className="ed-header">
        <h1>
          <span className="ed-title">イベントデータの編集</span>
          <span className="ed-folder">events/{eventId}/</span>
        </h1>
        <div className="ed-header-buttons">
          {dirty && (
            <span className="ed-dirty">
              未保存: {(Object.keys(opened.dirty) as (keyof Dirty)[]).filter((k) => opened.dirty[k]).map((k) => DIRTY_FILE[k]).join('・')}
            </span>
          )}
          <button type="button" onClick={pick} disabled={busy}>別のフォルダ</button>
          <button type="button" onClick={reload} disabled={busy}>読み込み直す</button>
          <button type="button" className="ed-primary" onClick={save} disabled={busy || (!dirty && !slotError)}>保存</button>
        </div>
      </header>
      <nav className="ed-tabs" aria-label="編集するもの">
        {tabs.map(([t, label]) => (
          <button type="button" key={t} aria-current={tab === t ? 'page' : undefined} onClick={() => setTab(t)}>
            {label}
          </button>
        ))}
      </nav>
      <div className="ed-status">
        {statusBox}
        {opened.notes.length > 0 && (
          <div className="ed-box">
            {opened.notes.map((n, i) => (
              <p key={i}>{n.file}: {n.message}</p>
            ))}
          </div>
        )}
      </div>
      <main className="ed-main">
        {tab === 'hunt' && (
          <HuntTab doc={doc} edit={edit} marks={marks} setMark={setMark} marksSaved={marksSaved}
            selected={huntSelected} onSelect={setHuntSelected} onOpenCircle={(key) => { setSelected(key); setTab('circles'); }} />
        )}
        {tab === 'circles' && <CirclesTab doc={doc} issues={issues} selected={selected} onSelect={setSelected} edit={edit} marks={marks} />}
        {tab === 'menus' && <MenusTab doc={doc} edit={edit} onOpenCircle={(key) => { setSelected(key); setTab('circles'); }} onHunt={() => setTab('hunt')} />}
        {tab === 'event' && <EventTab key={opened.loadId} doc={doc} issues={issues} edit={edit} slotDraft={slotDraft} setSlotDraft={setSlotDraft} />}
        {tab === 'issues' && (
          <section className="ed-issues">
            <p className="meta">
              ここでは明らかな間違いだけを確かめています。正式な検証は保存したあとの <code>uv run caimawaru data {eventId}</code> です。
            </p>
            {issues.length === 0 ? (
              <p className="empty">見つかった問題はありません</p>
            ) : (
              <ul>
                {issues.map((i, n) => (
                  <li key={n} className={i.level}>
                    <button type="button" onClick={() => jump(i)}>
                      <span className="ed-level">{i.level === 'error' ? 'エラー' : '警告'}</span>
                      {i.where === 'event' ? 'event.json: ' : ''}{i.message}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
