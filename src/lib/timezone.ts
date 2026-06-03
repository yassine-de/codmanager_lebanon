/**
 * Lebanon time — Asia/Beirut.
 *
 * All date calculations that involve "today", "yesterday", "this month", etc.
 * must use Lebanon boundaries so that filters and analytics match what the
 * Lebanon-based team sees on the wall clock.
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

export const LEBANON_TIMEZONE = "Asia/Beirut";
export const PKT = LEBANON_TIMEZONE;

// ── Converters ────────────────────────────────────────────────────────────────

/** Current moment (same instant, works in any host timezone). */
export function nowPKT(): Date {
  return new Date();
}

/** Convert a UTC Date to its Lebanon "wall-clock" representation. */
export function toPKT(date: Date): Date {
  return toZonedTime(date, LEBANON_TIMEZONE);
}

/** Convert a Lebanon wall-clock Date back to UTC. */
export function fromPKT(date: Date): Date {
  return fromZonedTime(date, LEBANON_TIMEZONE);
}

// ── Day / month boundaries in Lebanon time ─────────────────────────────────────────────

export function startOfDayPKT(date: Date): Date {
  return fromZonedTime(startOfDay(toZonedTime(date, LEBANON_TIMEZONE)), LEBANON_TIMEZONE);
}

export function endOfDayPKT(date: Date): Date {
  return fromZonedTime(endOfDay(toZonedTime(date, LEBANON_TIMEZONE)), LEBANON_TIMEZONE);
}

export function startOfMonthPKT(date: Date): Date {
  return fromZonedTime(startOfMonth(toZonedTime(date, LEBANON_TIMEZONE)), LEBANON_TIMEZONE);
}

export function endOfMonthPKT(date: Date): Date {
  return fromZonedTime(endOfMonth(toZonedTime(date, LEBANON_TIMEZONE)), LEBANON_TIMEZONE);
}

export function subDaysPKT(date: Date, amount: number): Date {
  return subDays(toZonedTime(date, LEBANON_TIMEZONE), amount);
}

export function subMonthsPKT(date: Date, amount: number): Date {
  return subMonths(toZonedTime(date, LEBANON_TIMEZONE), amount);
}

/** Each calendar day in [start, end] expressed as Lebanon time wall-clock dates. */
export function eachDayOfIntervalPKT(start: Date, end: Date): Date[] {
  return eachDayOfInterval({
    start: toZonedTime(start, LEBANON_TIMEZONE),
    end:   toZonedTime(end,   LEBANON_TIMEZONE),
  });
}

// ── Formatting ────────────────────────────────────────────────────────────────

/**
 * Format a date/timestamp in Lebanon time using a date-fns format string.
 * Accepts ISO strings or Date objects.
 *
 * @example
 *   formatPKT("2026-05-04T20:30:00Z", "dd MMM yyyy · HH:mm") // "05 May 2026 · 01:30"
 */
export function formatPKT(date: Date | string, fmt: string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return formatTZ(toZonedTime(d, LEBANON_TIMEZONE), fmt, { timeZone: LEBANON_TIMEZONE });
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
 * Check whether a UTC Date falls within today in Lebanon time.
 */
export function isTodayPKT(date: Date): boolean {
  const pkt = toZonedTime(date, LEBANON_TIMEZONE);
  const todayPkt = toZonedTime(new Date(), LEBANON_TIMEZONE);
  return (
    pkt.getFullYear() === todayPkt.getFullYear() &&
    pkt.getMonth()    === todayPkt.getMonth()    &&
    pkt.getDate()     === todayPkt.getDate()
  );
}
