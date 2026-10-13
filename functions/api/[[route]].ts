/**
 * Relief-ops backend: Cloudflare Pages Function over D1. Holds the shared truth both views
 * poll — hazards, driver trips, and the message feed. Routing runs in the browser (the graph
 * is a static asset); this layer validates and persists.
 *
 *   GET    /api/state                 everything, one round trip
 *   POST   /api/hazards               admin reports a hazard
 *   DELETE /api/hazards/:id           admin clears it
 *   PUT    /api/drivers/:id           new trip (reroute keeps the clock; restart:true redispatches)
 *   POST   /api/drivers/:id/ack       driver acknowledged these hazards
 *   POST   /api/messages              admin ↔ driver notes, plus system events
 *   POST   /api/reset                 restore the seeded scenario
 */
import seed from '../seed.json';

interface Env {
  DB: D1Database;
}

const KINDS = ['flood', 'fire', 'collapse', 'landslide', 'cyclone', 'chemical'];
const BBOX = { s: 17.25, n: 17.58, w: 78.28, e: 78.66 }; // the routed graph, with margin

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS hazards (id TEXT PRIMARY KEY, kind TEXT NOT NULL, lat REAL NOT NULL, lon REAL NOT NULL,
     radius_m INTEGER NOT NULL, severity INTEGER NOT NULL, starts_at INTEGER NOT NULL, note TEXT NOT NULL, created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS drivers (id TEXT PRIMARY KEY, name TEXT NOT NULL, vehicle TEXT NOT NULL, depot TEXT NOT NULL,
     path TEXT NOT NULL, stops TEXT NOT NULL, started_at INTEGER NOT NULL, acked TEXT NOT NULL DEFAULT '[]', updated_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, driver_id TEXT, sender TEXT NOT NULL,
     text TEXT NOT NULL, created_at INTEGER NOT NULL)`,
];

let ready = false; // per isolate: schema + seed checked once

async function ensure(db: D1Database) {
  if (ready) return;
  await db.batch(SCHEMA.map((s) => db.prepare(s)));
  const row = await db.prepare('SELECT COUNT(*) AS n FROM drivers').first<{ n: number }>();
  if (!row?.n) await reseed(db);
  ready = true;
}

async function reseed(db: D1Database) {
  const now = Date.now();
  await db.batch([
    db.prepare('DELETE FROM hazards'),
    db.prepare('DELETE FROM drivers'),
    db.prepare('DELETE FROM messages'),
    ...seed.hazards.map((h) =>
      db
        .prepare('INSERT INTO hazards VALUES (?,?,?,?,?,?,?,?,?)')
        .bind(h.id, h.kind, h.lat, h.lon, h.radius_m, h.severity, now + h.starts_in * 60000, h.note, now),
    ),
    ...seed.drivers.map((d) =>
      db
        .prepare('INSERT INTO drivers VALUES (?,?,?,?,?,?,?,?,?)')
        .bind(d.id, d.name, d.vehicle, d.depot, JSON.stringify(d.path), JSON.stringify(d.stops), now, '[]', now),
    ),
    db.prepare('INSERT INTO messages (driver_id, sender, text, created_at) VALUES (NULL, ?, ?, ?)').bind(
      'system',
      'Dispatch plan issued: Kruskal clearance → Dijkstra → greedy allocation → knapsack loading → subset-DP routing.',
      now,
    ),
  ]);
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

class Bad extends Error {}
const need = (ok: unknown, msg: string) => {
  if (!ok) throw new Bad(msg);
};
const int = (v: unknown, lo: number, hi: number) => Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi;
const str = (v: unknown, max: number) => typeof v === 'string' && v.length <= max;

function checkTrip(b: any) {
  need(Array.isArray(b.path) && b.path.length >= 1 && b.path.length <= 5000, 'path must be 1–5000 node ids');
  need(b.path.every((n: unknown) => int(n, 0, 200000)), 'path holds node ids');
  need(Array.isArray(b.stops) && b.stops.length <= 30, 'stops must be ≤ 30');
  for (const s of b.stops) {
    need(str(s.place, 40) && int(s.units, 0, 1000) && int(s.idx, -1, 5000), 'bad stop');
    need(['water', 'food', 'medical'].every((c) => int(s.mix?.[c], 0, 1000)), 'bad stop mix');
  }
  return {
    path: JSON.stringify(b.path),
    stops: JSON.stringify(b.stops.map((s: any) => ({ place: s.place, units: s.units, idx: s.idx, mix: { water: s.mix.water, food: s.mix.food, medical: s.mix.medical } }))),
  };
}

export const onRequest: PagesFunction<Env> = async ({ request, env, params }) => {
  const db = env.DB;
  const parts = (params.route as string[] | undefined) ?? [];
  const route = `${request.method} /${parts.map((p, i) => (i === 1 ? ':id' : p)).join('/')}`;
  const id = parts[1];
  try {
    await ensure(db);
    const body: any = ['POST', 'PUT'].includes(request.method) ? await request.json().catch(() => ({})) : null;
    const now = Date.now();

    switch (route) {
      case 'GET /state': {
        const [h, d, m] = await db.batch([
          db.prepare('SELECT * FROM hazards ORDER BY created_at'),
          db.prepare('SELECT * FROM drivers ORDER BY id'),
          db.prepare('SELECT * FROM messages ORDER BY id DESC LIMIT 80'),
        ]);
        return json({
          now,
          hazards: h.results,
          drivers: (d.results as any[]).map((r) => ({ ...r, path: JSON.parse(r.path), stops: JSON.parse(r.stops), acked: JSON.parse(r.acked) })),
          messages: m.results,
        });
      }

      case 'POST /hazards': {
        need(KINDS.includes(body.kind), `kind must be one of ${KINDS.join(', ')}`);
        need(typeof body.lat === 'number' && body.lat > BBOX.s && body.lat < BBOX.n, 'lat outside the operating area');
        need(typeof body.lon === 'number' && body.lon > BBOX.w && body.lon < BBOX.e, 'lon outside the operating area');
        need(int(body.radius_m, 50, 5000) && int(body.severity, 1, 3), 'radius 50–5000 m, severity 1–3');
        need(body.starts_in === undefined || int(body.starts_in, 0, 1440), 'starts_in 0–1440 minutes');
        need(str(body.note ?? '', 200), 'note ≤ 200 chars');
        const count = await db.prepare('SELECT COUNT(*) AS n FROM hazards').first<{ n: number }>();
        need((count?.n ?? 0) < 60, 'hazard limit reached — clear some first');
        const hid = `hz-${crypto.randomUUID().slice(0, 8)}`;
        const starts = now + (body.starts_in ?? 0) * 60000;
        await db.batch([
          db.prepare('INSERT INTO hazards VALUES (?,?,?,?,?,?,?,?,?)').bind(hid, body.kind, body.lat, body.lon, body.radius_m, body.severity, starts, body.note ?? '', now),
          db.prepare('INSERT INTO messages (driver_id, sender, text, created_at) VALUES (NULL, ?, ?, ?)').bind(
            'system',
            `${body.starts_in ? 'Forecast' : 'New'} ${body.kind} hazard (severity ${body.severity}, ${body.radius_m} m)${body.note ? ` — ${body.note}` : ''}`,
            now,
          ),
        ]);
        return json({ id: hid }, 201);
      }

      case 'DELETE /hazards/:id': {
        const r = await db.prepare('DELETE FROM hazards WHERE id = ?').bind(id).run();
        need(r.meta.changes, 'no such hazard');
        await db.prepare('INSERT INTO messages (driver_id, sender, text, created_at) VALUES (NULL, ?, ?, ?)').bind('system', `Hazard ${id} cleared`, now).run();
        return json({ ok: true });
      }

      case 'PUT /drivers/:id': {
        const t = checkTrip(body);
        const sql = body.restart
          ? 'UPDATE drivers SET path = ?, stops = ?, started_at = ?, acked = \'[]\', updated_at = ? WHERE id = ?'
          : 'UPDATE drivers SET path = ?, stops = ?, updated_at = ? WHERE id = ?';
        const args = body.restart ? [t.path, t.stops, now, now, id] : [t.path, t.stops, now, id];
        const r = await db.prepare(sql).bind(...args).run();
        need(r.meta.changes, 'no such driver');
        return json({ ok: true });
      }

      case 'POST /drivers/:id/ack': {
        need(Array.isArray(body.hazard_ids) && body.hazard_ids.length <= 60 && body.hazard_ids.every((h: unknown) => str(h, 40)), 'hazard_ids');
        const r = await db.prepare('UPDATE drivers SET acked = ?, updated_at = ? WHERE id = ?').bind(JSON.stringify(body.hazard_ids), now, id).run();
        need(r.meta.changes, 'no such driver');
        return json({ ok: true });
      }

      case 'POST /messages': {
        need(['admin', 'driver', 'system'].includes(body.sender), 'sender');
        need(body.driver_id === null || str(body.driver_id, 20), 'driver_id');
        need(str(body.text, 280) && body.text.trim(), 'text 1–280 chars');
        await db
          .prepare('INSERT INTO messages (driver_id, sender, text, created_at) VALUES (?, ?, ?, ?)')
          .bind(body.driver_id, body.sender, body.text.trim(), now)
          .run();
        await db.prepare('DELETE FROM messages WHERE id <= (SELECT MAX(id) - 500 FROM messages)').run();
        return json({ ok: true }, 201);
      }

      case 'POST /reset':
        await reseed(db);
        return json({ ok: true });

      default:
        return json({ error: `no route ${route}` }, 404);
    }
  } catch (e) {
    if (e instanceof Bad) return json({ error: e.message }, 400);
    return json({ error: 'server error', detail: String(e) }, 500);
  }
};
