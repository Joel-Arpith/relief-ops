import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Map as MapIcon } from 'lucide-react';
import { BASEMAPS, type Basemap } from '../lib/basemaps';

/* ---------------- basemap switcher (Google-Maps style, bottom-left) --------------- */

export function BasemapSwitcher({
  active,
  onChange,
}: {
  active: Basemap;
  onChange: (b: Basemap) => void;
}) {
  const [open, setOpen] = useState(false);
  const others = BASEMAPS.filter((b) => b.id !== active.id);

  return (
    <div className="pointer-events-auto flex items-end gap-2" onMouseLeave={() => setOpen(false)}>
      <button
        onMouseEnter={() => setOpen(true)}
        onClick={() => setOpen((v) => !v)}
        className="group relative h-[68px] w-[92px] overflow-hidden rounded-xl border border-white/15 shadow-glass transition
                   hover:border-neon-cyan/45"
        style={{ background: active.swatch }}
        title={active.hint}
      >
        <span className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/10 to-transparent" />
        <span className="absolute bottom-1 left-0 right-0 text-center font-mono text-[9.5px] uppercase tracking-[0.14em] text-white">
          {active.label}
        </span>
        <span className="absolute left-1.5 top-1.5 grid h-5 w-5 place-items-center rounded-md bg-black/45 text-white/80 backdrop-blur">
          <MapIcon size={11} />
        </span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -8 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="glass flex gap-2 rounded-2xl p-2"
          >
            {others.map((b) => (
              <button
                key={b.id}
                onClick={() => {
                  onChange(b);
                  setOpen(false);
                }}
                title={b.hint}
                className="group relative h-[56px] w-[76px] overflow-hidden rounded-lg border border-white/12 transition
                           hover:border-neon-cyan/50 hover:shadow-[0_0_26px_-8px_rgba(34,211,238,0.9)]"
                style={{ background: b.swatch }}
              >
                <span className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/10 to-transparent" />
                <span className="absolute bottom-1 left-0 right-0 text-center font-mono text-[9px] uppercase tracking-[0.12em] text-white/90">
                  {b.label}
                </span>
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
