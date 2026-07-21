export interface CanvasClipboardPayload {
  width: number;
  height: number;
  rgbaData: Uint8Array;
}

export interface TextPatchAction {
  type: string;
  color: string;
  lineWidth: number;
  startX?: number;
  startY?: number;
  text?: string;
}

export interface CanvasTextPatch {
  x: number;
  y: number;
  width: number;
  height: number;
  rgbaData: Uint8Array;
}

interface CanvasImageResponse {
  ok: boolean;
  status: number;
  blob(): Promise<Blob>;
}

type CanvasImageFetcher = (url: string) => Promise<CanvasImageResponse>;

export async function createCanvasSafeImageUrl(
  sourceUrl: string,
  fetchImage: CanvasImageFetcher = (url) => fetch(url),
  createObjectUrl: (blob: Blob) => string = (blob) => URL.createObjectURL(blob),
): Promise<string> {
  const response = await fetchImage(sourceUrl);
  if (!response.ok) {
    throw new Error(`Failed to load screenshot preview: HTTP ${response.status}`);
  }
  return createObjectUrl(await response.blob());
}

export function getCanvasClipboardPayload(canvas: HTMLCanvasElement): CanvasClipboardPayload | null {
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return {
    width: canvas.width,
    height: canvas.height,
    rgbaData: new Uint8Array(
      imageData.data.buffer,
      imageData.data.byteOffset,
      imageData.data.byteLength,
    ),
  };
}

export function getCanvasTextPatches(
  canvas: HTMLCanvasElement,
  actions: TextPatchAction[],
): CanvasTextPatch[] | null {
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const patches: CanvasTextPatch[] = [];
  for (const action of actions) {
    if (action.type !== 'text' || !action.text || action.startX === undefined || action.startY === undefined) {
      continue;
    }

    const fontSize = action.lineWidth * 6;
    ctx.font = `${fontSize}px Inter, sans-serif`;
    const metrics = ctx.measureText(action.text);
    const left = action.startX + Math.min(metrics.actualBoundingBoxLeft ? -metrics.actualBoundingBoxLeft : 0, 0);
    const right = action.startX + Math.max(metrics.width, metrics.actualBoundingBoxRight || metrics.width);
    const top = action.startY - (metrics.actualBoundingBoxAscent || fontSize);
    const bottom = action.startY + (metrics.actualBoundingBoxDescent || fontSize * 0.25);
    const padding = Math.ceil(Math.max(4, action.lineWidth * 2));
    const x = Math.max(0, Math.floor(left - padding));
    const y = Math.max(0, Math.floor(top - padding));
    const maxRight = Math.min(canvas.width, Math.ceil(right + padding));
    const maxBottom = Math.min(canvas.height, Math.ceil(bottom + padding));
    const width = maxRight - x;
    const height = maxBottom - y;

    if (width <= 0 || height <= 0) continue;

    const patchCanvas = document.createElement('canvas');
    patchCanvas.width = width;
    patchCanvas.height = height;
    const patchCtx = patchCanvas.getContext('2d');
    if (!patchCtx) return null;
    patchCtx.fillStyle = action.color;
    patchCtx.font = `${fontSize}px Inter, sans-serif`;
    patchCtx.fillText(action.text, action.startX - x, action.startY - y);
    const imageData = patchCtx.getImageData(0, 0, width, height);
    patches.push({
      x,
      y,
      width,
      height,
      rgbaData: new Uint8Array(
        imageData.data.buffer,
        imageData.data.byteOffset,
        imageData.data.byteLength,
      ),
    });
  }

  return patches;
}

export function waitForNextPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });
}
