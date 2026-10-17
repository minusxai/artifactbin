/** Declarative geometry shared by publish validation and the figure renderer. */
export type IsoPoint = [number, number, number];
export type IsoPlanPoint = [number, number];
export type IsoTone = 'neutral' | 'accent' | 'secondary' | 'muted';
type Orientation = { axis: IsoPoint; origin?: IsoPoint; degrees: number };
type Shape = { key: string; tone?: IsoTone; orientation?: Orientation; repeat?: { count: number; step?: IsoPoint; rotation?: Orientation } };
export type IsometricShape = Shape & (
  | { kind: 'slab'; x: number; y: number; z: number; width: number; depth: number; height: number; radius?: number }
  | { kind: 'cylinder'; x: number; y: number; z: number; radius: number; height: number }
  | { kind: 'prism'; points: IsoPlanPoint[]; z: number; height: number; section?: boolean }
  | { kind: 'revolve'; origin: IsoPoint; profile: IsoPlanPoint[]; axis?: IsoPoint; segments?: number }
  | { kind: 'sweep'; points: IsoPoint[]; radius: number; curve?: 'bezier'; segments?: number; steps?: number }
  | { kind: 'line'; points: IsoPoint[]; dashed?: boolean; curve?: 'bezier'; arrow?: boolean; width?: number; opacity?: number }
);
export type IsometricPart = (IsometricShape | (Shape & { kind: 'group'; parts: IsometricShape[] })) & { separation?: IsoPoint; rotation?: { axis: IsoPoint; origin: IsoPoint; range?: IsoPlanPoint } };
export type IsometricSpec = { parts: IsometricPart[]; title: string; width?: number; height?: number; azimuth?: number; elevation?: number; spread?: number | string; appearance?: 'outline' | 'solid'; motion?: 'smooth' | 'instant'; angle?: number | string; flow?: boolean | string };

