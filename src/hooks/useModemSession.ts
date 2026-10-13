import { useCallback, useEffect, useRef, useState } from 'react'
import type { AtChannel, AtResult } from '../modem/at'
import { createBackup, createBackupStore, type BackupStore, type ModemBackup } from '../modem/backup'
import type { SetupPlan } from '../modem/plan'
import { readSnapshot, type ModemSnapshot } from '../modem/status'
import {
  applyPlan,
  verifyPlan,
  waitForModule,
  type ConnectionKind,
  type Connector,
  type StepStatus,
} from '../modem/workflow'
import {
  SimulatedModule,
  createSimulatedConnector,
  type SimulatedModuleOptions,
} from '../transports/simulated'
import { createWebSerialConnector } from '../transports/webserial'
import { createWebUsbConnector } from '../transports/webusb'

export interface SessionOptions {
  createConnector?: (kind: ConnectionKind) => Connector
  backupStore?: BackupStore
  demoModuleOptions?: SimulatedModuleOptions
  reconnectTimeoutMs?: number
  reconnectIntervalMs?: number
}

export type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'rebooting' | 'lost'

export interface ConnectionState {
  status: ConnectionStatus
  kind: ConnectionKind | null
  description: string | null
  error: string | null
}

export interface OperationStep {
  id: string
  title: string
  command?: string
  status: StepStatus
  detail?: string
}

export interface OperationState {
  kind: SetupPlan['kind']
  status: 'running' | 'waiting' | 'needs-user' | 'done' | 'failed'
  steps: OperationStep[]
  message: string | null
}

const IDLE: ConnectionState = { status: 'idle', kind: null, description: null, error: null }

export function isOperationActive(operation: OperationState | null): boolean {
  return Boolean(operation && ['running', 'waiting', 'needs-user'].includes(operation.status))
}

