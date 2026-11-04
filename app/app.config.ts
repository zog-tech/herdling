/**
 * Dynamic Expo config. It extends the static config in app.json.
 *
 * It adds the Firebase file for Android push (FCM) only when the file exists.
 * The file is not in git: EAS gives it to the build through the file
 * environment variable GOOGLE_SERVICES_JSON (a path to a temporary copy).
 * A local build reads ./google-services.json. Without the file, the build
 * still works, but Android push notifications do not arrive. iOS is unchanged.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ConfigContext, ExpoConfig } from 'expo/config';

export default ({ config }: ConfigContext): ExpoConfig => {
  const file = process.env.GOOGLE_SERVICES_JSON ?? './google-services.json';
  const base = config as ExpoConfig;
  if (!existsSync(resolve(__dirname, file))) {
    return base;
  }
  return {
    ...base,
    android: { ...base.android, googleServicesFile: file },
  };
};