/** Static geometry is validated once at publish; only spread, angle and flow may be reactive. */
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 1e6;
const positive = (v: unknown) => finite(v) && v > 0;
const point = (v: unknown, size: number): v is number[] => Array.isArray(v) && v.length === size && v.every(finite);
export function isometricError(p: Record<string, unknown>): string | null {
  const fail = (why: string) => `Isometric ${why}.`;
  if (typeof p.title !== 'string' || !p.title.trim() || p.title.length > 500) return fail('requires a short, nonempty title');
  if (!Array.isArray(p.parts) || !p.parts.length || p.parts.length > 300) return fail('requires 1–300 static parts');
  for (const key of ['width', 'height']) if (p[key] !== undefined && (!positive(p[key]) || Number(p[key]) > 4096)) return fail(`${key} must be between 0 and 4096`);
  if (p.azimuth !== undefined && (!finite(p.azimuth) || p.azimuth < 0 || p.azimuth > 360)) return fail('azimuth must be between 0 and 360 degrees');
  if (p.elevation !== undefined && (!finite(p.elevation) || p.elevation < 5 || p.elevation > 85)) return fail('elevation must be between 5 and 85 degrees');
  if (p.spread !== undefined && !(typeof p.spread === 'string' && /^\$[A-Za-z_]\w*$/.test(p.spread)) && (!finite(p.spread) || p.spread < 0 || p.spread > 1)) return fail('spread must be 0–1 or a "$name" Value binding');
  if (p.appearance !== undefined && !['outline', 'solid'].includes(String(p.appearance))) return fail('appearance must be outline or solid');
  if (p.motion !== undefined && !['smooth', 'instant'].includes(String(p.motion))) return fail('motion must be smooth or instant');
  const binding = (v: unknown) => typeof v === 'string' && /^\$[A-Za-z_]\w*$/.test(v);
  if (p.angle !== undefined && !binding(p.angle) && (!finite(p.angle) || Math.abs(p.angle) > 180)) return fail('angle must be −180–180 degrees or a Value binding');
  if (p.flow !== undefined && !binding(p.flow) && typeof p.flow !== 'boolean') return fail('flow must be boolean or a Value binding');
  const axis = (v: unknown) => point(v, 3) && Math.hypot(...v as IsoPoint) > 1e-8;
  const orientation = (o: unknown) => record(o) && axis(o.axis) && finite(o.degrees) && (o.origin === undefined || point(o.origin, 3));
  const keys = new Set();
  let surfaces = 0;
  const parts: unknown[] = [];
  for (const part of p.parts) {
    parts.push(part);
    if (record(part) && part.kind === 'group') {
      if (!Array.isArray(part.parts) || !part.parts.length) return fail('groups need shapes');
      for (const child of part.parts) {
        if (!record(child) || child.kind === 'group' || child.separation !== undefined || child.rotation !== undefined) return fail('group children must be shapes without their own separation');
        parts.push(child);
      }
    }
  }
  if (parts.length > 300) return fail('requires at most 300 parts including group children');
  for (const part of parts) {
    if (!record(part) || typeof part.key !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(part.key) || keys.has(part.key)) return fail('parts need unique short keys');
    keys.add(part.key);
    if (part.tone !== undefined && !['neutral', 'accent', 'secondary', 'muted'].includes(String(part.tone))) return fail('part tone must be neutral, accent, secondary or muted');
    if (part.separation !== undefined && !point(part.separation, 3)) return fail('separation must be three finite coordinates');
    if (part.rotation !== undefined) {
      const r = part.rotation;
      if (!record(r) || !axis(r.axis) || !point(r.origin, 3)) return fail('rotation needs a nonzero axis and an origin');
      if (r.range !== undefined && (!point(r.range, 2) || r.range[0] < -180 || r.range[1] > 180 || r.range[0] >= r.range[1])) return fail('rotation range must increase within −180–180 degrees');
    }
    if (part.orientation !== undefined) {
      const o = part.orientation;
      if (!orientation(o)) return fail('orientation needs a nonzero axis and finite degrees/origin');
    }
    let copies = 1;
    if (part.repeat !== undefined) {
      const r = part.repeat;
      if (!record(r) || !Number.isInteger(r.count) || Number(r.count) < 1 || Number(r.count) > 64 || (r.step !== undefined && !point(r.step, 3)) || (r.rotation !== undefined && !orientation(r.rotation)) || (r.step === undefined && r.rotation === undefined)) return fail('repeat needs count 1–64 and a step or rotation');
      copies = Number(r.count);
    }
    if (part.kind === 'group') {
      if (part.orientation !== undefined || part.repeat !== undefined) return fail('orientation and repeat belong on group children');
      continue;
    }
    if (part.kind === 'revolve' || part.kind === 'sweep') {
      const segments = part.segments ?? (part.kind === 'revolve' ? 32 : 12);
      if (!Number.isInteger(segments) || Number(segments) < 8 || Number(segments) > 64) return fail('segments must be an integer from 8 to 64');
      if (part.kind === 'revolve') {
        if (!point(part.origin, 3)) return fail('revolve origin must be three finite coordinates');
        if (part.axis !== undefined && (!point(part.axis, 3) || Math.hypot(...part.axis as IsoPoint) < 1e-8)) return fail('revolve axis must be a nonzero vector');
        if (!Array.isArray(part.profile) || part.profile.length < 2 || part.profile.length > 128 || !part.profile.every(p => point(p, 2) && p[0] >= 0) || !part.profile.some(p => p[0] > 0)) return fail('revolve needs 2–128 radius/height pairs with nonnegative radii and positive width');
        surfaces += (part.profile.length - 1) * Number(segments) * copies;
      } else {
        if (!positive(part.radius) || !Array.isArray(part.points) || part.points.length < 2 || part.points.length > 128 || !part.points.every(p => point(p, 3))) return fail('sweeps need a positive radius and 2–128 three-dimensional points');
        const points = part.points as IsoPoint[];
        if (points.some((p, i) => i > 0 && p.every((n, k) => n === points[i - 1]![k]))) return fail('sweep points must not repeat consecutively');
        if (part.curve !== undefined && (part.curve !== 'bezier' || part.points.length !== 4)) return fail('a bezier sweep needs exactly four control points');
        const steps = part.steps ?? 24;
        if (!Number.isInteger(steps) || Number(steps) < 2 || Number(steps) > 128 || (part.steps !== undefined && !part.curve)) return fail('steps must be an integer from 2 to 128 on a bezier sweep');
        surfaces += ((part.curve ? Number(steps) : part.points.length - 1) * Number(segments) + 2) * copies;
      }
      if (surfaces > 20000) return fail('surface budget exceeds 20,000 faces');
      continue;
    }
    if (part.kind === 'line') {
      if (!Array.isArray(part.points) || part.points.length < 2 || part.points.length > 256 || !part.points.every(p => point(p, 3))) return fail('lines need 2–256 three-dimensional points');
      if (part.curve !== undefined && (part.curve !== 'bezier' || part.points.length !== 4)) return fail('a bezier line needs four control points');
      if (part.width !== undefined && (!positive(part.width) || Number(part.width) > 6)) return fail('line width must be positive and at most 6');
      if (part.opacity !== undefined && (!finite(part.opacity) || part.opacity < 0 || part.opacity > 1)) return fail('line opacity must be 0–1');
      if (part.arrow !== undefined && typeof part.arrow !== 'boolean') return fail('arrow must be boolean');
      surfaces += (part.curve ? 32 : part.points.length) * copies;
      if (surfaces > 20000) return fail('surface budget exceeds 20,000 faces');
      if (part.dashed !== undefined && typeof part.dashed !== 'boolean') return fail('dashed must be boolean');
      continue;
    }
    surfaces += (part.kind === 'prism' && Array.isArray(part.points) ? part.points.length + 2 : 50) * copies;
    if (surfaces > 20000) return fail('surface budget exceeds 20,000 faces');
    if (!finite(part.z) || !positive(part.height)) return fail('solids need finite z and positive height');
    if (part.kind === 'prism') {
      if (part.section !== undefined && typeof part.section !== 'boolean') return fail('prism section must be boolean');
      if (!Array.isArray(part.points) || part.points.length < 3 || part.points.length > 256 || !part.points.every(p => point(p, 2))) return fail('prisms need 3–256 two-dimensional outline points');
      const points = part.points as IsoPlanPoint[];
      const area = points.reduce((a, [x, y], i) => { const next = points[(i + 1) % points.length]!; return a + x * next[1] - next[0] * y; }, 0);
      if (Math.abs(area) < 1e-8) return fail('prism outline must enclose an area');
      continue;
    }
    if (!finite(part.x) || !finite(part.y)) return fail('solids need finite x and y');
    if (part.kind === 'slab') {
      if (!positive(part.width) || !positive(part.depth) || (part.radius !== undefined && (!finite(part.radius) || part.radius < 0))) return fail('slabs need positive width/depth and a nonnegative corner radius');
    } else if (part.kind === 'cylinder') {
      if (!positive(part.radius)) return fail('cylinders need a positive radius');
    } else return fail('part kind must be slab, cylinder, prism, revolve, sweep, group or line');
  }
  return null;
}