function isUserCancel(error: unknown): boolean {
  return error instanceof Error && error.name === 'NotFoundError'
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function initialSteps(plan: SetupPlan): OperationStep[] {
  return [
    ...plan.steps.map((step) => ({
      id: step.id,
      title: step.title,
      command: step.command,
      status: 'pending' as const,
    })),
    { id: 'wait', title: '等待模块重启并自动重新连接（约 10–40 秒）', status: 'pending' },
    { id: 'verify', title: '读取配置，确认已经生效', status: 'pending' },
  ]
}

export function useModemSession(options: SessionOptions = {}) {
  const [config] = useState(() => ({
    reconnectTimeoutMs: options.reconnectTimeoutMs ?? 90_000,
    reconnectIntervalMs: options.reconnectIntervalMs ?? 2000,
    backupStore: options.backupStore ?? createBackupStore(),
    createConnector: options.createConnector,
    demoModuleOptions: options.demoModuleOptions,
  }))

  const demoModuleRef = useRef<SimulatedModule | null>(null)
  const connectorRef = useRef<Connector | null>(null)
  const channelRef = useRef<AtChannel | null>(null)
  const pendingPlanRef = useRef<SetupPlan | null>(null)
  const waitAbortRef = useRef<AbortController | null>(null)
  const expectingDropRef = useRef(false)

  const [connection, setConnection] = useState<ConnectionState>(IDLE)
  const [snapshot, setSnapshot] = useState<ModemSnapshot | null>(null)
  const [originalBackup, setOriginalBackup] = useState<ModemBackup | null>(null)
  const [reading, setReading] = useState(false)
  const [operation, setOperation] = useState<OperationState | null>(null)

  const makeConnector = useCallback(
    (kind: ConnectionKind): Connector => {
      if (config.createConnector) return config.createConnector(kind)
      if (kind === 'webusb') return createWebUsbConnector()
      if (kind === 'webserial') return createWebSerialConnector()
      demoModuleRef.current ??= new SimulatedModule(config.demoModuleOptions)
      return createSimulatedConnector(demoModuleRef.current)
    },
    [config],
  )

  const attach = useCallback((channel: AtChannel, kind: ConnectionKind) => {
    channelRef.current = channel
    setConnection({ status: 'connected', kind, description: channel.description, error: null })
    void channel.closed.then(() => {
      if (channelRef.current !== channel) return
      channelRef.current = null
      if (expectingDropRef.current) return
      setConnection((current) => ({
        ...current,
        status: 'lost',
        error: '与模块的连接已断开（被拔出或正在重启）。',
      }))
    })
  }, [])

  const adopt = useCallback(
    (next: ModemSnapshot) => {
      setSnapshot(next)
      setOriginalBackup(config.backupStore.keepOriginal(createBackup(next)))
    },
    [config],
  )

  const refreshWith = useCallback(
    async (channel: AtChannel) => {
      setReading(true)
      try {
        adopt(await readSnapshot(channel))
      } catch (error) {
        setConnection((current) => ({ ...current, error: `读取模块状态失败：${errorMessage(error)}` }))
      } finally {
        setReading(false)
      }
    },
    [adopt],
  )

  const updateStep = useCallback((id: string, patch: Partial<OperationStep>) => {
    setOperation((current) =>
      current && {
        ...current,
        steps: current.steps.map((step) => (step.id === id ? { ...step, ...patch } : step)),
      },
    )
  }, [])

  const finishVerify = useCallback(
    async (channel: AtChannel, kind: ConnectionKind, plan: SetupPlan) => {
      expectingDropRef.current = false
      pendingPlanRef.current = null
      attach(channel, kind)
      updateStep('wait', { status: 'done', detail: channel.description })
      updateStep('verify', { status: 'running' })
      setOperation((current) => current && { ...current, status: 'running', message: null })
      try {
        const result = await verifyPlan(channel, plan)
        adopt(result.snapshot)
        updateStep('verify', {
          status: result.ok ? 'done' : 'failed',
          detail: result.ok ? '配置已生效' : result.mismatches.join('；'),
        })
        setOperation(
          (current) =>
            current && {
              ...current,
              status: result.ok ? 'done' : 'failed',
              message: result.ok ? null : '模块重启后的配置与预期不一致。',
            },
        )
      } catch (error) {
        updateStep('verify', { status: 'failed', detail: errorMessage(error) })
        setOperation(
          (current) => current && { ...current, status: 'failed', message: errorMessage(error) },
        )
      }
    },
    [adopt, attach, updateStep],
  )

  const waitAndVerify = useCallback(
    async (connector: Connector, plan: SetupPlan) => {
      updateStep('wait', { status: 'running' })
      setOperation((current) => current && { ...current, status: 'waiting' })
      const controller = new AbortController()
      waitAbortRef.current = controller
      const channel = await waitForModule(connector, {
        timeoutMs: config.reconnectTimeoutMs,
        intervalMs: config.reconnectIntervalMs,
        signal: controller.signal,
      })
      if (controller.signal.aborted) return
      if (!channel) {
        setConnection((current) => ({ ...current, status: 'lost' }))
        updateStep('wait', { detail: '没有自动重连成功，等待手动重新连接' })
        setOperation(
          (current) =>
            current && {
              ...current,
              status: 'needs-user',
              message:
                '模块重启后浏览器没有自动重连。请确认模块仍插在电脑上，然后点「重新连接模块」，在弹窗中再次选择它。',
            },
        )
        return
      }
      await finishVerify(channel, connector.kind, plan)
    },
    [config, finishVerify, updateStep],
  )

  const closeChannel = useCallback(async () => {
    waitAbortRef.current?.abort()
    const channel = channelRef.current
    channelRef.current = null
    await channel?.close().catch(() => undefined)
  }, [])

  const connect = useCallback(
    async (kind: ConnectionKind) => {
      await closeChannel()
      expectingDropRef.current = false
      pendingPlanRef.current = null
      setOperation(null)
      setSnapshot(null)
      const connector = makeConnector(kind)
      connectorRef.current = connector
      setConnection({ status: 'connecting', kind, description: null, error: null })
      let channel: AtChannel
      try {
        channel = await connector.request()
      } catch (error) {
        setConnection({
          ...IDLE,
          kind,
          error: isUserCancel(error) ? null : errorMessage(error),
        })
        return
      }
      attach(channel, kind)
      await refreshWith(channel)
    },
    [attach, closeChannel, makeConnector, refreshWith],
  )

  const reconnect = useCallback(async () => {
    const connector = connectorRef.current
    if (!connector) return
    waitAbortRef.current?.abort()
    let channel: AtChannel
    try {
      channel = await connector.request()
    } catch (error) {
      if (!isUserCancel(error)) {
        setConnection((current) => ({ ...current, error: errorMessage(error) }))
      }
      return
    }
    const plan = pendingPlanRef.current
    if (plan) {
      await finishVerify(channel, connector.kind, plan)
    } else {
      attach(channel, connector.kind)
      await refreshWith(channel)
    }
  }, [attach, finishVerify, refreshWith])

  const disconnect = useCallback(async () => {
    expectingDropRef.current = false
    pendingPlanRef.current = null
    await closeChannel()
    setConnection(IDLE)
    setSnapshot(null)
    setOperation(null)
  }, [closeChannel])

  const refresh = useCallback(async () => {
    const channel = channelRef.current
    if (channel) await refreshWith(channel)
  }, [refreshWith])

  const sendCommand = useCallback(async (command: string, timeoutMs?: number): Promise<AtResult> => {
    const channel = channelRef.current
    if (!channel) throw new Error('尚未连接模块')
    return channel.send(command, timeoutMs)
  }, [])

  const runPlan = useCallback(
    async (plan: SetupPlan) => {
      const channel = channelRef.current
      const connector = connectorRef.current
      if (!channel || !connector || plan.steps.length === 0) return
      setOperation({ kind: plan.kind, status: 'running', steps: initialSteps(plan), message: null })
      expectingDropRef.current = true
      try {
        await applyPlan(channel, plan, (event) =>
          updateStep(event.step.id, { status: event.status, detail: event.detail }),
        )
      } catch (error) {
        expectingDropRef.current = false
        setOperation(
          (current) =>
            current && {
              ...current,
              status: 'failed',
              message: `${errorMessage(error)}。模块未重启，已写入的内容可用「恢复原始配置」撤销。`,
            },
        )
        if (channel.isOpen) await refreshWith(channel)
        return
      }
      pendingPlanRef.current = plan
      channelRef.current = null
      await channel.close().catch(() => undefined)
      setConnection((current) => ({ ...current, status: 'rebooting', error: null }))
      await waitAndVerify(connector, plan)
    },
    [refreshWith, updateStep, waitAndVerify],
  )

  useEffect(
    () => () => {
      waitAbortRef.current?.abort()
      void channelRef.current?.close()
    },
    [],
  )

  return {
    connection,
    snapshot,
    originalBackup,
    reading,
    operation,
    connect,
    reconnect,
    disconnect,
    refresh,
    sendCommand,
    runPlan,
  }
}

export type ModemSession = ReturnType<typeof useModemSession>
