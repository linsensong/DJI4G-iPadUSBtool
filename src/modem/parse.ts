import type { AtResult } from './at'

/** Returns the text after `PREFIX:` for every line carrying that prefix. */
export function payloads(lines: readonly string[], prefix: string): string[] {
  const head = `${prefix.toUpperCase()}:`
  return lines
    .filter((line) => line.toUpperCase().startsWith(head))
    .map((line) => line.slice(head.length).trim())
}

/** Splits an AT parameter list on commas outside double quotes and unquotes values. */
export function splitParams(payload: string): string[] {
  const params: string[] = []
  let current = ''
  let quoted = false
  for (const char of payload) {
    if (char === '"') {
      quoted = !quoted
      continue
    }
    if (char === ',' && !quoted) {
      params.push(current.trim())
      current = ''
      continue
    }
    current += char
  }
  params.push(current.trim())
  return params
}

function toInt(value: string | undefined): number | null {
  if (value === undefined || value.trim() === '') return null
  const parsed = Number(value.trim())
  return Number.isInteger(parsed) ? parsed : null
}

function qcfg(lines: readonly string[], key: string): string[] | null {
  for (const payload of payloads(lines, '+QCFG')) {
    const params = splitParams(payload)
    if (params[0]?.toLowerCase() === key) return params.slice(1)
  }
  return null
}

export function parseUsbnet(lines: readonly string[]): number | null {
  const params = qcfg(lines, 'usbnet')
  return params ? toInt(params[0]) : null
}

export interface UsbComposition {
  vendorId: number
  productId: number
  /** Function switches in Quectel order: diag, nmea, at, modem, net, adb, uac. */
  flags: number[]
  raw: string
}

export function parseUsbcfg(lines: readonly string[]): UsbComposition | null {
  const params = qcfg(lines, 'usbcfg')
  if (!params || params.length < 2) return null
  const vendorId = toInt(params[0])
  const productId = toInt(params[1])
  if (vendorId === null || productId === null) return null
  const flags = params.slice(2).map((flag) => toInt(flag) ?? -1)
  return { vendorId, productId, flags, raw: params.join(',') }
}

/** USB Audio is the last function switch; iPadOS would treat the module as a sound card. */
export function usbAudioEnabled(composition: UsbComposition): boolean {
  return composition.flags.length >= 7 && composition.flags[composition.flags.length - 1] === 1
}

export interface PdpContext {
  cid: number
  pdpType: string
  apn: string
}

export function parsePdpContexts(lines: readonly string[]): PdpContext[] {
  const contexts: PdpContext[] = []
  for (const payload of payloads(lines, '+CGDCONT')) {
    const [cid, pdpType = '', apn = ''] = splitParams(payload)
    const id = toInt(cid)
    if (id === null) continue
    contexts.push({ cid: id, pdpType, apn })
  }
  return contexts
}

export type SimState =
  | { kind: 'ready' }
  | { kind: 'absent' }
  | { kind: 'pin-required' }
  | { kind: 'puk-required' }
  | { kind: 'busy' }
  | { kind: 'error'; detail: string }

export function parseSim(result: AtResult): SimState {
  if (result.ok) {
    const [status = ''] = payloads(result.lines, '+CPIN')
    const upper = status.toUpperCase()
    if (upper === 'READY') return { kind: 'ready' }
    if (upper === 'SIM PIN') return { kind: 'pin-required' }
    if (upper === 'SIM PUK') return { kind: 'puk-required' }
    return { kind: 'error', detail: status || result.final }
  }
  const final = result.final
  if (/\b10\b|not inserted/i.test(final)) return { kind: 'absent' }
  if (/\b14\b|busy/i.test(final)) return { kind: 'busy' }
  return { kind: 'error', detail: final }
}

export interface SignalQuality {
  rssi: number
  ber: number | null
  dbm: number | null
  /** 0–4 bars, 0 when the module reports no measurable signal. */
  bars: number
}

