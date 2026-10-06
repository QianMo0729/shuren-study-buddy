import { motion } from 'motion/react';
import { useNavigate } from 'react-router';
import { MessageCircle } from 'lucide-react';
import { ease } from '../../lib/motion';
import { Plate, Stamp } from '../brand';
import { Nickname } from '../ProfileCard';
import { Button, Modal } from '../ui';

/** 互相感兴趣时的庆祝弹窗：盖一枚「同行」章，引导去私聊 */
export function MatchCelebration({ match, onClose }: {
  match: { matchId: number; nickname: string; cover: string | null } | null;
  onClose: () => void;
}) {
  const nav = useNavigate();
  return (
    <Modal open={!!match} onClose={onClose} size="sm">
      {match && (
        <div className="px-6 pt-7 pb-6 text-center" role="alertdialog" aria-labelledby="match-celebration-title" aria-describedby="match-celebration-desc">
          <div className="relative mx-auto w-fit">
            <Plate nickname={match.nickname} photo={match.cover} className="size-28 rounded-md border border-line" pad="10%" />
            <motion.span
              className="absolute -right-5 -bottom-3"
              initial={{ scale: 1.8, opacity: 0, rotate: -18 }}
              animate={{ scale: 1, opacity: 1, rotate: -8 }}
              transition={{ duration: 0.45, ease, delay: 0.15 }}
            >
              <Stamp text="同行" size={46} />
            </motion.span>
          </div>
          <h3 id="match-celebration-title" className="mt-6 font-display text-[24px] text-ink">你们互相感兴趣了</h3>
          <p id="match-celebration-desc" className="mt-2 text-[14px] leading-relaxed text-ink-2">
            你和 <Nickname name={match.nickname} size={15} className="align-baseline" /> 都对彼此感兴趣。先打个招呼，聊聊学习目标和时间安排。
          </p>
          <div className="mt-6 flex flex-col gap-2 sm:flex-row-reverse sm:justify-center">
            <Button variant="primary" size="lg" icon={<MessageCircle size={17} />} onClick={() => { onClose(); nav(`/messages/${match.matchId}`); }} autoFocus>
              去私聊
            </Button>
            <Button variant="ghost" size="lg" onClick={onClose}>
              继续看看
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
