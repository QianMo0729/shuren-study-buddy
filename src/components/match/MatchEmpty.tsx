import { useNavigate } from 'react-router';
import type { DeckResponse } from '../../../shared/types';
import { Illustration } from '../brand';
import { Button, Empty } from '../ui';

type State = DeckResponse['state'] | 'exhausted';

/** 推荐为空时说明原因，并给出下一步 */
export function MatchEmpty({ data, state, onRefresh, onReviewDisliked }: {
  data: Pick<DeckResponse, 'missing' | 'eligibleCount'> | null;
  state: State;
  onRefresh?: () => void;
  /** 可选：去「我的」查看不感兴趣的同学 */
  onReviewDisliked?: () => void;
}) {
  const nav = useNavigate();
  const missing = data?.missing ?? [];
  const copy: Record<State, { title: string; desc: string; action: string; to: string }> = {
    incomplete: {
      title: '再补几项，就能为你推荐',
      desc: missing.length
        ? `请先完成：${missing.slice(0, 4).map((item) => item.label).join('、')}${missing.length > 4 ? `等 ${missing.length} 项` : ''}。`
        : '填写学习时间、目标和学习方式后，即可开始匹配。',
      action: '继续填写问卷',
      to: '/me/edit',
    },
    unpublished: { title: '问卷已就绪，上传后开始匹配', desc: '上传你的主页后，系统会根据问卷为你推荐合拍的同学，对方也能看到你。', action: '去上传我的主页', to: '/me' },
    unavailable: { title: '你的主页暂不参与推荐', desc: '请检查是否处于「暂时忙碌」状态，或主页是否需要修改后重新上传。调整后即可重新获取推荐。', action: '检查主页状态', to: '/me' },
    no_overlap: {
      title: '暂时还没有共同时间的搭子',
      desc: `当前可参与匹配的 ${data?.eligibleCount ?? 0} 位同学与你没有共同空闲时段，或线上 / 线下、性别偏好不一致。可以调整空闲时段；北京时间明天零点会重新生成名单。`,
      action: '调整我的空闲时间',
      to: '/me/edit',
    },
    empty: { title: '今天暂时没有合适的推荐', desc: '今日名单中没有符合条件的新同学，北京时间明天零点重新推荐。也可以主动找同学，或查看稍后再看列表。', action: '主动找同学', to: '/match/search' },
    daily_done: { title: '今天的推荐已看完', desc: '每天最多推荐 5 位，北京时间零点更新。稍后再看的同学会一直留在待看列表，等你回来处理；已下线或不再符合条件的同学不会补位。', action: '查看稍后再看', to: '/match/later' },
    ready: { title: '暂时没有推荐结果', desc: '可以稍后再来，或调整自己的学习安排。', action: '调整我的问卷', to: '/me/edit' },
    exhausted: { title: '今天的推荐已看完', desc: '每天最多推荐 5 位，北京时间零点更新。可以先去处理稍后再看的同学，或主动搜索学习搭子。', action: '查看稍后再看', to: '/match/later' },
  };
  const c = copy[state];
  return (
    <Empty
      art={<Illustration name="mascot-search" className="mb-4 size-28" />}
      title={c.title}
      desc={c.desc}
      action={(
        <div className="flex flex-wrap justify-center gap-2">
          <Button variant="primary" onClick={() => nav(c.to)}>{c.action}</Button>
          {onRefresh && state === 'ready' && <Button onClick={onRefresh}>刷新推荐</Button>}
          {onReviewDisliked && (state === 'exhausted' || state === 'empty') && <Button variant="ghost" onClick={onReviewDisliked}>查看不感兴趣的同学</Button>}
        </div>
      )}
    />
  );
}
