import { carrierFromPlmn } from '../modem/carriers'
import type { ModemSnapshot } from '../modem/status'

/** A factory-fresh DJI module with a registered China Telecom SIM. */
export function makeSnapshot(overrides: Partial<ModemSnapshot> = {}): ModemSnapshot {
  return {
    capturedAt: '2026-10-13T06:00:00.000Z',
    identity: { manufacturer: 'Quectel', model: 'QDC507', revision: 'QDC507R01' },
    imei: '860000123456789',
    sim: { kind: 'ready' },
    imsi: '460110123456789',
    iccid: '89860321000000000017',
    carrier: carrierFromPlmn('46011'),
    signal: { rssi: 24, ber: 99, dbm: -65, bars: 4 },
    operator: { name: 'CHN-CT', accessTech: 7 },
    registration: { stat: 1, registered: true, label: '已注册（本地网络）' },
    network: { accessTech: 'FDD LTE', plmn: '46011', band: 'LTE BAND 3', channel: 1825 },
    cfun: 1,
    usbnet: 0,
    usbcfg: {
      vendorId: 0x2ca3,
      productId: 0x4006,
      flags: [1, 1, 1, 1, 1, 0, 0],
      raw: '0x2CA3,0x4006,1,1,1,1,1,0,0',
    },
    pdpContexts: [{ cid: 1, pdpType: 'IPV4V6', apn: '' }],
    raw: {},
    ...overrides,
  }
}
