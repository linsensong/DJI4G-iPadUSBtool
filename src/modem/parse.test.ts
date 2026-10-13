import { describe, expect, it } from 'vitest'
import type { AtResult } from './at'
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
  splitParams,
  usbAudioEnabled,
} from './parse'

function result(final: string, lines: string[] = []): AtResult {
  return { command: 'AT', ok: final === 'OK', final, lines, raw: '' }
}

describe('splitParams', () => {
  it('keeps commas inside quotes and unquotes values', () => {
    expect(splitParams('1,"IPV4V6","ctnet","0.0.0.0",0,0')).toEqual([
      '1',
      'IPV4V6',
      'ctnet',
      '0.0.0.0',
      '0',
      '0',
    ])
    expect(splitParams('"FDD LTE","46011","LTE BAND 3",1825')).toEqual([
      'FDD LTE',
      '46011',
      'LTE BAND 3',
      '1825',
    ])
  })
})

describe('Quectel configuration parsers', () => {
  it('reads the usbnet mode', () => {
    expect(parseUsbnet(['+QCFG: "usbnet",1'])).toBe(1)
    expect(parseUsbnet(['+QCFG: "USBNET",0'])).toBe(0)
    expect(parseUsbnet(['+QCFG: "nat",1'])).toBeNull()
  })

  it('reads the DJI factory USB composition', () => {
    const composition = parseUsbcfg(['+QCFG: "usbcfg",0x2CA3,0x4006,1,1,1,1,1,0,0'])
    expect(composition).toMatchObject({
      vendorId: 0x2ca3,
      productId: 0x4006,
      flags: [1, 1, 1, 1, 1, 0, 0],
    })
    expect(usbAudioEnabled(composition!)).toBe(false)
    expect(usbAudioEnabled(parseUsbcfg(['+QCFG: "usbcfg",0x2C7C,0x0125,1,1,1,1,1,1,1'])!)).toBe(true)
  })

  it('reads every PDP context', () => {
    expect(
      parsePdpContexts([
        '+CGDCONT: 1,"IPV4V6","","0.0.0.0",0,0,0,0',
        '+CGDCONT: 2,"IPV4V6","ims","0.0.0.0",0,0,0,0',
      ]),
    ).toEqual([
      { cid: 1, pdpType: 'IPV4V6', apn: '' },
      { cid: 2, pdpType: 'IPV4V6', apn: 'ims' },
    ])
  })
})

describe('SIM and network parsers', () => {
  it('maps CPIN answers and CME errors', () => {
    expect(parseSim(result('OK', ['+CPIN: READY']))).toEqual({ kind: 'ready' })
    expect(parseSim(result('OK', ['+CPIN: SIM PIN']))).toEqual({ kind: 'pin-required' })
    expect(parseSim(result('+CME ERROR: 10'))).toEqual({ kind: 'absent' })
    expect(parseSim(result('+CME ERROR: SIM not inserted'))).toEqual({ kind: 'absent' })
    expect(parseSim(result('+CME ERROR: 14'))).toEqual({ kind: 'busy' })
  })

  it('converts CSQ to dBm and bars', () => {
    expect(parseCsq(['+CSQ: 24,99'])).toEqual({ rssi: 24, ber: 99, dbm: -65, bars: 4 })
    expect(parseCsq(['+CSQ: 12,99'])).toMatchObject({ dbm: -89, bars: 2 })
    expect(parseCsq(['+CSQ: 99,99'])).toMatchObject({ dbm: null, bars: 0 })
  })

  it('reads operator, registration and serving network', () => {
    expect(parseCops(['+COPS: 0,0,"CHN-CT",7'])).toEqual({ name: 'CHN-CT', accessTech: 7 })
    expect(parseCops(['+COPS: 0'])).toEqual({ name: null, accessTech: null })
    expect(parseRegistration(['+CEREG: 0,1'])).toMatchObject({ stat: 1, registered: true })
    expect(parseRegistration(['+CEREG: 2,5,"1A2B","0C3D4E5",7'])).toMatchObject({
      stat: 5,
      registered: true,
    })
    expect(parseRegistration(['+CEREG: 0,2'])).toMatchObject({ registered: false, label: '正在搜索网络' })
    expect(parseQnwinfo(['+QNWINFO: "FDD LTE","46011","LTE BAND 3",1825'])).toEqual({
      accessTech: 'FDD LTE',
      plmn: '46011',
      band: 'LTE BAND 3',
      channel: 1825,
    })
    expect(parseCfun(['+CFUN: 1'])).toBe(1)
  })

  it('extracts identifiers from bare and prefixed lines', () => {
    expect(parseImei(['860000123456789'])).toBe('860000123456789')
    expect(parseImei(['+CGSN: "860000123456789"'])).toBe('860000123456789')
    expect(parseImsi(['460110123456789'])).toBe('460110123456789')
    expect(parseIccid(['+QCCID: 89860321000000000017'])).toBe('89860321000000000017')
    expect(parseIccid(['+QCCID: 8986032100000000001F'])).toBe('8986032100000000001F')
  })

  it('reads the module identity from ATI', () => {
    expect(parseIdentity(['Quectel', 'EG25', 'Revision: EG25GGBR07A08M2G'])).toEqual({
      manufacturer: 'Quectel',
      model: 'EG25',
      revision: 'EG25GGBR07A08M2G',
    })
    expect(parseIdentity(['Quectel', 'QDC507'], ['QDC507R01'])).toMatchObject({
      revision: 'QDC507R01',
    })
  })
})
