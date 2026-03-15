import type { NextConfig } from "next";
import withPWAInit from "@ducanh2912/next-pwa";

const withPWA = withPWAInit({
  dest: "public",
  disable: process.env.NODE_ENV === "development",
  register: true,
});

const nextConfig: NextConfig = {
  transpilePackages: ["@energy/types", "@energy/database"],
  turbopack: {},
};

export default withPWA(nextConfig);
