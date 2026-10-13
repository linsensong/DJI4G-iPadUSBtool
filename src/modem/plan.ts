import type { ModemBackup } from './backup'
import { usbAudioEnabled } from './parse'
import { primaryContext, type ModemSnapshot } from './status'

/** `AT+QCFG="usbnet",1` exposes CDC-ECM, which iPadOS drives natively as Ethernet. */
export const IPAD_USBNET_MODE = 1

export const USBNET_MODES: Record<number, { name: string; hint: string }> = {
  0: { name: 'QMI / RmNet', hint: '大疆出厂通常是这个模式，iPad 无法识别' },
  1: { name: 'ECM', hint: 'iPad / Mac 免驱识别为「以太网」' },
  2: { name: 'MBIM', hint: 'Windows 移动宽带模式，iPad 不支持' },
  3: { name: 'RNDIS', hint: '部分 Windows / Android 使用，iPad 不支持' },
}

export function describeUsbnet(mode: number | null): string {
  if (mode === null) return '未知'
  const known = USBNET_MODES[mode]
  return known ? `${mode} · ${known.name}` : `${mode}`
}

export type ApnChoice = { kind: 'keep' } | { kind: 'set'; apn: string }

export interface ApnRecommendation {
  choice: ApnChoice
  reason: string
}

const APN_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,61}[A-Za-z0-9])?$/
const PDP_TYPES = ['IP', 'IPV6', 'IPV4V6']
/** PDP type "IP" makes the module request only an IPv4 bearer, so no public IPv6 prefix reaches the iPad. */
export const IPV4_ONLY_PDP_TYPE = 'IP'
const DUAL_STACK_PDP_TYPE = 'IPV4V6'

const PDP_TYPE_NAMES: Record<string, string> = {
  IP: '仅 IPv4',
  IPV4V6: 'IPv4 + IPv6',
  IPV6: '仅 IPv6',
}

export function describePdpType(pdpType: string | undefined): string {
  if (!pdpType) return '未知'
  return PDP_TYPE_NAMES[pdpType.toUpperCase()] ?? pdpType
}

export function isIpv4Only(snapshot: Pick<ModemSnapshot, 'pdpContexts'>): boolean {
  return primaryContext(snapshot)?.pdpType.toUpperCase() === IPV4_ONLY_PDP_TYPE
}

export interface IpadSetupOptions {
  /** `true` writes PDP type IP, `false` turns an IPv4-only context back into IPV4V6, omitted keeps it. */
  ipv4Only?: boolean
}

export function validateApn(apn: string): string | null {
  if (!apn.trim()) return 'APN 不能为空'
  if (!APN_PATTERN.test(apn.trim())) return 'APN 只能包含字母、数字、点、短横线和下划线'
  return null
}

export function recommendApn(snapshot: ModemSnapshot): ApnRecommendation {
  const current = primaryContext(snapshot)?.apn ?? ''
  const carrier = snapshot.carrier
  if (!carrier) {
    return {
      choice: { kind: 'keep' },
      reason: current
        ? `未能识别 SIM 运营商，保留当前 APN「${current}」`
        : '未能识别 SIM 运营商，保留模块当前设置',
    }
  }
  if (current.toLowerCase() === carrier.apn) {
    return { choice: { kind: 'keep' }, reason: `当前 APN 已是${carrier.name}的「${carrier.apn}」` }
  }
  return {
    choice: { kind: 'set', apn: carrier.apn },
    reason: current
      ? `当前 APN「${current}」与${carrier.name} SIM 不匹配，建议改为「${carrier.apn}」`
      : `检测到${carrier.name} SIM，建议设置 APN「${carrier.apn}」`,
  }
}

export interface PlanStep {
  id: 'apn' | 'usbnet' | 'reboot'
  title: string
  command: string
  timeoutMs: number
  /** The module may drop off the bus while (or right after) handling this command. */
  mayReboot: boolean
}

export interface SetupPlan {
  kind: 'ipad' | 'restore'
  steps: PlanStep[]
  /** Values to confirm after the reboot; `null` means "not part of this plan". */
  target: { usbnet: number | null; apn: string | null; pdpType: string | null }
  warnings: string[]
}

