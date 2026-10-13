import type { PdpContext } from './parse'
import type { ModemSnapshot } from './status'

export const BACKUP_FORMAT = 'dji4g-ipad-backup'

export interface ModemBackup {
  format: typeof BACKUP_FORMAT
  version: 1
  createdAt: string
  module: { imei: string | null; model: string | null; revision: string | null }
  usbnet: number | null
  /** Informational only; this tool never writes USBCFG. */
  usbcfg: string | null
  pdpContexts: PdpContext[]
}

export function createBackup(snapshot: ModemSnapshot): ModemBackup {
  return {
    format: BACKUP_FORMAT,
    version: 1,
    createdAt: snapshot.capturedAt,
    module: {
      imei: snapshot.imei,
      model: snapshot.identity.model,
      revision: snapshot.identity.revision,
    },
    usbnet: snapshot.usbnet,
    usbcfg: snapshot.usbcfg?.raw ?? null,
    pdpContexts: snapshot.pdpContexts.map((context) => ({ ...context })),
  }
}

export function serializeBackup(backup: ModemBackup): string {
  return `${JSON.stringify(backup, null, 2)}\n`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

export function parseBackup(text: string): ModemBackup {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error('备份文件不是有效的 JSON')
  }
  if (!isRecord(data) || data.format !== BACKUP_FORMAT) {
    throw new Error('这不是本工具生成的备份文件')
  }
  if (data.version !== 1) {
    throw new Error(`不支持的备份版本：${String(data.version)}`)
  }
  const usbnet = data.usbnet
  if (usbnet !== null && !(Number.isInteger(usbnet) && (usbnet as number) >= 0 && (usbnet as number) <= 3)) {
    throw new Error('备份中的 usbnet 值无效')
  }
  if (!Array.isArray(data.pdpContexts)) {
    throw new Error('备份中缺少 APN（PDP）配置')
  }
  const pdpContexts = data.pdpContexts.map((entry): PdpContext => {
    if (
      !isRecord(entry) ||
      !Number.isInteger(entry.cid) ||
      (entry.cid as number) < 1 ||
      typeof entry.pdpType !== 'string' ||
      typeof entry.apn !== 'string'
    ) {
      throw new Error('备份中的 APN（PDP）配置格式无效')
    }
    return { cid: entry.cid as number, pdpType: entry.pdpType, apn: entry.apn }
  })
  const module = isRecord(data.module) ? data.module : {}
  return {
    format: BACKUP_FORMAT,
    version: 1,
    createdAt: optionalString(data.createdAt) ?? new Date(0).toISOString(),
    module: {
      imei: optionalString(module.imei),
      model: optionalString(module.model),
      revision: optionalString(module.revision),
    },
    usbnet: usbnet as number | null,
    usbcfg: optionalString(data.usbcfg),
    pdpContexts,
  }
}

export function backupFileName(backup: ModemBackup): string {
  const stamp = backup.createdAt.replace(/[-:]/g, '').replace(/\..*$/, '').replace('T', '-')
  const suffix = backup.module.imei ? `-${backup.module.imei.slice(-4)}` : ''
  return `dji4g-backup${suffix}-${stamp}.json`
}

export interface BackupStore {
  /** The first configuration ever seen for this module, i.e. before this tool changed it. */
  getOriginal(imei: string | null): ModemBackup | null
  /** Stores the backup unless an original already exists, so re-running setup never overwrites it. */
  keepOriginal(backup: ModemBackup): ModemBackup
}

const STORAGE_PREFIX = 'dji4g.original-backup.'

function storageKey(imei: string | null): string {
  return `${STORAGE_PREFIX}${imei ?? 'unknown'}`
}

function defaultStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

export function createBackupStore(storage: Storage | null = defaultStorage()): BackupStore {
  const memory = new Map<string, string>()
  const read = (key: string) => (storage ? storage.getItem(key) : (memory.get(key) ?? null))
  const write = (key: string, value: string) => {
    if (storage) storage.setItem(key, value)
    else memory.set(key, value)
  }

  return {
    getOriginal(imei) {
      const text = read(storageKey(imei))
      if (!text) return null
      try {
        return parseBackup(text)
      } catch {
        return null
      }
    },
    keepOriginal(backup) {
      const existing = this.getOriginal(backup.module.imei)
      if (existing) return existing
      write(storageKey(backup.module.imei), serializeBackup(backup))
      return backup
    },
  }
}
