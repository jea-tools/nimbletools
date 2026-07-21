import assert from 'node:assert/strict';
import {
  canAdjustScreenshotSelection,
  commitScreenshotAction,
  createScreenshotAction,
  getScreenshotOverlayEscapeAction,
  isMeaningfulScreenshotAction,
  isUsableScreenshotSource,
  positionScreenshotToolbar,
  redoScreenshotAction,
  renderScreenshotActions,
  renderScreenshotSelection,
  screenPointToSelectionPixel,
  selectionPixelToScreenPoint,
  selectionToSourceRect,
  undoScreenshotAction,
  updateScreenshotAction,
  type ScreenshotAction,
} from '../src/utils/screenshotAnnotations.ts';

const selection = { x: 100, y: 50, w: 200, h: 100 };
const sourceRect = selectionToSourceRect(
  selection,
  { width: 800, height: 400 },
  { width: 1600, height: 800 },
);

assert.deepEqual(sourceRect, { x: 200, y: 100, w: 400, h: 200 });
assert.equal(isUsableScreenshotSource({ width: 3456, height: 2234 }), true);
assert.equal(isUsableScreenshotSource({ width: 0, height: 2234 }), false);
assert.equal(isUsableScreenshotSource({ width: 3456, height: 0 }), false);
assert.deepEqual(
  screenPointToSelectionPixel({ x: 150, y: 75 }, selection, sourceRect),
  { x: 100, y: 50 },
);
assert.deepEqual(
  selectionPixelToScreenPoint({ x: 100, y: 50 }, selection, sourceRect),
  { x: 150, y: 75 },
);
assert.deepEqual(
  screenPointToSelectionPixel({ x: 999, y: -50 }, selection, sourceRect),
  { x: 400, y: 0 },
);

const arrow = updateScreenshotAction(
  createScreenshotAction('arrow', { x: 10, y: 20 }, '#ef4444', 8),
  { x: 80, y: 90 },
);
assert.deepEqual(arrow, {
  type: 'arrow',
  color: '#ef4444',
  lineWidth: 8,
  startX: 10,
  startY: 20,
  endX: 80,
  endY: 90,
});
assert.equal(isMeaningfulScreenshotAction(arrow), true);
assert.equal(
  isMeaningfulScreenshotAction(createScreenshotAction('rect', { x: 2, y: 2 }, '#fff', 4)),
  false,
);
assert.equal(
  isMeaningfulScreenshotAction({
    type: 'text', color: '#fff', lineWidth: 4, startX: 2, startY: 2, text: '  ',
  }),
  false,
);

const firstHistory = commitScreenshotAction([], [arrow], arrow);
assert.deepEqual(firstHistory.actions, [arrow]);
assert.deepEqual(firstHistory.redoActions, []);

const rect: ScreenshotAction = {
  type: 'rect', color: '#22c55e', lineWidth: 4,
  startX: 5, startY: 5, endX: 40, endY: 30,
};
const secondHistory = commitScreenshotAction(firstHistory.actions, [], rect);
const undone = undoScreenshotAction(secondHistory.actions, secondHistory.redoActions);
assert.deepEqual(undone.actions, [arrow]);
assert.deepEqual(undone.redoActions, [rect]);
const redone = redoScreenshotAction(undone.actions, undone.redoActions);
assert.deepEqual(redone.actions, [arrow, rect]);
assert.deepEqual(redone.redoActions, []);

assert.equal(canAdjustScreenshotSelection([], null), true);
assert.equal(canAdjustScreenshotSelection([arrow], null), false);
assert.equal(canAdjustScreenshotSelection([], arrow), false);

assert.equal(getScreenshotOverlayEscapeAction({ hasDraft: true, hasTextInput: false, activeTool: 'arrow' }), 'cancel-current');
assert.equal(getScreenshotOverlayEscapeAction({ hasDraft: false, hasTextInput: true, activeTool: 'text' }), 'cancel-current');
assert.equal(getScreenshotOverlayEscapeAction({ hasDraft: false, hasTextInput: false, activeTool: 'rect' }), 'deactivate-tool');
assert.equal(getScreenshotOverlayEscapeAction({ hasDraft: false, hasTextInput: false, activeTool: null }), 'close');

