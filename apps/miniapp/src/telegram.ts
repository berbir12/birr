/**
 * Thin wrapper over @telegram-apps/sdk-react. Every call is a no-op outside Telegram, so the app
 * also runs in a normal browser for local preview (where screens render their own buttons).
 */
import {
  bindThemeParamsCssVars,
  hapticFeedbackImpactOccurred,
  hapticFeedbackNotificationOccurred,
  hapticFeedbackSelectionChanged,
  hideBackButton,
  init,
  isThemeParamsDark,
  isTMA,
  miniAppReady,
  mountBackButton,
  mountMainButton,
  mountMiniAppSync,
  mountSwipeBehavior,
  mountThemeParamsSync,
  disableVerticalSwipes,
  expandViewport,
  mountViewport,
  offBackButtonClick,
  offMainButtonClick,
  onBackButtonClick,
  onMainButtonClick,
  retrieveRawInitData,
  setMainButtonParams,
  showBackButton,
} from '@telegram-apps/sdk-react';

let inside = false;

export function initTelegram(): { insideTelegram: boolean } {
  inside = isTMA();
  const root = document.documentElement;
  if (!inside) {
    if (window.matchMedia('(prefers-color-scheme: dark)').matches) root.dataset.dark = '';
    return { insideTelegram: false };
  }
  init();
  root.dataset.tg = '';
  mountThemeParamsSync.ifAvailable();
  bindThemeParamsCssVars.ifAvailable();
  mountMiniAppSync.ifAvailable();
  mountBackButton.ifAvailable();
  mountMainButton.ifAvailable();
  mountSwipeBehavior.ifAvailable();
  // Lists scroll vertically; don't let a swipe-down close the app mid-scroll.
  disableVerticalSwipes.ifAvailable();
  const viewport = mountViewport.ifAvailable();
  if (viewport[0]) void viewport[1].then(() => expandViewport.ifAvailable()).catch(() => {});
  try {
    if (isThemeParamsDark()) root.dataset.dark = '';
  } catch {
    /* theme not mounted */
  }
  miniAppReady.ifAvailable();
  return { insideTelegram: true };
}

export const insideTelegram = () => inside;

export function rawInitData(): string | undefined {
  if (!inside) return undefined;
  try {
    return retrieveRawInitData();
  } catch {
    return undefined;
  }
}

export const haptic = {
  tap: () => inside && hapticFeedbackImpactOccurred.ifAvailable('light'),
  select: () => inside && hapticFeedbackSelectionChanged.ifAvailable(),
  success: () => inside && hapticFeedbackNotificationOccurred.ifAvailable('success'),
  warning: () => inside && hapticFeedbackNotificationOccurred.ifAvailable('warning'),
  error: () => inside && hapticFeedbackNotificationOccurred.ifAvailable('error'),
};

export function setBackButton(handler: (() => void) | null): () => void {
  if (!inside) return () => {};
  if (!handler) {
    hideBackButton.ifAvailable();
    return () => {};
  }
  showBackButton.ifAvailable();
  onBackButtonClick.ifAvailable(handler);
  return () => offBackButtonClick.ifAvailable(handler);
}

export interface MainButtonSpec {
  text: string;
  onClick: () => void;
  enabled?: boolean;
  loading?: boolean;
}

export function setMainButton(spec: MainButtonSpec | null): () => void {
  if (!inside) return () => {};
  if (!spec) {
    setMainButtonParams.ifAvailable({ isVisible: false });
    return () => {};
  }
  setMainButtonParams.ifAvailable({
    text: spec.text,
    isVisible: true,
    isEnabled: spec.enabled !== false && !spec.loading,
    isLoaderVisible: Boolean(spec.loading),
  });
  onMainButtonClick.ifAvailable(spec.onClick);
  return () => {
    offMainButtonClick.ifAvailable(spec.onClick);
    setMainButtonParams.ifAvailable({ isVisible: false, isLoaderVisible: false });
  };
}
