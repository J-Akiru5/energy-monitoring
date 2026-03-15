"use client";

import { useEffect, useRef, useState } from "react";

export interface PollingReading {
  id: number;
  device_id: string;
  voltage: number;
  current_amp: number;
  power_w: number;
  energy_kwh: number;
  frequency: number;
  power_factor: number;
  recorded_at: string;
}

/**
 * Polls /api/readings?deviceId=<id>&limit=1 every POLL_INTERVAL_MS.
 *
 * Staleness Detection:
 * Compares the `recorded_at` timestamp from the latest DB row against the
 * browser's Date.now(). If the reading is older than STALE_THRESHOLD_MS,
 * the device is flagged OFFLINE.
 *
 * STALE_THRESHOLD_MS is intentionally generous (30s) to absorb:
 *  – Vercel cold-start latency
 *  – 1-second ESP32 transmit interval
 *  – minor NTP clock drift between the ESP32 and browser
 */
const POLL_INTERVAL_MS = 3_000;
const STALE_THRESHOLD_MS = 30_000; // 30 seconds — generous buffer for Vercel

export function usePolling(deviceId: string | null) {
  const [latestReading, setLatestReading] = useState<PollingReading | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!deviceId) return;

    let isMounted = true;

    async function fetchLatest() {
      // Cancel any in-flight request before making a new one
      abortRef.current?.abort();
      abortRef.current = new AbortController();

      try {
        const res = await fetch(
          `/api/readings?deviceId=${deviceId}&limit=1`,
          { signal: abortRef.current.signal, cache: "no-store" }
        );

        if (!res.ok) {
          if (isMounted) setIsConnected(false);
          return;
        }

        const json = await res.json();
        const readings: PollingReading[] = json.readings ?? [];

        if (isMounted && readings.length > 0) {
          const reading = readings[0];
          setLatestReading(reading);

          // ── Staleness check ──
          // Supabase returns timestamptz as an ISO string with timezone
          // (e.g., "2026-03-15T02:13:11+00:00"). We parse it directly.
          // If for some reason it arrives without a timezone, we append Z
          // (UTC) as a safe default so Date.parse() doesn't interpret it as
          // local browser time, which would produce a wildly wrong delta.
          const recordedStr = reading.recorded_at;
          const hasTimezone =
            recordedStr.endsWith("Z") ||
            /([+-][0-9]{2}:[0-9]{2})$/.test(recordedStr);
          const dateString = hasTimezone ? recordedStr : `${recordedStr}Z`;

          const recordedMs = new Date(dateString).getTime();
          const nowMs = Date.now();
          const ageSecs = (nowMs - recordedMs) / 1000;

          if (process.env.NODE_ENV !== "production") {
            console.debug(
              `[usePolling] deviceId=${deviceId} recorded_at="${recordedStr}" age=${ageSecs.toFixed(1)}s stale=${ageSecs * 1000 > STALE_THRESHOLD_MS}`
            );
          }

          setIsConnected(ageSecs * 1000 <= STALE_THRESHOLD_MS);
        } else if (isMounted) {
          // No readings found for this deviceId — device never reported
          setIsConnected(false);
          console.warn(
            `[usePolling] No readings found for deviceId="${deviceId}". ` +
            `Check that this device has sent at least one record to /api/ingest.`
          );
        }
      } catch (err) {
        // AbortError fires on cleanup — not a real error
        if (err instanceof Error && err.name === "AbortError") return;
        if (isMounted) setIsConnected(false);
        console.error("[usePolling] Fetch error:", err);
      }
    }

    // Fetch immediately on mount, then on every interval
    fetchLatest();
    intervalRef.current = setInterval(fetchLatest, POLL_INTERVAL_MS);

    return () => {
      isMounted = false;
      if (intervalRef.current) clearInterval(intervalRef.current);
      abortRef.current?.abort();
    };
  }, [deviceId]);

  return { latestReading, isConnected };
}
