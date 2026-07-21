import assert from 'node:assert/strict';
import {
  canConfirmSelection,
  cursorForSelectionHit,
  getEscapeAction,
  hitTestSelection,
  hitTestToolbar,
  isPointInSelection,
  moveSelection,
  normalizeSelection,
  resizeSelection,
  shouldConfirmSelectionOnDoubleClick,
  shouldStartNewSelectionOnMouseDown,
  toolbarLayoutForSelection,
} from '../src/pages/RegionSelector.logic.ts';

assert.equal(getEscapeAction('crosshair'), 'close');
assert.equal(getEscapeAction('drawing'), 'close');
assert.equal(getEscapeAction('selected'), 'close');
assert.equal(getEscapeAction('moving'), 'close');
assert.equal(getEscapeAction('resizing'), 'close');

const selection = { x: 10, y: 20, w: 100, h: 80 };
const bounds = { width: 300, height: 220 };

assert.deepEqual(normalizeSelection({ x: 110, y: 100 }, { x: 10, y: 20 }), selection);
assert.equal(normalizeSelection({ x: 10, y: 20 }, { x: 15, y: 24 }), null);

assert.equal(
  shouldStartNewSelectionOnMouseDown('selected', selection, { x: 30, y: 40 }),
  false,
);
assert.equal(
  shouldStartNewSelectionOnMouseDown('selected', selection, { x: 114, y: 104 }),
  false,
);
assert.equal(
  shouldStartNewSelectionOnMouseDown('selected', selection, { x: 5, y: 40 }),
  true,
);
assert.equal(
  shouldStartNewSelectionOnMouseDown('crosshair', null, { x: 30, y: 40 }),
  true,
);

assert.equal(isPointInSelection(selection, { x: 60, y: 60 }), true);
assert.equal(isPointInSelection(selection, { x: 111, y: 60 }), false);

assert.equal(hitTestSelection(selection, { x: 10, y: 20 }), 'nw');
assert.equal(hitTestSelection(selection, { x: 60, y: 20 }), 'n');
assert.equal(hitTestSelection(selection, { x: 110, y: 100 }), 'se');
assert.equal(hitTestSelection(selection, { x: 60, y: 60 }), 'inside');
assert.equal(hitTestSelection(selection, { x: 0, y: 0 }), 'outside');

assert.equal(cursorForSelectionHit('nw'), 'nwse-resize');
assert.equal(cursorForSelectionHit('e'), 'ew-resize');
assert.equal(cursorForSelectionHit('inside'), 'move');
assert.equal(cursorForSelectionHit('outside'), 'crosshair');

assert.deepEqual(
  moveSelection(selection, { x: 30, y: 40 }, { x: 330, y: 240 }, bounds),
  { x: 200, y: 140, w: 100, h: 80 },
);
assert.deepEqual(
  moveSelection(selection, { x: 30, y: 40 }, { x: 0, y: 0 }, bounds),
  { x: 0, y: 0, w: 100, h: 80 },
);

assert.deepEqual(
  resizeSelection(selection, 'se', { x: 260, y: 210 }, bounds),
  { x: 10, y: 20, w: 250, h: 190 },
);
assert.deepEqual(
  resizeSelection(selection, 'nw', { x: 108, y: 98 }, bounds),
  { x: 100, y: 90, w: 10, h: 10 },
);
assert.deepEqual(
  resizeSelection(selection, 'e', { x: 12, y: 999 }, bounds),
  { x: 10, y: 20, w: 10, h: 80 },
);
assert.deepEqual(
  resizeSelection(selection, 'w', { x: -20, y: 0 }, bounds),
  { x: 0, y: 20, w: 110, h: 80 },
);

const toolbar = toolbarLayoutForSelection(selection, bounds);
assert.equal(
  hitTestToolbar(selection, bounds, {
    x: toolbar.buttons[0].x + toolbar.buttons[0].w / 2,
    y: toolbar.buttons[0].y + toolbar.buttons[0].h / 2,
  }),
  'confirm',
);
assert.equal(
  hitTestToolbar(selection, bounds, {
    x: toolbar.buttons[1].x + toolbar.buttons[1].w / 2,
    y: toolbar.buttons[1].y + toolbar.buttons[1].h / 2,
  }),
  'reset',
);
assert.equal(
  hitTestToolbar(selection, bounds, {
    x: toolbar.buttons[2].x + toolbar.buttons[2].w / 2,
    y: toolbar.buttons[2].y + toolbar.buttons[2].h / 2,
  }),
  'cancel',
);
assert.equal(hitTestToolbar(selection, bounds, { x: 0, y: 0 }), null);

assert.equal(shouldConfirmSelectionOnDoubleClick('selected', selection, { x: 60, y: 60 }), true);
assert.equal(shouldConfirmSelectionOnDoubleClick('selected', selection, { x: 0, y: 0 }), false);
assert.equal(shouldConfirmSelectionOnDoubleClick('resizing', selection, { x: 60, y: 60 }), false);
assert.equal(canConfirmSelection(selection), true);
assert.equal(canConfirmSelection({ x: 0, y: 0, w: 9, h: 100 }), false);
