"use client";

import { useEffect, useState } from "react";
import { usePrimaryDevice } from "@/hooks/usePrimaryDevice";

type BillingResponse = {
  totalKwh: number;
  estimatedCostPhp: number;
  ratePhpPerKwh: number;
  period: string;
};

export default function BillingPage() {
  const { deviceId } = usePrimaryDevice();
  const [billing, setBilling] = useState<BillingResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!deviceId) return;

    let isMounted = true;

    const loadBilling = async () => {
      try {
        const res = await fetch(`/api/billing?deviceId=${deviceId}`, { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        if (!isMounted) return;
        setBilling(data);
      } catch (err) {
        console.error("[billing] Failed to load billing:", err);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };

    loadBilling();
    const interval = setInterval(loadBilling, 10_000);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [deviceId]);

  return (
    <div className="page-shell">
      <section className="page-header">
        <div>
          <div className="page-eyebrow">Billing</div>
          <h1 className="page-title">Billing Snapshot</h1>
          <p className="page-copy">Track the current month estimate and live kWh accumulation with clearer precision.</p>
        </div>
      </section>

      {isLoading && !billing ? (
        <div className="page-empty">Loading billing...</div>
      ) : billing ? (
        <section className="summary-grid compact-grid">
          <article className="summary-card">
            <div className="summary-label">Billing Period</div>
            <div className="summary-value">{billing.period}</div>
          </article>
          <article className="summary-card">
            <div className="summary-label">Total Consumption</div>
            <div className="summary-value">{billing.totalKwh.toFixed(4)} kWh</div>
          </article>
          <article className="summary-card">
            <div className="summary-label">Current Rate</div>
            <div className="summary-value">₱{billing.ratePhpPerKwh.toFixed(2)}</div>
            <div className="summary-note">per kWh</div>
          </article>
          <article className="summary-card">
            <div className="summary-label">Estimated Cost</div>
            <div className="summary-value accent-amber">₱{billing.estimatedCostPhp.toFixed(2)}</div>
          </article>
        </section>
      ) : null}
    </div>
  );
}