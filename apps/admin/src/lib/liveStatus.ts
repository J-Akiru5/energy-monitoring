import { getAlertThresholds, getLatestReading } from "@energy/database";

export const DEFAULT_OFFLINE_SECONDS = 60;

export interface DeviceLiveStatus {
  last_seen_at: string | null;
  is_online: boolean;
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
 * device is the source of truth. A device is online only when it is active and
 * its latest reading is within the offline window.
 */
export async function attachLiveStatus<T extends { id: string; is_active: boolean }>(
  devices: T[],
  offlineSeconds: number,
  customerId?: string
): Promise<Array<T & DeviceLiveStatus>> {
  const nowMs = Date.now();

  return Promise.all(
    devices.map(async (device) => {
      const latest = await getLatestReading(device.id, customerId);
      const lastSeenMs = latest ? new Date(latest.recorded_at).getTime() : null;
      const isOnline =
        Boolean(device.is_active) &&
        lastSeenMs !== null &&
        nowMs - lastSeenMs <= offlineSeconds * 1000;

      return {
        ...device,
        last_seen_at: latest?.recorded_at ?? null,
        is_online: isOnline,
      };
    })
  );
}
