import type { Metadata } from "next";
import { themeInitScript } from "@energy/ui";
import "./globals-compiled.css";

export const metadata: Metadata = {
  title: "Super Admin — Syntaxure Labs",
  description: "Super administrator portal for managing tenants and system settings.",
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
        {children}
      </body>
    </html>
  );
}
