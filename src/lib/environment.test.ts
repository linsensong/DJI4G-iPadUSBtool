import { describe, expect, it } from 'vitest'
import { detectPlatform, detectSupport, maskIdentifier, recommendedConnection } from './environment'

const MAC_CHROME =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'
const IPAD_SAFARI =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15'
const WINDOWS_EDGE =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0'

const nav = (userAgent: string, platform: string, maxTouchPoints = 0, extra = {}) => ({
  userAgent,
  platform,
  maxTouchPoints,
  ...extra,
})

describe('detectPlatform', () => {
  it('tells an iPad that pretends to be a Mac apart from a real Mac', () => {
    expect(detectPlatform(nav(IPAD_SAFARI, 'MacIntel', 5))).toBe('ipados')
    expect(detectPlatform(nav(MAC_CHROME, 'MacIntel', 0))).toBe('macos')
  })

  it('recognises the other desktop and mobile systems', () => {
    expect(detectPlatform(nav(WINDOWS_EDGE, 'Win32'))).toBe('windows')
    expect(detectPlatform(nav('Mozilla/5.0 (X11; Linux x86_64)', 'Linux x86_64'))).toBe('linux')
    expect(detectPlatform(nav('Mozilla/5.0 (Linux; Android 15; Pixel 9)', 'Linux armv8l', 5))).toBe(
      'android',
    )
    expect(detectPlatform(nav('Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X)', 'iPhone', 5))).toBe(
      'ios',
    )
  })
})

describe('detectSupport', () => {
  it('reports which device APIs the browser exposes', () => {
    expect(detectSupport(nav(MAC_CHROME, 'MacIntel', 0, { usb: {}, serial: {} }), true)).toEqual({
      platform: 'macos',
      webUsb: true,
      webSerial: true,
      secureContext: true,
    })
    expect(detectSupport(nav(IPAD_SAFARI, 'MacIntel', 5), true)).toMatchObject({
      platform: 'ipados',
      webUsb: false,
      webSerial: false,
    })
  })

  it('suggests WebUSB on macOS and Web Serial on Windows', () => {
    expect(recommendedConnection('macos')).toBe('webusb')
    expect(recommendedConnection('windows')).toBe('webserial')
    expect(recommendedConnection('ipados')).toBeNull()
  })
})

describe('maskIdentifier', () => {
  it('hides the middle of long identifiers', () => {
    expect(maskIdentifier('860000123456789')).toBe('8600•••••••6789')
    expect(maskIdentifier('1234')).toBe('1234')
    expect(maskIdentifier(null)).toBe('—')
  })
})
