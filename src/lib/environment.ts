export type Platform = 'ipados' | 'ios' | 'macos' | 'windows' | 'linux' | 'android' | 'other'

export interface BrowserSupport {
  platform: Platform
  webUsb: boolean
  webSerial: boolean
  secureContext: boolean
}

type NavigatorLike = Pick<Navigator, 'userAgent' | 'platform' | 'maxTouchPoints'> & {
  usb?: unknown
  serial?: unknown
}

export function detectPlatform(nav: NavigatorLike): Platform {
  const ua = nav.userAgent
  if (/iPad/.test(ua)) return 'ipados'
  if (/iPhone|iPod/.test(ua)) return 'ios'
  if (/Android/.test(ua)) return 'android'
  // iPadOS Safari presents itself as a Mac; touch support gives it away.
  if (/Macintosh|MacIntel/.test(ua) || nav.platform === 'MacIntel') {
    return nav.maxTouchPoints > 1 ? 'ipados' : 'macos'
  }
  if (/Windows/.test(ua)) return 'windows'
  if (/Linux|X11/.test(ua)) return 'linux'
  return 'other'
}

export function detectSupport(
  nav: NavigatorLike = navigator,
  secureContext: boolean = typeof window !== 'undefined' && window.isSecureContext,
): BrowserSupport {
  return {
    platform: detectPlatform(nav),
    webUsb: 'usb' in nav && Boolean(nav.usb),
    webSerial: 'serial' in nav && Boolean(nav.serial),
    secureContext,
  }
}

export const PLATFORM_NAMES: Record<Platform, string> = {
  ipados: 'iPadOS',
  ios: 'iOS',
  macos: 'macOS',
  windows: 'Windows',
  linux: 'Linux',
  android: 'Android',
  other: '未知系统',
}

/** Which connection method to suggest first on each platform. */
export function recommendedConnection(platform: Platform): 'webusb' | 'webserial' | null {
  switch (platform) {
    case 'macos':
    case 'android':
    case 'linux':
      return 'webusb'
    case 'windows':
      return 'webserial'
    default:
      return null
  }
}

/** Keeps the first and last few characters of an identifier, masking the middle. */
export function maskIdentifier(value: string | null, visible = 4): string {
  if (!value) return '—'
  if (value.length <= visible * 2) return value
  return `${value.slice(0, visible)}${'•'.repeat(value.length - visible * 2)}${value.slice(-visible)}`
}
