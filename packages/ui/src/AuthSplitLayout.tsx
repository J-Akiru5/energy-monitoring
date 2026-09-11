import React from "react";

export function AuthSplitLayout({
  productName,
  tagline,
  children,
}: {
  productName: string;
  tagline: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen grid lg:grid-cols-2 bg-[#eef2f6]">
      {/* Brand panel — left, hidden on mobile */}
      <div className="hidden lg:flex flex-col justify-between p-12 relative overflow-hidden">
        <div
          className="absolute inset-0 opacity-[0.05]"
          style={{
            backgroundImage:
              "radial-gradient(circle, #0f172a 1px, transparent 1px)",
            backgroundSize: "24px 24px",
          }}
        />
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse 80% 80% at 50% -20%, #06b6d414, transparent)",
          }}
        />
        <div className="relative z-10 flex items-center gap-2">
          {/* Syntaxure logo mark here */}
          <span className="font-semibold text-lg">Syntaxure Labs</span>
        </div>
        <div className="relative z-10">
          <h1 className="text-3xl font-semibold text-zinc-900 mb-2">
            {productName}
          </h1>
          <p className="text-zinc-600">{tagline}</p>
        </div>
      </div>

      {/* Form panel — right, always visible */}
      <div className="flex items-center justify-center p-6 lg:p-12">
        <div
          className="w-full max-w-sm backdrop-blur-xl bg-[#eef2f6bf]
                          border border-black/5 rounded-2xl p-8
                          shadow-[0_0_0_1px_#0f172a0a]"
        >
          {children}
        </div>
      </div>
    </div>
  );
}