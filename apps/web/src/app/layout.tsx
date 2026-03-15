import type { Metadata, Viewport } from "next";
import { AppShell } from "@/components/AppShell";
import "./globals.css";

export const viewport: Viewport = {
  themeColor: "#0F172A",
};

export const metadata: Metadata = {
  title: "Energy Monitor — Live Dashboard",
  description: "Real-time single-phase energy monitoring for your building. Track voltage, current, power, and cost estimates.",
  manifest: "/manifest.json",
  icons: {
    icon: "/icon.png",
    apple: "/apple-icon.png",
  },
  openGraph: {
    title: "Energy Monitor — Live Dashboard",
    description: "Industrial IoT Energy Monitoring dashboard for real-time telemetry.",
    images: [
      {
        url: "/opengraph-image.png",
        width: 1200,
        height: 630,
        alt: "Energy Monitor Cover",
      },
    ],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
