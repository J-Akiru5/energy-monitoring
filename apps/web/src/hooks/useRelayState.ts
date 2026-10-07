"use client";

import { useEffect, useState } from "react";

export interface RelayStateSummary {
  isTripped: boolean;
  tripReason: string | null;
}

const RELAY_POLL_INTERVAL_MS = 10_000;

/**
 * Poll the device's relay state so the dashboard can surface a power cut.
 *
 * A tripped relay keeps producing telemetry (PZEM taps sit upstream of the
 * relay), so telemetry freshness alone can never show the cut. 10s keeps the
 * indicator current without competing with the 3s reading poll.
 */
export function useRelayState(deviceId: string | null): RelayStateSummary | null {
  const [relayState, setRelayState] = useState<RelayStateSummary | null>(null);

  useEffect(() => {
    if (!deviceId) return;

    let isMounted = true;

    const loadRelayState = async () => {
      try {
        const res = await fetch(`/api/relay?deviceId=${deviceId}`, { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        if (!isMounted || !data?.state) return;
        setRelayState({
          isTripped: Boolean(data.state.isTripped),
          tripReason: data.state.tripReason ?? null,
        });
      } catch (err) {
        console.error("[useRelayState] Failed to load relay state:", err);
      }
    };

    loadRelayState();
    const interval = setInterval(loadRelayState, RELAY_POLL_INTERVAL_MS);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [deviceId]);

  return relayState;
}
