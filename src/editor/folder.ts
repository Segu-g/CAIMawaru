// イベントのフォルダ（events/<eventId>/）の読み書き。Chrome の File System Access API を使い、
// 利用者が選んだフォルダの中の event.json・data/circles.csv・data/menus.csv だけを読み書きする。
// 書く前に、読み込んだときから中身が変わっていないかを確かめ、変わっていたら書かない（CLI やエージェントの編集を消さないため）。

// 使う API だけの型（ブラウザの FileSystemDirectoryHandle と、テスト用の偽物の両方が満たす）
export type FileLike = { arrayBuffer(): Promise<ArrayBuffer>; lastModified: number; size: number };
export type WritableLike = { write(data: string): Promise<void>; close(): Promise<void>; abort?(): Promise<void> };
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

/** ファイルの中身を UTF-8 として読む（先頭の BOM は除く）。UTF-8 でなければ、置き換え文字で読んで保存してしまわないよう例外にする */
export function decodeUtf8(path: string, bytes: ArrayBuffer | Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`${path} は UTF-8 ではありません（Shift_JIS などで保存されています）。そのまま開いて保存すると文字が壊れるので開きません。UTF-8 で保存し直してから開いてください`);
  }
}

export async function readSnapshot(dir: DirHandleLike, path: FilePath): Promise<Snapshot> {
  const h = await fileHandle(dir, path, false);
  if (!h) return { path, exists: false, text: '', lastModified: 0, size: 0 };
  const f = await h.getFile();
  return { path, exists: true, text: decodeUtf8(path, await f.arrayBuffer()), lastModified: f.lastModified, size: f.size };
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
  /** すべて書けた */
  | { kind: 'saved'; snapshots: Snapshots; written: FilePath[] }
  /** 読み込んだ後にほかで変更されたファイルがあったので、何も書かなかった */
  | { kind: 'conflict'; changed: FilePath[] }
  /** 途中で失敗した。written は書けたファイル、snapshots はそれを反映した状態（書けなかったファイルは前のまま） */
  | { kind: 'failed'; snapshots: Snapshots; written: FilePath[]; failed: FilePath; message: string };

/** 書いた中身から、書いた直後のファイルの状態を作る（読み直さない。読み直すと、その間にほかが書いた内容を取り込んでしまうため） */
function writtenSnapshot(path: FilePath, text: string): Snapshot {
  return { path, exists: true, text, lastModified: Date.now(), size: new TextEncoder().encode(text).length };
}

/**
 * 編集したファイルを書く。
 * 1. 3つのファイルすべてを読み直し、どれかが読み込んだときから変わっていたら、何も書かずに conflict を返す
 * 2. 書くファイルすべての書き込み口（createWritable）を先に用意する。権限などで用意できなければ、何も書かずに failed を返す
 * 3. 順に書く。途中で失敗したら残りは書かず、書けたファイルだけを反映した状態で failed を返す
 * 返す状態（snapshots）は、書いたファイルは書いた中身から、書いていないファイルは手順 1 で読み直したものから作る。
 */
export async function saveFiles(
  dir: DirHandleLike,
  loaded: Snapshots,
  writes: Partial<Record<FilePath, string>>,
): Promise<SaveResult> {
  const before = await readAll(dir);
  const changed = changedSince(loaded, before);
  if (changed.length) return { kind: 'conflict', changed };
  const targets = FILES.filter((p) => writes[p] !== undefined);
  const snapshots: Snapshots = { ...before };
  const written: FilePath[] = [];

  // createWritable は一時ファイルに書き、close で置き換える（close までは元のファイルは変わらない）
  const opened: { path: FilePath; w: WritableLike }[] = [];
  const abortRest = async (from: number) => {
    for (const { w } of opened.slice(from)) await w.abort?.().catch(() => {});
  };
  for (const path of targets) {
    try {
      const h = (await fileHandle(dir, path, true))!;
      // ファイルがなかったときは、この時点で空のファイルができる
      if (!before[path].exists) snapshots[path] = { path, exists: true, text: '', lastModified: Date.now(), size: 0 };
      opened.push({ path, w: await h.createWritable() });
    } catch (e) {
      await abortRest(0);
      return { kind: 'failed', snapshots, written, failed: path, message: (e as Error).message };
    }
  }
  for (let n = 0; n < opened.length; n++) {
    const { path, w } = opened[n];
    try {
      await w.write(writes[path]!);
      await w.close();
    } catch (e) {
      await w.abort?.().catch(() => {});
      await abortRest(n + 1);
      return { kind: 'failed', snapshots, written, failed: path, message: (e as Error).message };
    }
    snapshots[path] = writtenSnapshot(path, writes[path]!);
    written.push(path);
  }
  return { kind: 'saved', snapshots, written };
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
