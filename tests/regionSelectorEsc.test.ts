import assert from 'node:assert/strict';
import { getEscapeAction } from '../src/pages/RegionSelector.logic.ts';

assert.equal(getEscapeAction('crosshair'), 'close');
assert.equal(getEscapeAction('drawing'), 'close');
assert.equal(getEscapeAction('selected'), 'close');
