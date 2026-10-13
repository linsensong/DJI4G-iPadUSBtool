import { AtTimeoutError, LinkClosedError, type AtChannel } from './at'
import { describePdpType, type PlanStep, type SetupPlan } from './plan'
import { primaryContext, readSnapshot, type ModemSnapshot } from './status'

export type ConnectionKind = 'webusb' | 'webserial' | 'demo'

export interface Connector {
  readonly kind: ConnectionKind
  /** Shows the browser device picker; must be called from a user gesture. */
  request(): Promise<AtChannel>
  /** Re-opens an already authorised module without a picker, or returns null. */
  reconnect(): Promise<AtChannel | null>
}

export type StepStatus = 'pending' | 'running' | 'done' | 'failed'

export interface StepEvent {
  step: PlanStep
  status: StepStatus
  detail?: string
}

export class PlanStepError extends Error {
  constructor(
    readonly step: PlanStep,
    readonly response: string,
  ) {
    super(`「${step.title}」失败：${response}`)
    this.name = 'PlanStepError'
  }
}

/**
 * Runs the plan's commands in order. Returns `'rebooting'` once the module has
 * been told to restart (or dropped off the bus while applying a change).
 */
export async function applyPlan(
  channel: AtChannel,
  plan: SetupPlan,
  onEvent: (event: StepEvent) => void = () => {},
): Promise<'rebooting' | 'unchanged'> {
  for (const step of plan.steps) {
    onEvent({ step, status: 'running' })
    try {
      const result = await channel.send(step.command, step.timeoutMs)
      if (!result.ok) {
        onEvent({ step, status: 'failed', detail: result.final })
        throw new PlanStepError(step, result.final)
      }
      onEvent({ step, status: 'done', detail: result.final })
    } catch (error) {
      if (error instanceof PlanStepError) throw error
      const rebootSignal =
        step.mayReboot && (error instanceof LinkClosedError || error instanceof AtTimeoutError)
      if (!rebootSignal) {
        onEvent({ step, status: 'failed', detail: (error as Error).message })
        throw error
      }
      onEvent({ step, status: 'done', detail: '模块已开始重启' })
      return 'rebooting'
    }
  }
  return plan.steps.length > 0 ? 'rebooting' : 'unchanged'
}

export interface VerifyResult {
  ok: boolean
  snapshot: ModemSnapshot
  mismatches: string[]
}

export async function verifyPlan(channel: AtChannel, plan: SetupPlan): Promise<VerifyResult> {
  const snapshot = await readSnapshot(channel)
  const mismatches: string[] = []
  if (plan.target.usbnet !== null && snapshot.usbnet !== plan.target.usbnet) {
    mismatches.push(
      `USB 网卡模式应为 ${plan.target.usbnet}，实际为 ${snapshot.usbnet ?? '未知'}`,
    )
  }
  if (plan.target.apn !== null) {
    const apn = primaryContext(snapshot)?.apn ?? ''
    if (apn.toLowerCase() !== plan.target.apn.toLowerCase()) {
      mismatches.push(`APN 应为「${plan.target.apn}」，实际为「${apn}」`)
    }
  }
  if (plan.target.pdpType !== null) {
    const pdpType = primaryContext(snapshot)?.pdpType ?? ''
    if (pdpType.toUpperCase() !== plan.target.pdpType) {
      mismatches.push(
        `IP 类型应为「${describePdpType(plan.target.pdpType)}」，实际为「${describePdpType(pdpType)}」`,
      )
    }
  }
  return { ok: mismatches.length === 0, snapshot, mismatches }
}

export interface WaitOptions {
  timeoutMs?: number
  intervalMs?: number
  signal?: AbortSignal
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(timer)
      resolve()
    })
  })

/** Polls until the rebooted module answers AT again; null on timeout or abort. */
export async function waitForModule(
  connector: Connector,
  { timeoutMs = 90_000, intervalMs = 2000, signal }: WaitOptions = {},
): Promise<AtChannel | null> {
  const deadline = Date.now() + timeoutMs
  while (!signal?.aborted && Date.now() < deadline) {
    await sleep(intervalMs, signal)
    if (signal?.aborted) break
    try {
      const channel = await connector.reconnect()
      if (channel) return channel
    } catch {
      // The module is still enumerating; keep polling until the deadline.
    }
  }
  return null
}
