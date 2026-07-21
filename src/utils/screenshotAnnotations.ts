export type AnnotationTool = 'pen' | 'rect' | 'circle' | 'arrow' | 'line' | 'text';

export interface ScreenshotPoint {
  x: number;
  y: number;
}

export interface ScreenshotRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ScreenshotSize {
  width: number;
  height: number;
}

export interface ScreenshotToolbarPosition extends ScreenshotPoint {
  placement: 'below' | 'above' | 'inside';
}

export interface ScreenshotAction {
  type: AnnotationTool;
  color: string;
  lineWidth: number;
  points?: ScreenshotPoint[];
  startX?: number;
  startY?: number;
  endX?: number;
  endY?: number;
  text?: string;
}

export interface ScreenshotActionHistory {
  actions: ScreenshotAction[];
  redoActions: ScreenshotAction[];
}

export type ScreenshotOverlayEscapeAction = 'cancel-current' | 'deactivate-tool' | 'close';

export interface ScreenshotOverlayInteraction {
  hasDraft: boolean;
  hasTextInput: boolean;
  activeTool: AnnotationTool | null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function isUsableScreenshotSource(source: ScreenshotSize): boolean {
  return Number.isFinite(source.width)
    && Number.isFinite(source.height)
    && source.width > 0
    && source.height > 0;
}

export function selectionToSourceRect(
  selection: ScreenshotRect,
  viewport: ScreenshotSize,
  source: ScreenshotSize,
): ScreenshotRect {
  if (viewport.width <= 0 || viewport.height <= 0 || source.width <= 0 || source.height <= 0) {
    return { x: 0, y: 0, w: 0, h: 0 };
  }

  const scaleX = source.width / viewport.width;
  const scaleY = source.height / viewport.height;
  const left = clamp(Math.floor(selection.x * scaleX), 0, source.width);
  const top = clamp(Math.floor(selection.y * scaleY), 0, source.height);
  const right = clamp(Math.ceil((selection.x + selection.w) * scaleX), left, source.width);
  const bottom = clamp(Math.ceil((selection.y + selection.h) * scaleY), top, source.height);

  return { x: left, y: top, w: right - left, h: bottom - top };
}

export function screenPointToSelectionPixel(
  point: ScreenshotPoint,
  selection: ScreenshotRect,
  sourceRect: ScreenshotRect,
): ScreenshotPoint {
  if (selection.w <= 0 || selection.h <= 0) return { x: 0, y: 0 };

  return {
    x: clamp((point.x - selection.x) * sourceRect.w / selection.w, 0, sourceRect.w),
    y: clamp((point.y - selection.y) * sourceRect.h / selection.h, 0, sourceRect.h),
  };
}

export function selectionPixelToScreenPoint(
  point: ScreenshotPoint,
  selection: ScreenshotRect,
  sourceRect: ScreenshotRect,
): ScreenshotPoint {
  if (sourceRect.w <= 0 || sourceRect.h <= 0) {
    return { x: selection.x, y: selection.y };
  }

  return {
    x: selection.x + point.x * selection.w / sourceRect.w,
    y: selection.y + point.y * selection.h / sourceRect.h,
  };
}

export function annotationLineWidthForSelection(
  displayLineWidth: number,
  selection: ScreenshotRect,
  sourceRect: ScreenshotRect,
): number {
  if (selection.w <= 0 || selection.h <= 0) return displayLineWidth;
  const scaleX = sourceRect.w / selection.w;
  const scaleY = sourceRect.h / selection.h;
  return displayLineWidth * (scaleX + scaleY) / 2;
}

export function positionScreenshotToolbar(
  selection: ScreenshotRect,
  viewport: ScreenshotSize,
  toolbar: ScreenshotSize,
  margin = 8,
): ScreenshotToolbarPosition {
  const maxX = Math.max(margin, viewport.width - toolbar.width - margin);
  const x = clamp(selection.x, margin, maxX);
  const below = selection.y + selection.h + margin;
  if (below + toolbar.height <= viewport.height - margin) {
    return { x, y: below, placement: 'below' };
  }

  const above = selection.y - toolbar.height - margin;
  if (above >= margin) return { x, y: above, placement: 'above' };

  const maxY = Math.max(margin, viewport.height - toolbar.height - margin);
  return {
    x,
    y: clamp(selection.y + margin, margin, maxY),
    placement: 'inside',
  };
}

export function createScreenshotAction(
  tool: AnnotationTool,
  point: ScreenshotPoint,
  color: string,
  lineWidth: number,
): ScreenshotAction {
  const base = { type: tool, color, lineWidth };
  if (tool === 'pen') return { ...base, points: [point] };
  if (tool === 'text') return { ...base, startX: point.x, startY: point.y };
  return {
    ...base,
    startX: point.x,
    startY: point.y,
    endX: point.x,
    endY: point.y,
  };
}

export function updateScreenshotAction(
  action: ScreenshotAction,
  point: ScreenshotPoint,
): ScreenshotAction {
  if (action.type === 'pen') {
    return { ...action, points: [...(action.points ?? []), point] };
  }
  if (action.type === 'text') return action;
  return { ...action, endX: point.x, endY: point.y };
}

export function isMeaningfulScreenshotAction(
  action: ScreenshotAction,
  minDistance = 2,
): boolean {
  if (action.type === 'text') return Boolean(action.text?.trim());

  if (action.type === 'pen') {
    const points = action.points ?? [];
    if (points.length < 2) return false;
    const start = points[0];
    return points.some((point) => Math.hypot(point.x - start.x, point.y - start.y) >= minDistance);
  }

  if (
    action.startX === undefined || action.startY === undefined
    || action.endX === undefined || action.endY === undefined
  ) {
    return false;
  }

  return Math.hypot(action.endX - action.startX, action.endY - action.startY) >= minDistance;
}

export function commitScreenshotAction(
  actions: ScreenshotAction[],
  _redoActions: ScreenshotAction[],
  action: ScreenshotAction,
): ScreenshotActionHistory {
  return { actions: [...actions, action], redoActions: [] };
}

export function undoScreenshotAction(
  actions: ScreenshotAction[],
  redoActions: ScreenshotAction[],
): ScreenshotActionHistory {
  const action = actions.at(-1);
  if (!action) return { actions, redoActions };
  return {
    actions: actions.slice(0, -1),
    redoActions: [...redoActions, action],
  };
}

export function redoScreenshotAction(
  actions: ScreenshotAction[],
  redoActions: ScreenshotAction[],
): ScreenshotActionHistory {
  const action = redoActions.at(-1);
  if (!action) return { actions, redoActions };
  return {
    actions: [...actions, action],
    redoActions: redoActions.slice(0, -1),
  };
}

export function canAdjustScreenshotSelection(
  actions: ScreenshotAction[],
  draftAction: ScreenshotAction | null,
): boolean {
  return actions.length === 0 && !draftAction;
}

export function getScreenshotOverlayEscapeAction(
  interaction: ScreenshotOverlayInteraction,
): ScreenshotOverlayEscapeAction {
  if (interaction.hasDraft || interaction.hasTextInput) return 'cancel-current';
  if (interaction.activeTool) return 'deactivate-tool';
  return 'close';
}

function drawArrowHead(
  ctx: CanvasRenderingContext2D,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  lineWidth: number,
): void {
  const headLength = lineWidth * 4;
  const angle = Math.atan2(toY - fromY, toX - fromX);
  ctx.beginPath();
  ctx.moveTo(toX, toY);
  ctx.lineTo(
    toX - headLength * Math.cos(angle - Math.PI / 6),
    toY - headLength * Math.sin(angle - Math.PI / 6),
  );
  ctx.moveTo(toX, toY);
  ctx.lineTo(
    toX - headLength * Math.cos(angle + Math.PI / 6),
    toY - headLength * Math.sin(angle + Math.PI / 6),
  );
  ctx.stroke();
}

export function renderScreenshotActions(
  ctx: CanvasRenderingContext2D,
  actions: ScreenshotAction[],
): void {
  for (const action of actions) {
    ctx.strokeStyle = action.color;
    ctx.fillStyle = action.color;
    ctx.lineWidth = action.lineWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    switch (action.type) {
      case 'pen': {
        const points = action.points ?? [];
        if (points.length < 2) break;
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        for (const point of points.slice(1)) ctx.lineTo(point.x, point.y);
        ctx.stroke();
        break;
      }
      case 'rect':
        if (
          action.startX !== undefined && action.startY !== undefined
          && action.endX !== undefined && action.endY !== undefined
        ) {
          ctx.strokeRect(
            action.startX,
            action.startY,
            action.endX - action.startX,
            action.endY - action.startY,
          );
        }
        break;
      case 'circle':
        if (
          action.startX !== undefined && action.startY !== undefined
          && action.endX !== undefined && action.endY !== undefined
        ) {
          const radiusX = Math.abs(action.endX - action.startX) / 2;
          const radiusY = Math.abs(action.endY - action.startY) / 2;
          const centerX = action.startX + (action.endX - action.startX) / 2;
          const centerY = action.startY + (action.endY - action.startY) / 2;
          ctx.beginPath();
          ctx.ellipse(centerX, centerY, radiusX, radiusY, 0, 0, Math.PI * 2);
          ctx.stroke();
        }
        break;
      case 'arrow':
      case 'line':
        if (
          action.startX !== undefined && action.startY !== undefined
          && action.endX !== undefined && action.endY !== undefined
        ) {
          ctx.beginPath();
          ctx.moveTo(action.startX, action.startY);
          ctx.lineTo(action.endX, action.endY);
          ctx.stroke();
          if (action.type === 'arrow') {
            drawArrowHead(
              ctx,
              action.startX,
              action.startY,
              action.endX,
              action.endY,
              action.lineWidth,
            );
          }
        }
        break;
      case 'text':
        if (action.text && action.startX !== undefined && action.startY !== undefined) {
          ctx.font = `${action.lineWidth * 6}px Inter, sans-serif`;
          ctx.fillText(action.text, action.startX, action.startY);
        }
        break;
    }
  }
}

export function renderScreenshotActionsInSelection(
  ctx: CanvasRenderingContext2D,
  selection: ScreenshotRect,
  sourceRect: ScreenshotRect,
  actions: ScreenshotAction[],
): void {
  if (selection.w <= 0 || selection.h <= 0 || sourceRect.w <= 0 || sourceRect.h <= 0) return;

  ctx.save();
  ctx.beginPath();
  ctx.rect(selection.x, selection.y, selection.w, selection.h);
  ctx.clip();
  ctx.translate(selection.x, selection.y);
  ctx.scale(selection.w / sourceRect.w, selection.h / sourceRect.h);
  renderScreenshotActions(ctx, actions);
  ctx.restore();
}

export function renderScreenshotSelection(
  sourceImage: CanvasImageSource,
  sourceRect: ScreenshotRect,
  actions: ScreenshotAction[],
): HTMLCanvasElement | null {
  if (sourceRect.w <= 0 || sourceRect.h <= 0) return null;

  const canvas = document.createElement('canvas');
  canvas.width = sourceRect.w;
  canvas.height = sourceRect.h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.drawImage(
    sourceImage,
    sourceRect.x,
    sourceRect.y,
    sourceRect.w,
    sourceRect.h,
    0,
    0,
    sourceRect.w,
    sourceRect.h,
  );
  renderScreenshotActions(ctx, actions);
  return canvas;
}
