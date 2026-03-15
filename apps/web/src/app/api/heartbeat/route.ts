import { NextResponse } from "next/server";
import { getAlertThresholds, getLatestReading, listDevices, getUnreadAlerts, createAlert } from "@energy/database";

/**
 * GET /api/heartbeat
 *
 * Designed to be called by a Vercel Cron Job every 2 minutes.
 * Acts as a Dead Man's Switch: if a device hasn't reported in
 * `device_offline_seconds`, it triggers a DEVICE_OFFLINE alert.
 */
export async function GET() {
  try {
    const thresholds = await getAlertThresholds();
    if (!thresholds) return NextResponse.json({ error: "No thresholds found" }, { status: 500 });

    const devices = await listDevices();
    const activeDevices = devices.filter(d => d.is_active);

    const checkPromises = activeDevices.map(async (device) => {
      // 1. Get the latest reading for this device
      const latestReading = await getLatestReading(device.id);
      
      if (!latestReading) return; // Never reported, skip

      // 2. Calculate elapsed time
      const recordedMs = new Date(latestReading.recorded_at).getTime();
      const elapsedSeconds = (Date.now() - recordedMs) / 1000;

      // 3. Check if it's stale
      if (elapsedSeconds > thresholds.device_offline_seconds) {
        
        // 4. Check if there's already an unread offline alert for this device to avoid spam
        const unreadAlerts = await getUnreadAlerts(device.id);
        const hasOfflineAlert = unreadAlerts.some((a) => a.type === "DEVICE_OFFLINE");

        if (!hasOfflineAlert) {
          await createAlert({
            deviceId: device.id,
            type: "DEVICE_OFFLINE",
            value: elapsedSeconds,
            threshold: thresholds.device_offline_seconds,
            message: `CRITICAL: Device offline. No telemetry received for ${Math.floor(elapsedSeconds)} seconds.`,
          });
          console.log(`[Heartbeat] Fired DEVICE_OFFLINE for ${device.name}`);
        }
      }
    });

    await Promise.all(checkPromises);

    return NextResponse.json({ status: "ok", checked: activeDevices.length });
  } catch (err) {
    console.error("[Heartbeat] Error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
