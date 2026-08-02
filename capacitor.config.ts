import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "app.lovable.convopalpro",
  appName: "صديق المحادثة",
  webDir: "mobile-www",
  server: {
    // The app is a server-rendered web app, so the native shell loads the live site.
    url: "https://convo-pal-pro.lovable.app",
    cleartext: false,
    androidScheme: "https",
  },
  android: {
    allowMixedContent: false,
  },
};

export default config;
