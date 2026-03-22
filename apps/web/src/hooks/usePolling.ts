"use client";

import { useEffect, useRef, useState } from "react";

export interface PollingReading {
  id: number;
  device_id: string;
  // Legacy single-phase columns
  voltage: number;
  current_amp: number;
  power_w: number;
  energy_kwh: number;
  frequency: number;
  power_factor: number;
  recorded_at: string;
  // 3-Phase columns (nullable - only present for 3-phase devices)
  voltage_a?: number | null;
  voltage_b?: number | null;
  voltage_c?: number | null;
  current_a?: number | null;
  current_b?: number | null;
  current_c?: number | null;
  power_a?: number | null;
  power_b?: number | null;
  power_c?: number | null;
  energy_a?: number | null;
  energy_b?: number | null;
  energy_c?: number | null;
  frequency_a?: number | null;
  frequency_b?: number | null;
  frequency_c?: number | null;
  power_factor_a?: number | null;
  power_factor_b?: number | null;
  power_factor_c?: number | null;
  total_power?: number | null;
  total_energy?: number | null;
}

/**
 * Polls /api/readings?deviceId=<id>&limit=1 every POLL_INTERVAL_MS.
 *
 * Staleness Detection (Server-Side Age):
 * Uses the `age_ms` field returned by the server instead of computing
 * Date.now() minus recorded_at locally. This is critical because the ESP32
 * RTC stores UTC time but the firmware labels it +08:00, causing all device
 * timestamps to appear 8 hours behind reality in the browser.
 * The server computes `age_ms` with its own clock, which is always correct.
 */
const POLL_INTERVAL_MS = 3_000;
const STALE_THRESHOLD_MS = 30_000; // 30 seconds

export function usePolling(deviceId: string | null) {
  const [latestReading, setLatestReading] = useState<PollingReading | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!deviceId) return;

    let isMounted = true;

    async function fetchLatest() {
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
        // age_ms is computed by the server — immune to ESP32 clock drift
        const age_ms: number | null = json.age_ms ?? null;

        if (isMounted && readings.length > 0) {
          setLatestReading(readings[0]);

          if (age_ms !== null) {
            // Prefer server-computed age (fixes ESP32 RTC timezone offset bug)
            const isStale = age_ms > STALE_THRESHOLD_MS;
            if (process.env.NODE_ENV !== "production") {
              console.debug(
                `[usePolling] deviceId=${deviceId} server_age=${(age_ms / 1000).toFixed(1)}s stale=${isStale}`
              );
            }
            setIsConnected(!isStale);
          } else {
            // Fallback: parse the recorded_at manually (less reliable)
            const recordedStr = readings[0].recorded_at;
            const hasTimezone =
              recordedStr.endsWith("Z") ||
              /([+-][0-9]{2}:[0-9]{2})$/.test(recordedStr);
            const dateString = hasTimezone ? recordedStr : `${recordedStr}Z`;
            const fallbackAge = Date.now() - new Date(dateString).getTime();
            setIsConnected(fallbackAge <= STALE_THRESHOLD_MS);
          }
        } else if (isMounted) {
          setIsConnected(false);
          console.warn(
            `[usePolling] No readings found for deviceId="${deviceId}". ` +
            `Verify the device has sent at least one record to /api/ingest.`
          );
        }
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
        if (isMounted) setIsConnected(false);
        console.error("[usePolling] Fetch error:", err);
      }
    }

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
