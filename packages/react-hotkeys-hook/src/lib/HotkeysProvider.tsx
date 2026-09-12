import type { Hotkey } from './types'
import { createContext, type ReactNode, useState, useContext, useCallback, useMemo } from 'react'
import BoundHotkeysProxyProviderProvider from './BoundHotkeysProxyProvider'
import deepEqual from './deepEqual'

export type HotkeysContextType = {
  hotkeys: ReadonlyArray<Hotkey>
  activeScopes: string[]
  toggleScope: (scope: string) => void
  enableScope: (scope: string) => void
  disableScope: (scope: string) => void
}

export type HotkeysScopeContextType = Omit<HotkeysContextType, 'hotkeys'>

// The context is only needed for special features like global scoping, so we use a graceful default fallback
const defaultScopeContext: HotkeysScopeContextType = {
  activeScopes: [], // This array has to be empty instead of containing '*' as default, to check if the provider is set or not
  toggleScope: () => {},
  enableScope: () => {},
  disableScope: () => {},
}

const HotkeysScopeContext = createContext<HotkeysScopeContextType>(defaultScopeContext)
const HotkeysContext = createContext<HotkeysContextType>({ ...defaultScopeContext, hotkeys: [] })

export const useHotkeysContext = () => {
  return useContext(HotkeysContext)
}

// Bindings and scope controls don't need updates when unrelated hotkeys register or unregister.
export const useHotkeysScopeContext = (): HotkeysScopeContextType => {
  return useContext(HotkeysScopeContext)
}

interface Props {
  initiallyActiveScopes?: string[]
  children: ReactNode
}

export const HotkeysProvider = ({ initiallyActiveScopes = ['*'], children }: Props) => {
  const [internalActiveScopes, setInternalActiveScopes] = useState(initiallyActiveScopes)
  const [boundHotkeys, setBoundHotkeys] = useState<Hotkey[]>([])

  const enableScope = useCallback((scope: string) => {
    setInternalActiveScopes((prev) => {
      const next = prev.includes('*') ? [scope] : Array.from(new Set([...prev, scope]))
      return next.length === prev.length && next.every((value, index) => value === prev[index]) ? prev : next
    })
  }, [])

  const disableScope = useCallback((scope: string) => {
    setInternalActiveScopes((prev) => {
      return prev.includes(scope) ? prev.filter((s) => s !== scope) : prev
    })
  }, [])

  const toggleScope = useCallback((scope: string) => {
    setInternalActiveScopes((prev) => {
      if (prev.includes(scope)) {
        return prev.filter((s) => s !== scope)
      }
      if (prev.includes('*')) {
        return [scope]
      }
      return Array.from(new Set([...prev, scope]))
    })
  }, [])

  const addBoundHotkey = useCallback((hotkey: Hotkey) => {
    setBoundHotkeys((prev) => [...prev, hotkey])
  }, [])

  const removeBoundHotkey = useCallback((hotkey: Hotkey) => {
    setBoundHotkeys((prev) => prev.filter((h) => !deepEqual(h, hotkey)))
  }, [])

  const scopeContext = useMemo<HotkeysScopeContextType>(
    () => ({ activeScopes: internalActiveScopes, enableScope, disableScope, toggleScope }),
    [internalActiveScopes, enableScope, disableScope, toggleScope],
  )
  const context = useMemo<HotkeysContextType>(
    () => ({ ...scopeContext, hotkeys: boundHotkeys }),
    [scopeContext, boundHotkeys],
  )

  return (
    <HotkeysContext.Provider value={context}>
      <HotkeysScopeContext.Provider value={scopeContext}>
        <BoundHotkeysProxyProviderProvider addHotkey={addBoundHotkey} removeHotkey={removeBoundHotkey}>
          {children}
        </BoundHotkeysProxyProviderProvider>
      </HotkeysScopeContext.Provider>
    </HotkeysContext.Provider>
  )
}
