import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Cpu,
  Crosshair,
  ExternalLink,
  Layers,
  MessageSquare,
  Navigation,
  Plus,
  RotateCcw,
  Route,
  Send,
  ShieldAlert,
  Trash2,
  Truck,
  Users,
  Wrench,
  X,
} from 'lucide-react';
import TopBar from '../components/TopBar';
import OpsMap, { type MapLayers } from '../components/OpsMap';
import DockPanel from '../components/DockPanel';
import { BasemapSwitcher } from '../components/MapControls';
import CountUp from '../reactbits/CountUp';
import { DEFAULT_BASEMAP, type Basemap } from '../lib/basemaps';
import { plan, reroute, type HazardKind, type LngLat, type Trip } from '../lib/algo';
import { CAPACITY, DEMANDS } from '../lib/places';
import { ago, api, fmtMin, KIND_META, LEVEL, PRIORITY, threatLine, useOps, type FleetRow, type Ops } from '../lib/ops';
import { useIsMobile } from '../lib/useIsMobile';

const ORDER = { critical: 0, warning: 1, clear: 2 } as const;
const placeName = Object.fromEntries(DEMANDS.map((d) => [d.id, d.name]));

export default function AdminView() {
  const ops = useOps();
  const isMobile = useIsMobile();
  const [basemap, setBasemap] = useState<Basemap>(DEFAULT_BASEMAP);
  const [layers, setLayers] = useState<MapLayers>({ routes: true, closures: true, clearance: false, places: true });
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<'fleet' | 'hazards' | 'feed'>('fleet');
  const [draft, setDraft] = useState<{ lng: number; lat: number } | null>(null);
  const [adding, setAdding] = useState(false);
  const [focus, setFocus] = useState<{ lng: number; lat: number; zoom?: number; t: number } | null>(null);
  const [form, setForm] = useState({ kind: 'flood' as HazardKind, severity: 2, radius_m: 500, starts_in: 0, note: '' });
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const rows = useMemo(() => [...ops.fleet].sort((a, b) => ORDER[a.a.level] - ORDER[b.a.level] || a.driver.id.localeCompare(b.driver.id)), [ops.fleet]);
  const sel = rows.find((r) => r.driver.id === selected) ?? null;

  const flash = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 3200);
  };
  const run = async (key: string, fn: () => Promise<unknown>, done?: string) => {
    setBusy(key);
    try {
      await fn();
      await ops.refresh();
      if (done) flash(done);
    } catch (e) {
      flash(`Failed: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  // what the report's pipeline would do right now, with today's closures
  const pipeline = useMemo(() => {
    if (!ops.graph || !ops.live || !ops.places) return null;
    const t0 = performance.now();
    const p = plan(ops.graph, ops.live.mult, ops.places.depots, ops.places.demands, CAPACITY);
    const ms = performance.now() - t0;
    const pri = Object.fromEntries(DEMANDS.map((d) => [d.id, d.priority]));
    const need = DEMANDS.reduce((s, d) => s + (d.need.water + d.need.food + d.need.medical) * d.priority, 0);
    const served = p.trips.flatMap((t) => t.stops.filter((s) => s.idx >= 0)).reduce((s, x) => s + x.units * pri[x.place], 0);
    return { ...p, ms, servedPct: (100 * served) / need, dropped: p.trips.flatMap((t) => t.stops.filter((s) => s.idx < 0)).length };
  }, [ops.graph, ops.live, ops.places]);

  const replan = () =>
    run(
      'replan',
      async () => {
        if (!pipeline || !ops.state || !ops.places) return;
        const byDepot = new Map<string, Trip[]>();
        pipeline.trips.forEach((t) => byDepot.set(t.depot, [...(byDepot.get(t.depot) ?? []), t]));
        await Promise.all(
          ops.state.drivers.map((d) => {
            const trip = byDepot.get(d.depot)?.shift() ?? { path: [ops.places!.depots.find((x) => x.id === d.depot)!.node], stops: [] };
            return api.setTrip(d.id, { path: trip.path, stops: trip.stops, restart: true });
          }),
        );
        await api.message(null, 'system', `Dispatch re-planned around ${ops.state.hazards.length} hazards — ${pipeline.servedPct.toFixed(0)}% of priority-weighted demand on time.`);
      },
      'All vehicles redispatched',
    );

  const rerouteOne = (r: FleetRow) =>
    run(
      `rr-${r.driver.id}`,
      async () => {
        if (!ops.graph || !ops.avoid || !ops.places) return;
        const places = Object.fromEntries(ops.places.demands.map((p) => [p.id, p]));
        const nr = reroute(ops.graph, r.driver, r.a, ops.avoid, places);
        await api.setTrip(r.driver.id, { path: nr.path, stops: nr.stops });
        await api.message(r.driver.id, 'admin', `Dispatch rerouted you around hazards (${fmtMin(nr.newMinutes)} remaining).`);
      },
      `Rerouted ${r.driver.name}`,
    );

  const kpis = useMemo(() => {
    const crit = DEMANDS.filter((d) => d.priority === 3);
    const critNeed = crit.reduce((s, d) => s + d.need.water + d.need.food + d.need.medical, 0);
    const critOk = rows.flatMap((r) => r.a.eta).filter((e) => !e.late && crit.some((c) => c.id === e.stop.place)).reduce((s, e) => s + e.stop.units, 0);
    const hz = ops.state?.hazards ?? [];
    return [
      { label: 'Drivers at risk', value: rows.filter((r) => r.a.level !== 'clear').length, foot: `of ${rows.length} vehicles on the board`, tone: '#FBBF24', icon: <Users size={13} /> },
      { label: 'Routes blocked', value: rows.filter((r) => r.a.level === 'critical').length, foot: `${rows.filter((r) => r.a.halted).length} halted at a closure`, tone: '#FF3B4E', icon: <ShieldAlert size={13} /> },
      { label: 'Critical demand on time', value: Math.round((100 * critOk) / critNeed), suffix: '%', foot: 'hospitals + camps, live ETA vs deadline', tone: '#34D399', icon: <Check size={13} /> },
      { label: 'Active hazards', value: hz.filter((h) => h.starts_at <= ops.now).length, foot: `${hz.filter((h) => h.starts_at > ops.now).length} forecast · ${ops.clearance?.edges.length ?? 0} roads to clear`, tone: '#38BDF8', icon: <AlertTriangle size={13} /> },
    ];
  }, [rows, ops.state, ops.now, ops.clearance]);

  const submitHazard = () =>
    draft &&
    run(
      'hazard',
      () => api.addHazard({ ...form, lat: +draft.lat.toFixed(5), lon: +draft.lng.toFixed(5), note: form.note.trim() }),
      `${KIND_META[form.kind].label} reported — drivers notified`,
    ).then(() => {
      setDraft(null);
      setAdding(false);
      setForm((f) => ({ ...f, note: '' }));
    });

  const mapClick = adding ? (p: LngLat) => setDraft({ lng: p[0], lat: p[1] }) : undefined;

  const rail = (
    <aside className={`glass-quiet flex min-h-0 flex-col border-white/[0.07] ${isMobile ? 'border-t' : 'w-[400px] border-l'}`}>
      <div className="flex gap-1 border-b border-white/[0.06] p-2">
        {(
          [
            ['fleet', 'Fleet', <Truck size={12} key="f" />],
            ['hazards', 'Hazards', <AlertTriangle size={12} key="h" />],
            ['feed', 'Feed', <MessageSquare size={12} key="m" />],
          ] as const
        ).map(([id, label, icon]) => (
          <button key={id} onClick={() => setTab(id)} data-active={tab === id} className="btn-glass flex-1 justify-center !py-1.5">
            {icon} {label}
          </button>
        ))}
      </div>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto p-3">
        {tab === 'fleet' &&
          (sel ? (
            <DriverDetail
              row={sel}
              ops={ops}
              busy={busy}
              onBack={() => setSelected(null)}
              onFocus={() => setFocus({ lng: sel.a.pos[0], lat: sel.a.pos[1], zoom: 14, t: Date.now() })}
              onReroute={() => rerouteOne(sel)}
              onMessage={(text) => run('msg', () => api.message(sel.driver.id, 'admin', text), 'Message sent')}
            />
          ) : (
            <FleetList rows={rows} onPick={(id) => setSelected(id)} />
          ))}
        {tab === 'hazards' && (
          <HazardList ops={ops} busy={busy} onClear={(id) => run(`del-${id}`, () => api.clearHazard(id), 'Hazard cleared')} onFocus={(lng, lat) => setFocus({ lng, lat, zoom: 14, t: Date.now() })} />
        )}
        {tab === 'feed' && <Feed ops={ops} />}
      </div>
    </aside>
  );

  return (
    <div className={`relative flex w-screen flex-col ${isMobile ? 'min-h-[100dvh]' : 'h-screen overflow-hidden'}`}>
      <TopBar ops={ops} view="admin">
        <div className="flex items-center gap-1.5">
          <button onClick={() => { setAdding((v) => !v); setDraft(null); }} data-active={adding} className="btn-glass !py-1.5">
            <Plus size={12} /> Report hazard
          </button>
          <button onClick={replan} disabled={busy === 'replan'} className="btn-glass !py-1.5" title="Run the full pipeline with today's closures and redispatch every vehicle">
            <Cpu size={12} /> {busy === 'replan' ? 'Planning…' : 'Re-plan'}
          </button>
        </div>
      </TopBar>

      <main className={`relative z-10 flex min-h-0 flex-1 ${isMobile ? 'flex-col' : ''}`}>
        <section className={`relative min-w-0 flex-1 ${isMobile ? 'h-[62dvh] flex-none' : ''}`}>
          <OpsMap
            ops={ops}
            basemap={basemap}
            layers={layers}
            rows={rows}
            selectedId={selected}
            onSelectDriver={(id) => {
              setSelected(id);
              setTab('fleet');
            }}
            onMapClick={mapClick}
            focus={focus}
            draft={draft ? { ...draft, radius_m: form.radius_m } : null}
          />

          {!ops.graph && <div className="absolute inset-0 grid place-items-center font-mono text-[11px] text-slate-400">Loading OSM road graph…</div>}

          <div className="pointer-events-none absolute inset-x-0 top-0 z-10 p-3">
            <div className={`mx-auto grid max-w-[920px] gap-2 ${isMobile ? 'grid-cols-2' : 'grid-cols-4'}`}>
              {kpis.map((k, i) => (
                <motion.div
                  key={k.label}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.06 * i, duration: 0.5 }}
                  className="glass pointer-events-auto relative overflow-hidden rounded-2xl px-3 py-2.5"
                >
                  <div className="absolute inset-x-0 top-0 h-px opacity-70" style={{ background: `linear-gradient(90deg,transparent,${k.tone},transparent)` }} />
                  <div className="flex items-center justify-between gap-1">
                    <span className="label truncate">{k.label}</span>
                    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-lg border" style={{ borderColor: `${k.tone}44`, color: k.tone, background: `${k.tone}14` }}>
                      {k.icon}
                    </span>
                  </div>
                  <div className="mt-1 flex items-baseline gap-1">
                    <span className="metric text-[24px] font-semibold leading-none" style={{ color: k.tone }}>
                      {ops.state ? <CountUp to={Number.isFinite(k.value) ? k.value : 0} duration={0.8} /> : '–'}
                    </span>
                    {k.suffix && <span className="font-mono text-[11px] text-slate-500">{k.suffix}</span>}
                  </div>
                  <div className="mt-1 truncate font-mono text-[9.5px] text-slate-500">{k.foot}</div>
                </motion.div>
              ))}
            </div>
          </div>

          {!isMobile && (
            <div className="pointer-events-none absolute bottom-5 left-3 top-[128px] z-10 flex flex-col justify-between">
              <div className="space-y-2.5">
                <DockPanel id="ro-layers" label="Layers" icon={<Layers size={13} />} tone="#22D3EE">
                  <LayerToggles layers={layers} onChange={setLayers} ops={ops} />
                </DockPanel>
                <DockPanel id="ro-pipeline" label="Pipeline" icon={<Cpu size={13} />} tone="#C084FC" width={250}>
                  <Pipeline p={pipeline} ops={ops} />
                </DockPanel>
              </div>
              <div className="pointer-events-auto pl-[36px]">
                <BasemapSwitcher active={basemap} onChange={setBasemap} />
              </div>
            </div>
          )}

          <AnimatePresence>
            {adding && (
              <motion.div
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: 20, opacity: 0 }}
                className="glass absolute bottom-4 left-1/2 z-20 w-[min(440px,calc(100%-24px))] -translate-x-1/2 rounded-2xl p-3.5"
              >
                <div className="flex items-center justify-between">
                  <span className="label text-neon-cyan">Report hazard</span>
                  <button onClick={() => { setAdding(false); setDraft(null); }} className="text-slate-500 hover:text-white" aria-label="Close">
                    <X size={14} />
                  </button>
                </div>
                {!draft ? (
                  <p className="mt-2 flex items-center gap-2 font-mono text-[11px] text-slate-400">
                    <Crosshair size={12} className="text-neon-cyan" /> Click the map where it is happening.
                  </p>
                ) : (
                  <div className="mt-2.5 space-y-2.5">
                    <div className="flex flex-wrap gap-1">
                      {(Object.keys(KIND_META) as HazardKind[]).map((k) => (
                        <button key={k} onClick={() => setForm({ ...form, kind: k })} data-active={form.kind === k} className="btn-glass !px-2 !py-1 !text-[10px]">
                          {KIND_META[k].glyph} {KIND_META[k].label}
                        </button>
                      ))}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="label w-16">Severity</span>
                      {[
                        [1, 'Slows'],
                        [2, 'Closes'],
                        [3, 'Severe'],
                      ].map(([s, l]) => (
                        <button key={s} onClick={() => setForm({ ...form, severity: s as number })} data-active={form.severity === s} className="btn-glass !px-2 !py-1 !text-[10px]">
                          {s} · {l}
                        </button>
                      ))}
                    </div>
                    <label className="flex items-center gap-2">
                      <span className="label w-16">Radius</span>
                      <input type="range" min={100} max={2000} step={50} value={form.radius_m} onChange={(e) => setForm({ ...form, radius_m: +e.target.value })} className="flex-1 accent-cyan-400" />
                      <span className="metric w-14 text-right text-[11px]">{form.radius_m} m</span>
                    </label>
                    <div className="flex items-center gap-2">
                      <span className="label w-16">Starts</span>
                      {[0, 30, 60, 120].map((m) => (
                        <button key={m} onClick={() => setForm({ ...form, starts_in: m })} data-active={form.starts_in === m} className="btn-glass !px-2 !py-1 !text-[10px]">
                          {m ? `+${m}m` : 'Now'}
                        </button>
                      ))}
                    </div>
                    <input
                      value={form.note}
                      maxLength={200}
                      onChange={(e) => setForm({ ...form, note: e.target.value })}
                      placeholder="What is happening (optional)"
                      className="h-9 w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 font-mono text-[11px] text-slate-200 outline-none placeholder:text-slate-600 focus:border-neon-cyan/40"
                    />
                    <button onClick={submitHazard} disabled={busy === 'hazard'} className="btn-glass w-full justify-center !border-neon-cyan/40 !bg-neon-cyan/15 !text-cyan-100">
                      <Send size={12} /> {busy === 'hazard' ? 'Reporting…' : 'Report and alert drivers'}
                    </button>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {toast && (
              <motion.div
                initial={{ y: -10, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: -10, opacity: 0 }}
                className="glass absolute left-1/2 top-[136px] z-30 -translate-x-1/2 rounded-xl px-4 py-2 font-mono text-[11px] text-slate-200"
                role="status"
              >
                {toast}
              </motion.div>
            )}
          </AnimatePresence>
        </section>
        {rail}
      </main>
    </div>
  );
}

/* ───────────── rail sections ───────────── */

function LevelChip({ level, halted }: { level: keyof typeof LEVEL; halted?: boolean }) {
  const l = LEVEL[level];
  return (
    <span className="chip" style={{ borderColor: `${l.tone}55`, color: l.tone, background: `${l.tone}12` }}>
      {halted ? 'Halted' : l.label}
    </span>
  );
}

function FleetList({ rows, onPick }: { rows: FleetRow[]; onPick: (id: string) => void }) {
  if (!rows.length) return <div className="skeleton h-24 rounded-xl" />;
  return (
    <div className="space-y-2">
      {rows.map(({ driver, a }) => {
        const next = a.eta.find((e) => !e.served);
        const top = a.threats[0];
        return (
          <button
            key={driver.id}
            onClick={() => onPick(driver.id)}
            className="glass w-full rounded-xl p-3 text-left transition hover:border-white/20"
            style={{ borderLeft: `3px solid ${LEVEL[a.level].tone}` }}
          >
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="text-[13px] font-medium text-slate-100">{driver.name}</div>
                <div className="font-mono text-[10px] text-slate-500">{driver.vehicle}</div>
              </div>
              <LevelChip level={a.level} halted={a.halted} />
            </div>
            <div className="mt-2 font-mono text-[10.5px] text-slate-400">
              {driver.stops.length === 0
                ? 'Standby at depot'
                : a.done
                  ? 'Trip complete'
                  : next
                    ? `Next: ${placeName[next.stop.place]} · ${fmtMin(next.minutes - a.clock)}`
                    : 'Returning'}
            </div>
            {top && (
              <div className="mt-1 font-mono text-[10.5px]" style={{ color: top.effect === 'closed' ? '#FF8A95' : '#FCD34D' }}>
                {KIND_META[top.hazard.kind].glyph} {threatLine(top)}
                {driver.acked.includes(top.hazard.id) && <span className="ml-1 text-neon-mint">· acked</span>}
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}

function DriverDetail({
  row,
  ops,
  busy,
  onBack,
  onFocus,
  onReroute,
  onMessage,
}: {
  row: FleetRow;
  ops: Ops;
  busy: string | null;
  onBack: () => void;
  onFocus: () => void;
  onReroute: () => void;
  onMessage: (t: string) => void;
}) {
  const { driver, a } = row;
  const [text, setText] = useState('');
  const pri = Object.fromEntries(DEMANDS.map((d) => [d.id, d]));
  const msgs = (ops.state?.messages ?? []).filter((m) => m.driver_id === driver.id).slice(0, 6);
  return (
    <div className="space-y-3">
      <button onClick={onBack} className="btn-glass !py-1">
        <ArrowLeft size={12} /> Fleet
      </button>
      <div className="glass rounded-xl p-3" style={{ borderLeft: `3px solid ${LEVEL[a.level].tone}` }}>
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="text-[15px] font-semibold text-slate-50">{driver.name}</div>
            <div className="font-mono text-[10px] text-slate-500">
              {driver.vehicle} · {driver.depot.replace('dp-', '')} depot
            </div>
          </div>
          <LevelChip level={a.level} halted={a.halted} />
        </div>
        <div className="mt-3 h-1 overflow-hidden rounded-full bg-white/[0.08]">
          <div className="h-full rounded-full" style={{ width: `${a.total ? Math.min(100, (100 * a.clock) / a.total) : 0}%`, background: LEVEL[a.level].tone }} />
        </div>
        <div className="mt-1.5 flex justify-between font-mono text-[10px] text-slate-500">
          <span>trip clock {fmtMin(a.clock)}</span>
          <span>{a.remainingKm.toFixed(1)} km to go</span>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          <button onClick={onFocus} className="btn-glass !py-1">
            <Crosshair size={12} /> Focus
          </button>
          <button onClick={onReroute} disabled={busy === `rr-${driver.id}` || !driver.stops.length} className="btn-glass !py-1" data-active={a.level !== 'clear'}>
            <Route size={12} /> {busy === `rr-${driver.id}` ? 'Routing…' : 'Reroute'}
          </button>
          <a href={`#/driver/${driver.id}`} target="_blank" rel="noreferrer" className="btn-glass !py-1">
            <ExternalLink size={12} /> Driver view
          </a>
        </div>
      </div>

      <section>
        <div className="label mb-1.5">Ahead on route</div>
        {a.threats.length === 0 ? (
          <div className="font-mono text-[11px] text-neon-mint">No hazards on the remaining route.</div>
        ) : (
          <ul className="space-y-1.5">
            {a.threats.map((t) => (
              <li key={t.hazard.id} className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-2 font-mono text-[10.5px]">
                <div style={{ color: KIND_META[t.hazard.kind].tone }}>
                  {KIND_META[t.hazard.kind].glyph} {threatLine(t)} · ~{fmtMin(t.inMinutes)}
                </div>
                <div className="mt-0.5 text-slate-500">
                  {t.hazard.note || t.hazard.id} {driver.acked.includes(t.hazard.id) ? <span className="text-neon-mint">· driver acknowledged</span> : <span className="text-neon-amber">· not yet acknowledged</span>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <div className="label mb-1.5">Stops · knapsack load · DP order</div>
        <ul className="space-y-1">
          {driver.stops.map((s) => {
            const e = a.eta.find((x) => x.stop.place === s.place && x.stop.idx === s.idx);
            const p = pri[s.place];
            const status = s.idx < 0 ? ['Dropped', '#FF3B4E'] : e?.served ? ['Served', '#34D399'] : e?.late ? ['Late', '#FF6B2C'] : ['On time', '#7DD3FC'];
            return (
              <li key={`${s.place}-${s.idx}`} className="flex items-center gap-2 rounded-lg px-2 py-1.5 font-mono text-[10.5px] hover:bg-white/[0.03]">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: PRIORITY[p.priority].tone }} title={PRIORITY[p.priority].label} />
                <span className="min-w-0 flex-1 truncate text-slate-300">{p.name}</span>
                <span className="text-slate-500">{s.units}u</span>
                <span className="w-12 text-right text-slate-400">{e && !e.served ? fmtMin(e.minutes) : ''}</span>
                <span className="w-14 text-right text-slate-600">/{p.deadline}m</span>
                <span className="w-14 text-right" style={{ color: status[1] }}>
                  {status[0]}
                </span>
              </li>
            );
          })}
          {!driver.stops.length && <li className="font-mono text-[11px] text-slate-500">Reserve vehicle — no load assigned by the knapsack stage.</li>}
        </ul>
      </section>

      <section>
        <div className="label mb-1.5">Messages</div>
        <form
          className="flex gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim()) onMessage(text.trim());
            setText('');
          }}
        >
          <input
            value={text}
            maxLength={280}
            onChange={(e) => setText(e.target.value)}
            placeholder={`Message ${driver.name.split(' ')[0]}…`}
            className="h-8 min-w-0 flex-1 rounded-lg border border-white/[0.08] bg-white/[0.03] px-2.5 font-mono text-[11px] text-slate-200 outline-none placeholder:text-slate-600 focus:border-neon-cyan/40"
          />
          <button className="btn-glass !py-1" aria-label="Send">
            <Send size={12} />
          </button>
        </form>
        <ul className="mt-2 space-y-1">
          {msgs.map((m) => (
            <li key={m.id} className="font-mono text-[10.5px]">
              <span className={m.sender === 'driver' ? 'text-neon-amber' : 'text-neon-ice'}>{m.sender}</span>
              <span className="text-slate-600"> · {ago(m.created_at, ops.now)}</span>
              <div className="text-slate-300">{m.text}</div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function HazardList({ ops, busy, onClear, onFocus }: { ops: Ops; busy: string | null; onClear: (id: string) => void; onFocus: (lng: number, lat: number) => void }) {
  const hz = [...(ops.state?.hazards ?? [])].sort((a, b) => b.severity - a.severity);
  const affected = (id: string) => ops.fleet.filter((r) => r.a.threats.some((t) => t.hazard.id === id)).map((r) => r.driver.name.split(' ')[0]);
  return (
    <div className="space-y-2">
      <p className="font-mono text-[10.5px] text-slate-500">Severity 1 slows roads ×2.5 · 2–3 close them. Forecast hazards are avoided by reroutes before they start.</p>
      {hz.map((h) => {
        const k = KIND_META[h.kind];
        const fc = h.starts_at > ops.now;
        const who = affected(h.id);
        return (
          <div key={h.id} className="glass rounded-xl p-3" style={{ borderLeft: `3px solid ${k.tone}` }}>
            <div className="flex items-start justify-between gap-2">
              <button onClick={() => onFocus(h.lon, h.lat)} className="text-left">
                <div className="text-[13px] font-medium text-slate-100">
                  {k.glyph} {k.label} · sev {h.severity}
                </div>
                <div className="font-mono text-[10px] text-slate-500">
                  {h.radius_m} m · {fc ? <span className="text-neon-violet">starts in {fmtMin((h.starts_at - ops.now) / 60000)}</span> : `since ${ago(h.starts_at, ops.now)}`}
                </div>
              </button>
              <button onClick={() => onClear(h.id)} disabled={busy === `del-${h.id}`} className="btn-glass !px-2 !py-1" title="Mark cleared">
                <Trash2 size={12} />
              </button>
            </div>
            {h.note && <div className="mt-1.5 text-[11.5px] text-slate-300">{h.note}</div>}
            <div className="mt-1.5 font-mono text-[10px] text-slate-500">{who.length ? `On route of ${who.join(', ')}` : 'No driver routed through it'}</div>
          </div>
        );
      })}
    </div>
  );
}

function Feed({ ops }: { ops: Ops }) {
  const names = Object.fromEntries((ops.state?.drivers ?? []).map((d) => [d.id, d.name]));
  return (
    <ul className="space-y-2">
      {(ops.state?.messages ?? []).map((m) => (
        <li key={m.id} className="rounded-lg border border-white/[0.05] bg-white/[0.02] px-3 py-2">
          <div className="flex justify-between font-mono text-[10px]">
            <span className={m.sender === 'driver' ? 'text-neon-amber' : m.sender === 'admin' ? 'text-neon-ice' : 'text-neon-violet'}>
              {m.sender === 'driver' ? names[m.driver_id ?? ''] ?? 'driver' : m.sender === 'admin' ? `dispatch → ${m.driver_id ? names[m.driver_id] ?? m.driver_id : 'all'}` : 'system'}
            </span>
            <span className="text-slate-600">{ago(m.created_at, ops.now)}</span>
          </div>
          <div className="mt-0.5 text-[12px] text-slate-300">{m.text}</div>
        </li>
      ))}
    </ul>
  );
}

function LayerToggles({ layers, onChange, ops }: { layers: MapLayers; onChange: (l: MapLayers) => void; ops: Ops }) {
  const items: [keyof MapLayers, string, string, string][] = [
    ['routes', 'Vehicle routes', 'coloured by risk', '#22D3EE'],
    ['closures', 'Closed / slowed roads', 'from live hazards', '#FF3B4E'],
    ['clearance', 'Clearance plan', `Kruskal · ${ops.clearance?.edges.length ?? 0} roads, ${(ops.clearance?.hours ?? 0).toFixed(0)} crew-h`, '#34D399'],
    ['places', 'Depots & demand', 'priority colour', '#FBBF24'],
  ];
  return (
    <div className="glass space-y-1 rounded-2xl p-2">
      {items.map(([k, label, hint, tone]) => (
        <button
          key={k}
          onClick={() => onChange({ ...layers, [k]: !layers[k] })}
          className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition hover:bg-white/[0.04]"
        >
          <span className="h-3 w-3 rounded-sm border" style={{ borderColor: tone, background: layers[k] ? tone : 'transparent' }} />
          <span className="min-w-0">
            <span className="block text-[12px] text-slate-200">{label}</span>
            <span className="block truncate font-mono text-[9.5px] text-slate-500">{hint}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

function Pipeline({ p, ops }: { p: (ReturnType<typeof plan> & { ms: number; servedPct: number; dropped: number }) | null; ops: Ops }) {
  if (!p) return <div className="glass skeleton h-40 rounded-2xl" />;
  const loads = p.trips.map((t) => t.stops.reduce((s, x) => s + x.units, 0));
  const rows: [string, string, string][] = [
    ['1 · Kruskal MST', `${ops.clearance?.edges.length ?? 0} roads to clear`, `${(ops.clearance?.hours ?? 0).toFixed(1)} crew-hours`],
    ['2 · Dijkstra', `${(ops.places?.depots.length ?? 0) + (ops.places?.demands.length ?? 0)} sources`, `${ops.graph?.nodes.length.toLocaleString()} nodes`],
    ['3 · Greedy allocation', `${p.bundles.length} bundles`, 'critical → deadline'],
    ['4 · 0/1 knapsack', `${p.trips.length} vehicles loaded`, `avg ${(loads.reduce((s, x) => s + x, 0) / Math.max(1, loads.length)).toFixed(0)}/${CAPACITY} units`],
    ['5 · Subset DP', `${p.dropped} stops dropped`, 'on-time or skipped'],
  ];
  return (
    <div className="glass space-y-2 rounded-2xl p-3">
      {rows.map(([a, b, c]) => (
        <div key={a}>
          <div className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-inferred">{a}</div>
          <div className="flex justify-between font-mono text-[10.5px]">
            <span className="text-slate-200">{b}</span>
            <span className="text-slate-500">{c}</span>
          </div>
        </div>
      ))}
      <div className="border-t border-white/[0.06] pt-2 font-mono text-[10.5px] text-slate-400">
        Re-plan now would serve <span className="text-neon-mint">{p.servedPct.toFixed(0)}%</span> of priority-weighted demand · {p.ms.toFixed(0)} ms in browser
      </div>
      <div className="flex items-center gap-1.5 font-mono text-[9.5px] text-slate-600">
        <Wrench size={10} /> Report: 65.8% vs 47.7% FCFS on random graphs
      </div>
      <button onClick={() => confirm('Restore the seeded scenario for everyone?') && void api.reset().then(ops.refresh)} className="btn-glass w-full justify-center !py-1">
        <RotateCcw size={11} /> Reset scenario
      </button>
      <a href="#/driver" className="btn-glass w-full justify-center !py-1">
        <Navigation size={11} /> Open driver app
      </a>
    </div>
  );
}