export function parseCsq(lines: readonly string[]): SignalQuality | null {
  const [payload] = payloads(lines, '+CSQ')
  if (payload === undefined) return null
  const [rssiText, berText] = splitParams(payload)
  const rssi = toInt(rssiText)
  if (rssi === null) return null
  const known = rssi >= 0 && rssi <= 31
  const dbm = known ? -113 + rssi * 2 : null
  let bars = 0
  if (known) {
    if (rssi >= 20) bars = 4
    else if (rssi >= 15) bars = 3
    else if (rssi >= 10) bars = 2
    else if (rssi >= 2) bars = 1
  }
  return { rssi, ber: toInt(berText), dbm, bars }
}

export interface OperatorInfo {
  name: string | null
  accessTech: number | null
}

export function parseCops(lines: readonly string[]): OperatorInfo | null {
  const [payload] = payloads(lines, '+COPS')
  if (payload === undefined) return null
  const params = splitParams(payload)
  return { name: params[2] || null, accessTech: toInt(params[3]) }
}

export interface RegistrationInfo {
  stat: number
  registered: boolean
  label: string
}

const REGISTRATION_LABELS: Record<number, string> = {
  0: '未注册（未在搜索）',
  1: '已注册（本地网络）',
  2: '正在搜索网络',
  3: '注册被拒绝',
  4: '未知',
  5: '已注册（漫游）',
}

export function parseRegistration(
  lines: readonly string[],
  prefix: '+CEREG' | '+CREG' = '+CEREG',
): RegistrationInfo | null {
  const [payload] = payloads(lines, prefix)
  if (payload === undefined) return null
  const params = splitParams(payload)
  const stat = toInt(params.length >= 2 ? params[1] : params[0])
  if (stat === null) return null
  return {
    stat,
    registered: stat === 1 || stat === 5,
    label: REGISTRATION_LABELS[stat] ?? `状态 ${stat}`,
  }
}

export interface NetworkInfo {
  accessTech: string
  plmn: string | null
  band: string | null
  channel: number | null
}

export function parseQnwinfo(lines: readonly string[]): NetworkInfo | null {
  const [payload] = payloads(lines, '+QNWINFO')
  if (payload === undefined) return null
  const [accessTech = '', plmn, band, channel] = splitParams(payload)
  return {
    accessTech,
    plmn: plmn || null,
    band: band || null,
    channel: toInt(channel),
  }
}

function firstMatch(
  lines: readonly string[],
  pattern: RegExp,
  prefixes: string[] = [],
): string | null {
  const candidates = [
    ...prefixes.flatMap((prefix) => payloads(lines, prefix).map((p) => splitParams(p)[0])),
    ...lines,
  ]
  for (const candidate of candidates) {
    const value = candidate.trim()
    if (pattern.test(value)) return value
  }
  return null
}

export function parseImei(lines: readonly string[]): string | null {
  return firstMatch(lines, /^\d{14,17}$/, ['+CGSN', '+GSN'])
}

export function parseImsi(lines: readonly string[]): string | null {
  return firstMatch(lines, /^\d{6,15}$/, ['+CIMI'])
}

export function parseIccid(lines: readonly string[]): string | null {
  return firstMatch(lines, /^[0-9A-Fa-f]{18,22}$/, ['+QCCID', '+ICCID', '+CCID'])
}

export function parseCfun(lines: readonly string[]): number | null {
  const [payload] = payloads(lines, '+CFUN')
  return payload === undefined ? null : toInt(splitParams(payload)[0])
}

export interface ModuleIdentity {
  manufacturer: string | null
  model: string | null
  revision: string | null
}

export function parseIdentity(
  atiLines: readonly string[],
  cgmrLines: readonly string[] = [],
): ModuleIdentity {
  const info = atiLines.filter((line) => !/^revision:/i.test(line))
  const revisionLine = atiLines.find((line) => /^revision:/i.test(line))
  const cgmr = cgmrLines[0]?.replace(/^(\+CGMR:|revision:)\s*/i, '').trim()
  return {
    manufacturer: info[0] ?? null,
    model: info[1] ?? null,
    revision: revisionLine?.replace(/^revision:\s*/i, '').trim() || cgmr || null,
  }
}
