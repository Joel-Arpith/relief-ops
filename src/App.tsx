import { useEffect, useState } from 'react';
import { LayoutDashboard, Truck } from 'lucide-react';
import Backdrop from './components/Backdrop';
import BootSplash from './components/BootSplash';
import StrokeText from './reactbits/StrokeText';
import AdminView from './views/AdminView';
import DriverView from './views/DriverView';

// ponytail: hash routing — two views don't need a router, and static hosting needs no rewrites
const useHash = () => {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const on = () => setHash(location.hash);
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  return hash.replace(/^#\/?/, '').split('/');
};

export default function App() {
  const [view, id] = useHash();
  const [booted, setBooted] = useState(() => sessionStorage.getItem('ro.booted') === '1');
  return (
    <>
      <Backdrop />
      {!booted && <BootSplash onDone={() => (sessionStorage.setItem('ro.booted', '1'), setBooted(true))} />}
      {view === 'admin' ? <AdminView /> : view === 'driver' ? <DriverView key={id} driverId={id} /> : <Landing />}
    </>
  );
}

function Landing() {
  const cards = [
    {
      href: '#/admin',
      icon: <LayoutDashboard size={20} />,
      tone: '#22D3EE',
      title: 'Dispatch console',
      text: 'Every vehicle, its route and what it will run into. Report floods, fires and collapses; the fleet is warned and rerouted.',
    },
    {
      href: '#/driver',
      icon: <Truck size={20} />,
      tone: '#FBBF24',
      title: 'Driver app',
      text: 'Your deliveries in deadline order, alerts the moment a hazard lands on your road, and a safe route in one tap.',
    },
  ];
  return (
    <main className="relative z-10 grid h-[100dvh] place-items-center overflow-y-auto px-4 py-10">
      <div className="w-full max-w-[860px]">
        <div className="label text-center text-neon-cyan/70">Disaster response logistics · Hyderabad</div>
        <div className="mt-3 flex justify-center">
          <StrokeText
            text="RELIEF OPS"
            strokeColor="#22D3EE"
            fillColor="#F1F5F9"
            strokeWidth={1.1}
            drawDuration={1.2}
            stagger={0.045}
            fontSize={innerWidth < 768 ? 48 : 84}
            fontWeight={800}
            letterSpacing={-2}
            fillMode="wipe"
            trigger="mount"
          />
        </div>
        <p className="mx-auto mt-4 max-w-[600px] text-center text-[14px] leading-relaxed text-slate-400">
          Relief routing on the real OpenStreetMap road network. The routes come from the DAA Group 16 pipeline: a Kruskal clearance
          backbone, Dijkstra travel times, greedy allocation, knapsack loading and a Held–Karp subset DP with deadlines.
        </p>
        <div className="mt-8 grid gap-3 md:grid-cols-2">
          {cards.map((c) => (
            <a key={c.href} href={c.href} className="glass group rounded-2xl p-5 transition hover:-translate-y-0.5 hover:border-white/20">
              <span className="grid h-11 w-11 place-items-center rounded-xl border" style={{ borderColor: `${c.tone}55`, color: c.tone, background: `${c.tone}14` }}>
                {c.icon}
              </span>
              <div className="mt-4 text-[18px] font-semibold text-slate-50">{c.title}</div>
              <p className="mt-1.5 text-[13px] leading-relaxed text-slate-400">{c.text}</p>
              <div className="mt-4 font-mono text-[10px] uppercase tracking-[0.16em]" style={{ color: c.tone }}>
                Open →
              </div>
            </a>
          ))}
        </div>
      </div>
    </main>
  );
}
