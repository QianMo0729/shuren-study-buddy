import { AnimatePresence } from 'motion/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useMatch, useNavigate } from 'react-router';
import { Search, SlidersHorizontal } from 'lucide-react';
import type { AdvancedQuery, Criterion, CriterionField, ProfileCard as Card } from '../../shared/types';
import { SLOT_COUNT } from '../../shared/options';
import { api, ApiError } from '../lib/api';
import { AdvancedSearch, PROFILE_FIELDS, activeCount, fieldLabel } from '../components/AdvancedSearch';
import { CardSkeleton, ProfileCard } from '../components/ProfileCard';
import { ProfileOverlay } from '../components/ProfileOverlay';
import { MajorSelect, SubjectsInput } from '../components/profileForm';
import { Button, Empty, Field, Input, Modal } from '../components/ui';
import { MatchTabs } from './Match';

const initialQuery = (): AdvancedQuery => ({
  criteria: ['major', 'subjects', 'overlap'].map((field) => ({ field: field as CriterionField, mode: 'must', values: [] })),
  matchMode: 'precise', mutualGender: false,
});

/** URL 只保存已经提交的公开筛选条件；限制外部链接的格式和长度。 */
function readSearch(search: string): { query: AdvancedQuery; keyword: string } {
  const params = new URLSearchParams(search);
  const keyword = (params.get('q') ?? '').slice(0, 100).trim();
  const raw = params.get('filters');
  if (!raw || raw.length > 20_000) return { query: initialQuery(), keyword };
  try {
    const parsed = JSON.parse(raw);
    const seen = new Set<string>();
    const criteria: Criterion[] = (Array.isArray(parsed?.criteria) ? parsed.criteria : []).slice(0, PROFILE_FIELDS.length)
      .filter((item: any) => item && PROFILE_FIELDS.some((field) => field.key === item.field) && !seen.has(item.field) && seen.add(item.field))
      .map((item: any) => ({ field: item.field, mode: item.mode === 'must' || item.mode === 'not' ? item.mode : 'should',
        values: (Array.isArray(item.values) ? item.values : []).filter((value: unknown) => typeof value === 'string').slice(0, SLOT_COUNT).map((value: string) => value.slice(0, 80)) }));
    return { query: { criteria, matchMode: parsed?.matchMode === 'fuzzy' ? 'fuzzy' : 'precise', mutualGender: parsed?.mutualGender === true }, keyword };
  } catch { return { query: initialQuery(), keyword }; }
}

