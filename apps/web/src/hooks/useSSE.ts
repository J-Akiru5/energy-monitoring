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
 * WHY: Vercel Serverless Functions have a hard 300-second timeout.
 * The previous SSE approach (setInterval inside ReadableStream) kept
 * a long-lived connection open and was killed by Vercel after 300s,
 * causing the "Task timed out" errors visible in Vercel logs.
 *
 * Client-side polling with short-lived fetch() calls is the correct
 * pattern for Vercel. Each request completes in <100ms.
 */
const POLL_INTERVAL_MS = 3000;

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
        // /api/readings returns { readings: [...] }
        const readings: SSEReading[] = json.readings ?? [];

        if (isMounted && readings.length > 0) {
          setLatestReading(readings[0]);
          setIsConnected(true);
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
