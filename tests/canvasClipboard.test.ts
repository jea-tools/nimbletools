import assert from 'node:assert/strict';
import {
  createCanvasSafeImageUrl,
  getCanvasClipboardPayload,
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
