/**
 * Pakistan Standard Time (PKT) — UTC+5, no Daylight Saving Time.
 *
 * All date calculations that involve "today", "yesterday", "this month", etc.
 * must use PKT boundaries so that filters and analytics match what the
 * Pakistan-based team sees on the wall clock.
 *
 * Usage:
 *   import { startOfDayPKT, endOfDayPKT, formatPKT, nowPKT } from "@/lib/timezone";
 */

import {
  toZonedTime,
  fromZonedTime,
  format as formatTZ,
} from "date-fns-tz";
import {
  startOfDay,
  endOfDay,
  startOfMonth,
  endOfMonth,
  subDays,
  subMonths,
  eachDayOfInterval,
  format,
} from "date-fns";

export const PKT = "Asia/Karachi";

// ── Converters ────────────────────────────────────────────────────────────────

/** Current moment (same instant, works in any host timezone). */
export function nowPKT(): Date {
  return new Date();
}

/** Convert a UTC Date to its PKT "wall-clock" representation. */
export function toPKT(date: Date): Date {
  return toZonedTime(date, PKT);
}

/** Convert a PKT wall-clock Date back to UTC. */
export function fromPKT(date: Date): Date {
  return fromZonedTime(date, PKT);
}

// ── Day / month boundaries in PKT ─────────────────────────────────────────────

export function startOfDayPKT(date: Date): Date {
  return fromZonedTime(startOfDay(toZonedTime(date, PKT)), PKT);
}

export function endOfDayPKT(date: Date): Date {
  return fromZonedTime(endOfDay(toZonedTime(date, PKT)), PKT);
}

export function startOfMonthPKT(date: Date): Date {
  return fromZonedTime(startOfMonth(toZonedTime(date, PKT)), PKT);
}

export function endOfMonthPKT(date: Date): Date {
  return fromZonedTime(endOfMonth(toZonedTime(date, PKT)), PKT);
}

export function subDaysPKT(date: Date, amount: number): Date {
  return subDays(toZonedTime(date, PKT), amount);
}

export function subMonthsPKT(date: Date, amount: number): Date {
  return subMonths(toZonedTime(date, PKT), amount);
}

/** Each calendar day in [start, end] expressed as PKT wall-clock dates. */
export function eachDayOfIntervalPKT(start: Date, end: Date): Date[] {
  return eachDayOfInterval({
    start: toZonedTime(start, PKT),
    end:   toZonedTime(end,   PKT),
  });
}

// ── Formatting ────────────────────────────────────────────────────────────────

/**
 * Format a date/timestamp in Pakistan time using a date-fns format string.
 * Accepts ISO strings or Date objects.
 *
 * @example
 *   formatPKT("2026-05-04T20:30:00Z", "dd MMM yyyy · HH:mm") // "05 May 2026 · 01:30"
 */
export function formatPKT(date: Date | string, fmt: string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return formatTZ(toZonedTime(d, PKT), fmt, { timeZone: PKT });
}

/**
 * Short human-readable timestamp: "05 May · 01:30"
 */
export function shortTimePKT(date: Date | string): string {
  return formatPKT(date, "dd MMM · HH:mm");
}

/**
 * Full timestamp: "05 May 2026, 01:30"
 */
export function fullTimePKT(date: Date | string): string {
  return formatPKT(date, "dd MMM yyyy, HH:mm");
}

/**
 * Check whether a UTC Date falls within today in PKT.
 */
export function isTodayPKT(date: Date): boolean {
  const pkt = toZonedTime(date, PKT);
  const todayPkt = toZonedTime(new Date(), PKT);
  return (
    pkt.getFullYear() === todayPkt.getFullYear() &&
    pkt.getMonth()    === todayPkt.getMonth()    &&
    pkt.getDate()     === todayPkt.getDate()
  );
}
