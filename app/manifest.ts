import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Signal Desk",
    short_name: "Signal Desk",
    description:
      "Your market sidekick — dips, breakouts, paper PnL, and chatty recommendations.",
    start_url: "/",
    display: "standalone",
    background_color: "#0a0c10",
    theme_color: "#ffc93c",
    icons: [
      {
        src: "/web-app-manifest-192x192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/web-app-manifest-512x512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
