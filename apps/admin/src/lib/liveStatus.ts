import { getAlertThresholds, getLatestReading, getRelayState } from "@energy/database";

export const DEFAULT_OFFLINE_SECONDS = 60;

export interface DeviceLiveStatus {
  last_seen_at: string | null;
  is_online: boolean;
  /** Relay deliberately cut power (auto-trip or manual) — load is disconnected. */
  relay_tripped: boolean;
  relay_trip_reason: string | null;
}

/**
 * Resolve the staleness window used to decide whether a device is online.
 * Falls back to the default when thresholds cannot be read.
 */
export async function resolveOfflineSeconds(): Promise<number> {
  try {
    const thresholds = await getAlertThresholds();
    return Number(thresholds?.device_offline_seconds ?? DEFAULT_OFFLINE_SECONDS);
  } catch (err) {
    console.error("[liveStatus] thresholds lookup failed:", (err as Error).message);
    return DEFAULT_OFFLINE_SECONDS;
  }
}

/**
 * Derive live status from telemetry, matching the DEVICE_OFFLINE alert clock.
 *
 * The devices table has no last-seen column; the newest power_readings row per
 * device is the source of truth. A device is online only when it is active,
 * its latest reading is within the offline window, and the relay has not cut
 * power. A tripped relay keeps reporting voltage (its taps sit upstream of
 * the relay), so telemetry freshness alone cannot detect the cut — the relay
 * state is the authoritative signal, and a tripped device is reported offline
 * with relay_tripped so the UI can say WHY.
 */
export async function attachLiveStatus<T extends { id: string; is_active: boolean }>(
  devices: T[],
  offlineSeconds: number,
  customerId?: string
): Promise<Array<T & DeviceLiveStatus>> {
  const nowMs = Date.now();

  return Promise.all(
    devices.map(async (device) => {
      const [latest, relay] = await Promise.all([
        getLatestReading(device.id, customerId),
        getRelayState(device.id),
      ]);
      const lastSeenMs = latest ? new Date(latest.recorded_at).getTime() : null;
      const relayTripped = relay?.isTripped ?? false;
      const isOnline =
        Boolean(device.is_active) &&
        lastSeenMs !== null &&
        nowMs - lastSeenMs <= offlineSeconds * 1000 &&
        !relayTripped;

      return {
        ...device,
        last_seen_at: latest?.recorded_at ?? null,
        is_online: isOnline,
        relay_tripped: relayTripped,
        relay_trip_reason: relayTripped ? (relay?.tripReason ?? null) : null,
      };
    })
  );
}
