import { useId } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Minus, Plus, RotateCcw, Search, X } from 'lucide-react';
import { ALL_MAJORS, COLLEGES } from '../../shared/majors';
import { DURATIONS, FREQUENCIES, GENDERS, GRADES, INTERESTS, PLACES, PLAN_PRESETS, STATUSES, STUDY_METHODS, STUDY_TYPES } from '../../shared/options';
import type { AdvancedQuery, Criterion, CriterionField, CriterionMode } from '../../shared/types';
import { cx } from '../lib/format';
import { spring } from '../lib/motion';
import { Button, ChipGroup, Input, Segmented } from './ui';
import { TimeGrid } from './TimeGrid';

type Kind = 'major' | 'gender' | 'multi' | 'overlap' | 'text' | 'schedule';

export const FIELDS: { key: CriterionField; label: string; kind: Kind; options?: { value: string; label: string }[] }[] = [
  { key: 'major', label: '对方专业', kind: 'major' },
  { key: 'gender', label: '对方性别', kind: 'gender' },
  { key: 'studyType', label: '对方学习类型', kind: 'multi', options: STUDY_TYPES },
  { key: 'places', label: '学习地点偏好', kind: 'multi', options: PLACES },
  { key: 'college', label: '对方院系', kind: 'multi', options: COLLEGES.map((c) => ({ value: c, label: c })) },
  { key: 'grade', label: '对方年级', kind: 'multi', options: GRADES },
  { key: 'overlap', label: '与我时间重合', kind: 'overlap' },
  { key: 'planTags', label: '近期学习目标', kind: 'multi', options: PLAN_PRESETS.map((p) => ({ value: p, label: p })) },
  { key: 'status', label: '目前状态', kind: 'multi', options: STATUSES },
  { key: 'schedule', label: '通常的空闲时间', kind: 'schedule' },
  { key: 'studyMethods', label: '学习方式', kind: 'multi', options: STUDY_METHODS },
  { key: 'frequency', label: '学习频率', kind: 'multi', options: FREQUENCIES },
  { key: 'duration', label: '单次学习时长', kind: 'multi', options: DURATIONS },
  { key: 'interests', label: '兴趣爱好', kind: 'multi', options: INTERESTS },
  { key: 'expectedPlaces', label: '期望搭子的地点', kind: 'multi', options: PLACES },
  { key: 'expectations', label: '对搭子的期待', kind: 'text' },
  { key: 'text', label: '自我介绍关键词', kind: 'text' },
];

export const fieldLabel = (key: string) => FIELDS.find((f) => f.key === key)?.label.replace(/^对方/, '') ?? key;

const MODE_TEXT: Record<CriterionMode, { label: string; cls: string; tip: string }> = {
  should: { label: '加分', cls: 'bg-brand-soft text-brand-text', tip: '计入精确或模糊匹配规则' },
  must: { label: '必须', cls: 'bg-ink text-surface', tip: '不满足则不显示' },
  not: { label: '排除', cls: 'bg-danger-soft text-danger', tip: '满足则不显示' },
};
const NEXT_MODE: Record<CriterionMode, CriterionMode> = { should: 'must', must: 'not', not: 'should' };

export const DEFAULT_QUERY: AdvancedQuery = {
  criteria: [
    { field: 'major', mode: 'should', values: [] },
    { field: 'gender', mode: 'should', values: [] },
    { field: 'studyType', mode: 'should', values: [] },
    { field: 'places', mode: 'should', values: [] },
  ],
  matchMode: 'precise',
  mutualGender: false,
};

export function activeCount(q: AdvancedQuery) {
  return q.criteria.filter((c) => c.values.length).length;
}

