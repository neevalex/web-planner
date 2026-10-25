// Shared RC helpers: channel roles, function names, normalisation.
import type { Ctx } from './kit';

export interface StickMap { roll: number; pitch: number; throttle: number; yaw: number }

export function stickMap(ctx: Ctx): StickMap {
  const v = (n: string, d: number) => Math.round(ctx.value(n) ?? d);
  return { roll: v('RCMAP_ROLL', 1), pitch: v('RCMAP_PITCH', 2), throttle: v('RCMAP_THROTTLE', 3), yaw: v('RCMAP_YAW', 4) };
}

export function roleOf(map: StickMap, ch: number): string | null {
  if (ch === map.roll) return 'Roll';
  if (ch === map.pitch) return 'Pitch';
  if (ch === map.throttle) return 'Throttle';
  if (ch === map.yaw) return 'Yaw';
  return null;
}

/** The documented list of RCx_OPTION functions for this firmware. */
export function rcOptions(ctx: Ctx): Record<string, string> {
  return ctx.m('RC5_OPTION')?.v ?? ctx.m('RC1_OPTION')?.v ?? { 0: 'Do Nothing' };
}

export function optionName(ctx: Ctx, value: number): string {
  return rcOptions(ctx)[String(value)] ?? `Function ${value}`;
}

export interface ChanRange { min: number; max: number; trim: number; rev: boolean }

export function chanRange(ctx: Ctx, ch: number): ChanRange {
  return {
    min: ctx.value(`RC${ch}_MIN`) ?? 1100,
    max: ctx.value(`RC${ch}_MAX`) ?? 1900,
    trim: ctx.value(`RC${ch}_TRIM`) ?? 1500,
    rev: (ctx.value(`RC${ch}_REVERSED`) ?? 0) !== 0,
  };
}

/** -1..1 around trim (0..1 for throttle-like), clamped. */
export function normalize(pwm: number, r: ChanRange, fromMin = false): number {
  if (!pwm) return fromMin ? 0 : 0;
  let x: number;
  if (fromMin) x = (pwm - r.min) / Math.max(1, r.max - r.min);
  else x = pwm >= r.trim ? (pwm - r.trim) / Math.max(1, r.max - r.trim) : (pwm - r.trim) / Math.max(1, r.trim - r.min);
  if (r.rev) x = fromMin ? 1 - x : -x;
  return Math.max(fromMin ? 0 : -1, Math.min(1, x));
}

/** Three-position switch reading as ArduPilot does for aux functions. */
export function switchPos(pwm: number): 'low' | 'mid' | 'high' | null {
  if (!pwm) return null;
  return pwm < 1200 ? 'low' : pwm > 1800 ? 'high' : 'mid';
}
