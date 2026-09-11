import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getBlackoutEvents, getBlackoutStats } from "@energy/database";
import { createClient, resolveAccess, AccessDeniedError } from "@energy/auth";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  Pragma: "no-cache",
  Expires: "0",
};

function noStoreJson(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE_HEADERS });
}

const PH_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

type Period = "day" | "week" | "month";

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function startOfPhDay(dateString: string) {
  const [year, month, day] = dateString.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day) - PH_OFFSET_MS);
}

function startOfPhWeek(dateString: string) {
  const dayStartUtc = startOfPhDay(dateString);
  const localEquivalent = new Date(dayStartUtc.getTime() + PH_OFFSET_MS);
  const dayOfWeek = localEquivalent.getUTCDay();
  const daysSinceMonday = (dayOfWeek + 6) % 7;
  return new Date(dayStartUtc.getTime() - daysSinceMonday * DAY_MS);
}

function startOfPhMonth(dateString: string) {
  const [year, month] = dateString.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, 1) - PH_OFFSET_MS);
}

function getRangeBounds(period: Period, dateString: string) {
  if (period === "week") {
    const start = startOfPhWeek(dateString);
    return { start, end: new Date(start.getTime() + 7 * DAY_MS) };
  }
  if (period === "month") {
    const start = startOfPhMonth(dateString);
    const shifted = new Date(start.getTime() + PH_OFFSET_MS);
    const year = shifted.getUTCFullYear();
    const month = shifted.getUTCMonth();
    const end = new Date(Date.UTC(year, month + 1, 1) - PH_OFFSET_MS);
    return { start, end };
  }
  const start = startOfPhDay(dateString);
  return { start, end: new Date(start.getTime() + DAY_MS) };
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${minutes}m`;
}

function getPhTodayKey() {
  const shifted = new Date(Date.now() + PH_OFFSET_MS);
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

/**
 * GET /api/blackouts?deviceId=<uuid>&period=day|week|month&date=YYYY-MM-DD
 *
 * Returns blackout events and statistics for the specified device and time period.
 * Used by the History page's Blackout Monitoring section.
 *
 * Auth: requires a logged-in session with "view_energy" on some customer.
 * resolveAccess() resolves which customer the caller is authorized for —
 * that customerId is then passed down into the query functions, which
 * explicitly filter blackout_events by it.
 */
export async function GET(req: NextRequest) {
  try {
    const deviceId = req.nextUrl.searchParams.get("deviceId");
    const periodParam = req.nextUrl.searchParams.get("period") ?? "day";
    const dateParam = req.nextUrl.searchParams.get("date") ?? getPhTodayKey();

    if (!deviceId) {
      return noStoreJson({ error: "Missing deviceId" }, 400);
    }

    if (!["day", "week", "month"].includes(periodParam)) {
      return noStoreJson({ error: "Invalid period" }, 400);
    }

    // ── Authenticate the caller ───────────────────────────────
    const cookieStore = await cookies();
    const supabase = createClient(cookieStore);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return noStoreJson({ error: "Not authenticated" }, 401);
    }

    // ── Resolve which customer this caller is authorized for ──
    let customerId: string;
    try {
      const access = await resolveAccess(user.id, "view_energy");
      customerId = access.customerId;
    } catch (err) {
      if (err instanceof AccessDeniedError) {
        return noStoreJson({ error: err.message }, 403);
      }
      throw err;
    }

    const period = periodParam as Period;
    const { start, end } = getRangeBounds(period, dateParam);

    const [events, stats] = await Promise.all([
      getBlackoutEvents(deviceId, customerId, start.toISOString(), end.toISOString()),
      getBlackoutStats(deviceId, customerId, start.toISOString(), end.toISOString()),
    ]);

    // Format events for UI
    const formattedEvents = events.map((event: {
      id: string;
      deviceId: string;
      startedAt: string;
      endedAt: string | null;
      durationSeconds: number | null;
      alertId: string | null;
      createdAt: string;
    }) => ({
      id: event.id,
      startedAt: event.startedAt,
      endedAt: event.endedAt,
      durationSeconds: event.durationSeconds,
      durationFormatted: event.durationSeconds
        ? formatDuration(event.durationSeconds)
        : "Ongoing",
      isOngoing: event.endedAt === null,
    }));

    return noStoreJson({
      period,
      date: dateParam,
      rangeStart: start.toISOString(),
      rangeEnd: end.toISOString(),
      events: formattedEvents,
      stats: {
        ...stats,
        totalDurationFormatted: formatDuration(stats.totalDurationSeconds),
        averageDurationFormatted: formatDuration(stats.averageDurationSeconds),
        longestDurationFormatted: formatDuration(stats.longestDurationSeconds),
        shortestDurationFormatted: formatDuration(stats.shortestDurationSeconds),
      },
    });
  } catch (err) {
    console.error("[/api/blackouts] Error:", err);
    return noStoreJson({ error: "Failed to fetch blackout data" }, 500);
  }
}