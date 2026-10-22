import type { ReactNode } from 'react';

/** 界面图标：与设计稿同一组 24×24 描边图标，颜色跟随 currentColor */
function Icon({ size = 24, width = 1.9, children, className }: { size?: number; width?: number; children: ReactNode; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" aria-hidden className={className}>
      {children}
    </svg>
  );
}
type P = { size?: number; width?: number; className?: string };

export const TodayIcon = (p: P) => <Icon {...p}><rect x="4" y="5" width="16" height="15" rx="3" /><path d="M4 10h16M9 3v4M15 3v4" /></Icon>;
export const PeopleIcon = (p: P) => <Icon {...p}><circle cx="9" cy="9" r="3.5" /><path d="M3 19c.6-3 3-4.5 6-4.5s5.4 1.5 6 4.5M16 6.5a3 3 0 0 1 0 5.6M18 14.8c1.6.6 2.6 2 3 4.2" /></Icon>;
export const CommunityIcon = (p: P) => <Icon {...p}><path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v10a2.5 2.5 0 0 1-2.5 2.5H8l-4 3z" /><path d="M8 9h8M8 13h5" /></Icon>;
export const BubbleIcon = (p: P) => <Icon {...p}><path d="M12 4c4.7 0 8.5 3.1 8.5 7s-3.8 7-8.5 7c-1 0-2-.1-2.9-.4L4.5 20l1.1-3.7C4.3 15 3.5 13.1 3.5 11c0-3.9 3.8-7 8.5-7z" /></Icon>;
export const CameraIcon = (p: P) => <Icon {...p}><path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2.2l1.4-2h5.8l1.4 2h2.2A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z" /><circle cx="12" cy="13" r="3.4" /></Icon>;
export const ClockIcon = (p: P) => <Icon {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></Icon>;
export const BookIcon = (p: P) => <Icon {...p}><path d="M5 4h10l4 4v12H5z" /><path d="M9 12h6M9 16h4" /></Icon>;
export const PinIcon = (p: P) => <Icon {...p}><path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z" /><circle cx="12" cy="10" r="2.3" /></Icon>;
export const SearchIcon = (p: P) => <Icon {...p}><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4.5 4.5" /></Icon>;
export const SlidersIcon = (p: P) => <Icon {...p}><path d="M4 7h10M18 7h2M4 17h4M12 17h8" /><circle cx="16" cy="7" r="2.2" /><circle cx="10" cy="17" r="2.2" /></Icon>;
export const XIcon = (p: P) => <Icon {...p}><path d="M6 6l12 12M18 6L6 18" /></Icon>;
export const BookmarkIcon = (p: P) => <Icon {...p}><path d="M7 4h10v16l-5-3.5L7 20z" /></Icon>;
export const PlusIcon = (p: P) => <Icon {...p}><path d="M12 5v14M5 12h14" /></Icon>;
export const BellIcon = (p: P) => <Icon {...p}><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z" /><path d="M10 20.5h4" /></Icon>;
export const ShieldIcon = (p: P) => <Icon {...p}><path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z" /></Icon>;
export const GridIcon = (p: P) => <Icon {...p}><rect x="4" y="5" width="16" height="15" rx="3" /><path d="M4 10h16M10 10v10" /></Icon>;
export const AlertIcon = (p: P) => <Icon {...p}><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5v5M12 16v.5" /></Icon>;
export const FlipIcon = (p: P) => <Icon {...p}><path d="M4 12a8 8 0 0 1 14-5.3M20 12a8 8 0 0 1-14 5.3" /><path d="M18.5 3v4h-4M5.5 21v-4h4" /></Icon>;
export const PencilIcon = (p: P) => <Icon {...p}><path d="M4 20h4L19 9l-4-4L4 16z" /><path d="M13.5 6.5l4 4" /></Icon>;
export const ShareIcon = (p: P) => <Icon {...p}><path d="M12 3v12M7.5 7.5L12 3l4.5 4.5" /><path d="M8 10H6.5A1.5 1.5 0 0 0 5 11.5v8A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5v-8a1.5 1.5 0 0 0-1.5-1.5H16" /></Icon>;
export const AddSquareIcon = (p: P) => <Icon {...p}><rect x="4" y="4" width="16" height="16" rx="4" /><path d="M12 8v8M8 12h8" /></Icon>;

/** 实心爱心（感兴趣、点赞） */
export const HeartFill = ({ size = 24, className }: { size?: number; className?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden className={className}><path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.3a4.3 4.3 0 0 1 7.5 2.5C19.5 15.4 12 20 12 20z" fill="currentColor" /></svg>
);
export const HeartIcon = (p: P) => <Icon {...p}><path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.3a4.3 4.3 0 0 1 7.5 2.5C19.5 15.4 12 20 12 20z" /></Icon>;

/** 列表右侧的箭头 */
export const Chevron = ({ className }: { className?: string }) => (
  <svg width="8" height="14" viewBox="0 0 8 14" aria-hidden className={className ?? 'shrink-0 text-ink-4'}><path d="M1 1l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
);
/** 返回箭头 */
export const BackChevron = () => (
  <svg width="12" height="20" viewBox="0 0 12 20" aria-hidden><path d="M10 2L2 10l8 8" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
);
