export interface ClipboardPopupKey {
  key: string;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
}

export function quickPasteIndexForKey(key: string): number | null {
  if (!/^[1-9]$/.test(key)) return null;
  return Number(key) - 1;
}

export function shouldEditSearchWhenInputUnfocused(event: ClipboardPopupKey): boolean {
  if (event.metaKey || event.ctrlKey || event.altKey) return false;
  if (/^[1-9]$/.test(event.key)) return false;
  return event.key.length === 1 || event.key === 'Backspace';
}

export function editSearchWithKey(current: string, key: string): string {
  if (key === 'Backspace') return current.slice(0, -1);
  if (key.length === 1) return current + key;
  return current;
}
