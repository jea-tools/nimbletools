import assert from 'node:assert/strict';
import {
  createCanvasSafeImageUrl,
  getCanvasClipboardPayload,
  runHiddenScreenshotExport,
} from '../src/utils/canvasClipboard.ts';

const pixels = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255]);
const canvas = {
  width: 2,
  height: 1,
  getContext: () => ({
    getImageData: () => ({ data: pixels }),
  }),
} as unknown as HTMLCanvasElement;

const payload = getCanvasClipboardPayload(canvas);

assert.equal(payload?.width, 2);
assert.equal(payload?.height, 1);
assert(payload?.rgbaData instanceof Uint8Array);
assert.equal(payload?.rgbaData.length, pixels.length);
assert.deepEqual([...payload!.rgbaData], [...pixels]);

const imageBlob = new Blob(['png'], { type: 'image/png' });
let fetchedUrl = '';
const canvasSafeUrl = await createCanvasSafeImageUrl(
  'asset://localhost/preview.png',
  async (url) => {
    fetchedUrl = url;
    return {
      ok: true,
      status: 200,
      blob: async () => imageBlob,
    };
  },
  (blob) => {
    assert.equal(blob, imageBlob);
    return 'blob:canvas-safe-preview';
  },
);

assert.equal(fetchedUrl, 'asset://localhost/preview.png');
assert.equal(canvasSafeUrl, 'blob:canvas-safe-preview');

const exportOrder: string[] = [];
await runHiddenScreenshotExport(
  async () => { exportOrder.push('hide'); },
  async () => { exportOrder.push('render'); },
  async () => { exportOrder.push('restore'); },
  async () => { exportOrder.push('settle'); },
);
assert.deepEqual(exportOrder, ['hide', 'settle', 'render']);

await assert.rejects(
  runHiddenScreenshotExport(
    async () => { exportOrder.push('hide-failed-export'); },
    async () => {
      exportOrder.push('render-failed-export');
      throw new Error('copy failed');
    },
    async () => { exportOrder.push('restore-failed-export'); },
    async () => { exportOrder.push('settle-failed-export'); },
  ),
  /copy failed/,
);
assert.deepEqual(exportOrder.slice(-4), [
  'hide-failed-export',
  'settle-failed-export',
  'render-failed-export',
  'restore-failed-export',
]);
