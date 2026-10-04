import { AnimatePresence, motion } from 'motion/react';
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { Check, Info, TriangleAlert, X } from 'lucide-react';
import { spring } from './motion';

type Tone = 'success' | 'error' | 'info';
interface ToastItem {
  id: number;
  tone: Tone;
  title: string;
  desc?: string;
}

interface ToastApi {
  show: (title: string, opts?: { tone?: Tone; desc?: string; duration?: number }) => void;
  success: (title: string, desc?: string) => void;
  error: (title: string, desc?: string) => void;
  info: (title: string, desc?: string) => void;
}

const Ctx = createContext<ToastApi>(null!);

const ICON = {
  success: <Check size={16} strokeWidth={2.6} />,
  error: <TriangleAlert size={16} strokeWidth={2.2} />,
  info: <Info size={16} strokeWidth={2.2} />,
};
const TONE = {
  success: 'text-[#7fd3ca]',
  error: 'text-[#ff9b8f]',
  info: 'opacity-70',
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const idRef = useRef(0);

  const dismiss = useCallback((id: number) => setItems((xs) => xs.filter((x) => x.id !== id)), []);

  const show = useCallback<ToastApi['show']>(
    (title, opts = {}) => {
      const id = ++idRef.current;
      setItems((xs) => [...xs.slice(-2), { id, title, tone: opts.tone ?? 'info', desc: opts.desc }]);
      setTimeout(() => dismiss(id), opts.duration ?? (opts.desc ? 4800 : 3000));
    },
    [dismiss],
  );

  const api: ToastApi = {
    show,
    success: (t, d) => show(t, { tone: 'success', desc: d }),
    error: (t, d) => show(t, { tone: 'error', desc: d }),
    info: (t, d) => show(t, { tone: 'info', desc: d }),
  };

  return (
    <Ctx.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-3 z-[90] flex flex-col items-center gap-2 px-4 sm:top-4" aria-live="polite">
        <AnimatePresence initial={false}>
          {items.map((t) => (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, y: -12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8, transition: { duration: 0.15 } }}
              transition={spring}
              className="pointer-events-auto flex max-w-[92vw] items-start gap-3 rounded-xl bg-ink py-3 pr-2.5 pl-4 text-surface shadow-lg sm:max-w-md"
              role="status"
            >
              <span className={`mt-[3px] shrink-0 ${TONE[t.tone]}`}>{ICON[t.tone]}</span>
              <div className="min-w-0 flex-1">
                <p className="text-[14.5px] leading-snug font-semibold">{t.title}</p>
                {t.desc && <p className="mt-0.5 text-[13.5px] leading-relaxed opacity-75">{t.desc}</p>}
              </div>
              <button onClick={() => dismiss(t.id)} className="grid size-6 place-items-center rounded opacity-60 hover:opacity-100" aria-label="关闭">
                <X size={14} />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);
