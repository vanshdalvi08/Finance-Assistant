import type { DayKey, TimesheetDailyReviewLocks, TimesheetEntry } from "@/lib/api";

const WEEK_DAYS: DayKey[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

function weekDateIso(weekStart: string, dayIndex: number) {
  const date = new Date(`${weekStart.slice(0, 10)}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + dayIndex);
  return date.toISOString().slice(0, 10);
}

// Mirrors the server: the last day of the week's first month, when the week runs into a second month.
export function timesheetMonthEndCutoff(weekStart: string): string | null {
  if (!weekStart) return null;
  const firstDate = weekDateIso(weekStart, 0);
  const lastDate = weekDateIso(weekStart, 6);
  if (firstDate.slice(0, 7) === lastDate.slice(0, 7)) return null;

  const [year, month] = firstDate.split("-").map(Number);
  const lastDayOfMonth = new Date(Date.UTC(year!, month!, 0)).getUTCDate();
  return `${firstDate.slice(0, 7)}-${String(lastDayOfMonth).padStart(2, "0")}`;
}

export function dayKeysThrough(weekStart: string, throughDate: string): DayKey[] {
  return WEEK_DAYS.filter((_, index) => weekDateIso(weekStart, index) <= throughDate);
}

// Days that are part of a pending or approved month-end submission; the employee can't edit these.
export function monthEndLockedDays(entry?: Pick<TimesheetEntry, "weekStart" | "partialSubmission"> | null): DayKey[] {
  const partial = entry?.partialSubmission;
  if (!entry || !partial || partial.status === "rejected") return [];
  return dayKeysThrough(entry.weekStart, partial.throughDate);
}

export function locksWithMonthEnd(
  entry?: Pick<TimesheetEntry, "weekStart" | "partialSubmission" | "dailyReviewLocks"> | null,
): TimesheetDailyReviewLocks | undefined {
  const lockedDays = monthEndLockedDays(entry);
  if (lockedDays.length === 0) return entry?.dailyReviewLocks;
  return {
    ...(entry?.dailyReviewLocks ?? {}),
    ...Object.fromEntries(lockedDays.map((day) => [day, true as const])),
  };
}

export function formatMonthEndDate(isoDate: string) {
  return new Date(`${isoDate}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
}

// "28–30 Sep": the part of the week up to and including the month-end cutoff.
export function formatMonthEndRange(weekStart: string, throughDate: string) {
  const start = new Date(`${weekStart.slice(0, 10)}T00:00:00Z`);
  const end = new Date(`${throughDate}T00:00:00Z`);
  const month = end.toLocaleDateString("en-IN", { month: "short", timeZone: "UTC" });
  return start.getTime() === end.getTime()
    ? `${end.getUTCDate()} ${month}`
    : `${start.getUTCDate()}–${end.getUTCDate()} ${month}`;
}

// "1–4 Oct": the part of the week after the month-end cutoff.
export function formatRemainingDays(weekStart: string, throughDate: string) {
  const firstRemaining = weekDateIso(throughDate, 1);
  const lastDay = weekDateIso(weekStart, 6);
  const start = new Date(`${firstRemaining}T00:00:00Z`);
  const end = new Date(`${lastDay}T00:00:00Z`);
  const month = end.toLocaleDateString("en-IN", { month: "short", timeZone: "UTC" });
  return start.getTime() === end.getTime()
    ? `${end.getUTCDate()} ${month}`
    : `${start.getUTCDate()}–${end.getUTCDate()} ${month}`;
}
