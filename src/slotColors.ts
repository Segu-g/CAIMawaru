import type { SlotColor } from './types';

// event.slotColors（枠番号 → 色）から、style.css の --ev-1〜5 を上書きする CSS を作る。
// ダークはライトと同じ3か所（OS 設定の自動・明示的なダーク）に当てる
export function slotColorCss(colors: Record<string, SlotColor> | undefined): string {
  if (!colors) return '';
  const light: string[] = [];
  const dark: string[] = [];
  for (const [slot, c] of Object.entries(colors)) {
    if (!/^[1-5]$/.test(slot)) continue;
    light.push(`--ev-${slot}: ${c.light};`, ...(c.ink ? [`--ev-${slot}-ink: ${c.ink};`] : []));
    const d = c.dark ?? c.light;
    const di = c.darkInk ?? c.ink;
    dark.push(`--ev-${slot}: ${d};`, ...(di ? [`--ev-${slot}-ink: ${di};`] : []));
  }
  if (!light.length) return '';
  const L = light.join(' ');
  const D = dark.join(' ');
  return `:root { ${L} }\n@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { ${D} } }\n:root[data-theme="dark"] { ${D} }\n`;
}
