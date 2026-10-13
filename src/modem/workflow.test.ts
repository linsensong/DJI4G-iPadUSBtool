import { describe, expect, it } from 'vitest'
import { SimulatedModule, createSimulatedConnector } from '../transports/simulated'
import { planIpadSetup, planRestore } from './plan'
import { createBackup } from './backup'
import { readSnapshot } from './status'
import { applyPlan, PlanStepError, verifyPlan, waitForModule, type StepEvent } from './workflow'

const fast = { timeoutMs: 2000, intervalMs: 10 }

describe('readSnapshot against the simulated module', () => {
  it('parses a factory DJI module with a Telecom SIM', async () => {
    const connector = createSimulatedConnector(new SimulatedModule())
    const snapshot = await readSnapshot(await connector.request())

    expect(snapshot).toMatchObject({
      imei: '860000123456789',
      sim: { kind: 'ready' },
      usbnet: 0,
      cfun: 1,
      carrier: { id: 'telecom' },
      registration: { registered: true },
      signal: { bars: 4 },
      usbcfg: { vendorId: 0x2ca3, productId: 0x4006 },
      pdpContexts: [{ cid: 1, apn: '' }],
    })
    expect(snapshot.raw['AT+CSQ']).toContain('+CSQ: 24,99')
  })

  it('reports a missing SIM without failing the whole read', async () => {
    const connector = createSimulatedConnector(new SimulatedModule({ simInserted: false }))
    const snapshot = await readSnapshot(await connector.request())

    expect(snapshot.sim).toEqual({ kind: 'absent' })
    expect(snapshot.imsi).toBeNull()
    expect(snapshot.usbnet).toBe(0)
  })
})

describe('iPad setup end to end', () => {
  it('configures, survives the reboot and verifies the result', async () => {
    const module = new SimulatedModule({ rebootDelayMs: 50 })
    const connector = createSimulatedConnector(module)
    const channel = await connector.request()
    const before = await readSnapshot(channel)
    const plan = planIpadSetup(before, { kind: 'set', apn: 'ctnet' })
    const events: StepEvent[] = []

    await expect(applyPlan(channel, plan, (event) => events.push(event))).resolves.toBe('rebooting')
    expect(events.filter((e) => e.status === 'done').map((e) => e.step.id)).toEqual([
      'apn',
      'usbnet',
      'reboot',
    ])
    await channel.closed

    const rebooted = await waitForModule(connector, fast)
    expect(rebooted).not.toBeNull()
    const result = await verifyPlan(rebooted!, plan)

    expect(result).toMatchObject({ ok: true, mismatches: [] })
    expect(result.snapshot.usbnet).toBe(1)
    expect(module.history).toContain('AT+QCFG="usbnet",1')

    const restore = planRestore(createBackup(before), result.snapshot)
    await applyPlan(rebooted!, restore)
    const restored = await waitForModule(connector, fast)
    await expect(verifyPlan(restored!, restore)).resolves.toMatchObject({ ok: true })
    expect(module.usbnet).toBe(0)
    expect(module.pdpContexts[0].apn).toBe('')
  })

  it('treats a module that restarts by itself after the usbnet write as a reboot', async () => {
    const module = new SimulatedModule({ autoRebootOnUsbnet: true, rebootDelayMs: 50 })
    const connector = createSimulatedConnector(module)
    const channel = await connector.request()
    const plan = planIpadSetup(await readSnapshot(channel), { kind: 'keep' })

    await expect(applyPlan(channel, plan)).resolves.toBe('rebooting')
    const rebooted = await waitForModule(connector, fast)
    await expect(verifyPlan(rebooted!, plan)).resolves.toMatchObject({ ok: true })
  })

  it('stops before touching the USB mode when a step is rejected', async () => {
    const module = new SimulatedModule()
    const channel = await createSimulatedConnector(module).request()
    const plan = planIpadSetup(await readSnapshot(channel), { kind: 'set', apn: 'ctnet' })
    plan.steps[0] = { ...plan.steps[0], command: 'AT+CGDCONT=1,"IPV4V6"' }

    await expect(applyPlan(channel, plan)).rejects.toBeInstanceOf(PlanStepError)
    expect(module.history).not.toContain('AT+QCFG="usbnet",1')
    expect(module.usbnet).toBe(0)
  })

  it('reports mismatches when the module comes back with other settings', async () => {
    const module = new SimulatedModule()
    const channel = await createSimulatedConnector(module).request()
    const plan = planIpadSetup(await readSnapshot(channel), { kind: 'set', apn: 'ctnet' })

    const result = await verifyPlan(channel, plan)
    expect(result.ok).toBe(false)
    expect(result.mismatches).toHaveLength(2)
  })

  it('turns IPv6 off on a module that is already in ECM mode and verifies it', async () => {
    const module = new SimulatedModule({
      usbnet: 1,
      pdpContexts: [{ cid: 1, pdpType: 'IPV4V6', apn: 'ctnet' }],
      rebootDelayMs: 50,
    })
    const connector = createSimulatedConnector(module)
    const channel = await connector.request()
    const plan = planIpadSetup(await readSnapshot(channel), { kind: 'keep' }, { ipv4Only: true })

    await expect(applyPlan(channel, plan)).resolves.toBe('rebooting')
    const rebooted = await waitForModule(connector, fast)
    const result = await verifyPlan(rebooted!, plan)
    expect(result).toMatchObject({ ok: true, mismatches: [] })
    expect(module.pdpContexts[0]).toEqual({ cid: 1, pdpType: 'IP', apn: 'ctnet' })
    expect(module.history).not.toContain('AT+QCFG="usbnet",1')
  })

  it('reports a module that kept IPv6 after the reboot', async () => {
    const module = new SimulatedModule({ usbnet: 1, pdpContexts: [{ cid: 1, pdpType: 'IPV4V6', apn: 'ctnet' }] })
    const channel = await createSimulatedConnector(module).request()
    const plan = planIpadSetup(await readSnapshot(channel), { kind: 'keep' }, { ipv4Only: true })

    const result = await verifyPlan(channel, plan)
    expect(result.ok).toBe(false)
    expect(result.mismatches).toEqual(['IP 类型应为「仅 IPv4」，实际为「IPv4 + IPv6」'])
  })

  it('gives up waiting when the module never returns', async () => {
    const module = new SimulatedModule({ rebootDelayMs: 10_000 })
    module.reboot()
    await expect(
      waitForModule(createSimulatedConnector(module), { timeoutMs: 60, intervalMs: 10 }),
    ).resolves.toBeNull()
  })
})
