"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { usePolling } from "@/hooks/usePolling";
import { usePrimaryDevice } from "@/hooks/usePrimaryDevice";
import { APP_NAV_ITEMS, MOBILE_PRIMARY_NAV } from "@/lib/navigation";

function isActivePath(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { deviceId } = usePrimaryDevice();
  const { latestReading, isConnected } = usePolling(deviceId);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [alertsCount, setAlertsCount] = useState(0);

  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!deviceId) return;

    let isMounted = true;

    const refreshAlerts = async () => {
      try {
        const res = await fetch(`/api/alerts?deviceId=${deviceId}`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = await res.json();
        if (!isMounted) return;
        setAlertsCount(Array.isArray(data.alerts) ? data.alerts.length : 0);
      } catch (err) {
        console.error("[AppShell] Failed to refresh alerts:", err);
      }
    };

    refreshAlerts();
    const interval = setInterval(refreshAlerts, 10_000);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [deviceId]);

  const lastSeen = latestReading?.recorded_at
    ? new Date(latestReading.recorded_at).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  return (
    <>
      <header className="app-shell-topbar">
        <div className="app-shell-brand-row">
          <button
            type="button"
            className="app-shell-menu-btn mobile-only"
            aria-label="Open navigation menu"
            onClick={() => setDrawerOpen(true)}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="4" x2="20" y1="12" y2="12" />
              <line x1="4" x2="20" y1="6" y2="6" />
              <line x1="4" x2="20" y1="18" y2="18" />
            </svg>
          </button>
          <Link href="/dashboard" className="app-shell-brand">
            <span className="app-shell-brand-mark">⚡</span>
            <span>Energy Monitor</span>
          </Link>
        </div>

        <nav className="app-shell-nav desktop-only" aria-label="Primary navigation">
          {APP_NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`app-shell-nav-link ${isActivePath(pathname, item.href) ? "active" : ""}`}
            >
              {item.label}
              {item.href === "/alerts" && alertsCount > 0 && (
                <span className="alert-badge">{alertsCount}</span>
              )}
            </Link>
          ))}
        </nav>

        <div className="app-shell-status">
          <span className={`status-dot ${isConnected ? "online" : "offline"}`} />
          <span>{isConnected ? "Live" : "Offline"}</span>
          {!isConnected && lastSeen && (
            <span className="app-shell-status-muted">Last seen {lastSeen}</span>
          )}
          {alertsCount > 0 && <span className="alert-badge">{alertsCount}</span>}
        </div>
      </header>

      <div className={`app-shell-overlay ${drawerOpen ? "open" : ""}`} onClick={() => setDrawerOpen(false)} />

      <aside className={`app-shell-drawer ${drawerOpen ? "open" : ""}`}>
        <div className="app-shell-drawer-header">
          <div>
            <div className="app-shell-drawer-title">Navigation</div>
            <div className="app-shell-drawer-subtitle">Jump across monitoring pages</div>
          </div>
          <button
            type="button"
            className="app-shell-menu-btn"
            aria-label="Close navigation menu"
            onClick={() => setDrawerOpen(false)}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" x2="6" y1="6" y2="18" />
              <line x1="6" x2="18" y1="6" y2="18" />
            </svg>
          </button>
        </div>

        <nav className="app-shell-drawer-nav" aria-label="Mobile navigation drawer">
          {APP_NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`app-shell-drawer-link ${isActivePath(pathname, item.href) ? "active" : ""}`}
            >
              <span>{item.label}</span>
              {item.href === "/alerts" && alertsCount > 0 && (
                <span className="alert-badge">{alertsCount}</span>
              )}
            </Link>
          ))}
        </nav>
      </aside>

      <main className="app-shell-main">{children}</main>

      <nav className="mobile-bottom-nav mobile-only" aria-label="Bottom shortcuts">
        {MOBILE_PRIMARY_NAV.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`mobile-bottom-link ${isActivePath(pathname, item.href) ? "active" : ""}`}
          >
            <span>{item.shortLabel}</span>
            {item.href === "/alerts" && alertsCount > 0 && (
              <span className="alert-badge">{alertsCount}</span>
            )}
          </Link>
        ))}
        <button
          type="button"
          className="mobile-bottom-link mobile-bottom-link-button"
          onClick={() => setDrawerOpen(true)}
          aria-label="Open full menu"
        >
          Menu
        </button>
      </nav>
    </>
  );
}