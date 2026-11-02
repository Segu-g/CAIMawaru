// イベントのフォルダ（events/<eventId>/）の読み書き。Chrome の File System Access API を使い、
// 利用者が選んだフォルダの中の event.json・data/circles.csv・data/menus.csv だけを読み書きする。
// 書く前に、読み込んだときから中身が変わっていないかを確かめ、変わっていたら書かない（CLI やエージェントの編集を消さないため）。

// 使う API だけの型（ブラウザの FileSystemDirectoryHandle と、テスト用の偽物の両方が満たす）
export type FileLike = { text(): Promise<string>; lastModified: number; size: number };
export type WritableLike = { write(data: string): Promise<void>; close(): Promise<void> };
export interface FileHandleLike {
  readonly kind: 'file';
  readonly name: string;
  getFile(): Promise<FileLike>;
  createWritable(): Promise<WritableLike>;
}
export interface DirHandleLike {
  readonly kind: 'directory';
  readonly name: string;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FileHandleLike>;
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<DirHandleLike>;
  values(): AsyncIterable<FileHandleLike | DirHandleLike>;
}

export const FILES = ['event.json', 'data/circles.csv', 'data/menus.csv'] as const;
export type FilePath = (typeof FILES)[number];

/** 読み込んだ時点のファイルの状態 */
export type Snapshot = { path: FilePath; exists: boolean; text: string; lastModified: number; size: number };
export type Snapshots = Record<FilePath, Snapshot>;

function isNotFound(e: unknown): boolean {
  const name = (e as { name?: unknown } | null)?.name;
  return name === 'NotFoundError' || name === 'TypeMismatchError';
}

async function fileHandle(dir: DirHandleLike, path: FilePath, create: boolean): Promise<FileHandleLike | null> {
  const parts = path.split('/');
  const name = parts.pop()!;
  try {
    let d = dir;
    for (const p of parts) d = await d.getDirectoryHandle(p, { create });
    return await d.getFileHandle(name, { create });
  } catch (e) {
    if (!create && isNotFound(e)) return null;
    throw e;
  }
}

export async function readSnapshot(dir: DirHandleLike, path: FilePath): Promise<Snapshot> {
  const h = await fileHandle(dir, path, false);
  if (!h) return { path, exists: false, text: '', lastModified: 0, size: 0 };
  const f = await h.getFile();
  return { path, exists: true, text: await f.text(), lastModified: f.lastModified, size: f.size };
}

export async function readAll(dir: DirHandleLike): Promise<Snapshots> {
  const list = await Promise.all(FILES.map((p) => readSnapshot(dir, p)));
  return Object.fromEntries(list.map((s) => [s.path, s])) as Snapshots;
}

/**
 * 読み込んだときから変わったファイル。あった／なくなった、大きさ、中身のどれかが違えば「変わった」。
 * 更新日時だけが違って中身が同じなら、上書きしても失うものがないので変わっていない扱いにする。
 */
export function changedSince(loaded: Snapshots, current: Snapshots): FilePath[] {
  return FILES.filter((p) => {
    const a = loaded[p];
    const b = current[p];
    return a.exists !== b.exists || a.size !== b.size || a.text !== b.text;
  });
}

export type SaveResult =
  | { ok: true; snapshots: Snapshots; written: FilePath[] }
  | { ok: false; changed: FilePath[] };

/**
 * 編集したファイルを書く。書く前に3つのファイルすべてを読み直し、どれかが読み込んだときから変わっていたら、
 * 何も書かずに変わったファイルを返す（一部だけ書いて食い違うのを避ける）。
 */
export async function saveFiles(
  dir: DirHandleLike,
  loaded: Snapshots,
  writes: Partial<Record<FilePath, string>>,
): Promise<SaveResult> {
  const before = await readAll(dir);
  const changed = changedSince(loaded, before);
  if (changed.length) return { ok: false, changed };
  const written: FilePath[] = [];
  for (const path of FILES) {
    const text = writes[path];
    if (text === undefined) continue;
    const h = (await fileHandle(dir, path, true))!;
    // createWritable は一時ファイルに書き、close で置き換える（途中で失敗しても元のファイルは残る）
    const w = await h.createWritable();
    await w.write(text);
    await w.close();
    written.push(path);
  }
  return { ok: true, snapshots: await readAll(dir), written };
}

/** 選んだフォルダがイベントのフォルダか。違えば、中にあるイベントのフォルダの候補を返す（events/ やリポジトリを選んだとき）。 */
export async function findEventDirs(dir: DirHandleLike): Promise<{ isEvent: boolean; candidates: { label: string; dir: DirHandleLike }[] }> {
  const hasEventJson = async (d: DirHandleLike) => !!(await fileHandle(d, 'event.json', false));
  if (await hasEventJson(dir)) return { isEvent: true, candidates: [] };
  const candidates: { label: string; dir: DirHandleLike }[] = [];
  const scan = async (d: DirHandleLike, prefix: string) => {
    for await (const h of d.values()) {
      if (h.kind === 'directory' && (await hasEventJson(h))) candidates.push({ label: prefix + h.name, dir: h });
    }
  };
  await scan(dir, '');
  try {
    await scan(await dir.getDirectoryHandle('events'), 'events/');
  } catch (e) {
    if (!isNotFound(e)) throw e;
  }
  candidates.sort((a, b) => a.label.localeCompare(b.label));
  return { isEvent: false, candidates };
}
