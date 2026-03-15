"use client";

import { useEffect, useState } from "react";

type DeviceSummary = {
  id: string;
  name?: string;
  location?: string | null;
};

export function usePrimaryDevice() {
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [device, setDevice] = useState<DeviceSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    const loadDevice = async () => {
      try {
        const res = await fetch("/api/devices", { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        if (!isMounted) return;

        const firstDevice = data.devices?.[0] ?? null;
        setDevice(firstDevice);
        setDeviceId(firstDevice?.id ?? null);
      } catch (err) {
        console.error("[usePrimaryDevice] Failed to load devices:", err);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };

    loadDevice();

    return () => {
      isMounted = false;
    };
  }, []);

  return { deviceId, device, isLoading };
}