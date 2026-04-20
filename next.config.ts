import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  reactStrictMode: true,
  transpilePackages: ['antd'], // 关键：让Next编译antd
  compiler: {
    styledComponents: true,
  },
};

export default nextConfig;
