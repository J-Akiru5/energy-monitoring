"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { logout } from "../actions";

const NAV_GROUPS = [
  {
    label: "Monitoring",
    items: [
      { href: "/", icon: "📊", label: "Overview" },
      { href: "/alerts", icon: "🔔", label: "Alerts" },
    ],
  },
  {
    label: "Management",
    items: [
      { href: "/sensors", icon: "📡", label: "Sensors" },
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

export function Sidebar() {
  const pathname = usePathname();

  // Hide the sidebar entirely on the login screen
  if (pathname === "/login") return null;

  return (
    <aside className="sidebar flex flex-col justify-between h-screen">
      <div>
        <div className="sidebar-header">
          <h1>
            ⚡ Energy Admin <span className="badge">Manager</span>
          </h1>
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
                >
                  <span className="icon">{item.icon}</span>
                  {item.label}
                </Link>
              ))}
            </div>
          ))}
        </nav>
      </div>

      <div className="p-4 border-t border-slate-800">
        <form action={logout}>
          <button
            type="submit"
            className="w-full flex items-center justify-center gap-2 px-4 py-2 text-sm text-rose-400 hover:text-white hover:bg-rose-600 rounded-md transition-colors"
          >
            <span>🚪</span> Sign Out
          </button>
        </form>
      </div>
    </aside>
  );
}

