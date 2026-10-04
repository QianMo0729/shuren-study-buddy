import { cx } from '../../lib/format';
import { Plate } from '../brand';

/** 私聊头像：公开照片优先，否则用昵称对应物种的图版 */
export function ChatAvatar({ nickname, cover, className }: { nickname: string; cover: string | null; className?: string }) {
  return <Plate nickname={nickname} photo={cover} fit="cover" pad="6%" className={cx('shrink-0 rounded-[5px]', className ?? 'size-11')} />;
}
