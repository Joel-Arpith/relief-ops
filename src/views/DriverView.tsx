import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Bell, BellOff, Check, CheckCircle2, LocateFixed, MessageSquare, Navigation, Route, ShieldAlert, ShieldCheck, TriangleAlert, X } from 'lucide-react';
import TopBar from '../components/TopBar';
import OpsMap from '../components/OpsMap';
import { DEFAULT_BASEMAP } from '../lib/basemaps';
import { reroute } from '../lib/algo';
import { DEMANDS } from '../lib/places';
import { ago, api, fmtMin, KIND_META, LEVEL, PRIORITY, threatLine, useOps } from '../lib/ops';
import { useIsMobile } from '../lib/useIsMobile';

const LAYERS = { routes: true, closures: true, clearance: false, places: true };
const placeBy = Object.fromEntries(DEMANDS.map((d) => [d.id, d]));
const QUICK = ['Acknowledged', 'Road clear here', 'Stuck — need assistance', 'Delivered'];

function beep() {
  try {
    const ctx = new AudioContext();
    [0, 0.22].forEach((at) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = 880;
      g.gain.setValueAtTime(0.18, ctx.currentTime + at);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + at + 0.18);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + at);
      o.stop(ctx.currentTime + at + 0.2);
    });
  } catch {
    /* audio blocked until the page has had a gesture — the banner still shows */
  }
}