function contextStep(
  pdpType: string,
  apn: string,
  changes: { apn: boolean; pdpType: boolean },
): PlanStep | null {
  if (!changes.apn && !changes.pdpType) return null
  const parts: string[] = []
  if (changes.apn) parts.push(apn ? `设置 APN 为「${apn}」` : '清空 APN（由网络自动分配）')
  if (changes.pdpType) {
    parts.push(
      pdpType === IPV4_ONLY_PDP_TYPE ? '关闭 IPv6（仅 IPv4）' : `IP 类型设为 ${describePdpType(pdpType)}`,
    )
  }
  return {
    id: 'apn',
    title: parts.join('，'),
    command: `AT+CGDCONT=1,"${pdpType}","${apn}"`,
    timeoutMs: 5000,
    mayReboot: false,
  }
}

function usbnetStep(mode: number): PlanStep {
  const known = USBNET_MODES[mode]
  return {
    id: 'usbnet',
    title: `切换 USB 网卡模式为 ${mode}${known ? `（${known.name}）` : ''}`,
    command: `AT+QCFG="usbnet",${mode}`,
    timeoutMs: 8000,
    mayReboot: true,
  }
}

const REBOOT_STEP: PlanStep = {
  id: 'reboot',
  title: '重启模块使配置生效',
  command: 'AT+CFUN=1,1',
  timeoutMs: 5000,
  mayReboot: true,
}

function withReboot(steps: PlanStep[]): PlanStep[] {
  return steps.length > 0 ? [...steps, REBOOT_STEP] : steps
}

function safePdpType(pdpType: string | undefined): string {
  const upper = (pdpType ?? '').toUpperCase()
  return PDP_TYPES.includes(upper) ? upper : DUAL_STACK_PDP_TYPE
}

function targetPdpType(current: string, ipv4Only: boolean | undefined): string {
  if (ipv4Only === undefined) return current
  if (ipv4Only) return IPV4_ONLY_PDP_TYPE
  return current === IPV4_ONLY_PDP_TYPE ? DUAL_STACK_PDP_TYPE : current
}

function environmentWarnings(snapshot: ModemSnapshot): string[] {
  const warnings: string[] = []
  if (snapshot.sim.kind === 'absent') {
    warnings.push('没有检测到 SIM 卡。配置仍可写入，但插到 iPad 前必须插好 SIM 卡。')
  } else if (snapshot.sim.kind !== 'ready') {
    warnings.push('SIM 卡未就绪（可能需要 PIN 或接触不良），iPad 将无法上网。')
  } else if (snapshot.registration && !snapshot.registration.registered) {
    warnings.push(`模块尚未注册到蜂窝网络（${snapshot.registration.label}），请检查信号或 SIM 是否欠费。`)
  }
  if (snapshot.cfun !== null && snapshot.cfun !== 1) {
    warnings.push(`模块当前处于 CFUN=${snapshot.cfun}（射频未完全开启），重启后会恢复为正常模式。`)
  }
  if (snapshot.usbcfg && usbAudioEnabled(snapshot.usbcfg)) {
    warnings.push('模块开启了 USB 音频功能，iPad 可能把它当成声卡并把声音输出到模块上。')
  }
  if (snapshot.usbnet === null) {
    warnings.push('读取不到当前 USB 网卡模式，仍会尝试写入，重启后再校验。')
  }
  return warnings
}

export function planIpadSetup(
  snapshot: ModemSnapshot,
  choice: ApnChoice,
  options: IpadSetupOptions = {},
): SetupPlan {
  const steps: PlanStep[] = []
  let targetApn: string | null = null
  if (choice.kind === 'set') {
    const error = validateApn(choice.apn)
    if (error) throw new Error(error)
    targetApn = choice.apn.trim()
  }
  const current = primaryContext(snapshot)
  const currentApn = current?.apn ?? ''
  const currentPdpType = safePdpType(current?.pdpType)
  const pdpType = targetPdpType(currentPdpType, options.ipv4Only)
  const apnChanged = targetApn !== null && currentApn.toLowerCase() !== targetApn.toLowerCase()
  const step = contextStep(pdpType, targetApn ?? currentApn, {
    apn: apnChanged,
    pdpType: pdpType !== currentPdpType,
  })
  if (step) steps.push(step)
  if (snapshot.usbnet !== IPAD_USBNET_MODE) {
    steps.push(usbnetStep(IPAD_USBNET_MODE))
  }
  return {
    kind: 'ipad',
    steps: withReboot(steps),
    target: {
      usbnet: IPAD_USBNET_MODE,
      apn: targetApn,
      pdpType: options.ipv4Only === undefined ? null : pdpType,
    },
    warnings: environmentWarnings(snapshot),
  }
}

