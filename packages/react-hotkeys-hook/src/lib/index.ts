import useHotkeys from './useHotkeys'
import type { Options, Keys, HotkeyCallback } from './types'
import {
  HotkeysProvider,
  useHotkeysContext,
  useHotkeysScopeContext,
  type HotkeysScopeContextType,
} from './HotkeysProvider'
import { isHotkeyPressed } from './isHotkeyPressed'
import useRecordHotkeys from './useRecordHotkeys'

export {
  useHotkeys,
  useRecordHotkeys,
  useHotkeysContext,
  useHotkeysScopeContext,
  isHotkeyPressed,
  HotkeysProvider,
  type Options,
  type Keys,
  type HotkeyCallback,
  type HotkeysScopeContextType,
}
