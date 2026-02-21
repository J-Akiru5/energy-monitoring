"use client";

import { useEffect, useRef, useState } from "react";

interface SSEReading {
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
 * Custom hook that connects to the SSE endpoint and
 * provides live readings as they stream in.
 */
export function useSSE(deviceId: string | null) {
  const [latestReading, setLatestReading] = useState<SSEReading | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!deviceId) return;

    function connect() {
      // Close existing connection
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }

      const es = new EventSource(`/api/stream?deviceId=${deviceId}`);
      eventSourceRef.current = es;

      es.onopen = () => {
        setIsConnected(true);
      };

      es.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as SSEReading;
          setLatestReading(data);
        } catch {
          // Ignore parse errors (heartbeats)
        }
      };

      es.onerror = () => {
        setIsConnected(false);
        es.close();
        // Auto-reconnect after 3 seconds
        reconnectTimeoutRef.current = setTimeout(connect, 3000);
      };
    }

    connect();

    return () => {
      eventSourceRef.current?.close();
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, [deviceId]);

  return { latestReading, isConnected };
}