/** Puts back exactly what the backup recorded; values already equal are skipped. */
export function planRestore(backup: ModemBackup, snapshot: ModemSnapshot): SetupPlan {
  const steps: PlanStep[] = []
  const warnings: string[] = []
  if (backup.module.imei && snapshot.imei && backup.module.imei !== snapshot.imei) {
    warnings.push('备份文件来自另一块模块（IMEI 不一致），请确认后再恢复。')
  }

  const saved = backup.pdpContexts.find((context) => context.cid === 1) ?? null
  let targetApn: string | null = null
  let targetType: string | null = null
  if (saved) {
    if (saved.apn && validateApn(saved.apn)) {
      throw new Error(`备份中的 APN「${saved.apn}」格式无效，已拒绝恢复`)
    }
    const current = primaryContext(snapshot)
    targetType = safePdpType(saved.pdpType)
    const step = contextStep(targetType, saved.apn, {
      apn: current?.apn !== saved.apn,
      pdpType: safePdpType(current?.pdpType) !== targetType,
    })
    if (step) steps.push(step)
    targetApn = saved.apn
  }
  if (backup.usbnet !== null && backup.usbnet !== snapshot.usbnet) {
    steps.push(usbnetStep(backup.usbnet))
  }
  return {
    kind: 'restore',
    steps: withReboot(steps),
    target: { usbnet: backup.usbnet, apn: targetApn, pdpType: targetType },
    warnings,
  }
}

/** Fallback when no backup exists: put the USB network mode back to QMI (0) only. */
export function planFactoryUsbnet(snapshot: ModemSnapshot): SetupPlan {
  const steps = snapshot.usbnet === 0 ? [] : [usbnetStep(0)]
  return {
    kind: 'restore',
    steps: withReboot(steps),
    target: { usbnet: 0, apn: null, pdpType: null },
    warnings: ['没有原始备份，只会把 USB 网卡模式改回 0（QMI），APN 保持不变。'],
  }
}

export type CommandRisk =
  | { level: 'safe' }
  | { level: 'danger'; reason: string }
  | { level: 'blocked'; reason: string }

const BLOCKED_COMMANDS: Array<{ pattern: RegExp; reason: string }> = [
  {
    pattern: /^AT\+EGMR\s*=\s*1/i,
    reason: '修改 IMEI 属违法行为，且会导致无法入网，本工具不允许发送',
  },
]

const DANGEROUS_COMMANDS: Array<{ pattern: RegExp; reason: string }> = [
  {
    pattern: /^AT\+QCFG\s*=\s*"usbcfg"\s*,/i,
    reason: '会改写模块的 USB 身份和接口组合，写错可能导致 AT 口消失、电脑再也连不上模块',
  },
  {
    pattern: /^AT\+QCFG\s*=\s*"usbmode"/i,
    reason: '可能把 USB 切成主机模式，模块将无法再被电脑识别',
  },
  {
    pattern: /^AT\+QCFG\s*=\s*"usbnet"\s*,/i,
    reason: '会切换 USB 网卡模式（重启后生效），建议用页面上的一键配置 / 恢复，它会先备份',
  },
  { pattern: /^AT\+QPRTPARA/i, reason: '会恢复或改写模块的出厂参数' },
  { pattern: /^AT&F/i, reason: '会恢复出厂设置' },
  {
    pattern: /^AT\+Q(FASTBOOT|DOWNLOAD|FOTADL)/i,
    reason: '会让模块进入固件下载 / 升级流程，操作不当可能变砖',
  },
  { pattern: /^AT\+QPOWD/i, reason: '会关闭模块电源，需要重新插拔才能恢复' },
  { pattern: /^AT\+CFUN\s*=\s*[04]\b/i, reason: '会关闭射频（飞行模式），模块将断网' },
]

export function assessCommand(command: string): CommandRisk {
  const trimmed = command.trim()
  for (const rule of BLOCKED_COMMANDS) {
    if (rule.pattern.test(trimmed)) return { level: 'blocked', reason: rule.reason }
  }
  for (const rule of DANGEROUS_COMMANDS) {
    if (rule.pattern.test(trimmed)) return { level: 'danger', reason: rule.reason }
  }
  return { level: 'safe' }
}
