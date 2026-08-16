import { AppShell } from "@/components/AppShell";

/**
 * Route group for the authenticated resident app (dashboard, sensors,
 * history, alerts, reports, billing, relay). The public landing page and
 * /login live outside this group and don't get the app chrome.
 *
 * proxy.ts enforces the session requirement; this layout only owns the UI.
 */
export default function AppGroupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AppShell>{children}</AppShell>;
}
