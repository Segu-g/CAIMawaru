import { useEffect, useState, type ChangeEvent } from 'react';
import type { Mine } from '../types';
import { STORE_ID, fromExport, toExport } from '../useMine';
import type { Theme } from '../useTheme';

type Props = {
  mine: Mine;
  theme: Theme;
  onTheme: (t: Theme) => void;
  onReplace: (value: Mine) => void;
  onMerge: (value: Mine) => void;
  onReset: () => void;
};

const THEMES: [Theme, string][] = [['auto', '自動'], ['light', 'ライト'], ['dark', 'ダーク']];

const summary = (m: Mine) =>
  `★${Object.keys(m.stars).length}・購入済み${Object.keys(m.bought).length}・タグ${Object.keys(m.tags).length}・メモ${Object.keys(m.memos).length}`;

// ヘッダーの「i」の中の設定: 表示テーマと、★・購入済み・タグ・メモの書き出し・読み込み
export default function Settings({ mine, theme, onTheme, onReplace, onMerge, onReset }: Props) {
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState<Mine>(); // 読み込む前の確認中のデータ
  const [pasting, setPasting] = useState(false);
  const [pasted, setPasted] = useState('');
  const [armed, setArmed] = useState(false);

  // 誤操作防止のため「すべて消去」は2回押しで実行（ブラウザのダイアログは使わない）
  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(timer);
  }, [armed]);

  const json = () => JSON.stringify(toExport(mine), null, 2);

  const saveFile = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([json()], { type: 'application/json' }));
    a.download = `circlelist-${STORE_ID}-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    setMessage(`ファイルに保存しました（${summary(mine)}）。`);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(json());
      setMessage(`コピーしました（${summary(mine)}）。別の端末の「貼り付けて読み込み」に貼ってください。`);
    } catch {
      setMessage('コピーできませんでした。「ファイルに保存」を使ってください。');
    }
  };

  const prepare = (text: string) => {
    try {
      const value = fromExport(JSON.parse(text));
      setPending(value);
      setMessage('');
    } catch {
      setMessage('読み込めませんでした。書き出したファイル（またはコピーした内容）か確認してください。');
    }
  };

  const openFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) prepare(await file.text());
  };

  const apply = (mode: 'replace' | 'merge') => {
    if (!pending) return;
    if (mode === 'replace') onReplace(pending);
    else onMerge(pending);
    setMessage(mode === 'replace' ? '読み込んだ内容に置き換えました。' : '今の内容に追加しました。');
    setPending(undefined);
    setPasting(false);
    setPasted('');
  };

  const reset = () => {
    if (!armed) {
      setArmed(true);
      return;
    }
    onReset();
    setArmed(false);
    setMessage('すべて消去しました。');
  };

  return (
    <section className="settings" aria-label="設定">
      <div className="setting-row">
        <span className="setting-label">表示テーマ</span>
        <div className="segmented" role="group" aria-label="表示テーマ">
          {THEMES.map(([t, label]) => (
            <button key={t} type="button" aria-pressed={theme === t} onClick={() => onTheme(t)}>{label}</button>
          ))}
        </div>
      </div>

      <div className="setting-block">
        <span className="setting-label">★・購入済み・タグ・メモ（{summary(mine)}）</span>
        <p className="meta">この端末のブラウザにだけ保存され、外部には送られません。別の端末へ移すときや、念のための控えに使ってください。</p>
        <div className="setting-buttons">
          <button type="button" onClick={saveFile}>ファイルに保存</button>
          <button type="button" onClick={copy}>コピー</button>
          <label className="file-btn">
            ファイルから読み込み
            <input type="file" accept="application/json,.json" onChange={openFile} />
          </label>
          <button type="button" aria-expanded={pasting} onClick={() => setPasting(!pasting)}>貼り付けて読み込み</button>
        </div>

        {pasting && !pending && (
          <div className="paste-box">
            <textarea
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              placeholder="コピーした内容をここに貼り付け"
              rows={4}
              aria-label="読み込む内容"
            />
            <button type="button" disabled={!pasted.trim()} onClick={() => prepare(pasted)}>内容を確認</button>
          </div>
        )}

        {pending && (
          <div className="import-confirm" role="group" aria-label="読み込みの確認">
            <p className="meta">読み込む内容: {summary(pending)}<br />今の内容: {summary(mine)}</p>
            <div className="setting-buttons">
              <button type="button" onClick={() => apply('merge')}>今の内容に追加</button>
              <button type="button" onClick={() => apply('replace')}>置き換える</button>
              <button type="button" onClick={() => setPending(undefined)}>やめる</button>
            </div>
          </div>
        )}

        <div className="setting-buttons">
          <button type="button" className="danger" onClick={reset}>{armed ? 'もう一度押すと消去' : 'すべて消去'}</button>
        </div>
        {message && <p className="meta" aria-live="polite">{message}</p>}
      </div>
    </section>
  );
}
