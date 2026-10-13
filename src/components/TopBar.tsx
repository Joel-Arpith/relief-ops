import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { CloudRain, LifeBuoy, RefreshCw, Truck, LayoutDashboard } from 'lucide-react';
import RotatingText from '../reactbits/RotatingText';
import { useRain, type Ops } from '../lib/ops';

const clock = () => new Date().toLocaleTimeString('en-IN', { hour12: false, timeZone: 'Asia/Kolkata' });

export default function TopBar({ ops, view, children }: { ops: Ops; view: 'admin' | 'driver'; children?: React.ReactNode }) {
  const [t, setT] = useState(clock());
  const rain = useRain();
  useEffect(() => {
    const id = setInterval(() => setT(clock()), 1000);
    return () => clearInterval(id);
  }, []);
  const link =
    ops.link === 'live'
      ? { dot: '#34D399', label: 'Live', cls: 'text-neon-mint' }
      : ops.link === 'connecting'
        ? { dot: '#FBBF24', label: 'Linking', cls: 'text-neon-amber' }
        : { dot: '#FF3B4E', label: 'Backend down', cls: 'text-neon-crimson' };
  const heavy = rain && rain.peak >= 7.5; // IMD "heavy" is 7.5 mm/h and up

  return (
    <div className="relative z-30">
      <div className="flex h-[22px] items-center justify-between border-b border-white/[0.06] bg-[#070B12]/80 px-4 backdrop-blur-xl">
        <span className="font-mono text-[9px] uppercase tracking-[0.3em] text-slate-500">Disaster response logistics · Hyderabad</span>
        <span className="hidden font-mono text-[9px] uppercase tracking-[0.28em] text-slate-500 md:block">
          DAA PBL Group 16 · OSM road graph · synthetic demand
        </span>
        <span className="font-mono text-[9px] uppercase tracking-[0.3em] text-slate-500">{t} IST</span>
      </div>

      <motion.header
        initial={{ y: -18, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
        className="glass-quiet flex min-h-[58px] flex-wrap items-center gap-3 border-b border-white/[0.07] px-3 py-2 md:px-4"
      >
        <a href="#/" className="flex items-center gap-3 pr-2">
          <div className="relative grid h-9 w-9 place-items-center rounded-xl border border-neon-cyan/30 bg-neon-cyan/10">
            <LifeBuoy size={16} className="text-neon-cyan" />
            <span className="absolute inset-0 animate-breathe rounded-xl border border-neon-cyan/20" />
          </div>
          <div className="leading-none">
            <div className="text-[15px] font-semibold tracking-tight text-slate-50">Relief Ops</div>
            <div className="mt-1 hidden items-center gap-1.5 font-mono text-[9.5px] uppercase tracking-[0.16em] text-slate-500 sm:flex">
              <span className="text-neon-cyan/70">{view === 'admin' ? 'dispatch' : 'driver'}</span>
              <span>·</span>
              <RotatingText
                texts={['kruskal clearance', 'dijkstra rerouting', 'knapsack loading', 'held–karp deadlines']}
                rotationInterval={3200}
                staggerDuration={0.012}
                staggerFrom="last"
                splitBy="characters"
                mainClassName="text-slate-500"
                transition={{ type: 'spring', damping: 30, stiffness: 380 }}
              />
            </div>
          </div>
        </a>

        <nav className="flex items-center gap-1 rounded-xl border border-white/[0.08] bg-white/[0.03] p-1">
          <a href="#/admin" data-active={view === 'admin'} className="btn-glass !py-1">
            <LayoutDashboard size={12} /> Admin
          </a>
          <a href="#/driver" data-active={view === 'driver'} className="btn-glass !py-1">
            <Truck size={12} /> Driver
          </a>
        </nav>

        {children}

        <div className="ml-auto flex items-center gap-2">
          {rain && (
            <div
              className={`hidden items-center gap-2 rounded-xl border px-3 py-1.5 lg:flex ${heavy ? 'border-neon-ember/40 bg-neon-ember/10' : 'border-white/[0.08] bg-white/[0.03]'}`}
              title="Open-Meteo hourly forecast for Hyderabad, next 12 hours"
            >
              <CloudRain size={12} className={heavy ? 'text-neon-ember' : 'text-neon-ice'} />
              <span className="font-mono text-[10px] text-slate-400">
                Rain 12 h <span className="text-slate-200">{rain.total.toFixed(1)} mm</span> · peak {rain.peak.toFixed(1)} mm/h @ {rain.peakAt}
                {heavy && <span className="ml-1 text-neon-ember">· flood watch</span>}
              </span>
            </div>
          )}
          <div className="flex items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-1.5">
            <span className="h-1.5 w-1.5 animate-breathe rounded-full" style={{ background: link.dot, boxShadow: `0 0 10px ${link.dot}` }} />
            <span className={`font-mono text-[10px] uppercase tracking-[0.14em] ${link.cls}`}>{link.label}</span>
          </div>
          <button onClick={() => void ops.refresh()} className="btn-glass !px-2.5 !py-2" title="Sync now" aria-label="Sync now">
            <RefreshCw size={12} />
          </button>
        </div>
      </motion.header>
    </div>
  );
}
