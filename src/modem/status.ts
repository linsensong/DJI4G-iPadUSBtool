import { AtTimeoutError, type AtChannel, type AtResult } from './at'
import { carrierFromPlmn, type Carrier } from './carriers'
import {
  parseCfun,
  parseCops,
  parseCsq,
  parseIccid,
  parseIdentity,
  parseImei,
  parseImsi,
  parsePdpContexts,
  parseQnwinfo,
  parseRegistration,
  parseSim,
  parseUsbcfg,
  parseUsbnet,
  type ModuleIdentity,
  type NetworkInfo,
  type OperatorInfo,
  type PdpContext,
  type RegistrationInfo,
  type SignalQuality,
  type SimState,
  type UsbComposition,
} from './parse'

export interface ModemSnapshot {
  capturedAt: string
  identity: ModuleIdentity
  imei: string | null
  sim: SimState
  imsi: string | null
  iccid: string | null
  carrier: Carrier | null
  signal: SignalQuality | null
  operator: OperatorInfo | null
  registration: RegistrationInfo | null
  network: NetworkInfo | null
  cfun: number | null
  usbnet: number | null
  usbcfg: UsbComposition | null
  pdpContexts: PdpContext[]
  /** Raw response per command, kept for the console view and support requests. */
  raw: Record<string, string>
}

/** Read-only queries; none of them change module state. */
export const STATUS_COMMANDS = {
  ati: 'ATI',
  cgmr: 'AT+CGMR',
  imei: 'AT+CGSN',
  sim: 'AT+CPIN?',
  imsi: 'AT+CIMI',
  iccid: 'AT+QCCID',
  cfun: 'AT+CFUN?',
  csq: 'AT+CSQ',
  cops: 'AT+COPS?',
  cereg: 'AT+CEREG?',
  qnwinfo: 'AT+QNWINFO',
  cgdcont: 'AT+CGDCONT?',
  usbnet: 'AT+QCFG="usbnet"',
  usbcfg: 'AT+QCFG="usbcfg"',
} as const

type StatusKey = keyof typeof STATUS_COMMANDS

const SLOW_COMMANDS: Partial<Record<StatusKey, number>> = { cops: 6000, iccid: 4000 }

function emptyResult(command: string, final: string): AtResult {
  return { command, ok: false, final, lines: [], raw: '' }
}

/**
 * Queries everything the setup flow needs. Individual command failures are
 * recorded rather than thrown; only a lost link aborts the read.
 */
export async function readSnapshot(channel: AtChannel): Promise<ModemSnapshot> {
  const results = {} as Record<StatusKey, AtResult>
  for (const key of Object.keys(STATUS_COMMANDS) as StatusKey[]) {
    const command = STATUS_COMMANDS[key]
    try {
      results[key] = await channel.send(command, SLOW_COMMANDS[key])
    } catch (error) {
      if (!(error instanceof AtTimeoutError)) throw error
      results[key] = emptyResult(command, 'TIMEOUT')
    }
  }

  const ok = (key: StatusKey) => (results[key].ok ? results[key].lines : [])
  const imsi = parseImsi(ok('imsi'))
  const network = parseQnwinfo(ok('qnwinfo'))
  const raw: Record<string, string> = {}
  for (const key of Object.keys(results) as StatusKey[]) {
    const result = results[key]
    raw[result.command] = [...result.lines, result.final].join('\n')
  }

  return {
    capturedAt: new Date().toISOString(),
    identity: parseIdentity(ok('ati'), ok('cgmr')),
    imei: parseImei(ok('imei')),
    sim: parseSim(results.sim),
    imsi,
    iccid: parseIccid(ok('iccid')),
    carrier: carrierFromPlmn(imsi) ?? carrierFromPlmn(network?.plmn),
    signal: parseCsq(ok('csq')),
    operator: parseCops(ok('cops')),
    registration: parseRegistration(ok('cereg')),
    network,
    cfun: parseCfun(ok('cfun')),
    usbnet: parseUsbnet(ok('usbnet')),
    usbcfg: parseUsbcfg(ok('usbcfg')),
    pdpContexts: parsePdpContexts(ok('cgdcont')),
    raw,
  }
}

export function primaryContext(snapshot: Pick<ModemSnapshot, 'pdpContexts'>): PdpContext | null {
  return snapshot.pdpContexts.find((context) => context.cid === 1) ?? null
}
