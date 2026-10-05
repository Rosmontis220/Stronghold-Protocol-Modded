import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'top.rosmontis.stronghold.protocol',
  appName: 'Stronghold Protocol Alliance',
  webDir: 'mobile-web',
  bundledWebRuntime: false,
  server: {
    url: 'https://wsxy.rosmontis220.top',
    cleartext: false,
  },
  android: {
    allowMixedContent: false,
  },
};

export default config;
