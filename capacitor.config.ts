import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.rosmontis220.wsxy',
  appName: 'Stronghold Protocol Alliance',
  webDir: 'mobile-web',
  bundledWebRuntime: false,
  server: {
    cleartext: false,
  },
  android: {
    allowMixedContent: false,
  },
};

export default config;
