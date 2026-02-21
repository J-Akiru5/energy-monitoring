import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@energy/types", "@energy/database"],
};

export default nextConfig;
