"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

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
    label: "Reports",
    items: [
      { href: "/reports", icon: "📈", label: "Historical Data" },
    ],
  },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="sidebar">
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
    </aside>
  );
}
