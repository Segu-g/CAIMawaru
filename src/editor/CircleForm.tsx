// 1つのサークルの編集（circles.csv の1行）と、そのサークルのお品書き（menus.csv の行）。
import { useEffect, useMemo, useRef, useState, type InputHTMLAttributes } from 'react';
import type { Doc } from './doc';
import { addMenu, changeCircleId, menusOf, removeCircle, sameIdCircles, updateCircle, type Dirty } from './edit';
import MenuRow from './MenuRow';
import { circleId, isDataRow, type Row } from './model';
import type { Issue } from './validate';

type Props = {
  doc: Doc;
  circle: Row;
  issues: Issue[];
  edit: (fn: (doc: Doc) => Doc, ...which: (keyof Dirty)[]) => void;
  onRemoved: () => void;
};

// 1行の入力欄（docs/event-data.md の circles.csv の列）
const TEXT_FIELDS: { col: string; label: string; hint?: string; type?: string }[] = [
  { col: 'name', label: 'サークル名（name・必須）' },
  { col: 'kana', label: '読み（kana）', hint: '検索と並べ替えに使う' },
  { col: 'penNames', label: '作家名（penNames）', hint: '複数は「;」区切り' },
  { col: 'tags', label: 'タグ（tags）', hint: '掲載側で付けるタグ。「;」区切り' },
  { col: 'x', label: 'X（x）', type: 'url' },
  { col: 'pixiv', label: 'pixiv（pixiv）', type: 'url' },
  { col: 'booth', label: 'BOOTH（booth）', type: 'url' },
  { col: 'web', label: 'Web サイト（web）', type: 'url' },
  { col: 'source', label: '出典（source）', hint: '主催の公式リストの名前や URL' },
];

/** 入力中は手元に持ち、確定（フォーカスを外す・Enter）したときに反映する入力欄（id・スペース番号） */
function DraftInput({ value, onCommit, ...rest }: { value: string; onCommit: (v: string) => boolean } & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const [draft, setDraft] = useState(value);
  const busy = useRef(false); // 確認のダイアログでフォーカスが外れても、2回確定しない
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    if (busy.current || draft === value) return;
    busy.current = true;
    try {
      if (!onCommit(draft)) setDraft(value);
    } finally {
      busy.current = false;
    }
  };
  return (
    <input
      {...rest}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') setDraft(value);
      }}
    />
  );
}