export function AdvancedSearch({ query, onChange, onSearch, onReset, busy }: {
  query: AdvancedQuery;
  onChange: (q: AdvancedQuery) => void;
  onSearch: () => void;
  onReset: () => void;
  busy?: boolean;
}) {
  const setRow = (i: number, c: Partial<Criterion>) => onChange({ ...query, criteria: query.criteria.map((x, k) => (k === i ? { ...x, ...c } : x)) });
  const counted = query.criteria.filter((c) => c.values.length && c.mode === 'should').length;
  const minimum = counted ? query.matchMode === 'fuzzy' ? 1 : Math.floor(counted / 2) + 1 : 0;
  const unused = FIELDS.filter((f) => !query.criteria.some((c) => c.field === f.key));

  return (
    <div className="rounded-xl bg-surface p-4 sm:p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-[15px] font-semibold text-ink">高级检索</p>
          <p className="mt-0.5 text-[13px] text-ink-3">精确匹配需符合过半加分条件；模糊匹配符合一项即可。「必须」与「排除」始终生效。</p>
        </div>
      </div>

      <div className="space-y-2.5">
        <AnimatePresence initial={false}>
          {query.criteria.map((c, i) => {
            const def = FIELDS.find((f) => f.key === c.field);
            if (!def) return null;
            const m = MODE_TEXT[c.mode];
            return (
              <motion.div
                key={c.field}
                layout
                initial={{ opacity: 0, height: 0, y: -6 }}
                animate={{ opacity: 1, height: 'auto', y: 0 }}
                exit={{ opacity: 0, height: 0 }}
                transition={spring}
                className="overflow-hidden"
              >
                <div className={cx('flex flex-col gap-2.5 rounded-lg border p-2.5 transition-colors', c.values.length ? 'border-line-strong bg-surface' : 'border-line bg-surface-2')}>
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      type="button"
                      title={m.tip}
                      onClick={() => setRow(i, { mode: NEXT_MODE[c.mode] })}
                      className={cx('h-8 w-12 shrink-0 rounded-md text-[12.5px] font-semibold transition-colors', m.cls)}
                    >
                      {m.label}
                    </button>
                    <select
                      value={c.field}
                      aria-label={`第 ${i + 1} 项筛选字段`}
                      onChange={(e) => setRow(i, { field: e.target.value as CriterionField, values: [] })}
                      className="h-8 min-w-0 flex-1 cursor-pointer rounded-md border border-line-strong bg-surface px-2 text-[14px] text-ink outline-none focus:border-brand"
                    >
                      {[def, ...unused].map((f) => (
                        <option key={f.key} value={f.key}>
                          {f.label}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => onChange({ ...query, criteria: query.criteria.filter((_, k) => k !== i) })}
                      className="grid size-8 shrink-0 place-items-center rounded-md text-ink-3 hover:bg-danger-soft hover:text-danger"
                      aria-label="删除条件"
                    >
                      <Minus size={15} />
                    </button>
                  </div>
                  <div className="min-w-0 flex-1">
                    <ValueControl kind={def.kind} options={def.options} values={c.values} onChange={(values) => setRow(i, { values })} />
                  </div>
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>

      {unused.length > 0 && query.criteria.length < FIELDS.length && (
        <button
          type="button"
          onClick={() => onChange({ ...query, criteria: [...query.criteria, { field: unused[0].key, mode: 'should', values: [] }] })}
          className="mt-2 flex h-9 items-center gap-1.5 rounded-md px-2 text-[13.5px] font-semibold text-brand-text transition-colors hover:bg-brand-softer"
        >
          <Plus size={15} /> 添加条件
        </button>
      )}

      <div className="mt-5 space-y-4 border-t border-line pt-4">
        <div>
          <p className="mb-2 text-[13px] font-semibold text-ink">结果匹配方式</p>
          <Segmented options={[{ value: 'precise', label: '精确匹配' }, { value: 'fuzzy', label: '模糊匹配' }]} value={query.matchMode ?? 'precise'} onChange={(value) => onChange({ ...query, matchMode: value as 'precise' | 'fuzzy' })} />
          <p className="mt-2 text-[12px] leading-relaxed text-ink-3">{counted ? `当前需符合至少 ${minimum} / ${counted} 项加分条件。` : '添加条件后开始筛选。'}按符合条件数量排序。</p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" icon={<RotateCcw size={15} />} onClick={onReset}>重置</Button>
          <Button variant="primary" icon={<Search size={15} />} onClick={onSearch} loading={busy} disabled={!activeCount(query)} className="flex-1">检索</Button>
        </div>
      </div>
    </div>
  );
}

function ValueControl({ kind, options, values, onChange }: { kind: Kind; options?: { value: string; label: string }[]; values: string[]; onChange: (v: string[]) => void }) {
  const listId = useId();
  if (kind === 'schedule') return <div className="overflow-x-auto"><TimeGrid compact value={values.map(Number)} onChange={(slots) => onChange(slots.map(String))} /><p className="mt-2 text-[12px] text-ink-3">对方在任一选中时段有空即符合此条件。</p></div>;
  if (kind === 'major') return <><Input value={values[0] ?? ''} onChange={(e) => onChange(e.target.value.trim() ? [e.target.value] : [])} list={listId} placeholder="输入专业或院系完整名称" aria-label="筛选专业或院系" /><datalist id={listId}>{ALL_MAJORS.map((major) => <option key={major} value={major} />)}</datalist><p className="mt-2 text-[12px] text-ink-3">可选择建议项，也可输入同学自填的专业或院系。</p></>;
  if (kind === 'gender')
    return (
      <div className="flex flex-wrap items-center gap-3">
        <Segmented
          options={[...GENDERS, { value: '', label: '皆可' }]}
          className="w-full [&>button]:min-w-0 [&>button]:flex-1 [&>button]:px-1"
          value={values[0] ?? ''}
          onChange={(v) => onChange(v ? [v] : [])}
        />
        {!values.length && <span className="text-[12px] text-ink-4">「皆可」不计入条件</span>}
      </div>
    );
  if (kind === 'overlap')
    return (
      <div className="flex flex-wrap items-center gap-2">
        {['2', '4', '8', '12'].map((h) => (
          <button
            key={h}
            type="button"
            onClick={() => onChange(values[0] === h ? [] : [h])}
            className={cx('h-8 rounded-md border px-2.5 text-[13px] transition-colors', values[0] === h ? 'border-brand bg-brand text-white' : 'border-line-strong bg-surface text-ink-2 hover:text-ink')}
          >
            ≥ {h} 小时 / 周
          </button>
        ))}
      </div>
    );
  if (kind === 'text')
    return (
      <div className="relative">
        <Input value={values[0] ?? ''} onChange={(e) => onChange(e.target.value.trim() ? [e.target.value] : [])} placeholder="如：雅思、数分、早起…（支持同义词）" className="h-9 text-[14px]" />
        {values[0] && (
          <button type="button" onClick={() => onChange([])} className="absolute top-1/2 right-2 grid size-6 -translate-y-1/2 place-items-center rounded text-ink-4 hover:text-ink" aria-label="清除">
            <X size={13} />
          </button>
        )}
      </div>
    );
  return <ChipGroup options={options ?? []} value={values} onChange={onChange} multi size="sm" />;
}
