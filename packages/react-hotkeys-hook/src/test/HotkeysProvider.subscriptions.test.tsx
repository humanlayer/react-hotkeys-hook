import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { StrictMode, useState } from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'

import {
  HotkeysProvider,
  type HotkeysScopeContextType,
  isHotkeyPressed,
  type Options,
  useHotkeys,
  useHotkeysContext,
  useHotkeysScopeContext,
} from '../lib/index'

// Exercise the public source entry point, with no mocked hooks or contexts.
type ScopeContext = HotkeysScopeContextType
type RegistryContext = ReturnType<typeof useHotkeysContext>

function probes() {
  const scopeRender = vi.fn<(value: ScopeContext) => void>()
  const registryRender = vi.fn<(value: RegistryContext) => void>()
  function ScopeProbe() {
    scopeRender(useHotkeysScopeContext())
    return null
  }
  function RegistryProbe() {
    registryRender(useHotkeysContext())
    return null
  }
  return {
    ScopeProbe,
    RegistryProbe,
    scopeRender,
    registryRender,
    get scope() {
      const value = scopeRender.mock.lastCall?.[0]
      if (!value) throw new Error('Scope probe has not rendered')
      return value
    },
    get registry() {
      const value = registryRender.mock.lastCall?.[0]
      if (!value) throw new Error('Registry probe has not rendered')
      return value
    },
  }
}

type BindingProps = {
  keys?: string
  onKey: () => void
  options?: Options
}

function Binding({ keys = 'a', onKey, options }: BindingProps) {
  useHotkeys(keys, onKey, options)
  return null
}

// Create each component once per test. The counter belongs to the fixture,
// not a render callback prop, and counts the actual hook consumer synchronously.
function trackedBinding(countRender: () => void) {
  return function CountedBinding({ keys = 'a', onKey, options }: BindingProps) {
    useHotkeys(keys, onKey, options)
    countRender()
    return null
  }
}

function press(key: string) {
  const options = { key, code: `Key${key.toUpperCase()}`, bubbles: true, cancelable: true }
  const down = new KeyboardEvent('keydown', options)
  fireEvent(document.body, down)
  fireEvent.keyUp(document.body, options)
  return down
}

