// Separates persisted wall time, workspace logical time, and latency measurement.
export type Workspace = 'live' | 'lab';
export interface WallClock { nowIso(): string }
export interface Monotonic { ms(): number }
export interface LabAnchor { logical_anchor: string | null; real_anchor: string | null; epoch: number }
export interface LabStore {
  labAnchor(): LabAnchor;
  setLabStart(target: string, realNow: string): void;
  advanceLab(target: string, realNow: string, logicalNow: string): void;
  resetLab(realNow: string): void;
}
export const wallClock: WallClock = { nowIso: () => new Date().toISOString() };
export const monotonic: Monotonic = { ms: () => performance.now() };

export class LogicalClock {
  private readonly store: LabStore;
  private readonly wall: WallClock;
  constructor(store: LabStore, wall: WallClock) {
    this.store = store;
    this.wall = wall;
  }

  now(workspace: Workspace, realNow = this.wall.nowIso()): Date {
    if (workspace === 'live') return new Date(realNow);
    const anchor = this.store.labAnchor();
    if (!anchor.logical_anchor || !anchor.real_anchor) return new Date(realNow);
    return new Date(Date.parse(anchor.logical_anchor) + Date.parse(realNow) - Date.parse(anchor.real_anchor));
  }

  setStart(target: Date) {
    this.store.setLabStart(target.toISOString(), this.wall.nowIso());
  }

  advance(target: Date) {
    const realNow = this.wall.nowIso();
    this.store.advanceLab(target.toISOString(), realNow, this.now('lab', realNow).toISOString());
  }

  reset() {
    this.store.resetLab(this.wall.nowIso());
  }
}

export function localDate(date: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  return ['year', 'month', 'day'].map((kind) => parts.find((part) => part.type === kind)?.value).join('-');
}
