import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import StrokeText from '../reactbits/StrokeText';
import SplitFlapText from '../reactbits/SplitFlapText';

const SEQUENCE = [
  'OSM road graph — 9,196 intersections, Hyderabad',
  'Kruskal MST · least-effort clearance backbone',
  'Dijkstra · travel times on passable roads',
  'Greedy allocation · critical first, earliest deadline',
  'Knapsack + subset DP · loads and on-time routes',
  'Fleet picture ready',
];

export default function BootSplash({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(0);
  const [open, setOpen] = useState(true);
  // The console re-renders on every stream heartbeat; keep the boot timers off that path.
  const done = useRef(onDone);
  done.current = onDone;

  useEffect(() => {
    const tick = setInterval(() => setStep((s) => Math.min(s + 1, SEQUENCE.length)), 340);
    const finish = setTimeout(() => {
      setOpen(false);
      setTimeout(() => done.current(), 620);
    }, 2900);
    return () => {
      clearInterval(tick);
      clearTimeout(finish);
    };
  }, []);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[999] grid place-items-center bg-void"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0, filter: 'blur(14px)' }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="pointer-events-none absolute inset-0">
            <div
              className="aurora animate-driftA"
              style={{
                width: '60vw',
                height: '60vw',
                left: '20vw',
                top: '-10vw',
                background: 'radial-gradient(circle, rgba(34,211,238,0.22), transparent 60%)',
              }}
            />
          </div>

          <div className="relative w-[min(760px,88vw)] px-6">
            <div className="mb-2 flex items-center justify-center gap-3">
              <span className="label text-neon-cyan/70">Disaster Response Logistics</span>
              <span className="h-px w-10 bg-white/15" />
              <span className="label">DAA · Group 16</span>
            </div>

            <StrokeText
              text="RELIEF OPS"
              strokeColor="#22D3EE"
              fillColor="#F1F5F9"
              strokeWidth={1.1}
              drawDuration={1.35}
              fillDelay={0.12}
              stagger={0.045}
              fontSize={typeof window !== 'undefined' && window.innerWidth < 768 ? 54 : 96}
              fontWeight={800}
              letterSpacing={-2}
              fillMode="wipe"
              trigger="mount"
            />

            <div className="mt-6 flex justify-center">
              <SplitFlapText
                words={['ROAD GRAPH', 'HAZARD SYNC', 'FLEET ONLINE']}
                fontSize={15}
                gap={3}
                tileRadius={4}
                padTo={13}
                tileColor="#0D1420"
                textColor="#7DD3FC"
                flipDuration={0.1}
                stagger={0.035}
                cycleDelay={900}
              />
            </div>

            <div className="mx-auto mt-7 max-w-md space-y-1.5">
              {SEQUENCE.map((line, i) => (
                <motion.div
                  key={line}
                  className="flex items-center gap-3 font-mono text-[11px]"
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: i < step ? 1 : 0.18, x: 0 }}
                  transition={{ duration: 0.35 }}
                >
                  <span className={i < step ? 'text-neon-mint' : 'text-slate-700'}>
                    {i < step ? '✓' : '·'}
                  </span>
                  <span className={i < step ? 'text-slate-400' : 'text-slate-700'}>{line}</span>
                </motion.div>
              ))}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
