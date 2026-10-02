// Screen metrics that are not in Xcode's device files (iOS computes them at
// runtime), so they are maintained by hand.
//
// Sources:
//   safe areas  - useyourloaf.com "iPhone 15/16/17 Screen Sizes"
//   islands     - safearea.info device pages
// Anything marked "assumed" has no published number yet; tune it here.

export interface DeviceMetrics {
  /** Landscape side insets are symmetric: both edges get `side`. */
  safeArea: {
    portrait: { top: number; bottom: number };
    landscape: { top: number; bottom: number; side: number };
  };
  /** Dynamic Island cutout, centred horizontally. Absent on notch devices. */
  island?: { width: number; height: number; top: number };
}

const ISLAND_59 = { width: 125, height: 36.67, top: 11.33 };
const ISLAND_62 = { width: 125.33, height: 36.67, top: 14 };
const ISLAND_AIR = { width: 125.33, height: 36.67, top: 20 };
// The 18 Pro's cutout is narrower (Face ID moved under the display). These
// numbers come from a third-party table with no stated source.
const ISLAND_18_PRO = { width: 94.67, height: 36.67, top: 14 };

// iOS 17/18 era: no top inset in landscape.
const SAFE_59 = { portrait: { top: 59, bottom: 34 }, landscape: { top: 0, bottom: 21, side: 59 } };
const SAFE_62 = { portrait: { top: 62, bottom: 34 }, landscape: { top: 0, bottom: 21, side: 62 } };
const SAFE_NOTCH = { portrait: { top: 47, bottom: 34 }, landscape: { top: 0, bottom: 21, side: 47 } };
// iOS 26 era: landscape gains a 20pt top inset.
const SAFE_62_IOS26 = { portrait: { top: 62, bottom: 34 }, landscape: { top: 20, bottom: 20, side: 62 } };
const SAFE_AIR = { portrait: { top: 68, bottom: 34 }, landscape: { top: 20, bottom: 29, side: 68 } };
// Assumed: the 17e follows the 16e in portrait and the rest of its generation in landscape.
const SAFE_NOTCH_IOS26 = { portrait: { top: 47, bottom: 34 }, landscape: { top: 20, bottom: 20, side: 47 } };

export const METRICS: Readonly<Record<string, DeviceMetrics>> = {
  // Assumed: safe areas match the 17 Pro, which has the same screen.
  "iphone-18-pro": { safeArea: SAFE_62_IOS26, island: ISLAND_18_PRO },
  "iphone-18-pro-max": { safeArea: SAFE_62_IOS26, island: ISLAND_18_PRO },

  "iphone-17": { safeArea: SAFE_62_IOS26, island: ISLAND_62 },
  "iphone-17-pro": { safeArea: SAFE_62_IOS26, island: ISLAND_62 },
  "iphone-17-pro-max": { safeArea: SAFE_62_IOS26, island: ISLAND_62 },
  "iphone-air": { safeArea: SAFE_AIR, island: ISLAND_AIR },
  "iphone-17e": { safeArea: SAFE_NOTCH_IOS26 },

  "iphone-16": { safeArea: SAFE_59, island: ISLAND_59 },
  "iphone-16-plus": { safeArea: SAFE_59, island: ISLAND_59 },
  "iphone-16-pro": { safeArea: SAFE_62, island: ISLAND_62 },
  "iphone-16-pro-max": { safeArea: SAFE_62, island: ISLAND_62 },
  "iphone-16e": { safeArea: SAFE_NOTCH },

  "iphone-15": { safeArea: SAFE_59, island: ISLAND_59 },
  "iphone-15-plus": { safeArea: SAFE_59, island: ISLAND_59 },
  "iphone-15-pro": { safeArea: SAFE_59, island: ISLAND_59 },
  "iphone-15-pro-max": { safeArea: SAFE_59, island: ISLAND_59 },
};
