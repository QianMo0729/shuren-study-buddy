/** 项目内自绘的圆形加号与叶芽；所有彩色部分跟随页面主题，不依赖外部图片。 */
export function PostCreateIcon() {
  return (
    <svg
      viewBox="0 0 80 88"
      fill="none"
      aria-hidden="true"
      focusable="false"
      className="pointer-events-none size-full overflow-visible select-none"
    >
      <circle cx="40" cy="48" r="32" fill="var(--surface)" stroke="var(--line-strong)" />
      <circle cx="40" cy="48" r="28.5" className="fill-brand transition-colors group-hover:fill-brand-2" />
      {/* 草叶从圆盘顶缘长出，独立于加号，保留清晰的操作轮廓。 */}
      <path
        d="M32 23C23 22 19 15 21 7C29 10 33 15 32 23Z"
        fill="var(--brand-3)"
        stroke="var(--brand-text)"
        strokeWidth="1.25"
        strokeLinejoin="round"
      />
      <path
        d="M33 23C31 13 37 7 45 6C44 15 40 22 33 23Z"
        fill="var(--brand-3)"
        stroke="var(--brand-text)"
        strokeWidth="1.25"
        strokeLinejoin="round"
      />
      <path d="M34 28C33 21 30 17 26 13M33 23L40 12" stroke="var(--brand-text)" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M40 37V59M29 48H51" stroke="white" strokeWidth="5" strokeLinecap="round" />
    </svg>
  );
}