export default function DriverView({ driverId }: { driverId?: string }) {
  const ops = useOps(3000);
  const isMobile = useIsMobile();
  const row = ops.fleet.find((r) => r.driver.id === driverId) ?? null;
  const [follow, setFollow] = useState(true);
  const [preview, setPreview] = useState<ReturnType<typeof reroute> | null>(null);
  const [busy, setBusy] = useState(false);
  const [alert, setAlert] = useState<string | null>(null);
  const [notify, setNotify] = useState(typeof Notification !== 'undefined' && Notification.permission === 'granted');
  const [focus, setFocus] = useState<{ lng: number; lat: number; zoom?: number; t: number } | null>(null);
  const announced = useRef<Set<string> | null>(null);

  // alert once per new hazard on the route, and once per new message from dispatch
  const msgs = useMemo(() => (ops.state?.messages ?? []).filter((m) => m.driver_id === driverId || (m.driver_id === null && m.sender !== 'driver')), [ops.state, driverId]);
  useEffect(() => {
    if (!row) return;
    const keys = [...row.a.threats.filter((t) => t.effect !== 'near').map((t) => `h:${t.hazard.id}`), ...msgs.filter((m) => m.sender === 'admin').map((m) => `m:${m.id}`)];
    if (!announced.current) {
      announced.current = new Set(keys); // what was already true when the app opened is shown, not shouted
      return;
    }
    const fresh = keys.filter((k) => !announced.current!.has(k));
    if (!fresh.length) return;
    fresh.forEach((k) => announced.current!.add(k));
    const t = row.a.threats.find((x) => fresh.includes(`h:${x.hazard.id}`));
    const m = msgs.find((x) => fresh.includes(`m:${x.id}`));
    const text = t ? `${KIND_META[t.hazard.kind].glyph} ${threatLine(t)}` : `Dispatch: ${m?.text}`;
    setAlert(text);
    beep();
    navigator.vibrate?.([300, 120, 300]);
    if (notify && document.visibilityState !== 'visible') new Notification('Relief Operations', { body: text, tag: `ro-${driverId}` });
  }, [row, msgs, notify, driverId]);

  // on a blocked route the safe alternative is computed before the driver asks
  const level = row?.a.level;
  useEffect(() => {
    if (level === 'critical' && !preview) suggest();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [level, row?.driver.updated_at]);

  const suggest = () => {
    if (!row || !ops.graph || !ops.avoid || !ops.places) return;
    const places = Object.fromEntries(ops.places.demands.map((p) => [p.id, p]));
    setPreview(reroute(ops.graph, row.driver, row.a, ops.avoid, places));
  };

  const accept = async () => {
    if (!row || !preview) return;
    setBusy(true);
    try {
      const avoided = row.a.threats.filter((t) => t.effect !== 'near').map((t) => t.hazard.id);
      await api.setTrip(row.driver.id, { path: preview.path, stops: preview.stops });
      await api.ack(row.driver.id, [...new Set([...row.driver.acked, ...avoided])]);
      const dropped = preview.stops.filter((s) => s.idx < 0).map((s) => placeBy[s.place].name);
      await api.message(
        row.driver.id,
        'driver',
        `Took safe route around ${avoided.length || 'no'} hazard(s): ${fmtMin(preview.newMinutes)} remaining${dropped.length ? `; cannot reach ${dropped.join(', ')}` : ''}.`,
      );
      setPreview(null);
      setAlert(null);
      await ops.refresh();
    } finally {
      setBusy(false);
    }
  };

  const ack = async () => {
    if (!row) return;
    await api.ack(row.driver.id, [...new Set([...row.driver.acked, ...row.a.threats.map((t) => t.hazard.id)])]);
    setAlert(null);
    void ops.refresh();
  };

  const enableAlerts = async () => {
    if (typeof Notification === 'undefined') return;
    setNotify((await Notification.requestPermission()) === 'granted');
  };

  if (!driverId || (ops.state && !row)) return <Picker ops={ops} />;

  const a = row?.a;
  const tone = a ? LEVEL[a.level].tone : '#64748B';
  const unacked = a?.threats.filter((t) => t.effect !== 'near' && !row!.driver.acked.includes(t.hazard.id)) ?? [];
  const delta = preview ? preview.newMinutes - preview.oldMinutes : 0;

  const panel = row && a && (
    <div className="space-y-3">
      {/* status hero */}
      <motion.div layout className="glass relative overflow-hidden rounded-2xl p-4" style={{ borderColor: `${tone}55` }}>
        <div className="absolute inset-x-0 top-0 h-[3px]" style={{ background: tone }} />
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="label">{row.driver.vehicle}</div>
            <div className="text-[17px] font-semibold text-slate-50">{row.driver.name}</div>
          </div>
          <div className="grid h-11 w-11 place-items-center rounded-xl border" style={{ borderColor: `${tone}66`, color: tone, background: `${tone}18` }}>
            {a.level === 'critical' ? <ShieldAlert size={20} /> : a.level === 'warning' ? <TriangleAlert size={20} /> : <ShieldCheck size={20} />}
          </div>
        </div>
        <div className="mt-3 text-[20px] font-semibold leading-tight" style={{ color: tone }}>
          {a.halted ? 'Stop — road ahead closed' : a.done ? 'Trip complete' : !row.driver.stops.length ? 'Standby at depot' : LEVEL[a.level].label}
        </div>
        <div className="mt-1 font-mono text-[11px] text-slate-400">
          {a.threats[0] ? threatLine(a.threats.find((t) => t.effect === 'closed' && !t.forecast) ?? a.threats[0]) : row.driver.stops.length ? 'No hazards on your remaining route.' : 'No load assigned. Dispatch may reassign you.'}
        </div>
        {!a.done && row.driver.stops.length > 0 && (
          <div className="mt-3 grid grid-cols-3 gap-2 font-mono">
            {[
              ['Trip clock', fmtMin(a.clock)],
              ['To go', `${a.remainingKm.toFixed(1)} km`],
              ['Next stop', fmtMin((a.eta.find((e) => !e.served)?.minutes ?? NaN) - a.clock)],
            ].map(([l, v]) => (
              <div key={l} className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-2 py-1.5">
                <div className="text-[9px] uppercase tracking-[0.14em] text-slate-500">{l}</div>
                <div className="text-[13px] text-slate-100">{v}</div>
              </div>
            ))}
          </div>
        )}
        {row.driver.stops.length > 0 && !a.done && (
          <button onClick={suggest} className="btn-glass mt-3 w-full justify-center !py-2" data-active={a.level !== 'clear'}>
            <Route size={13} /> Find a safer route
          </button>
        )}
      </motion.div>

      {/* reroute proposal */}
      <AnimatePresence>
        {preview && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }} className="glass rounded-2xl p-4" style={{ borderColor: '#22D3EE55' }}>
            <div className="label text-neon-cyan">Safe route · Dijkstra + subset DP</div>
            <div className="mt-1.5 text-[14px] text-slate-100">
              {Number.isFinite(preview.newMinutes) ? (
                <>
                  {fmtMin(preview.newMinutes)} remaining{' '}
                  <span className="font-mono text-[12px]" style={{ color: !Number.isFinite(preview.oldMinutes) ? '#34D399' : delta > 0 ? '#FBBF24' : '#34D399' }}>
                    {!Number.isFinite(preview.oldMinutes) ? '(current route is impassable)' : `(${delta >= 0 ? '+' : ''}${delta.toFixed(0)} min vs current)`}
                  </span>
                </>
              ) : (
                'No open road reaches your remaining stops — hold position and contact dispatch.'
              )}
            </div>
            <div className="mt-1 font-mono text-[10.5px] text-slate-500">Avoids every closed and forecast-closed road. Dashed cyan on the map.</div>
            {preview.stops.some((s) => s.idx < 0) && (
              <div className="mt-1.5 font-mono text-[10.5px] text-neon-crimson">
                Unreachable: {preview.stops.filter((s) => s.idx < 0).map((s) => placeBy[s.place].name).join(', ')}
              </div>
            )}
            <div className="mt-3 flex gap-2">
              <button onClick={accept} disabled={busy || !Number.isFinite(preview.newMinutes)} className="btn-glass flex-1 justify-center !border-neon-cyan/45 !bg-neon-cyan/15 !py-2 !text-cyan-100">
                <Check size={13} /> {busy ? 'Saving…' : 'Take this route'}
              </button>
              <button onClick={() => setPreview(null)} className="btn-glass justify-center !py-2">
                <X size={13} /> Keep mine
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* hazards */}
      {a.threats.length > 0 && (
        <section className="glass rounded-2xl p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="label">Hazards on your route</span>
            {unacked.length > 0 && (
              <button onClick={ack} className="btn-glass !py-1 !text-[10px]">
                <CheckCircle2 size={11} /> Acknowledge
              </button>
            )}
          </div>
          <ul className="space-y-1.5">
            {a.threats.map((t) => (
              <li key={t.hazard.id} className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-2">
                <div className="text-[12.5px]" style={{ color: t.effect === 'closed' ? '#FF8A95' : t.effect === 'slowed' ? '#FCD34D' : '#94A3B8' }}>
                  {KIND_META[t.hazard.kind].glyph} {threatLine(t)}
                </div>
                <div className="mt-0.5 flex justify-between font-mono text-[10px] text-slate-500">
                  <span className="truncate">{t.hazard.note || KIND_META[t.hazard.kind].label}</span>
                  <button onClick={() => setFocus({ lng: t.hazard.lon, lat: t.hazard.lat, zoom: 14.5, t: Date.now() })} className="ml-2 shrink-0 text-neon-ice">
                    show
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* stops */}
      {row.driver.stops.length > 0 && (
        <section className="glass rounded-2xl p-3">
          <div className="label mb-2">Your deliveries</div>
          <ol className="space-y-1.5">
            {row.driver.stops.map((s, i) => {
              const p = placeBy[s.place];
              const e = a.eta.find((x) => x.stop.place === s.place && x.stop.idx === s.idx);
              return (
                <li key={`${s.place}-${s.idx}`} className="flex items-center gap-2.5 rounded-lg px-1 py-1">
                  <span
                    className="grid h-6 w-6 shrink-0 place-items-center rounded-full border font-mono text-[10px]"
                    style={{ borderColor: PRIORITY[p.priority].tone, color: e?.served ? '#04060B' : PRIORITY[p.priority].tone, background: e?.served ? PRIORITY[p.priority].tone : 'transparent' }}
                  >
                    {e?.served ? <Check size={11} /> : i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className={`truncate text-[12.5px] ${s.idx < 0 ? 'text-slate-500 line-through' : 'text-slate-200'}`}>{p.name}</div>
                    <div className="font-mono text-[10px] text-slate-500">
                      {s.mix.water} water · {s.mix.food} food · {s.mix.medical} medical
                    </div>
                  </div>
                  <div className="text-right font-mono text-[10.5px]">
                    {s.idx < 0 ? (
                      <span className="text-neon-crimson">unreachable</span>
                    ) : e?.served ? (
                      <span className="text-neon-mint">done</span>
                    ) : (
                      <>
                        <div className={e?.late ? 'text-neon-ember' : 'text-slate-200'}>{fmtMin((e?.minutes ?? NaN) - a.clock)}</div>
                        <div className="text-slate-600">due {p.deadline}m</div>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      )}

      {/* dispatch */}
      <section className="glass rounded-2xl p-3">
        <div className="label mb-2 flex items-center gap-1.5">
          <MessageSquare size={11} /> Dispatch
        </div>
        <div className="flex flex-wrap gap-1.5">
          {QUICK.map((q) => (
            <button key={q} onClick={() => void api.message(row.driver.id, 'driver', q).then(ops.refresh)} className="btn-glass !px-2 !py-1 !text-[10px] !normal-case !tracking-normal">
              {q}
            </button>
          ))}
        </div>
        <ul className="mt-2.5 space-y-1.5">
          {msgs.slice(0, 8).map((m) => (
            <li key={m.id} className="font-mono text-[10.5px]">
              <span className={m.sender === 'driver' ? 'text-neon-amber' : m.sender === 'admin' ? 'text-neon-ice' : 'text-neon-violet'}>
                {m.sender === 'driver' ? 'you' : m.sender === 'admin' ? 'dispatch' : 'system'}
              </span>
              <span className="text-slate-600"> · {ago(m.created_at, ops.now)}</span>
              <div className="text-[11.5px] text-slate-300">{m.text}</div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );

  return (
    <div className={`relative flex w-screen flex-col ${isMobile ? 'min-h-[100dvh]' : 'h-screen overflow-hidden'}`}>
      <TopBar ops={ops} view="driver">
        <button onClick={enableAlerts} className="btn-glass !py-1.5" data-active={notify} title="Phone notifications when a hazard hits your route">
          {notify ? <Bell size={12} /> : <BellOff size={12} />} {notify ? 'Alerts on' : 'Enable alerts'}
        </button>
      </TopBar>

      <AnimatePresence>
        {alert && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="relative z-20 flex items-center gap-3 border-b border-neon-crimson/40 bg-neon-crimson/15 px-4 py-2.5 backdrop-blur-xl"
            role="alert"
          >
            <TriangleAlert size={16} className="shrink-0 animate-breathe text-neon-crimson" />
            <span className="flex-1 text-[13px] font-medium text-rose-100">{alert}</span>
            <button onClick={ack} className="btn-glass !py-1">
              <Check size={12} /> OK
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <main className={`relative z-10 flex min-h-0 flex-1 ${isMobile ? 'flex-col' : ''}`}>
        <section className={`relative min-w-0 flex-1 ${isMobile ? 'h-[52dvh] flex-none' : ''}`}>
          <OpsMap
            ops={ops}
            basemap={DEFAULT_BASEMAP}
            layers={LAYERS}
            rows={row ? [row] : []}
            selectedId={driverId}
            preview={preview?.path.slice(Math.max(0, (a?.at ?? 0)))}
            follow={follow}
            focus={focus}
          />
          <div className="absolute bottom-10 right-12 z-10 flex flex-col gap-1.5">
            <button onClick={() => setFollow((v) => !v)} data-active={follow} className="btn-glass glass !p-2" title="Follow my vehicle" aria-label="Follow my vehicle">
              <LocateFixed size={14} />
            </button>
          </div>
          {!ops.graph && <div className="absolute inset-0 grid place-items-center font-mono text-[11px] text-slate-400">Loading OSM road graph…</div>}
        </section>
        <aside className={`scroll-thin glass-quiet min-h-0 overflow-y-auto p-3 ${isMobile ? 'border-t border-white/[0.07]' : 'w-[420px] border-l border-white/[0.07]'}`}>
          {panel ?? <div className="skeleton h-48 rounded-2xl" />}
        </aside>
      </main>
    </div>
  );
}

function Picker({ ops }: { ops: ReturnType<typeof useOps> }) {
  return (
    <div className="relative flex min-h-[100dvh] w-screen flex-col">
      <TopBar ops={ops} view="driver" />
      <main className="relative z-10 mx-auto w-full max-w-[560px] flex-1 p-4">
        <h1 className="mt-4 text-[22px] font-semibold text-slate-50">Who is driving?</h1>
        <p className="mt-1 font-mono text-[11px] text-slate-500">Pick your vehicle. Your route, hazards and dispatch messages follow you on this device.</p>
        <div className="mt-4 space-y-2">
          {!ops.fleet.length && <div className="skeleton h-40 rounded-xl" />}
          {ops.fleet.map(({ driver, a }) => (
            <a key={driver.id} href={`#/driver/${driver.id}`} className="glass flex items-center gap-3 rounded-xl p-3 transition hover:border-white/20">
              <span className="grid h-9 w-9 place-items-center rounded-lg border" style={{ borderColor: `${LEVEL[a.level].tone}55`, color: LEVEL[a.level].tone }}>
                <Navigation size={15} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[14px] text-slate-100">{driver.name}</span>
                <span className="block font-mono text-[10px] text-slate-500">
                  {driver.vehicle} · {driver.stops.length ? `${driver.stops.length} stops` : 'standby'}
                </span>
              </span>
              <span className="chip" style={{ borderColor: `${LEVEL[a.level].tone}55`, color: LEVEL[a.level].tone }}>
                {LEVEL[a.level].label}
              </span>
            </a>
          ))}
        </div>
      </main>
    </div>
  );
}
