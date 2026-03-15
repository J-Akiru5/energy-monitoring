export type AppNavItem = {
  href: string;
  label: string;
  shortLabel: string;
};

export const APP_NAV_ITEMS: AppNavItem[] = [
  { href: "/dashboard", label: "Dashboard", shortLabel: "Home" },
  { href: "/history", label: "History", shortLabel: "History" },
  { href: "/alerts", label: "Alerts", shortLabel: "Alerts" },
  { href: "/reports", label: "Reports", shortLabel: "Reports" },
  { href: "/billing", label: "Billing", shortLabel: "Billing" },
];

export const MOBILE_PRIMARY_NAV = APP_NAV_ITEMS.slice(0, 4);