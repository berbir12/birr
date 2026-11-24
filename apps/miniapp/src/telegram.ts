import {
  bindThemeParamsCssVars,
  init,
  isTMA,
  miniAppReady,
  mountMiniAppSync,
  mountThemeParamsSync,
  retrieveRawInitData,
} from '@telegram-apps/sdk-react';

export function initTelegram(): { insideTelegram: boolean } {
  const insideTelegram = isTMA();
  if (!insideTelegram) return { insideTelegram };
  init();
  mountThemeParamsSync.ifAvailable();
  bindThemeParamsCssVars.ifAvailable();
  mountMiniAppSync.ifAvailable();
  miniAppReady.ifAvailable();
  return { insideTelegram };
}

export function rawInitData(): string | undefined {
  try {
    return retrieveRawInitData();
  } catch {
    return undefined;
  }
}
