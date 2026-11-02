// 作業用の印とメモ（「あとで」・自由なメモ）。このブラウザの localStorage にだけ置き、イベントのファイルには書かない
// （CSV の形式・CLI・公開ページは変わらない。別のブラウザ・PC とは共有されない）。サークルの id ごとに持つ。
export type Mark = { later?: boolean; memo?: string };
export type Marks = Record<string, Mark>;

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export const marksKey = (eventId: string) => `caimawaru-editor:marks:${eventId}`;

/** 読めない値・形の違う値は無視する（ほかの版のエディタが書いたものなど） */
export function parseMarks(text: string | null): Marks {
  if (!text) return {};
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return {};
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Marks = {};
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) continue;
    const { later, memo } = v as Record<string, unknown>;
    const m: Mark = {};
    if (later === true) m.later = true;
    if (typeof memo === 'string' && memo.trim()) m.memo = memo;
    if (m.later || m.memo) out[id] = m;
  }
  return out;
}

/** 印を変える。印もメモもなくなったら、その id を消す */
export function setMark(marks: Marks, id: string, change: Mark): Marks {
  const m: Mark = { ...marks[id], ...change };
  const next = { ...marks };
  if (!m.later) delete m.later;
  if (!m.memo?.trim()) delete m.memo;
  if (m.later || m.memo) next[id] = m;
  else delete next[id];
  return next;
}

export function loadMarks(storage: StorageLike | undefined, eventId: string): Marks {
  try {
    return parseMarks(storage?.getItem(marksKey(eventId)) ?? null);
  } catch {
    return {};
  }
}

/** 保存できなければ false（容量・プライベートモードなど。画面の印は残る） */
export function saveMarks(storage: StorageLike | undefined, eventId: string, marks: Marks): boolean {
  try {
    if (!storage) return false;
    if (Object.keys(marks).length) storage.setItem(marksKey(eventId), JSON.stringify(marks));
    else storage.removeItem(marksKey(eventId));
    return true;
  } catch {
    return false;
  }
}
