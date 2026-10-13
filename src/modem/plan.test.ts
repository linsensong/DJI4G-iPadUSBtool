import { describe, expect, it } from 'vitest'
import { makeSnapshot } from '../test/fixtures'
import { createBackup } from './backup'
import { carrierFromPlmn } from './carriers'
import {
  assessCommand,
  planFactoryUsbnet,
  planIpadSetup,
  planRestore,
  recommendApn,
  validateApn,
} from './plan'

const commands = (plan: { steps: { command: string }[] }) => plan.steps.map((step) => step.command)

describe('carrierFromPlmn', () => {
  it('recognises China Telecom from the IMSI or PLMN', () => {
    expect(carrierFromPlmn('460110123456789')?.apn).toBe('ctnet')
    expect(carrierFromPlmn('46003')?.name).toBe('中国电信')
    expect(carrierFromPlmn('46001')?.apn).toBe('3gnet')
    expect(carrierFromPlmn('31026')).toBeNull()
  })
})

describe('recommendApn', () => {
  it('suggests ctnet for a Telecom SIM with an empty APN', () => {
    const { choice, reason } = recommendApn(makeSnapshot())
    expect(choice).toEqual({ kind: 'set', apn: 'ctnet' })
    expect(reason).toContain('中国电信')
  })

  it('keeps an APN that already matches the SIM', () => {
    const snapshot = makeSnapshot({ pdpContexts: [{ cid: 1, pdpType: 'IPV4V6', apn: 'CTNET' }] })
    expect(recommendApn(snapshot).choice).toEqual({ kind: 'keep' })
  })

  it('keeps the current APN when the carrier is unknown', () => {
    const snapshot = makeSnapshot({ carrier: null, imsi: null })
    expect(recommendApn(snapshot).choice).toEqual({ kind: 'keep' })
  })
})

describe('planIpadSetup', () => {
  it('sets the APN, switches to ECM and reboots a factory module', () => {
    const plan = planIpadSetup(makeSnapshot(), { kind: 'set', apn: 'ctnet' })
    expect(commands(plan)).toEqual([
      'AT+CGDCONT=1,"IPV4V6","ctnet"',
      'AT+QCFG="usbnet",1',
      'AT+CFUN=1,1',
    ])
    expect(plan.target).toEqual({ usbnet: 1, apn: 'ctnet' })
    expect(plan.warnings).toEqual([])
  })

  it('only switches the USB mode when the APN is kept', () => {
    const plan = planIpadSetup(makeSnapshot(), { kind: 'keep' })
    expect(commands(plan)).toEqual(['AT+QCFG="usbnet",1', 'AT+CFUN=1,1'])
    expect(plan.target.apn).toBeNull()
  })

  it('has nothing to do once the module is already in ECM mode with the right APN', () => {
    const snapshot = makeSnapshot({
      usbnet: 1,
      pdpContexts: [{ cid: 1, pdpType: 'IP', apn: 'ctnet' }],
    })
    expect(planIpadSetup(snapshot, { kind: 'set', apn: 'ctnet' }).steps).toEqual([])
  })

  it('preserves the existing PDP type when changing the APN', () => {
    const snapshot = makeSnapshot({ pdpContexts: [{ cid: 1, pdpType: 'IP', apn: 'cmnet' }] })
    expect(commands(planIpadSetup(snapshot, { kind: 'set', apn: 'ctnet' }))[0]).toBe(
      'AT+CGDCONT=1,"IP","ctnet"',
    )
  })

  it('rejects APNs that could break out of the AT command', () => {
    expect(() => planIpadSetup(makeSnapshot(), { kind: 'set', apn: 'ctnet","x' })).toThrow()
    expect(validateApn('')).not.toBeNull()
    expect(validateApn('ctnet')).toBeNull()
    expect(validateApn('m2m.iot-1')).toBeNull()
  })

  it('warns about a missing SIM, an unregistered module and USB audio', () => {
    const noSim = planIpadSetup(makeSnapshot({ sim: { kind: 'absent' } }), { kind: 'keep' })
    expect(noSim.warnings.join()).toContain('没有检测到 SIM 卡')

    const searching = planIpadSetup(
      makeSnapshot({ registration: { stat: 2, registered: false, label: '正在搜索网络' } }),
      { kind: 'keep' },
    )
    expect(searching.warnings.join()).toContain('尚未注册')

    const withAudio = planIpadSetup(
      makeSnapshot({
        usbcfg: { vendorId: 0x2c7c, productId: 0x0125, flags: [1, 1, 1, 1, 1, 1, 1], raw: '' },
      }),
      { kind: 'keep' },
    )
    expect(withAudio.warnings.join()).toContain('USB 音频')
  })
})

describe('planRestore', () => {
  const original = createBackup(makeSnapshot())
  const configured = makeSnapshot({
    usbnet: 1,
    pdpContexts: [{ cid: 1, pdpType: 'IPV4V6', apn: 'ctnet' }],
  })

  it('writes back the original APN and USB mode', () => {
    const plan = planRestore(original, configured)
    expect(commands(plan)).toEqual([
      'AT+CGDCONT=1,"IPV4V6",""',
      'AT+QCFG="usbnet",0',
      'AT+CFUN=1,1',
    ])
    expect(plan.target).toEqual({ usbnet: 0, apn: '' })
  })

  it('does nothing when the module already matches the backup', () => {
    expect(planRestore(original, makeSnapshot()).steps).toEqual([])
  })

  it('warns when the backup belongs to another module', () => {
    const plan = planRestore(original, { ...configured, imei: '860000999999999' })
    expect(plan.warnings.join()).toContain('另一块模块')
  })

  it('refuses a tampered APN in the backup', () => {
    const tampered = { ...original, pdpContexts: [{ cid: 1, pdpType: 'IP', apn: 'a";AT+QPOWD' }] }
    expect(() => planRestore(tampered, configured)).toThrow('格式无效')
  })

  it('falls back to usbnet 0 when there is no backup', () => {
    expect(commands(planFactoryUsbnet(configured))).toEqual(['AT+QCFG="usbnet",0', 'AT+CFUN=1,1'])
    expect(planFactoryUsbnet(makeSnapshot()).steps).toEqual([])
  })
})

describe('assessCommand', () => {
  it('lets read-only queries through', () => {
    expect(assessCommand('AT+CSQ')).toEqual({ level: 'safe' })
    expect(assessCommand('AT+QCFG="usbcfg"')).toEqual({ level: 'safe' })
    expect(assessCommand('AT+QCFG="usbnet"')).toEqual({ level: 'safe' })
  })

  it('flags commands that can make the module unreachable', () => {
    expect(assessCommand('AT+QCFG="usbcfg",0x2C7C,0x0125,1,1,1,1,1,0,0').level).toBe('danger')
    expect(assessCommand('at+qcfg="usbmode",1').level).toBe('danger')
    expect(assessCommand('AT+QCFG="usbnet",3').level).toBe('danger')
    expect(assessCommand('AT+CFUN=4').level).toBe('danger')
    expect(assessCommand('AT+CFUN=1,1').level).toBe('safe')
    expect(assessCommand('AT+QDOWNLOAD=1').level).toBe('danger')
  })

  it('blocks IMEI rewriting outright', () => {
    expect(assessCommand('AT+EGMR=1,7,"860000000000000"').level).toBe('blocked')
  })
})
