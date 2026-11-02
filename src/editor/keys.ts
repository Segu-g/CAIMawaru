// 入力欄のキー操作。日本語入力の変換中（確定の Enter・候補を選ぶ ↑↓）は、どの操作にもしない。
type KeyLike = { key: string; shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; keyCode?: number; nativeEvent?: { isComposing?: boolean }; isComposing?: boolean };

export type KeyAction = 'enter' | 'shift-enter' | 'mod-enter' | 'up' | 'down' | 'escape';

/** 変換中か（Chrome は確定の keydown で isComposing、Safari などは keyCode 229） */
export function isComposing(e: KeyLike): boolean {
  return !!(e.nativeEvent?.isComposing ?? e.isComposing) || e.keyCode === 229;
}

/** キーを操作に読み替える。変換中と、ほかの修飾キーとの組み合わせは null */
export function keyAction(e: KeyLike): KeyAction | null {
  if (isComposing(e) || e.altKey) return null;
  const mod = !!(e.ctrlKey || e.metaKey);
  switch (e.key) {
    case 'Enter':
      if (mod) return 'mod-enter';
      return e.shiftKey ? 'shift-enter' : 'enter';
    case 'ArrowUp':
      return mod || e.shiftKey ? null : 'up';
    case 'ArrowDown':
      return mod || e.shiftKey ? null : 'down';
    case 'Escape':
      return 'escape';
    default:
      return null;
  }
}