function keyboardListeners() {
  const add = vi.spyOn(document, 'addEventListener')
  const remove = vi.spyOn(document, 'removeEventListener')
  const keyboardOnly = ([type]: [string, ...unknown[]]) => type === 'keydown' || type === 'keyup'
  return {
    get added() {
      return add.mock.calls.filter(keyboardOnly)
    },
    get removed() {
      return remove.mock.calls.filter(keyboardOnly)
    },
  }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('real hotkeys provider contract', () => {
  // These regressions deliberately use only the pre-existing API. They must
  // fail behaviorally against the old source, not because an export is missing.
  test('ordinary useHotkeys bindings ignore registry-only sibling updates', () => {
    const p = probes()
    const activeRender = vi.fn()
    const disabledRender = vi.fn()
    const ActiveBinding = trackedBinding(activeRender)
    const DisabledBinding = trackedBinding(disabledRender)
    const active = vi.fn()
    const disabled = vi.fn()
    const temporary = vi.fn()
    function Churn() {
      const [mounted, setMounted] = useState(false)
      return (
        <>
          <button type="button" onClick={() => setMounted((previous) => !previous)}>
            Toggle ordinary
          </button>
          {mounted && <Binding keys="b" onKey={temporary} />}
        </>
      )
    }
    render(
      <HotkeysProvider>
        <p.RegistryProbe />
        <Churn />
        <ActiveBinding onKey={active} />
        <DisabledBinding keys="d" onKey={disabled} options={{ enabled: false }} />
      </HotkeysProvider>,
    )
    const baseline = [activeRender.mock.calls.length, disabledRender.mock.calls.length]
    expect(baseline.every((count) => count > 0)).toBe(true)
    for (const mounted of [true, false]) {
      fireEvent.click(screen.getByRole('button', { name: 'Toggle ordinary' }))
      expect(p.registry.hotkeys).toHaveLength(mounted ? 2 : 1)
      expect([activeRender.mock.calls.length, disabledRender.mock.calls.length]).toEqual(baseline)
      press('b')
      expect(temporary).toHaveBeenCalledOnce()
    }
    press('a')
    press('d')
    expect(active).toHaveBeenCalledOnce()
    expect(disabled).not.toHaveBeenCalled()
  })

  test.each([
    { label: 'enable existing named scope', initial: ['editor'], operation: 'enableScope', scope: 'editor' },
    { label: 'enable existing wildcard', initial: ['*'], operation: 'enableScope', scope: '*' },
    { label: 'disable absent named scope', initial: ['editor'], operation: 'disableScope', scope: 'missing' },
    { label: 'disable from empty scopes', initial: [], operation: 'disableScope', scope: 'missing' },
  ] as const)('public context no-op: $label', ({ initial, operation, scope }) => {
    const p = probes()
    const listeners = keyboardListeners()
    render(
      <HotkeysProvider initiallyActiveScopes={[...initial]}>
        <p.RegistryProbe />
        <Binding onKey={() => {}} />
      </HotkeysProvider>,
    )
    const before = p.registry
    const renders = p.registryRender.mock.calls.length
    const added = listeners.added.length
    const removed = listeners.removed.length
    expect(added).toBe(2)
    for (let repeat = 0; repeat < 3; repeat++) {
      act(() => p.registry[operation](scope))
      expect(p.registry.activeScopes).toBe(before.activeScopes)
      expect(p.registry).toBe(before)
      expect(p.registryRender).toHaveBeenCalledTimes(renders)
      expect(listeners.added).toHaveLength(added)
      expect(listeners.removed).toHaveLength(removed)
    }
  })

  test('local registry churn does not render stable active/disabled bindings or narrow scope consumers', () => {
    const p = probes()
    const activeRender = vi.fn()
    const disabledRender = vi.fn()
    const inactiveRender = vi.fn()
    const ActiveBinding = trackedBinding(activeRender)
    const DisabledBinding = trackedBinding(disabledRender)
    const InactiveBinding = trackedBinding(inactiveRender)
    const active = vi.fn()
    const disabled = vi.fn()
    const inactive = vi.fn()
    const temporary = vi.fn()
    function Churn() {
      const [mounted, setMounted] = useState(false)
      const [revision, setRevision] = useState(0)
      return (
        <>
          <button type="button" onClick={() => setMounted((previous) => !previous)}>
            Toggle registration
          </button>
          <button type="button" onClick={() => setRevision((previous) => previous + 1)}>
            Revise registration
          </button>
          {mounted && (
            <Binding keys="t" onKey={temporary} options={{ description: 'temporary', metadata: { revision } }} />
          )}
        </>
      )
    }
    const listeners = keyboardListeners()
    // Only Churn owns changing state: sibling element identities stay fixed.
    // Counters live inside consumers, so context-driven renders cannot hide.
    render(
      <HotkeysProvider initiallyActiveScopes={['editor']}>
        <Churn />
        <ActiveBinding onKey={active} options={{ scopes: ['editor'] }} />
        <DisabledBinding keys="d" onKey={disabled} options={{ enabled: false }} />
        <InactiveBinding keys="i" onKey={inactive} options={{ scopes: ['inactive'] }} />
        <p.ScopeProbe />
        <p.RegistryProbe />
      </HotkeysProvider>,
    )
    const renderCounts = () => [
      activeRender.mock.calls.length,
      disabledRender.mock.calls.length,
      inactiveRender.mock.calls.length,
      p.scopeRender.mock.calls.length,
    ]
    const baseline = renderCounts()
    expect(baseline.every((count) => count > 0)).toBe(true)
    const scope = p.scope
    expect(Object.keys(scope).sort()).toEqual(['activeScopes', 'disableScope', 'enableScope', 'toggleScope'])
    const originalHotkeys = p.registry.hotkeys
    const originalListeners = listeners.added
    expect(originalHotkeys).toHaveLength(1)
    expect(originalListeners).toHaveLength(2)
    for (let cycle = 0; cycle < 3; cycle++) {
      for (const mounted of [true, false]) {
        const publicRenders = p.registryRender.mock.calls.length
        fireEvent.click(screen.getByRole('button', { name: 'Toggle registration' }))
        expect(p.registryRender.mock.calls.length).toBeGreaterThan(publicRenders)
        expect(p.registry.hotkeys).toHaveLength(mounted ? 2 : 1)
        if (mounted) {
          expect(p.registry.hotkeys).toContainEqual(expect.objectContaining({ description: 'temporary' }))
          const beforeRevision = p.registryRender.mock.calls.length
          fireEvent.click(screen.getByRole('button', { name: 'Revise registration' }))
          expect(p.registryRender.mock.calls.length).toBeGreaterThan(beforeRevision)
          expect(p.registry.hotkeys).toHaveLength(2)
          expect(p.registry.hotkeys).toContainEqual(expect.objectContaining({ metadata: { revision: cycle + 1 } }))
        } else expect(p.registry.hotkeys).toEqual(originalHotkeys)
        expect(p.scope).toBe(scope)
        expect(p.registry.activeScopes).toBe(scope.activeScopes)
        expect(renderCounts()).toEqual(baseline)
        for (const [, listener] of originalListeners) {
          expect(listeners.removed.some(([, removed]) => removed === listener)).toBe(false)
        }
        press('t')
        expect(temporary).toHaveBeenCalledTimes(cycle + 1)
      }
    }
    press('a')
    press('d')
    press('i')
    expect(active).toHaveBeenCalledOnce()
    expect(disabled).not.toHaveBeenCalled()
    expect(inactive).not.toHaveBeenCalled()
  })

  test('public registry still reflects metadata, keys, options, disabling, and unmounting', () => {
    const p = probes()
    const callback = vi.fn()
    const initial: Options = { description: 'original', metadata: { action: 'open', version: 1 } }
    function Page({
      keys = 'a',
      options = initial,
      mounted = true,
    }: {
      keys?: string
      options?: Options
      mounted?: boolean
    }) {
      return (
        <HotkeysProvider>
          <p.RegistryProbe />
          {mounted && <Binding keys={keys} onKey={callback} options={options} />}
        </HotkeysProvider>
      )
    }
    const view = render(<Page />)
    expect(p.registry.hotkeys).toEqual([expect.objectContaining({ hotkey: 'a', keys: ['a'], ...initial })])
    const next = { description: 'replacement', metadata: { action: 'close', version: 2 }, preventDefault: true }
    // An options-only update must replace metadata even when keys are unchanged.
    view.rerender(<Page options={next} />)
    expect(p.registry.hotkeys).toEqual([
      expect.objectContaining({ hotkey: 'a', description: next.description, metadata: next.metadata }),
    ])
    view.rerender(<Page keys="b" options={next} />)
    expect(p.registry.hotkeys).toEqual([
      expect.objectContaining({ hotkey: 'b', keys: ['b'], description: next.description, metadata: next.metadata }),
    ])
    press('a')
    expect(callback).not.toHaveBeenCalled()
    expect(press('b').defaultPrevented).toBe(true)
    expect(callback).toHaveBeenCalledOnce()
    view.rerender(<Page keys="b" options={{ ...next, enabled: false }} />)
    expect(p.registry.hotkeys).toEqual([])
    press('b')
    expect(callback).toHaveBeenCalledOnce()
    view.rerender(<Page keys="b" options={next} />)
    expect(p.registry.hotkeys).toHaveLength(1)
    press('b')
    expect(callback).toHaveBeenCalledTimes(2)
    view.rerender(<Page mounted={false} />)
    expect(p.registry.hotkeys).toEqual([])
    press('b')
    expect(callback).toHaveBeenCalledTimes(2)
  })

  test('callbacks stay current, explicit dependencies retain their semantics, and press/release is not duplicated', () => {
    const calls = vi.fn()
    function Current({ value, revision }: { value: string; revision: number }) {
      useHotkeys('a', (event) => calls('current', value, event.type), { keydown: true, keyup: true })
      useHotkeys('b', () => calls('deps', value), {}, [revision])
      useHotkeys('c', (event) => calls('release', value, event.type), { keyup: true })
      return null
    }
    const listeners = keyboardListeners()
    const view = render(
      <HotkeysProvider>
        <Current value="first" revision={0} />
      </HotkeysProvider>,
    )
    const added = listeners.added.length
    const removed = listeners.removed.length
    expect(added).toBe(6)
    const exercise = (current: string, dependency: string) => {
      calls.mockClear()
      fireEvent.keyDown(document.body, { key: 'a', code: 'KeyA' })
      expect(isHotkeyPressed('a')).toBe(true)
      fireEvent.keyUp(document.body, { key: 'a', code: 'KeyA' })
      expect(isHotkeyPressed('a')).toBe(false)
      // A second full press must work after release, too.
      press('a')
      press('b')
      press('c')
      expect(calls.mock.calls).toEqual([
        ['current', current, 'keydown'],
        ['current', current, 'keyup'],
        ['current', current, 'keydown'],
        ['current', current, 'keyup'],
        ['deps', dependency],
        ['release', current, 'keyup'],
      ])
      expect(isHotkeyPressed('a')).toBe(false)
    }
    exercise('first', 'first')
    view.rerender(
      <HotkeysProvider>
        <Current value="second" revision={0} />
      </HotkeysProvider>,
    )
    exercise('second', 'first')
    view.rerender(
      <HotkeysProvider>
        <Current value="third" revision={1} />
      </HotkeysProvider>,
    )
    exercise('third', 'third')
    expect(listeners.added).toHaveLength(added)
    expect(listeners.removed).toHaveLength(removed)
  })

  test('real scope transitions change dispatch, while enable/disable no-ops preserve identities and listeners', () => {
    const p = probes()
    const editor = vi.fn()
    const dialog = vi.fn()
    const editorRender = vi.fn()
    const dialogRender = vi.fn()
    const EditorBinding = trackedBinding(editorRender)
    const DialogBinding = trackedBinding(dialogRender)
    const listeners = keyboardListeners()
    render(
      <HotkeysProvider>
        <p.ScopeProbe />
        <p.RegistryProbe />
        <EditorBinding onKey={editor} options={{ scopes: ['editor'] }} />
        <DialogBinding keys="b" onKey={dialog} options={{ scopes: ['dialog'] }} />
      </HotkeysProvider>,
    )
    const controls = p.scope
    const assertDispatch = (expected: string[]) => {
      expect(p.scope.activeScopes).toEqual(expected)
      expect(p.registry.activeScopes).toBe(p.scope.activeScopes)
      expect(p.scope.enableScope).toBe(controls.enableScope)
      expect(p.scope.disableScope).toBe(controls.disableScope)
      expect(p.scope.toggleScope).toBe(controls.toggleScope)
      expect(p.registry.enableScope).toBe(controls.enableScope)
      expect(p.registry.disableScope).toBe(controls.disableScope)
      expect(p.registry.toggleScope).toBe(controls.toggleScope)
      editor.mockClear()
      dialog.mockClear()
      press('a')
      press('b')
      expect(editor).toHaveBeenCalledTimes(expected.includes('*') || expected.includes('editor') ? 1 : 0)
      expect(dialog).toHaveBeenCalledTimes(expected.includes('*') || expected.includes('dialog') ? 1 : 0)
    }
    const noop = (operation: () => void) => {
      const before = p.scope
      const publicBefore = p.registry
      const renders = p.scopeRender.mock.calls.length
      const publicRenders = p.registryRender.mock.calls.length
      const bindingRenders = [editorRender.mock.calls.length, dialogRender.mock.calls.length]
      const added = listeners.added.length
      const removed = listeners.removed.length
      act(operation)
      expect(p.scope).toBe(before)
      expect(p.registry).toBe(publicBefore)
      expect(p.registry.activeScopes).toBe(before.activeScopes)
      expect(p.scopeRender).toHaveBeenCalledTimes(renders)
      expect(p.registryRender).toHaveBeenCalledTimes(publicRenders)
      expect([editorRender.mock.calls.length, dialogRender.mock.calls.length]).toEqual(bindingRenders)
      expect(listeners.added).toHaveLength(added)
      expect(listeners.removed).toHaveLength(removed)
    }
    assertDispatch(['*'])
    noop(() => controls.enableScope('*'))
    noop(() => controls.disableScope('missing'))
    act(() => controls.enableScope('editor'))
    assertDispatch(['editor'])
    noop(() => controls.enableScope('editor'))
    noop(() => controls.disableScope('missing'))
    act(() => controls.enableScope('dialog'))
    assertDispatch(['editor', 'dialog'])
    noop(() => p.registry.enableScope('editor'))
    noop(() => p.registry.disableScope('missing'))
    act(() => controls.disableScope('editor'))
    assertDispatch(['dialog'])
    act(() => controls.toggleScope('dialog'))
    assertDispatch([])
    noop(() => controls.disableScope('dialog'))
    act(() => controls.toggleScope('editor'))
    assertDispatch(['editor'])
    // Legacy wildcard semantics: adding '*' retains named scopes, but enabling
    // any scope while '*' is present replaces the whole array, even if present.
    act(() => controls.enableScope('*'))
    assertDispatch(['editor', '*'])
    act(() => controls.enableScope('editor'))
    assertDispatch(['editor'])
    act(() => controls.enableScope('*'))
    act(() => controls.enableScope('*'))
    assertDispatch(['*'])
    noop(() => controls.enableScope('*'))
    act(() => controls.toggleScope('dialog'))
    assertDispatch(['dialog'])
    act(() => controls.enableScope('*'))
    act(() => controls.disableScope('*'))
    assertDispatch(['dialog'])
    act(() => p.registry.toggleScope('dialog'))
    assertDispatch([])
    act(() => p.registry.enableScope('*'))
    assertDispatch(['*'])
    act(() => p.registry.toggleScope('*'))
    assertDispatch([])
    // Positive control: real scope changes did perform listener work.
    expect(listeners.removed.length).toBeGreaterThan(0)
  })

  test('outside-provider hooks retain defaults and unscoped keyboard behavior', () => {
    const p = probes()
    const callback = vi.fn()
    const scoped = vi.fn()
    render(
      <>
        <p.ScopeProbe />
        <p.RegistryProbe />
        <Binding onKey={callback} />
        <Binding keys="b" onKey={scoped} options={{ scopes: ['editor'] }} />
      </>,
    )
    expect(p.scope.activeScopes).toEqual([])
    expect(p.registry.hotkeys).toEqual([])
    act(() => {
      p.scope.enableScope('editor')
      p.scope.disableScope('editor')
      p.scope.toggleScope('*')
      p.registry.enableScope('editor')
      p.registry.disableScope('editor')
      p.registry.toggleScope('*')
    })
    expect(p.scope.activeScopes).toEqual([])
    press('a')
    press('b')
    expect(callback).toHaveBeenCalledOnce()
    expect(scoped).not.toHaveBeenCalled()
  })

  test.each(['independent', 'nested'] as const)('%s providers isolate registry and scope updates', (placement) => {
    const left = probes()
    const right = probes()
    const leftKey = vi.fn()
    const rightKey = vi.fn()
    const second = (
      <HotkeysProvider initiallyActiveScopes={['right']}>
        <right.ScopeProbe />
        <right.RegistryProbe />
        <Binding keys="b" onKey={rightKey} options={{ scopes: ['right'] }} />
      </HotkeysProvider>
    )
    function LeftBinding() {
      const [mounted, setMounted] = useState(true)
      return (
        <>
          <button type="button" onClick={() => setMounted(false)}>
            Remove left
          </button>
          {mounted && <Binding onKey={leftKey} options={{ scopes: ['left'] }} />}
        </>
      )
    }
    render(
      <>
        <HotkeysProvider initiallyActiveScopes={['left']}>
          <left.ScopeProbe />
          <left.RegistryProbe />
          <LeftBinding />
          {placement === 'nested' && second}
        </HotkeysProvider>
        {placement === 'independent' && second}
      </>,
    )
    expect(left.registry.hotkeys.map(({ hotkey }) => hotkey)).toEqual(['a'])
    expect(right.registry.hotkeys.map(({ hotkey }) => hotkey)).toEqual(['b'])
    const rightScope = right.scope
    const rightRegistry = right.registry
    const rightRenders = [right.scopeRender.mock.calls.length, right.registryRender.mock.calls.length]
    press('a')
    press('b')
    expect(leftKey).toHaveBeenCalledOnce()
    expect(rightKey).toHaveBeenCalledOnce()
    act(() => left.scope.disableScope('left'))
    press('a')
    press('b')
    expect(leftKey).toHaveBeenCalledOnce()
    expect(rightKey).toHaveBeenCalledTimes(2)
    act(() => left.scope.enableScope('left'))
    fireEvent.click(screen.getByRole('button', { name: 'Remove left' }))
    expect(left.registry.hotkeys).toEqual([])
    expect(right.scope).toBe(rightScope)
    expect(right.registry).toBe(rightRegistry)
    // React can revisit consumers beneath a nested provider during ancestor
    // context propagation. Isolation requires every read to retain the inner
    // value, not a guarantee that React never calls these components again.
    for (const [value] of right.scopeRender.mock.calls.slice(rightRenders[0])) expect(value).toBe(rightScope)
    for (const [value] of right.registryRender.mock.calls.slice(rightRenders[1])) expect(value).toBe(rightRegistry)
    if (placement === 'independent') {
      expect([right.scopeRender.mock.calls.length, right.registryRender.mock.calls.length]).toEqual(rightRenders)
    }
    press('a')
    press('b')
    expect(leftKey).toHaveBeenCalledOnce()
    expect(rightKey).toHaveBeenCalledTimes(3)
  })

  test('repeated StrictMode mount/unmount leaves no registrations, duplicate callbacks, or listeners', () => {
    const p = probes()
    const callback = vi.fn()
    const listeners = keyboardListeners()
    function Churn() {
      const [mounted, setMounted] = useState(false)
      return (
        <>
          <button type="button" onClick={() => setMounted((previous) => !previous)}>
            Toggle
          </button>
          {mounted && <Binding onKey={callback} />}
        </>
      )
    }
    for (let providerCycle = 0; providerCycle < 2; providerCycle++) {
      const view = render(
        <StrictMode>
          <HotkeysProvider>
            <p.RegistryProbe />
            <Churn />
          </HotkeysProvider>
        </StrictMode>,
      )
      for (let cycle = 0; cycle < 3; cycle++) {
        callback.mockClear()
        fireEvent.click(screen.getByRole('button', { name: 'Toggle' }))
        expect(p.registry.hotkeys).toHaveLength(1)
        press('a')
        expect(callback).toHaveBeenCalledOnce()
        fireEvent.click(screen.getByRole('button', { name: 'Toggle' }))
        expect(p.registry.hotkeys).toEqual([])
        press('a')
        expect(callback).toHaveBeenCalledOnce()
      }
      // Also tear down a provider with a live binding, not just an empty one.
      fireEvent.click(screen.getByRole('button', { name: 'Toggle' }))
      expect(p.registry.hotkeys).toHaveLength(1)
      view.unmount()
      callback.mockClear()
      press('a')
      expect(callback).not.toHaveBeenCalled()
      expect(listeners.added.length).toBeGreaterThan(0)
      expect(listeners.removed).toHaveLength(listeners.added.length)
      for (const [type, listener, options] of listeners.added) {
        expect(
          listeners.removed.filter(
            ([removedType, removedListener, removedOptions]) =>
              removedType === type && removedListener === listener && removedOptions === options,
          ),
        ).toHaveLength(1)
      }
    }
  })
})
