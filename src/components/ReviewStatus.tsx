/** 自动暂存与人工撤下分开展示，避免让作者误以为内容已被处罚。 */
export function PendingReviewBadge() {
  return <span className="shrink-0 rounded-[4px] bg-accent-soft px-2 py-0.5 text-[12px] text-accent">等待审核，暂未公开</span>;
}

export function PendingReviewNotice() {
  return <p className="mb-4 rounded-md bg-accent-soft px-4 py-3 text-[14px] leading-relaxed text-accent" role="status">已提交，等待审核。审核通过后会按设定的可见范围展示。</p>;
}