assert.deepEqual(
  positionScreenshotToolbar(selection, { width: 800, height: 600 }, { width: 400, height: 44 }),
  { x: 100, y: 158, placement: 'below' },
);
assert.deepEqual(
  positionScreenshotToolbar(
    { x: 700, y: 530, w: 80, h: 60 },
    { width: 800, height: 600 },
    { width: 400, height: 44 },
  ),
  { x: 392, y: 478, placement: 'above' },
);
assert.deepEqual(
  positionScreenshotToolbar(
    { x: 0, y: 0, w: 800, h: 600 },
    { width: 800, height: 600 },
    { width: 400, height: 44 },
  ),
  { x: 8, y: 8, placement: 'inside' },
);

const operations: string[] = [];
const context = {
  strokeStyle: '',
  fillStyle: '',
  lineWidth: 0,
  lineCap: 'butt',
  lineJoin: 'miter',
  font: '',
  beginPath: () => operations.push('beginPath'),
  moveTo: (x: number, y: number) => operations.push(`moveTo:${x},${y}`),
  lineTo: (x: number, y: number) => operations.push(`lineTo:${x},${y}`),
  stroke: () => operations.push('stroke'),
  strokeRect: (x: number, y: number, w: number, h: number) => operations.push(`strokeRect:${x},${y},${w},${h}`),
  ellipse: (x: number, y: number, rx: number, ry: number) => operations.push(`ellipse:${x},${y},${rx},${ry}`),
  fillText: (value: string, x: number, y: number) => operations.push(`fillText:${value},${x},${y}`),
} as unknown as CanvasRenderingContext2D;

renderScreenshotActions(context, [
  arrow,
  rect,
  { type: 'circle', color: '#fff', lineWidth: 2, startX: 10, startY: 20, endX: 30, endY: 60 },
  { type: 'line', color: '#fff', lineWidth: 2, startX: 1, startY: 2, endX: 3, endY: 4 },
  { type: 'pen', color: '#fff', lineWidth: 2, points: [{ x: 1, y: 1 }, { x: 2, y: 3 }] },
  { type: 'text', color: '#fff', lineWidth: 2, startX: 6, startY: 8, text: 'Nimble' },
]);

assert(operations.includes('strokeRect:5,5,35,25'));
assert(operations.includes('ellipse:20,40,10,20'));
assert(operations.includes('fillText:Nimble,6,8'));
assert(operations.includes('lineTo:80,90'));

const exportOperations: Array<{ name: string; args: unknown[] }> = [];
const exportContext = {
  ...context,
  drawImage: (...args: unknown[]) => exportOperations.push({ name: 'drawImage', args }),
  strokeRect: (...args: unknown[]) => exportOperations.push({ name: 'strokeRect', args }),
} as unknown as CanvasRenderingContext2D;
const exportCanvas = {
  width: 0,
  height: 0,
  getContext: () => exportContext,
};
Object.defineProperty(globalThis, 'document', {
  configurable: true,
  value: { createElement: () => exportCanvas },
});
const sourceImage = { id: 'frozen-image' } as unknown as CanvasImageSource;
const rendered = renderScreenshotSelection(
  sourceImage,
  { x: 200, y: 100, w: 400, h: 200 },
  [rect],
);

assert.equal(rendered, exportCanvas);
assert.equal(exportCanvas.width, 400);
assert.equal(exportCanvas.height, 200);
assert.deepEqual(exportOperations[0], {
  name: 'drawImage',
  args: [sourceImage, 200, 100, 400, 200, 0, 0, 400, 200],
});
assert.deepEqual(exportOperations[1], {
  name: 'strokeRect',
  args: [5, 5, 35, 25],
});
