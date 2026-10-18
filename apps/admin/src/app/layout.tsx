import type { Metadata } from "next";
import { themeInitScript } from "@energy/ui";
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
    <html lang="en" suppressHydrationWarning>
      <body>
        {/* Applies the stored theme before first paint — must stay inline. */}
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <AdminShell>{children}</AdminShell>
      </body>
    </html>
  );
}
