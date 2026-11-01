import { useState, type FormEvent } from 'react';

type Props = {
  name: string;
  tags: string[];
  allTags: string[];
  memo: string;
  onToggleTag: (tag: string) => void;
  onMemo: (text: string) => void;
};

// 自分用のタグとメモの編集欄（「タグ・メモ」を押したときだけ開く）
export default function MineEditor({ name, tags, allTags, memo, onToggleTag, onMemo }: Props) {
  const [draft, setDraft] = useState('');
  const choices = [...new Set([...allTags, ...tags])];

  const add = (e: FormEvent) => {
    e.preventDefault();
    if (!draft.trim()) return;
    if (!tags.includes(draft.trim())) onToggleTag(draft);
    setDraft('');
  };

  return (
    <div className="mine-editor">
      <div className="chips" role="group" aria-label={`${name} のタグ`}>
        {choices.map((t) => (
          <button key={t} type="button" className="chip" aria-pressed={tags.includes(t)} onClick={() => onToggleTag(t)}>
            {t}
          </button>
        ))}
      </div>
      <form className="tag-add" onSubmit={add}>
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="新しいタグ"
          enterKeyHint="done"
          maxLength={20}
          aria-label="新しいタグ"
        />
        <button type="submit" disabled={!draft.trim()}>追加</button>
      </form>
      <input
        className="memo"
        type="text"
        value={memo}
        onChange={(e) => onMemo(e.target.value)}
        placeholder="自分用メモ（買うもの・予算など）"
        aria-label={`${name} のメモ`}
      />
    </div>
  );
}
