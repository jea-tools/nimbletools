/**
 * 全局快捷键工具模块
 * 持久化由 Rust 端文件存储，前端通过 invoke 读写
 */
import { invoke } from '@tauri-apps/api/core';

export const HOTKEY_TYPES = ['clipboard', 'screenshot'] as const;
export type HotkeyType = (typeof HOTKEY_TYPES)[number];

/** 从 Rust 端读取已保存的快捷键（空字符串 = 未设置） */
export async function getHotkey(type: HotkeyType): Promise<string> {
  try {
    return await invoke<string>('get_hotkey', { hotkeyType: type });
  } catch {
    return '';
  }
}

/** 保存快捷键到 Rust 端（同时注册 + 持久化到文件） */
export async function saveHotkey(type: HotkeyType, value: string): Promise<void> {
  await invoke('update_hotkey', { hotkeyType: type, newShortcut: value });
}

/** 清除快捷键 */
export async function clearHotkey(type: HotkeyType): Promise<void> {
  await saveHotkey(type, '');
}

/**
 * 将 KeyboardEvent 转为 Tauri 快捷键格式
 * macOS: Meta → Command, Ctrl → Control
 */
export function eventToShortcutString(e: KeyboardEvent): string | null {
  const MODIFIER_KEYS = new Set(['Control', 'Meta', 'Alt', 'Shift']);
  if (MODIFIER_KEYS.has(e.key)) return null;

  const parts: string[] = [];
  if (e.metaKey) parts.push('Command');
  if (e.ctrlKey) parts.push('Control');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');

  // 至少需要一个修饰键
  if (parts.length === 0) return null;

  let key = e.key;
  if (key.length === 1) {
    key = key.toUpperCase();
  } else {
    const SPECIAL_KEYS: Record<string, string> = {
      Backspace: 'Backspace', Delete: 'Delete', Tab: 'Tab',
      ' ': 'Space', Enter: 'Enter', Escape: 'Escape',
      ArrowUp: 'ArrowUp', ArrowDown: 'ArrowDown',
      ArrowLeft: 'ArrowLeft', ArrowRight: 'ArrowRight',
      F1: 'F1', F2: 'F2', F3: 'F3', F4: 'F4', F5: 'F5', F6: 'F6',
      F7: 'F7', F8: 'F8', F9: 'F9', F10: 'F10', F11: 'F11', F12: 'F12',
    };
    key = SPECIAL_KEYS[key] || key;
  }

  parts.push(key);
  return parts.join('+');
}
