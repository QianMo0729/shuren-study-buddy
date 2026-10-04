import type { RecommendationInfo } from '../../../shared/types';

/** 契合度档位：只描述问卷契合程度，不代表成功概率 */
export const TIER_LABEL: Record<RecommendationInfo['tier'], string> = {
  great: '很合拍',
  good: '较合拍',
  fair: '可以聊聊',
};

/** 档位文字 + 分数，如「很合拍 86」 */
export const tierText = (r: Pick<RecommendationInfo, 'tier' | 'score'>) => `${TIER_LABEL[r.tier] ?? '可以聊聊'} ${r.score}`;

/** 小时数：整数不带小数点 */
export const hours = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
