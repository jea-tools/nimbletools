export type Phase = 'crosshair' | 'drawing' | 'selected';
export type EscapeAction = 'close';
export interface SelectionRect { x: number; y: number; w: number; h: number }
export interface Point { x: number; y: number }

export function getEscapeAction(phase: Phase): EscapeAction {
  switch (phase) {
    case 'crosshair':
    case 'drawing':
    case 'selected':
      return 'close';
  }
}

export function isPointInSelection(selection: SelectionRect, point: Point): boolean {
  return point.x >= selection.x
    && point.x <= selection.x + selection.w
    && point.y >= selection.y
    && point.y <= selection.y + selection.h;
}

export function shouldStartNewSelectionOnMouseDown(
  phase: Phase,
  selection: SelectionRect | null,
  point: Point,
): boolean {
  if (phase !== 'selected') return true;
  if (!selection) return true;
  return !isPointInSelection(selection, point);
}
