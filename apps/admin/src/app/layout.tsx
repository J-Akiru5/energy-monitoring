import type { Metadata } from "next";
import "./globals-compiled.css";
import { AdminShell } from "./components/AdminShell";

export const metadata: Metadata = {
  title: "Energy Monitor — Admin",
  description: "Building Manager dashboard for energy monitoring system configuration.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <AdminShell>{children}</AdminShell>
      </body>
    </html>
  );
}
