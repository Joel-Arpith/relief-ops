import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

/**
 * A map-edge panel that folds into a vertical tab. The tab — icon, upright label,
 * chevron — stays on screen in both states, so the operator always knows what is
 * parked there and can close it from the same control they opened it with.
 *
 * Open state is remembered per panel, because an operator's dock layout should
 * survive a refresh.
 */
export default function DockPanel({
  id,
  label,
  icon,
  tone = '#22D3EE',
  width = 230,
  defaultOpen = true,
  children,
}: {
  id: string;
  label: string;
  icon: JSX.Element;
  tone?: string;
  width?: number;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const storageKey = `tw.dock.${id}`;

  const [open, setOpen] = useState(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      return stored === null ? defaultOpen : stored === '1';
    } catch {
      return defaultOpen;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, open ? '1' : '0');
    } catch {
      /* private mode or blocked storage — the panel just forgets between sessions */
    }
  }, [open, storageKey]);

  const toggle = useCallback(() => setOpen((v) => !v), []);

  return (
    <div className="pointer-events-auto flex items-start gap-1.5">
      <button
        onClick={toggle}
        aria-expanded={open}
        aria-controls={`dock-${id}`}
        title={`${open ? 'Collapse' : 'Expand'} ${label}`}
        className="glass group flex w-[30px] shrink-0 flex-col items-center gap-2 rounded-xl px-1 py-2.5
                   transition-colors duration-200 hover:border-white/20"
        style={open ? { borderColor: `${tone}44`, boxShadow: `inset 0 0 0 1px ${tone}18` } : undefined}
      >
        <span
          className="grid h-5 w-5 place-items-center rounded-md transition-colors"
          style={{ color: open ? tone : '#64748B' }}
        >
          {icon}
        </span>

        <span
          className="font-mono text-[9.5px] uppercase tracking-[0.22em] transition-colors
                     [writing-mode:vertical-rl] rotate-180"
          style={{ color: open ? '#CBD5E1' : '#7C8CA3' }}
        >
          {label}
        </span>

        <span className="text-slate-600 transition-colors group-hover:text-slate-300">
          {open ? <ChevronLeft size={11} /> : <ChevronRight size={11} />}
        </span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            id={`dock-${id}`}
            key="panel"
            initial={{ width: 0, opacity: 0, x: -10 }}
            animate={{ width, opacity: 1, x: 0 }}
            exit={{ width: 0, opacity: 0, x: -10 }}
            transition={{ duration: 0.34, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div style={{ width }}>{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
