import assert from 'node:assert/strict';
import { getEscapeAction, shouldStartNewSelectionOnMouseDown } from '../src/pages/RegionSelector.logic.ts';

assert.equal(getEscapeAction('crosshair'), 'close');
assert.equal(getEscapeAction('drawing'), 'close');
assert.equal(getEscapeAction('selected'), 'close');

const selection = { x: 10, y: 20, w: 100, h: 80 };

assert.equal(
  shouldStartNewSelectionOnMouseDown('selected', selection, { x: 30, y: 40 }),
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
