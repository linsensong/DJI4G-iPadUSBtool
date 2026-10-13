import { describe, expect, it } from 'vitest'
import { makeSnapshot } from '../test/fixtures'
import {
  backupFileName,
  createBackup,
  createBackupStore,
  parseBackup,
  serializeBackup,
} from './backup'

describe('backup files', () => {
  it('round-trips through JSON', () => {
    const backup = createBackup(makeSnapshot())
    expect(parseBackup(serializeBackup(backup))).toEqual(backup)
    expect(backup).toMatchObject({
      usbnet: 0,
      usbcfg: '0x2CA3,0x4006,1,1,1,1,1,0,0',
      module: { imei: '860000123456789' },
    })
  })

  it('names files after the IMEI suffix and capture time', () => {
    expect(backupFileName(createBackup(makeSnapshot()))).toBe(
      'dji4g-backup-6789-20261013-060000.json',
    )
  })

  it('rejects files that are not valid backups', () => {
    expect(() => parseBackup('not json')).toThrow('不是有效的 JSON')
    expect(() => parseBackup('{"format":"other"}')).toThrow('不是本工具生成的备份文件')
    const valid = JSON.parse(serializeBackup(createBackup(makeSnapshot())))
    expect(() => parseBackup(JSON.stringify({ ...valid, usbnet: 9 }))).toThrow('usbnet')
    expect(() => parseBackup(JSON.stringify({ ...valid, pdpContexts: [{ cid: 'x' }] }))).toThrow(
      'PDP',
    )
  })
})

describe('createBackupStore', () => {
  it('keeps the very first configuration even after the module was changed', () => {
    const store = createBackupStore(null)
    const factory = createBackup(makeSnapshot())
    const configured = createBackup(makeSnapshot({ usbnet: 1 }))

    expect(store.keepOriginal(factory).usbnet).toBe(0)
    expect(store.keepOriginal(configured).usbnet).toBe(0)
    expect(store.getOriginal('860000123456789')?.usbnet).toBe(0)
    expect(store.getOriginal('000000000000000')).toBeNull()
  })

  it('persists to the provided Storage', () => {
    const store = createBackupStore(localStorage)
    store.keepOriginal(createBackup(makeSnapshot({ imei: '860000111122223' })))
    expect(createBackupStore(localStorage).getOriginal('860000111122223')?.usbnet).toBe(0)
    localStorage.clear()
  })
})
