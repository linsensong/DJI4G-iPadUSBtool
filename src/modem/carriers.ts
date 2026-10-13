export interface Carrier {
  id: 'telecom' | 'mobile' | 'unicom' | 'broadnet'
  name: string
  apn: string
  plmns: readonly string[]
}

export const CARRIERS: readonly Carrier[] = [
  { id: 'telecom', name: '中国电信', apn: 'ctnet', plmns: ['46003', '46005', '46011'] },
  { id: 'mobile', name: '中国移动', apn: 'cmnet', plmns: ['46000', '46002', '46004', '46007', '46008'] },
  { id: 'unicom', name: '中国联通', apn: '3gnet', plmns: ['46001', '46006', '46009'] },
  { id: 'broadnet', name: '中国广电', apn: 'cbnet', plmns: ['46015'] },
]

/** Looks up a carrier from an IMSI or a PLMN (MCC+MNC); only the first five digits matter. */
export function carrierFromPlmn(value: string | null | undefined): Carrier | null {
  if (!value) return null
  const plmn = value.replace(/\D/g, '').slice(0, 5)
  return CARRIERS.find((carrier) => carrier.plmns.includes(plmn)) ?? null
}

export function carrierByApn(apn: string): Carrier | null {
  const normalized = apn.trim().toLowerCase()
  return CARRIERS.find((carrier) => carrier.apn === normalized) ?? null
}
