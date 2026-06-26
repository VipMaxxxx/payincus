import { dispatchPluginEvent, type PluginEventDispatchOptions, type PluginRuntimeActor } from './plugin-runtime.js'

export function emitPluginEvent(
  event: string,
  payload: unknown,
  actor: PluginRuntimeActor = { id: null, role: 'system' },
  options: PluginEventDispatchOptions = {}
): void {
  void dispatchPluginEvent(event, payload, actor, options).catch(error => {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[PluginEvent] Failed to dispatch ${event}: ${message}`)
  })
}
