import { useState } from 'react';
import { ChipGroup, Textarea } from './ui';

/** Choice-first answers reuse the original display/search text and preserve older prose. */
export function ChoiceAnswer({ value, onChange, options, label, maxLength }: {
  value: string; onChange: (value: string) => void; options: string[]; label: string; maxLength: number;
}) {
  const [error, setError] = useState('');
  const parts = value.split('；');
  const selected = options.filter((option) => parts.includes(option));
  const extra = parts.filter((part) => !options.includes(part)).join('；');
  const update = (next: string[], text: string) => {
    const answer = [...next, ...(text ? [text] : [])].join('；');
    if (answer.length > maxLength) { setError(`最多 ${maxLength} 字，请先缩短补充内容`); return; }
    setError(''); onChange(answer);
  };
  return <div>
    <ChipGroup options={options.map((option) => ({ value: option, label: option }))} value={selected} onChange={(next) => update(next, extra)} multi />
    <Textarea className="mt-3" value={extra} onChange={(event) => update(selected, event.target.value)} maxLength={maxLength - selected.join('；').length - (selected.length ? 1 : 0)} aria-label={`${label}补充`} placeholder="还想补充什么？可留空" />
    {error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
  </div>;
}
