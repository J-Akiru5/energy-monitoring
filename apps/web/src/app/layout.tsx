import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Energy Monitor — Live Dashboard",
  description: "Real-time single-phase energy monitoring for your building. Track voltage, current, power, and cost estimates.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