export function PeopleSearch() {
  const nav = useNavigate();
  const location = useLocation();
  const openRoute = useMatch('/match/search/u/:id');
  const openId = openRoute && /^\d+$/.test(openRoute.params.id ?? '') ? Number(openRoute.params.id) : null;
  const applied = useMemo(() => readSearch(location.search), [location.search]);
  const [query, setQuery] = useState(applied.query);
  const [keyword, setKeyword] = useState(applied.keyword);
  const [advanced, setAdvanced] = useState(false);
  const [subjectsOpen, setSubjectsOpen] = useState(false);
  const [items, setItems] = useState<Card[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const requestId = useRef(0);
  useEffect(() => { setQuery(applied.query); setKeyword(applied.keyword); }, [applied]);

  const load = useCallback(async () => {
    const id = ++requestId.current;
    setLoading(true);
    setError('');
    try {
      const result = await api.advancedSearch({ ...applied.query, keyword: applied.keyword });
      if (id !== requestId.current) return;
      setItems(result.items);
      setTotal(result.total);
    } catch (cause) {
      if (id === requestId.current) setError(cause instanceof ApiError ? cause.message : '网络连接失败，请稍后重试');
    } finally { if (id === requestId.current) setLoading(false); }
  }, [applied]);
  useEffect(() => { void load(); return () => { requestId.current += 1; }; }, [load]);

  const runSearch = (next = query, text = keyword) => {
    const params = new URLSearchParams();
    if (text.trim()) params.set('q', text.trim());
    const criteria = next.criteria.filter((item) => item.values.length);
    if (criteria.length || next.mutualGender) params.set('filters', JSON.stringify({ ...next, criteria }));
    const search = params.toString() ? `?${params}` : '';
    setAdvanced(false);
    if (search === location.search && !openId) void load();
    else nav({ pathname: '/match/search', search });
  };
  const reset = () => { const next = initialQuery(); setQuery(next); setKeyword(''); runSearch(next, ''); };
  const criterion = (field: CriterionField) => query.criteria.find((item) => item.field === field);
  const setValues = (field: CriterionField, values: string[]) => setQuery((current) => ({ ...current,
    criteria: current.criteria.some((item) => item.field === field)
      ? current.criteria.map((item) => item.field === field ? { ...item, values } : item)
      : [...current.criteria, { field, mode: 'must', values }],
  }));
  const chosen = openId ? items.find((item) => item.id === openId) : undefined;
  const count = activeCount(applied.query);
  const modeHint = (field: CriterionField) => {
    const mode = criterion(field)?.mode;
    return mode === 'not' ? '当前为排除条件' : mode === 'should' ? '当前为加分条件' : '当前为必须条件';
  };

  return <div className="pb-10">
    <header className="mb-5 border-b border-ink pt-5 pb-4 sm:pt-10 sm:pb-5">
      <h1 className="font-display text-[30px] leading-[1.1] text-ink sm:text-[46px]">找同学</h1>
      <p className="mt-2 text-[14px] text-ink-2">按专业、学习科目和共同空闲时间主动查找，搜索不占用每日推荐名额。</p>
      <MatchTabs active="search" />
    </header>

    <form onSubmit={(event) => { event.preventDefault(); runSearch(); }} className="rounded-lg border border-line bg-surface p-4 sm:p-5">
      <Field label="自我介绍关键词" hint="关键词只检索同学的自我介绍；专业和课程请使用下方筛选。">
        <Input aria-label="搜索同学的自我介绍" value={keyword} onChange={(event) => setKeyword(event.target.value)} maxLength={100} leading={<Search size={16} />} placeholder="例如：早起、图书馆、一起复习" enterKeyHint="search" />
      </Field>
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Field label="专业" hint={modeHint('major')}><MajorSelect value={criterion('major')?.values[0] ?? ''} onChange={(value) => setValues('major', value ? [value] : [])} placeholder="不限专业" allowClear /></Field>
        <Field label="学习科目 / 考试" hint={`按对方选择的匹配科目筛选；${modeHint('subjects')}。`}>
          <Button type="button" className="h-11 w-full min-w-0 justify-start font-normal" onClick={() => setSubjectsOpen(true)}><span className="truncate">{criterion('subjects')?.values.length ? criterion('subjects')!.values.join('、') : '不限科目，点击选择课程或考试'}</span></Button>
        </Field>
        <Field label="每周共同空闲时间" hint={modeHint('overlap')}>
          <select aria-label="每周共同空闲时间" value={criterion('overlap')?.values[0] ?? ''} onChange={(event) => setValues('overlap', event.target.value ? [event.target.value] : [])} className="h-11 w-full rounded-lg border border-line-strong bg-surface px-3 text-[15px] text-ink">
            <option value="">不限时间</option>{[1, 2, 4, 6, 8, 10].map((hours) => <option key={hours} value={hours}>至少 {hours} 小时</option>)}
            {criterion('overlap')?.values[0] && !['1', '2', '4', '6', '8', '10'].includes(criterion('overlap')!.values[0]) && <option value={criterion('overlap')!.values[0]}>至少 {criterion('overlap')!.values[0]} 小时</option>}
          </select>
        </Field>
      </div>
      <div className="mt-5 flex flex-wrap gap-2">
        <Button type="button" icon={<SlidersHorizontal size={15} />} aria-expanded={advanced} aria-controls="people-advanced" onClick={() => setAdvanced((value) => !value)}>高级筛选{activeCount(query) ? ` · ${activeCount(query)}` : ''}</Button>
        <Button type="button" variant="ghost" onClick={reset}>清空条件</Button>
        <Button type="submit" variant="primary" loading={loading} icon={<Search size={15} />} className="ml-auto">查找同学</Button>
      </div>
    </form>
    <Modal open={subjectsOpen} onClose={() => setSubjectsOpen(false)} title="选择学习科目 / 考试" size="lg"><div className="p-4 sm:p-5"><SubjectsInput value={criterion('subjects')?.values ?? []} onChange={(values) => setValues('subjects', values)} max={8} /><div className="mt-4 flex justify-end gap-2"><Button onClick={() => setValues('subjects', [])}>不限科目</Button><Button variant="primary" onClick={() => setSubjectsOpen(false)}>完成选择</Button></div></div></Modal>
    {advanced && <div id="people-advanced" className="mt-3 rounded-lg border border-line"><AdvancedSearch query={query} onChange={setQuery} onSearch={() => runSearch()} onReset={reset} busy={loading} fields={PROFILE_FIELDS} title="同学高级筛选" /></div>}

    <p className="mt-5 mb-3 text-[13px] text-ink-3" aria-live="polite">{loading ? '正在查找同学…' : error ? '本次搜索未完成' : `找到 ${total} 位同学${count ? ` · ${count} 项筛选条件` : ''}${applied.keyword ? ` · 自我介绍包含「${applied.keyword}」` : ''}`}</p>
    {loading ? <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-4">{Array.from({ length: 4 }, (_, index) => <CardSkeleton key={index} />)}</div>
      : error ? <Empty title="暂时无法查找同学" desc={error} action={<Button onClick={() => void load()}>重试</Button>} />
      : !items.length ? <Empty title="没有找到符合条件的同学" desc="可以减少筛选条件，换一个自我介绍关键词，或在高级筛选中调整匹配方式。" action={<Button onClick={() => setAdvanced(true)}>调整筛选</Button>} />
      : <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-4">{items.map((card, index) => <ProfileCard key={card.id} card={card} index={index} matchLabels={(key) => fieldLabel(key.split(':')[1] ?? key)} onOpen={() => nav({ pathname: `/match/search/u/${card.id}`, search: location.search })} />)}</div>}

    <AnimatePresence>{openId && <ProfileOverlay key={openId} id={openId} match={chosen?.match} searchQuery={applied.query} keyword={applied.keyword} onClose={() => nav({ pathname: '/match/search', search: location.search }, { replace: true })} onChanged={() => void load()} />}</AnimatePresence>
  </div>;
}
