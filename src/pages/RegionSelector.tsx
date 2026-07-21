import { useRef, useCallback, useEffect, useState, type CSSProperties } from 'react';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { listen } from '@tauri-apps/api/event';
import { save } from '@tauri-apps/plugin-dialog';
import { readFile } from '@tauri-apps/plugin-fs';
import {
  ArrowUpRight,
  Circle,
  Copy,
  Download,
  Ellipsis,
  Minus,
  MousePointer2,
  Pen,
  Redo2,
  RotateCcw,
  Square,
  Type,
  Undo2,
  X,
} from 'lucide-react';
import {
  canConfirmSelection,
  cursorForSelectionHit,
  hitTestSelection,
  moveSelection,
  normalizeSelection,
  resizeSelection,
  selectionHandleRects,
  shouldStartNewSelectionOnMouseDown,
  type Bounds,
  type Phase,
  type Point,
  type ResizeHandle,
  type SelectionRect,
} from './RegionSelector.logic';
import {
  createCanvasSafeImageUrl,
  getCanvasClipboardPayload,
} from '../utils/canvasClipboard';
import {
  annotationLineWidthForSelection,
  canAdjustScreenshotSelection,
  commitScreenshotAction,
  createScreenshotAction,
  getScreenshotOverlayEscapeAction,
  isMeaningfulScreenshotAction,
  isUsableScreenshotSource,
  positionScreenshotToolbar,
  redoScreenshotAction,
  renderScreenshotActionsInSelection,
  renderScreenshotSelection,
  screenPointToSelectionPixel,
  selectionToSourceRect,
  undoScreenshotAction,
  updateScreenshotAction,
  type AnnotationTool,
  type ScreenshotAction,
} from '../utils/screenshotAnnotations';

type Interaction =
  | { type: 'move'; startPoint: Point; initialSelection: SelectionRect }
  | { type: 'resize'; handle: ResizeHandle; initialSelection: SelectionRect };

interface TextInputState {
  sourceX: number;
  sourceY: number;
  screenX: number;
  screenY: number;
  value: string;
}

const COLORS = ['#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#ffffff', '#111827'];
const LINE_WIDTHS = [2, 4, 8];
const PRIMARY_TOOLS: Array<{ type: AnnotationTool; label: string; icon: typeof ArrowUpRight }> = [
  { type: 'arrow', label: '箭头', icon: ArrowUpRight },
  { type: 'rect', label: '矩形', icon: Square },
  { type: 'circle', label: '椭圆', icon: Circle },
  { type: 'text', label: '文字', icon: Type },
];
const MORE_TOOLS: Array<{ type: AnnotationTool; label: string; icon: typeof Pen }> = [
  { type: 'pen', label: '画笔', icon: Pen },
  { type: 'line', label: '直线', icon: Minus },
];

const toolbarButtonStyle = (active = false, disabled = false): CSSProperties => ({
  width: 32,
  height: 32,
  flex: '0 0 32px',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 0,
  border: active ? '1px solid #38bdf8' : '1px solid transparent',
  borderRadius: 5,
  color: disabled ? 'rgba(255,255,255,0.32)' : '#f8fafc',
  background: active ? 'rgba(14,165,233,0.28)' : 'transparent',
  cursor: disabled ? 'default' : 'pointer',
  opacity: disabled ? 0.55 : 1,
});

const dividerStyle: CSSProperties = {
  width: 1,
  height: 24,
  flex: '0 0 1px',
  background: 'rgba(255,255,255,0.18)',
  margin: '0 2px',
};

async function closeSelf() {
  try {
    await getCurrentWindow().close();
  } catch {
    try { await getCurrentWindow().destroy(); } catch { /* noop */ }
  }
}

async function closeOverlay(sourcePath: string, reason = 'unknown') {
  try {
    await invoke('cancel_region_selector', { sourcePath, reason });
  } catch (err) {
    console.error('cancel_region_selector failed:', err);
  }
  await closeSelf();
}

