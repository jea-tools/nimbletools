export type Phase = 'crosshair' | 'drawing' | 'selected' | 'moving' | 'resizing';
export type EscapeAction = 'close';
export type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
export type SelectionHit = ResizeHandle | 'inside' | 'outside';
export type ToolbarAction = 'confirm' | 'reset' | 'cancel';

export interface SelectionRect { x: number; y: number; w: number; h: number }
export interface Point { x: number; y: number }
export interface Bounds { width: number; height: number }
export interface ToolbarButton {
  action: ToolbarAction;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface ToolbarLayout {
  x: number;
  y: number;
  w: number;
  h: number;
  buttons: ToolbarButton[];
}

export const MIN_SELECTION_PX = 10;
export const HANDLE_SIZE_PX = 8;
export const HANDLE_HIT_SIZE_PX = 12;

export function getEscapeAction(phase: Phase): EscapeAction {
  switch (phase) {
    case 'crosshair':
    case 'drawing':
    case 'selected':
    case 'moving':
    case 'resizing':
      return 'close';
  }
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.max(min, Math.min(max, value));
}

export function isPointInSelection(selection: SelectionRect, point: Point): boolean {
  return point.x >= selection.x
    && point.x < selection.x + selection.w
    && point.y >= selection.y
    && point.y < selection.y + selection.h;
}

function isPointInRect(rect: SelectionRect, point: Point): boolean {
  return point.x >= rect.x
    && point.x <= rect.x + rect.w
    && point.y >= rect.y
    && point.y <= rect.y + rect.h;
}

export function normalizeSelection(
  start: Point,
  end: Point,
  minSize = MIN_SELECTION_PX,
): SelectionRect | null {
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  const w = Math.abs(end.x - start.x);
  const h = Math.abs(end.y - start.y);

  if (w < minSize || h < minSize) return null;
  return { x, y, w, h };
}

export function constrainSelection(
  selection: SelectionRect,
  bounds: Bounds,
  minSize = MIN_SELECTION_PX,
): SelectionRect {
  const maxW = Math.max(0, bounds.width);
  const maxH = Math.max(0, bounds.height);
  const w = clamp(selection.w, minSize, Math.max(minSize, maxW));
  const h = clamp(selection.h, minSize, Math.max(minSize, maxH));

  return {
    x: clamp(selection.x, 0, Math.max(0, maxW - w)),
    y: clamp(selection.y, 0, Math.max(0, maxH - h)),
    w,
    h,
  };
}

export function moveSelection(
  selection: SelectionRect,
  dragStart: Point,
  dragCurrent: Point,
  bounds: Bounds,
): SelectionRect {
  return constrainSelection({
    ...selection,
    x: selection.x + dragCurrent.x - dragStart.x,
    y: selection.y + dragCurrent.y - dragStart.y,
  }, bounds);
}

export function resizeSelection(
  selection: SelectionRect,
  handle: ResizeHandle,
  point: Point,
  bounds: Bounds,
  minSize = MIN_SELECTION_PX,
): SelectionRect {
  let left = selection.x;
  let top = selection.y;
  let right = selection.x + selection.w;
  let bottom = selection.y + selection.h;

  if (handle.includes('w')) {
    left = clamp(point.x, 0, right - minSize);
  }
  if (handle.includes('e')) {
    right = clamp(point.x, left + minSize, bounds.width);
  }
  if (handle.includes('n')) {
    top = clamp(point.y, 0, bottom - minSize);
  }
  if (handle.includes('s')) {
    bottom = clamp(point.y, top + minSize, bounds.height);
  }

  return {
    x: left,
    y: top,
    w: right - left,
    h: bottom - top,
  };
}

export function selectionHandleRects(
  selection: SelectionRect,
  size = HANDLE_SIZE_PX,
): Array<SelectionRect & { handle: ResizeHandle }> {
  const half = size / 2;
  const cx = selection.x + selection.w / 2;
  const cy = selection.y + selection.h / 2;
  const right = selection.x + selection.w;
  const bottom = selection.y + selection.h;

  return [
    { handle: 'nw', x: selection.x - half, y: selection.y - half, w: size, h: size },
    { handle: 'n', x: cx - half, y: selection.y - half, w: size, h: size },
    { handle: 'ne', x: right - half, y: selection.y - half, w: size, h: size },
    { handle: 'e', x: right - half, y: cy - half, w: size, h: size },
    { handle: 'se', x: right - half, y: bottom - half, w: size, h: size },
    { handle: 's', x: cx - half, y: bottom - half, w: size, h: size },
    { handle: 'sw', x: selection.x - half, y: bottom - half, w: size, h: size },
    { handle: 'w', x: selection.x - half, y: cy - half, w: size, h: size },
  ];
}

export function hitTestSelection(
  selection: SelectionRect,
  point: Point,
  hitSize = HANDLE_HIT_SIZE_PX,
): SelectionHit {
  const handleOrder: ResizeHandle[] = ['nw', 'ne', 'se', 'sw', 'n', 'e', 's', 'w'];
  const handleRects = selectionHandleRects(selection, hitSize);

  for (const handle of handleOrder) {
    const rect = handleRects.find((item) => item.handle === handle);
    if (rect && isPointInRect(rect, point)) return handle;
  }

  return isPointInSelection(selection, point) ? 'inside' : 'outside';
}

export function cursorForSelectionHit(hit: SelectionHit): string {
  switch (hit) {
    case 'nw':
    case 'se':
      return 'nwse-resize';
    case 'ne':
    case 'sw':
      return 'nesw-resize';
    case 'n':
    case 's':
      return 'ns-resize';
    case 'e':
    case 'w':
      return 'ew-resize';
    case 'inside':
      return 'move';
    case 'outside':
      return 'crosshair';
  }
}

export function toolbarLayoutForSelection(
  selection: SelectionRect,
  bounds: Bounds,
): ToolbarLayout {
  const padding = 6;
  const gap = 4;
  const buttonW = 44;
  const buttonH = 24;
  const w = padding * 2 + buttonW * 3 + gap * 2;
  const h = padding * 2 + buttonH;
  const preferredY = selection.y - h - 8;
  const belowY = selection.y + selection.h + 8;
  const y = preferredY >= 4
    ? preferredY
    : clamp(belowY, 4, Math.max(4, bounds.height - h - 4));
  const x = clamp(selection.x, 4, Math.max(4, bounds.width - w - 4));
  const labels: Array<[ToolbarAction, string]> = [
    ['confirm', '确定'],
    ['reset', '重选'],
    ['cancel', '取消'],
  ];

  return {
    x,
    y,
    w,
    h,
    buttons: labels.map(([action, label], index) => ({
      action,
      label,
      x: x + padding + index * (buttonW + gap),
      y: y + padding,
      w: buttonW,
      h: buttonH,
    })),
  };
}

export function hitTestToolbar(
  selection: SelectionRect,
  bounds: Bounds,
  point: Point,
): ToolbarAction | null {
  const toolbar = toolbarLayoutForSelection(selection, bounds);
  if (!isPointInRect(toolbar, point)) return null;

  const button = toolbar.buttons.find((item) => isPointInRect(item, point));
  return button?.action ?? null;
}

export function canConfirmSelection(selection: SelectionRect | null): selection is SelectionRect {
  return !!selection && selection.w >= MIN_SELECTION_PX && selection.h >= MIN_SELECTION_PX;
}

export function shouldConfirmSelectionOnDoubleClick(
  phase: Phase,
  selection: SelectionRect | null,
  point: Point,
): boolean {
  return phase === 'selected' && !!selection && isPointInSelection(selection, point);
}

export function shouldStartNewSelectionOnMouseDown(
  phase: Phase,
  selection: SelectionRect | null,
  point: Point,
): boolean {
  if (phase !== 'selected') return true;
  if (!selection) return true;
  return hitTestSelection(selection, point) === 'outside';
}
