"use client";

import { useEffect, useRef, useState } from "react";

export interface SSEReading {
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
 * Staleness Detection (Option B – Absolute Time Check):
 * Compares the `recorded_at` timestamp from the latest DB row against
 * the browser's Date.now(). If the reading is older than STALE_THRESHOLD_MS,
 * the device is considered OFFLINE.
 *
 * IMPORTANT: This requires the ESP32's RTC to be NTP-synchronised.
 * If the RTC drifts by more than STALE_THRESHOLD_MS, the dashboard will
 * falsely report "Offline" even when data is flowing.
 */
const POLL_INTERVAL_MS = 3_000;
const STALE_THRESHOLD_MS = 15_000; // 15 seconds

export function useSSE(deviceId: string | null) {
  const [latestReading, setLatestReading] = useState<SSEReading | null>(null);
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
          { signal: abortRef.current.signal }
        );

        if (!res.ok) {
          if (isMounted) setIsConnected(false);
          return;
        }

        const json = await res.json();
        const readings: SSEReading[] = json.readings ?? [];

        if (isMounted && readings.length > 0) {
          const reading = readings[0];
          setLatestReading(reading);

          // ── Option B: Absolute time staleness check ──
          const recordedMs = new Date(reading.recorded_at).getTime();
          const nowMs = Date.now();
          const isStale = nowMs - recordedMs > STALE_THRESHOLD_MS;

          setIsConnected(!isStale);
        } else if (isMounted) {
          // No readings at all — device never reported
          setIsConnected(false);
        }
      } catch (err) {
        // AbortError is expected on cleanup — ignore it
        if (err instanceof Error && err.name === "AbortError") return;
        if (isMounted) setIsConnected(false);
      }
    }

    // Fetch immediately on mount, then every POLL_INTERVAL_MS
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