export default function RegionSelector() {
  const params = new URLSearchParams(window.location.search);
  const fullImagePath = decodeURIComponent(params.get('image') || '');

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);

  const phaseRef = useRef<Phase>('crosshair');
  const startRef = useRef({ x: 0, y: 0 });
  const mouseRef = useRef({ x: 0, y: 0 });
  const selectionRef = useRef<SelectionRect | null>(null);
  const interactionRef = useRef<Interaction | null>(null);
  const actionsRef = useRef<ScreenshotAction[]>([]);
  const redoActionsRef = useRef<ScreenshotAction[]>([]);
  const draftActionRef = useRef<ScreenshotAction | null>(null);
  const activeToolRef = useRef<AnnotationTool | null>(null);
  const colorRef = useRef(COLORS[0]);
  const lineWidthRef = useRef(4);
  const textInputStateRef = useRef<TextInputState | null>(null);
  const redrawFrameRef = useRef<number | null>(null);
  const lastEscapeAtRef = useRef(0);
  const overlayShownRef = useRef(false);

  const [phase, setPhaseState] = useState<Phase>('crosshair');
  const [selection, setSelectionState] = useState<SelectionRect | null>(null);
  const [actions, setActionsState] = useState<ScreenshotAction[]>([]);
  const [redoActions, setRedoActionsState] = useState<ScreenshotAction[]>([]);
  const [activeTool, setActiveToolState] = useState<AnnotationTool | null>(null);
  const [color, setColorState] = useState(COLORS[0]);
  const [lineWidth, setLineWidthState] = useState(4);
  const [textInput, setTextInputState] = useState<TextInputState | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('正在加载截图...');
  const [errorMessage, setErrorMessage] = useState('');
  const [cursor, setCursor] = useState('crosshair');

  const setPhase = useCallback((next: Phase) => {
    phaseRef.current = next;
    setPhaseState(next);
  }, []);

  const setSelection = useCallback((next: SelectionRect | null) => {
    selectionRef.current = next;
    setSelectionState(next);
  }, []);

  const setActiveTool = useCallback((next: AnnotationTool | null) => {
    activeToolRef.current = next;
    setActiveToolState(next);
  }, []);

  const setColor = useCallback((next: string) => {
    colorRef.current = next;
    setColorState(next);
  }, []);

  const setLineWidth = useCallback((next: number) => {
    lineWidthRef.current = next;
    setLineWidthState(next);
  }, []);

  const setDraftAction = useCallback((next: ScreenshotAction | null) => {
    draftActionRef.current = next;
  }, []);

  const setTextInput = useCallback((next: TextInputState | null) => {
    textInputStateRef.current = next;
    setTextInputState(next);
  }, []);

  const applyHistory = useCallback((next: { actions: ScreenshotAction[]; redoActions: ScreenshotAction[] }) => {
    actionsRef.current = next.actions;
    redoActionsRef.current = next.redoActions;
    setActionsState(next.actions);
    setRedoActionsState(next.redoActions);
  }, []);

  const sourceRectForSelection = useCallback((currentSelection: SelectionRect) => {
    const img = imgRef.current;
    const canvas = canvasRef.current;
    if (!img || !canvas) return null;
    const imageSize = { width: img.naturalWidth, height: img.naturalHeight };
    if (!isUsableScreenshotSource(imageSize)) return null;
    return selectionToSourceRect(
      currentSelection,
      { width: canvas.width, height: canvas.height },
      imageSize,
    );
  }, []);

  const redraw = useCallback(() => {
    redrawFrameRef.current = null;
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img) return;
    if (!isUsableScreenshotSource({ width: img.naturalWidth, height: img.naturalHeight })) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = window.innerWidth;
    const H = window.innerHeight;
    if (canvas.width !== W) canvas.width = W;
    if (canvas.height !== H) canvas.height = H;

    // 底层截图
    ctx.drawImage(img, 0, 0, W, H);
    // 遮罩
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.fillRect(0, 0, W, H);

    const mx = mouseRef.current.x;
    const my = mouseRef.current.y;
    const currentPhase = phaseRef.current;

    let rx = 0, ry = 0, rw = 0, rh = 0;
    let hasRect = false;

    if (currentPhase === 'drawing') {
      const sx = startRef.current.x;
      const sy = startRef.current.y;
      rx = Math.min(sx, mx);
      ry = Math.min(sy, my);
      rw = Math.abs(mx - sx);
      rh = Math.abs(my - sy);
      hasRect = rw > 1 && rh > 1;
    } else if (selectionRef.current && currentPhase !== 'crosshair' && currentPhase !== 'canceled') {
      rx = selectionRef.current.x;
      ry = selectionRef.current.y;
      rw = selectionRef.current.w;
      rh = selectionRef.current.h;
      hasRect = true;
    }

    if (hasRect) {
      // 选区原图
      ctx.save();
      ctx.beginPath();
      ctx.rect(rx, ry, rw, rh);
      ctx.clip();
      ctx.drawImage(img, 0, 0, W, H);
      ctx.restore();

      // 边框
      ctx.strokeStyle = '#4fc3f7';
      ctx.lineWidth = 2;
      ctx.setLineDash([]);
      ctx.strokeRect(rx, ry, rw, rh);

      const currentSelection = selectionRef.current;
      const sourceRect = currentSelection ? sourceRectForSelection(currentSelection) : null;
      if (currentSelection && sourceRect) {
        renderScreenshotActionsInSelection(
          ctx,
          currentSelection,
          sourceRect,
          draftActionRef.current
            ? [...actionsRef.current, draftActionRef.current]
            : actionsRef.current,
        );
      }

      if (
        currentSelection
        && canAdjustScreenshotSelection(actionsRef.current, draftActionRef.current)
        && (currentPhase === 'selected' || currentPhase === 'moving' || currentPhase === 'resizing')
      ) {
        for (const handle of selectionHandleRects(currentSelection)) {
          ctx.fillStyle = '#ffffff';
          ctx.strokeStyle = '#0ea5e9';
          ctx.lineWidth = 1;
          ctx.fillRect(handle.x, handle.y, handle.w, handle.h);
          ctx.strokeRect(handle.x, handle.y, handle.w, handle.h);
        }
      }

      // 尺寸标签
      const scaleX = img.naturalWidth / W;
      const scaleY = img.naturalHeight / H;
      const realW = Math.round(rw * scaleX);
      const realH = Math.round(rh * scaleY);
      const label = `${realW} × ${realH}`;
      ctx.font = '13px -apple-system, sans-serif';
      const textW = ctx.measureText(label).width + 12;
      const labelX = rx;
      const labelY = ry > 28 ? ry - 6 : ry + rh + 22;
      ctx.fillStyle = 'rgba(0,0,0,0.75)';
      ctx.fillRect(labelX, labelY - 16, textW, 22);
      ctx.fillStyle = '#fff';
      ctx.fillText(label, labelX + 6, labelY - 1);

    }

    if (currentPhase === 'crosshair') {
      ctx.strokeStyle = 'rgba(255,255,255,0.6)';
      ctx.lineWidth = 1;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(mx, 0);
      ctx.lineTo(mx, H);
      ctx.moveTo(0, my);
      ctx.lineTo(W, my);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }, [sourceRectForSelection]);

  const scheduleRedraw = useCallback(() => {
    if (redrawFrameRef.current !== null) return;
    redrawFrameRef.current = requestAnimationFrame(redraw);
  }, [redraw]);

  useEffect(() => {
    let disposed = false;
    let objectUrl = '';
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => {
      if (disposed || overlayShownRef.current) return;
      imgRef.current = image;
      setLoadingMessage('');
      redraw();
      overlayShownRef.current = true;
      invoke('show_region_selector').catch((error) => {
        overlayShownRef.current = false;
        console.error('Failed to show screenshot overlay:', error);
        void closeOverlay(fullImagePath, 'show-error');
      });
    };
    image.onerror = () => {
      if (disposed) return;
      console.error('Failed to load screenshot preview:', fullImagePath);
      setLoadingMessage('');
      setErrorMessage('截图冻结图加载失败');
      void closeOverlay(fullImagePath, 'load-error');
    };

    const loadFrozenImage = async () => {
      try {
        try {
          objectUrl = await createCanvasSafeImageUrl(convertFileSrc(fullImagePath));
        } catch (assetError) {
          console.warn('Asset preview fetch failed, using file fallback:', assetError);
          const bytes = await readFile(fullImagePath);
          objectUrl = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }));
        }
        if (disposed) {
          URL.revokeObjectURL(objectUrl);
          objectUrl = '';
          return;
        }
        image.src = objectUrl;
      } catch (error) {
        if (disposed) return;
        console.error('Failed to load screenshot preview:', error);
        setLoadingMessage('');
        setErrorMessage(`截图冻结图加载失败: ${String(error)}`);
        void closeOverlay(fullImagePath, 'load-error');
      }
    };

    void loadFrozenImage();

    return () => {
      disposed = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [fullImagePath, redraw]);

  useEffect(() => {
    window.focus();
    document.body.focus();
  }, []);

  const resetToCrosshair = useCallback(() => {
    setPhase('crosshair');
    setSelection(null);
    interactionRef.current = null;
    setDraftAction(null);
    applyHistory({ actions: [], redoActions: [] });
    setTextInput(null);
    setActiveTool(null);
    setMoreOpen(false);
    setErrorMessage('');
    setCursor('crosshair');
    scheduleRedraw();
  }, [applyHistory, scheduleRedraw, setActiveTool, setDraftAction, setPhase, setSelection, setTextInput]);

  const canvasBounds = useCallback((): Bounds => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }), []);

  const updateHoverCursor = useCallback((point: Point) => {
    const selection = selectionRef.current;
    const phase = phaseRef.current;
    if (activeToolRef.current && selection) {
      setCursor(activeToolRef.current === 'text' ? 'text' : 'crosshair');
      return;
    }

    if (!selection || phase !== 'selected') {
      setCursor(phase === 'crosshair' || phase === 'drawing' ? 'crosshair' : 'default');
      return;
    }

    if (!canAdjustScreenshotSelection(actionsRef.current, draftActionRef.current)) {
      setCursor('default');
      return;
    }

    setCursor(cursorForSelectionHit(hitTestSelection(selection, point)));
  }, [canvasBounds]);

  useEffect(() => {
    return () => {
      if (redrawFrameRef.current !== null) {
        cancelAnimationFrame(redrawFrameRef.current);
      }
    };
  }, []);

  const buildExportCanvas = useCallback(() => {
    const currentSelection = selectionRef.current;
    const image = imgRef.current;
    if (!currentSelection || !image) return null;
    const sourceRect = sourceRectForSelection(currentSelection);
    if (!sourceRect) return null;
    return renderScreenshotSelection(image, sourceRect, actionsRef.current);
  }, [sourceRectForSelection]);

  const copySelection = useCallback(async () => {
    if (phaseRef.current === 'exporting' || !canConfirmSelection(selectionRef.current)) return;
    setPhase('exporting');
    setErrorMessage('');
    try {
      const exportCanvas = buildExportCanvas();
      if (!exportCanvas) throw new Error('无法生成截图内容');
      const payload = getCanvasClipboardPayload(exportCanvas);
      if (!payload) throw new Error('无法读取截图像素');
      await invoke('copy_image_to_clipboard', {
        width: payload.width,
        height: payload.height,
        rgbaData: payload.rgbaData,
      });
      await closeOverlay(fullImagePath, 'copied');
    } catch (error) {
      console.error('copy_image_to_clipboard failed:', error);
      setErrorMessage(`复制失败: ${String(error)}`);
      setPhase('selected');
    }
  }, [buildExportCanvas, fullImagePath, setPhase]);

  const saveSelection = useCallback(async () => {
    if (phaseRef.current === 'exporting' || !canConfirmSelection(selectionRef.current)) return;
    const outputPath = await save({
      filters: [{ name: 'PNG Image', extensions: ['png'] }],
      defaultPath: `screenshot_${Date.now()}.png`,
    });
    if (!outputPath) return;

    setPhase('exporting');
    setErrorMessage('');
    try {
      const exportCanvas = buildExportCanvas();
      if (!exportCanvas) throw new Error('无法生成截图内容');
      const payload = getCanvasClipboardPayload(exportCanvas);
      if (!payload) throw new Error('无法读取截图像素');
      await invoke('save_screenshot_canvas', {
        outputPath,
        width: payload.width,
        height: payload.height,
        rgbaData: payload.rgbaData,
      });
      await closeOverlay(fullImagePath, 'saved');
    } catch (error) {
      console.error('save_screenshot_canvas failed:', error);
      setErrorMessage(`保存失败: ${String(error)}`);
      setPhase('selected');
    }
  }, [buildExportCanvas, fullImagePath, setPhase]);

  const commitTextInput = useCallback(() => {
    const input = textInputStateRef.current;
    if (!input) return;
    const value = input.value.trim();
    if (value) {
      const currentSelection = selectionRef.current;
      const sourceRect = currentSelection ? sourceRectForSelection(currentSelection) : null;
      const sourceLineWidth = currentSelection && sourceRect
        ? annotationLineWidthForSelection(lineWidthRef.current, currentSelection, sourceRect)
        : lineWidthRef.current;
      const action: ScreenshotAction = {
        type: 'text',
        color: colorRef.current,
        lineWidth: sourceLineWidth,
        startX: input.sourceX,
        startY: input.sourceY,
        text: value,
      };
      applyHistory(commitScreenshotAction(actionsRef.current, redoActionsRef.current, action));
    }
    setTextInput(null);
    setPhase('selected');
    scheduleRedraw();
  }, [applyHistory, scheduleRedraw, setPhase, setTextInput, sourceRectForSelection]);

  const cancelCurrentInteraction = useCallback(() => {
    setDraftAction(null);
    setTextInput(null);
    interactionRef.current = null;
    setActiveTool(null);
    setPhase(selectionRef.current ? 'selected' : 'crosshair');
    scheduleRedraw();
  }, [scheduleRedraw, setActiveTool, setDraftAction, setPhase, setTextInput]);

  const undo = useCallback(() => {
    applyHistory(undoScreenshotAction(actionsRef.current, redoActionsRef.current));
    scheduleRedraw();
  }, [applyHistory, scheduleRedraw]);

  const redo = useCallback(() => {
    applyHistory(redoScreenshotAction(actionsRef.current, redoActionsRef.current));
    scheduleRedraw();
  }, [applyHistory, scheduleRedraw]);

  // 鼠标事件
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const onMouseMove = (e: MouseEvent) => {
      const point = { x: e.clientX, y: e.clientY };
      mouseRef.current = point;
      const interaction = interactionRef.current;

      if (draftActionRef.current && selectionRef.current) {
        const sourceRect = sourceRectForSelection(selectionRef.current);
        if (sourceRect) {
          setDraftAction(updateScreenshotAction(
            draftActionRef.current,
            screenPointToSelectionPixel(point, selectionRef.current, sourceRect),
          ));
        }
        scheduleRedraw();
        return;
      }

      if (interaction?.type === 'move') {
        selectionRef.current = moveSelection(
          interaction.initialSelection,
          interaction.startPoint,
          point,
          canvasBounds(),
        );
      } else if (interaction?.type === 'resize') {
        selectionRef.current = resizeSelection(
          interaction.initialSelection,
          interaction.handle,
          point,
          canvasBounds(),
        );
      } else {
        updateHoverCursor(point);
      }

      scheduleRedraw();
    };

    const onMouseDown = async (e: MouseEvent) => {
      if (e.button !== 0) return;

      const point = { x: e.clientX, y: e.clientY };
      const currentSelection = selectionRef.current;
      const currentTool = activeToolRef.current;

      if (currentTool && currentSelection) {
        if (hitTestSelection(currentSelection, point) === 'outside') return;
        const sourceRect = sourceRectForSelection(currentSelection);
        if (!sourceRect) return;
        const sourcePoint = screenPointToSelectionPixel(point, currentSelection, sourceRect);
        const sourceLineWidth = annotationLineWidthForSelection(
          lineWidthRef.current,
          currentSelection,
          sourceRect,
        );

        if (currentTool === 'text') {
          if (textInputStateRef.current) commitTextInput();
          setTextInput({
            sourceX: sourcePoint.x,
            sourceY: sourcePoint.y,
            screenX: point.x,
            screenY: point.y,
            value: '',
          });
          setPhase('annotating');
          return;
        }

        setDraftAction(createScreenshotAction(
          currentTool,
          sourcePoint,
          colorRef.current,
          sourceLineWidth,
        ));
        setPhase('annotating');
        scheduleRedraw();
        return;
      }

      if (!canAdjustScreenshotSelection(actionsRef.current, draftActionRef.current)) return;

      if (!shouldStartNewSelectionOnMouseDown(phaseRef.current, currentSelection, point) && currentSelection) {
        const hit = hitTestSelection(currentSelection, point);
        if (hit === 'inside') {
          setPhase('moving');
          interactionRef.current = { type: 'move', startPoint: point, initialSelection: currentSelection };
          setCursor('move');
          mouseRef.current = point;
          scheduleRedraw();
          return;
        }
        if (hit !== 'outside') {
          setPhase('resizing');
          interactionRef.current = { type: 'resize', handle: hit, initialSelection: currentSelection };
          setCursor(cursorForSelectionHit(hit));
          mouseRef.current = point;
          scheduleRedraw();
          return;
        }

        mouseRef.current = point;
        return;
      }

      setPhase('drawing');
      interactionRef.current = null;
      startRef.current = point;
      mouseRef.current = point;
      setSelection(null);
      setCursor('crosshair');
      scheduleRedraw();
    };

    const onMouseUp = (e: MouseEvent) => {
      const draft = draftActionRef.current;
      if (draft) {
        if (isMeaningfulScreenshotAction(draft)) {
          applyHistory(commitScreenshotAction(actionsRef.current, redoActionsRef.current, draft));
        }
        setDraftAction(null);
        setPhase('selected');
        scheduleRedraw();
        return;
      }

      const currentPhase = phaseRef.current;
      if (currentPhase === 'moving' || currentPhase === 'resizing') {
        setSelection(selectionRef.current);
        setPhase('selected');
        interactionRef.current = null;
        updateHoverCursor({ x: e.clientX, y: e.clientY });
        scheduleRedraw();
        return;
      }

      if (currentPhase !== 'drawing') return;

      const sel = normalizeSelection(startRef.current, { x: e.clientX, y: e.clientY });
      if (!sel) {
        resetToCrosshair();
        return;
      }

      setPhase('selected');
      interactionRef.current = null;
      setSelection(sel);
      updateHoverCursor({ x: e.clientX, y: e.clientY });
      redraw();
    };

    const onDblClick = async (e: MouseEvent) => {
      const currentSelection = selectionRef.current;
      if (currentSelection && hitTestSelection(currentSelection, { x: e.clientX, y: e.clientY }) === 'inside') {
        setDraftAction(null);
        setTextInput(null);
        await copySelection();
      }
    };

    canvas.addEventListener('mousedown', onMouseDown);
    canvas.addEventListener('dblclick', onDblClick);
    window.addEventListener('mousemove', onMouseMove, true);
    window.addEventListener('mouseup', onMouseUp, true);

    return () => {
      canvas.removeEventListener('mousedown', onMouseDown);
      canvas.removeEventListener('dblclick', onDblClick);
      window.removeEventListener('mousemove', onMouseMove, true);
      window.removeEventListener('mouseup', onMouseUp, true);
    };
  }, [
    canvasBounds,
    commitTextInput,
    copySelection,
    applyHistory,
    redraw,
    resetToCrosshair,
    scheduleRedraw,
    setDraftAction,
    setPhase,
    setSelection,
    setTextInput,
    sourceRectForSelection,
    updateHoverCursor,
  ]);

  const handleEscape = useCallback(async () => {
    const now = performance.now();
    if (now - lastEscapeAtRef.current < 180) return;
    lastEscapeAtRef.current = now;

    const action = getScreenshotOverlayEscapeAction({
      hasDraft: Boolean(draftActionRef.current),
      hasTextInput: Boolean(textInputStateRef.current),
      activeTool: activeToolRef.current,
    });
    if (action === 'close') {
      setPhase('canceled');
      await closeOverlay(fullImagePath, 'escape');
    } else if (action === 'deactivate-tool') {
      setActiveTool(null);
      setCursor('default');
    } else {
      cancelCurrentInteraction();
    }
  }, [cancelCurrentInteraction, fullImagePath, setActiveTool, setPhase]);

  // ESC：通过 Rust 后端 CGEventSourceKeyState 轮询检测
  useEffect(() => {
    const unlisten = listen('esc-pressed', () => {
      handleEscape();
    });
    return () => { unlisten.then(fn => fn()); };
  }, [handleEscape]);

  // 键盘焦点正常时的兜底路径；后端轮询仍保留用于窗口焦点不稳定的场景
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleEscape();
        return;
      }

      if (textInputStateRef.current) return;

      if (e.key === 'Enter' && canConfirmSelection(selectionRef.current)) {
        e.preventDefault();
        copySelection();
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'c' && canConfirmSelection(selectionRef.current)) {
        e.preventDefault();
        copySelection();
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's' && canConfirmSelection(selectionRef.current)) {
        e.preventDefault();
        saveSelection();
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [copySelection, handleEscape, redo, saveSelection, undo]);

  // 右键取消
  useEffect(() => {
    const onContextMenu = async (e: MouseEvent) => {
      e.preventDefault();
      if (phaseRef.current === 'crosshair') {
        await closeOverlay(fullImagePath, 'right-click');
      } else {
        resetToCrosshair();
      }
    };
    window.addEventListener('contextmenu', onContextMenu);
    return () => window.removeEventListener('contextmenu', onContextMenu);
  }, [fullImagePath, resetToCrosshair]);

  useEffect(() => {
    scheduleRedraw();
  }, [actions, phase, scheduleRedraw, selection]);

  const toolbarPosition = selection ? (() => {
    const estimatedWidth = activeTool ? 680 : 430;
    const position = positionScreenshotToolbar(
      selection,
      { width: window.innerWidth, height: window.innerHeight },
      { width: estimatedWidth, height: 44 },
    );
    return { left: position.x, top: position.y };
  })() : null;

  const selectTool = (tool: AnnotationTool | null) => {
    if (textInputStateRef.current) commitTextInput();
    setActiveTool(tool);
    setMoreOpen(false);
    setCursor(tool === 'text' ? 'text' : tool ? 'crosshair' : 'default');
  };

  return (
    <div style={{ position: 'fixed', inset: 0, overflow: 'hidden', background: '#09090b', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>
      <canvas
        ref={canvasRef}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100vw',
          height: '100vh',
          cursor,
          margin: 0,
          padding: 0,
        }}
      />

      {selection && toolbarPosition && phase !== 'exporting' && phase !== 'canceled' && (
        <div
          role="toolbar"
          aria-label="截图标注工具"
          style={{
            position: 'fixed',
            left: toolbarPosition.left,
            top: toolbarPosition.top,
            zIndex: 20,
            display: 'flex',
            alignItems: 'center',
            gap: 3,
            height: 44,
            maxWidth: 'calc(100vw - 16px)',
            padding: '5px 6px',
            overflowX: 'auto',
            overflowY: 'visible',
            whiteSpace: 'nowrap',
            color: '#f8fafc',
            background: 'rgba(17,24,39,0.96)',
            border: '1px solid rgba(255,255,255,0.18)',
            borderRadius: 6,
            boxShadow: '0 8px 24px rgba(0,0,0,0.32)',
          }}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <button type="button" style={toolbarButtonStyle(activeTool === null)} onClick={() => selectTool(null)} title="选择和调整选区">
            <MousePointer2 size={17} />
          </button>
          {PRIMARY_TOOLS.map(({ type, label, icon: Icon }) => (
            <button key={type} type="button" style={toolbarButtonStyle(activeTool === type)} onClick={() => selectTool(type)} title={label}>
              <Icon size={17} />
            </button>
          ))}
          <div style={{ position: 'relative', display: 'flex' }}>
            <button type="button" style={toolbarButtonStyle(MORE_TOOLS.some((tool) => tool.type === activeTool))} onClick={() => setMoreOpen((open) => !open)} title="更多标注工具">
              <Ellipsis size={18} />
            </button>
            {moreOpen && (
              <div style={{
                position: 'fixed',
                left: Math.min(toolbarPosition.left + 170, window.innerWidth - 122),
                top: Math.min(toolbarPosition.top + 48, window.innerHeight - 82),
                width: 114,
                padding: 4,
                background: 'rgba(17,24,39,0.98)',
                border: '1px solid rgba(255,255,255,0.18)',
                borderRadius: 6,
                boxShadow: '0 8px 24px rgba(0,0,0,0.36)',
              }}>
                {MORE_TOOLS.map(({ type, label, icon: Icon }) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => selectTool(type)}
                    style={{
                      ...toolbarButtonStyle(activeTool === type),
                      width: '100%',
                      justifyContent: 'flex-start',
                      gap: 8,
                      padding: '0 8px',
                    }}
                  >
                    <Icon size={16} />
                    <span style={{ fontSize: 12 }}>{label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {activeTool && (
            <>
              <div style={dividerStyle} />
              {COLORS.map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setColor(item)}
                  title={`颜色 ${item}`}
                  aria-label={`颜色 ${item}`}
                  style={{
                    width: 18,
                    height: 18,
                    flex: '0 0 18px',
                    padding: 0,
                    borderRadius: '50%',
                    border: item === '#ffffff' ? '1px solid rgba(255,255,255,0.5)' : 'none',
                    background: item,
                    outline: color === item ? '2px solid #38bdf8' : '2px solid transparent',
                    outlineOffset: 1,
                    cursor: 'pointer',
                  }}
                />
              ))}
              <div style={{ display: 'flex', alignItems: 'center', gap: 1, marginLeft: 3 }}>
                {LINE_WIDTHS.map((width) => (
                  <button key={width} type="button" style={toolbarButtonStyle(lineWidth === width)} onClick={() => setLineWidth(width)} title={`线宽 ${width}px`}>
                    <span style={{ width: 16, height: width, maxHeight: 8, borderRadius: 1, background: '#f8fafc' }} />
                  </button>
                ))}
              </div>
            </>
          )}

          <div style={dividerStyle} />
          <button type="button" style={toolbarButtonStyle(false, actions.length === 0)} disabled={actions.length === 0} onClick={undo} title="撤销 (Cmd+Z)">
            <Undo2 size={17} />
          </button>
          <button type="button" style={toolbarButtonStyle(false, redoActions.length === 0)} disabled={redoActions.length === 0} onClick={redo} title="重做 (Cmd+Shift+Z)">
            <Redo2 size={17} />
          </button>
          <button type="button" style={toolbarButtonStyle()} onClick={resetToCrosshair} title="重选">
            <RotateCcw size={17} />
          </button>
          <button type="button" style={toolbarButtonStyle()} onClick={saveSelection} title="保存 (Cmd+S)">
            <Download size={17} />
          </button>
          <button type="button" style={{ ...toolbarButtonStyle(), background: 'rgba(14,165,233,0.9)' }} onClick={copySelection} title="复制并关闭 (Enter / Cmd+C / 双击)">
            <Copy size={17} />
          </button>
          <button type="button" style={toolbarButtonStyle()} onClick={() => closeOverlay(fullImagePath, 'toolbar-close')} title="关闭 (Esc)">
            <X size={17} />
          </button>
        </div>
      )}

      {textInput && selection && (
        <textarea
          autoFocus
          value={textInput.value}
          onChange={(event) => setTextInput({ ...textInput, value: event.target.value })}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              commitTextInput();
            } else if (event.key === 'Escape') {
              event.preventDefault();
              cancelCurrentInteraction();
            }
          }}
          onBlur={commitTextInput}
          style={{
            position: 'fixed',
            left: textInput.screenX,
            top: textInput.screenY - lineWidth * 6,
            zIndex: 30,
            minWidth: 120,
            minHeight: lineWidth * 6 + 10,
            padding: '3px 5px',
            resize: 'both',
            color,
            caretColor: color,
            font: `${lineWidth * 6}px Inter, sans-serif`,
            lineHeight: 1.2,
            background: 'rgba(15,23,42,0.7)',
            border: `1px solid ${color}`,
            borderRadius: 4,
            outline: 'none',
          }}
        />
      )}

      {loadingMessage && (
        <div style={{
          position: 'fixed',
          left: '50%',
          top: '50%',
          zIndex: 35,
          transform: 'translate(-50%, -50%)',
          padding: '8px 12px',
          color: '#e2e8f0',
          fontSize: 13,
          background: 'rgba(17,24,39,0.9)',
          border: '1px solid rgba(255,255,255,0.16)',
          borderRadius: 6,
        }}>
          {loadingMessage}
        </div>
      )}

      {errorMessage && (
        <div style={{
          position: 'fixed',
          left: '50%',
          bottom: 24,
          zIndex: 40,
          maxWidth: 'min(560px, calc(100vw - 32px))',
          transform: 'translateX(-50%)',
          padding: '8px 12px',
          color: '#fecaca',
          fontSize: 13,
          background: 'rgba(127,29,29,0.94)',
          border: '1px solid rgba(254,202,202,0.35)',
          borderRadius: 6,
        }}>
          {errorMessage}
        </div>
      )}
    </div>
  );
}
