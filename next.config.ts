import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Clerk local auth — allow all common loopback hostnames.
  allowedDevOrigins: [
    "127.0.0.1",
    "localhost",
    "signaldesk.local",
  ],
};

export default nextConfig;
