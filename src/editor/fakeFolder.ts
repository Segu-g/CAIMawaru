// テスト用の、メモリ上のフォルダ（File System Access API の FileSystemDirectoryHandle のうちエディタが使う部分）。
import type { DirHandleLike, FileHandleLike, FileLike, WritableLike } from './folder';

type Entry = { kind: 'file'; text: string; lastModified: number } | { kind: 'dir'; dir: FakeDir };

let clock = 1_000;

function notFound(name: string): Error {
  const e = new Error(`${name} がありません`);
  e.name = 'NotFoundError';
  return e;
}

export class FakeDir implements DirHandleLike {
  readonly kind = 'directory' as const;
  readonly entries = new Map<string, Entry>();
  constructor(readonly name: string) {}

  /** パス（「data/circles.csv」）にファイルを置く。フォルダは作る */
  put(path: string, text: string): this {
    const parts = path.split('/');
    const file = parts.pop()!;
    let d: FakeDir = this;
    for (const p of parts) {
      let e = d.entries.get(p);
      if (!e) d.entries.set(p, (e = { kind: 'dir', dir: new FakeDir(p) }));
      if (e.kind !== 'dir') throw new Error(`${p} はファイルです`);
      d = e.dir;
    }
    d.entries.set(file, { kind: 'file', text, lastModified: ++clock });
    return this;
  }

  /** パスのファイルの中身（なければ undefined） */
  read(path: string): string | undefined {
    const parts = path.split('/');
    const file = parts.pop()!;
    let d: FakeDir | undefined = this;
    for (const p of parts) {
      const e: Entry | undefined = d?.entries.get(p);
      d = e?.kind === 'dir' ? e.dir : undefined;
    }
    const e = d?.entries.get(file);
    return e?.kind === 'file' ? e.text : undefined;
  }

  /** 中身を変えずに更新日時だけ進める（touch） */
  touch(path: string): void {
    const text = this.read(path);
    if (text === undefined) throw notFound(path);
    this.put(path, text);
  }

  async getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<DirHandleLike> {
    let e = this.entries.get(name);
    if (!e && options?.create) this.entries.set(name, (e = { kind: 'dir', dir: new FakeDir(name) }));
    if (!e) throw notFound(name);
    if (e.kind !== 'dir') throw Object.assign(new Error(name), { name: 'TypeMismatchError' });
    return e.dir;
  }

  async getFileHandle(name: string, options?: { create?: boolean }): Promise<FileHandleLike> {
    if (!this.entries.has(name)) {
      if (!options?.create) throw notFound(name);
      this.entries.set(name, { kind: 'file', text: '', lastModified: ++clock });
    }
    const e = this.entries.get(name)!;
    if (e.kind !== 'file') throw Object.assign(new Error(name), { name: 'TypeMismatchError' });
    return this.fileHandle(name);
  }

  private fileHandle(name: string): FileHandleLike {
    const entries = this.entries;
    return {
      kind: 'file',
      name,
      async getFile(): Promise<FileLike> {
        const e = entries.get(name);
        if (e?.kind !== 'file') throw notFound(name);
        const size = new TextEncoder().encode(e.text).length;
        return { text: async () => e.text, lastModified: e.lastModified, size };
      },
      async createWritable(): Promise<WritableLike> {
        // 本物と同じく、close するまで元のファイルは変わらない
        let buf = '';
        return {
          async write(data: string) {
            buf += data;
          },
          async close() {
            entries.set(name, { kind: 'file', text: buf, lastModified: ++clock });
          },
        };
      },
    };
  }

  async *values(): AsyncIterable<FileHandleLike | DirHandleLike> {
    for (const [name, e] of this.entries) yield e.kind === 'dir' ? e.dir : this.fileHandle(name);
  }
}