export default function CircleForm({ doc, circle, issues, edit, onRemoved }: Props) {
  const v = circle.values;
  const id = circleId(v);
  const menus = menusOf(doc, circle);
  const mine = issues.filter((i) => i.where === 'circle' && i.key === circle.key);
  const menuKeys = new Set(menus.map((m) => m.key));
  const menuIssues = issues.filter((i) => i.where === 'menu' && i.key !== undefined && menuKeys.has(i.key));
  const events = useMemo(() => [...new Set(doc.circles.filter((c) => isDataRow(c.values)).map((c) => c.values.event.trim()).filter(Boolean))].sort(), [doc.circles]);
  const [newUrl, setNewUrl] = useState('');
  const [newNote, setNewNote] = useState('');

  const set = (col: string, value: string) => edit((d) => updateCircle(d, circle.key, col, value), 'circles');

  const shared = sameIdCircles(doc, circle);
  const sharedNames = shared.map((c) => `${c.values.space} ${c.values.name}`.trim()).join('・');

  /** id かスペース番号を変える。id が変わってお品書きがあるときは、付け替えることを利用者に確かめる */
  const commitIdField = (col: 'id' | 'space', value: string): boolean => {
    const after = circleId({ ...v, [col]: value });
    const plan = changeCircleId(doc, circle.key, col, value);
    if (after !== id && menus.length > 0) {
      if (!after) {
        alert('id もスペース番号もないと、お品書きを付けられません。どちらかを入れてください');
        return false;
      }
      const taken = doc.circles.some((c) => c.key !== circle.key && isDataRow(c.values) && circleId(c.values) === after);
      const message = shared.length
        ? `このサークルの id が「${id}」から「${after}」に変わります。\n` +
          `「${id}」はほかのサークル（${sharedNames}）も使っているので、お品書き ${menus.length} 件は付け替えず、id「${id}」のまま残します。`
        : `このサークルの id が「${id}」から「${after}」に変わります。\n` +
          `お品書き ${plan.moved} 件の id も「${after}」に付け替えます（付け替えないとお品書きが宙に浮くため）。` +
          (taken ? `\n注意: 「${after}」はほかのサークルも使っている id です。重複を直すまで、お品書きがどちらのものか決まりません。` : '');
      if (!confirm(message + '\n\nキャンセルすると入力を元に戻します。')) return false;
    }
    edit((d) => changeCircleId(d, circle.key, col, value).doc, ...plan.dirty);
    return true;
  };

  const remove = () => {
    const name = v.name || v.space || id || 'このサークル';
    if (shared.length) {
      alert(`id「${id}」はほかのサークル（${sharedNames}）も使っているので、お品書きがどちらのものか決まりません。\n先に id かスペース番号を直して重複をなくしてから削除してください。`);
      return;
    }
    const message = menus.length
      ? `「${name}」を削除します。\nこのサークルのお品書き ${menus.length} 件も menus.csv から削除します（残すと宙に浮くため）。\n\nお品書きを別のサークルに移したいときは、キャンセルして「お品書き」タブで付け替えてから削除してください。`
      : `「${name}」を削除しますか？`;
    if (!confirm(message)) return;
    const res = removeCircle(doc, circle.key);
    edit((d) => removeCircle(d, circle.key).doc, ...(res.removedMenus ? (['circles', 'menus'] as const) : (['circles'] as const)));
    onRemoved();
  };

  const add = () => {
    const url = newUrl.trim();
    if (!url) return;
    const res = addMenu(doc, id, url, newNote.trim());
    const row = res.doc.menus[res.doc.menus.length - 1];
    edit((d) => ({ ...d, menus: [...d.menus, row] }), 'menus');
    setNewUrl('');
    setNewNote('');
  };

  return (
    <div className="ed-form">
      <div className="ed-form-head">
        <h2>{v.name || '（名前なし）'}</h2>
        <button type="button" className="danger" onClick={remove}>削除</button>
      </div>
      {shared.length > 0 && (
        <div className="ed-box danger" role="alert">
          <p>
            <strong>id「{id}」が重複しています。</strong>ほかのサークル（{sharedNames}）も同じ id です。
            お品書きと閲覧者の ★ は id で決まるので、どちらのものか決まりません。id かスペース番号を直して重複をなくしてください。
          </p>
          <p>重複している間は、このサークルを削除できません。id を変えても、お品書きは付け替えずに元の id のまま残します。</p>
        </div>
      )}
      {mine.length > 0 && (
        <ul className="ed-inline-issues">
          {mine.map((i, n) => <li key={n} className={i.level}>{i.message}</li>)}
        </ul>
      )}
      <div className="ed-fields">
        <label>
          <span>スペース番号（space）</span>
          <DraftInput value={v.space} onCommit={(s) => commitIdField('space', s)} placeholder="A-01（複数は A-01,A-02）" />
        </label>
        <label>
          <span>id</span>
          <DraftInput value={v.id} onCommit={(s) => commitIdField('id', s)} placeholder={id ? `空欄なら ${id}` : '空欄ならスペース番号から作る'} className="ed-mono" />
          <small>英数字とハイフン。menus.csv と閲覧者の ★ が参照するので、公開後は変えない</small>
        </label>
        <label>
          <span>参加イベント（event）</span>
          <input value={v.event} onChange={(e) => set('event', e.target.value)} list="ed-events" />
          <datalist id="ed-events">
            {events.map((ev) => <option key={ev} value={ev} />)}
          </datalist>
        </label>
        {TEXT_FIELDS.map((f) => (
          <label key={f.col}>
            <span>{f.label}</span>
            <input type={f.type ?? 'text'} value={v[f.col]} onChange={(e) => set(f.col, e.target.value)} />
            {f.hint && <small>{f.hint}</small>}
          </label>
        ))}
        <label>
          <span>成人向け（adult）</span>
          <select value={v.adult} onChange={(e) => set('adult', e.target.value)}>
            <option value="">空欄（なし）</option>
            <option value="0">0（なし）</option>
            <option value="1">1（成人向け頒布物あり）</option>
            {!['', '0', '1'].includes(v.adult) && <option value={v.adult}>{v.adult}（不正な値）</option>}
          </select>
        </label>
        <label className="wide">
          <span>補足（notes）</span>
          <textarea value={v.notes} onChange={(e) => set('notes', e.target.value)} rows={3} />
          <small>欠席などの事情（健康・家族など）は書かない</small>
        </label>
      </div>

      <h3>お品書き（{menus.length}）</h3>
      {!id && <p className="meta">お品書きを付けるには、先に id かスペース番号を入れてください</p>}
      {menuIssues.length > 0 && (
        <ul className="ed-inline-issues">
          {menuIssues.map((i, n) => <li key={n} className={i.level}>{i.message}</li>)}
        </ul>
      )}
      <div className="ed-menus">
        {menus.map((m) => <MenuRow key={m.key} menu={m} edit={edit} />)}
      </div>
      {id && (
        <div className="ed-menu-add">
          <input type="url" value={newUrl} onChange={(e) => setNewUrl(e.target.value)} placeholder="お品書きの URL（X の投稿・BOOTH など）" aria-label="追加するお品書きの URL"
            onKeyDown={(e) => e.key === 'Enter' && add()} />
          <input value={newNote} onChange={(e) => setNewNote(e.target.value)} placeholder="説明（例: 新刊）" aria-label="追加するお品書きの説明"
            onKeyDown={(e) => e.key === 'Enter' && add()} />
          <button type="button" onClick={add} disabled={!newUrl.trim()}>追加</button>
        </div>
      )}
      <p className="meta">
        URL は自分でページを見て貼り付けます（このエディタは X などのページを読み込みません）。追加・URL を変えると、確認した日（checkedAt）が今日になります。
      </p>
    </div>
  );
}
