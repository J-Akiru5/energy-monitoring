"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { logout } from "../actions";

const NAV_GROUPS = [
  {
    label: "Monitoring",
    items: [
      { href: "/", icon: "📊", label: "Overview" },
      { href: "/pzem", icon: "📈", label: "PZEM Status" },
      { href: "/alerts", icon: "🔔", label: "Alerts" },
    ],
  },
  {
    label: "Management",
    items: [
      { href: "/sensors", icon: "📡", label: "Sensors" },
      { href: "/relay", icon: "🔌", label: "Relay Control" },
      { href: "/thresholds", icon: "⚡", label: "Alert Thresholds" },
      { href: "/billing", icon: "💰", label: "Billing Rate" },
    ],
  },
  {
    label: "Settings",
    items: [
      { href: "/account", icon: "⚙️", label: "Account" },
    ],
  },
  {
    label: "Reports",
    items: [
      { href: "/reports", icon: "📈", label: "Historical Data" },
    ],
  },
];

interface SidebarProps {
  open?: boolean;
  onNavigate?: () => void;
}

export function Sidebar({ open = false, onNavigate }: SidebarProps) {
  const pathname = usePathname();

  // Hide the sidebar entirely on the login screen
  if (pathname === "/login") return null;

  return (
    <aside id="admin-sidebar" className={`sidebar ${open ? "open" : ""}`}>
      <div>
        <div className="sidebar-header">
          <h1>
            ⚡ Energy Admin <span className="badge">Manager</span>
          </h1>
          <button
            type="button"
            className="sidebar-close-btn"
            aria-label="Close navigation menu"
            onClick={onNavigate}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <line x1="18" x2="6" y1="6" y2="18" />
              <line x1="6" x2="18" y1="6" y2="18" />
            </svg>
          </button>
        </div>

        <nav className="sidebar-nav">
          {NAV_GROUPS.map((group) => (
            <div className="sidebar-group" key={group.label}>
              <div className="sidebar-group-label">{group.label}</div>
              {group.items.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`sidebar-link ${pathname === item.href ? "active" : ""}`}
                  onClick={onNavigate}
                >
                  <span className="icon">{item.icon}</span>
                  {item.label}
                </Link>
              ))}
            </div>
          ))}
        </nav>
      </div>

      <div className="sidebar-signout-section">
        <form action={logout}>
          <button
            type="submit"
            className="sidebar-signout-btn"
          >
            <span>🚪</span> Sign Out
          </button>
        </form>
      </div>
    </aside>
  );
}

