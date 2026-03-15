"use client";

import { useEffect, useState } from "react";
import { usePrimaryDevice } from "@/hooks/usePrimaryDevice";

type ReportSummary = {
  current: {
    monthKwh: number;
    monthEstimatedPhp: number;
  };
  averages: {
    dayKwh: number;
    weekKwh: number;
    monthKwh: number;
    dayEstimatedPhp: number;
    weekEstimatedPhp: number;
    monthEstimatedPhp: number;
  };
  monthlyHistory: Array<{
    period: string;
    totalKwh: number;
  }>;
};

export default function ReportsPage() {
  const { deviceId } = usePrimaryDevice();
  const [summary, setSummary] = useState<ReportSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isDownloading, setIsDownloading] = useState(false);

  useEffect(() => {
    if (!deviceId) return;

    let isMounted = true;

    const loadSummary = async () => {
      try {
        const res = await fetch(`/api/reports/summary?deviceId=${deviceId}`, { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        if (!isMounted) return;
        setSummary(data);
      } catch (err) {
        console.error("[reports] Failed to load summary:", err);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };

    loadSummary();

    return () => {
      isMounted = false;
    };
  }, [deviceId]);

  const downloadPdf = async () => {
    if (!deviceId || isDownloading) return;

    setIsDownloading(true);
    try {
      const res = await fetch(`/api/reports/pdf?deviceId=${deviceId}`, { cache: "no-store" });
      if (!res.ok) return;

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "consumption-summary.pdf";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("[reports] Failed to download PDF:", err);
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <div className="page-shell">
      <section className="page-header page-header-split">
        <div>
          <div className="page-eyebrow">Analytics</div>
          <h1 className="page-title">Consumption Reports</h1>
          <p className="page-copy">Monthly rollups and long-window averages ready for download.</p>
        </div>
        <button type="button" className="primary-btn" onClick={downloadPdf} disabled={!deviceId || isDownloading}>
          {isDownloading ? "Generating PDF..." : "Generate PDF"}
        </button>
      </section>

      {isLoading && !summary ? (
        <div className="page-empty">Loading reports...</div>
      ) : summary ? (
        <>
          <section className="summary-grid compact-grid">
            <article className="summary-card">
              <div className="summary-label">Average / Day</div>
              <div className="summary-value">{summary.averages.dayKwh.toFixed(3)} kWh</div>
              <div className="summary-note">₱{summary.averages.dayEstimatedPhp.toFixed(2)}</div>
            </article>
            <article className="summary-card">
              <div className="summary-label">Average / Week</div>
              <div className="summary-value">{summary.averages.weekKwh.toFixed(3)} kWh</div>
              <div className="summary-note">₱{summary.averages.weekEstimatedPhp.toFixed(2)}</div>
            </article>
            <article className="summary-card">
              <div className="summary-label">Average / Month</div>
              <div className="summary-value">{summary.averages.monthKwh.toFixed(3)} kWh</div>
              <div className="summary-note">₱{summary.averages.monthEstimatedPhp.toFixed(2)}</div>
            </article>
            <article className="summary-card">
              <div className="summary-label">Current Month</div>
              <div className="summary-value accent-cyan">{summary.current.monthKwh.toFixed(3)} kWh</div>
              <div className="summary-note">₱{summary.current.monthEstimatedPhp.toFixed(2)}</div>
            </article>
          </section>

          <section className="stack-list">
            {summary.monthlyHistory.map((item) => (
              <article className="stack-card" key={item.period}>
                <div className="stack-card-head">
                  <div className="summary-label">{item.period}</div>
                  <div className="summary-value">{item.totalKwh.toFixed(2)} kWh</div>
                </div>
              </article>
            ))}
          </section>
        </>
      ) : null}
    </div>
  );
}