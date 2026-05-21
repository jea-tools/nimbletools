export type Phase = 'crosshair' | 'drawing' | 'selected';
export type EscapeAction = 'close';

export function getEscapeAction(phase: Phase): EscapeAction {
  switch (phase) {
    case 'crosshair':
    case 'drawing':
    case 'selected':
      return 'close';
  }
}
