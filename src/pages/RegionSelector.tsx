import { useRef, useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { convertFileSrc } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import {
  canConfirmSelection,
  cursorForSelectionHit,
  getEscapeAction,
  hitTestSelection,
  hitTestToolbar,
  moveSelection,
  normalizeSelection,
  resizeSelection,
  selectionHandleRects,
  shouldConfirmSelectionOnDoubleClick,
  shouldStartNewSelectionOnMouseDown,
  toolbarLayoutForSelection,
  type Bounds,
  type Phase,
  type Point,
  type ResizeHandle,
  type SelectionRect,
} from './RegionSelector.logic';

type Interaction =
  | { type: 'move'; startPoint: Point; initialSelection: SelectionRect }
  | { type: 'resize'; handle: ResizeHandle; initialSelection: SelectionRect };

async function closeSelf() {
  try {
    await getCurrentWindow().close();
  } catch {
    try { await getCurrentWindow().destroy(); } catch { /* noop */ }
  }
}

async function cancelSelection(sourcePath: string) {
  try {
    await invoke('cancel_region_selector', { sourcePath });
  } catch (err) {
    console.error('cancel_region_selector failed:', err);
  }
  await closeSelf();
}

/**
 * 全屏区域选择器
 *
 * ESC 行为：任意阶段都退出截图，移除冻结屏幕
 */
export default function RegionSelector() {
  const params = new URLSearchParams(window.location.search);
  const fullImagePath = decodeURIComponent(params.get('image') || '');
  const imageSrc = convertFileSrc(fullImagePath);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);

  const phaseRef = useRef<Phase>('crosshair');
  const startRef = useRef({ x: 0, y: 0 });
  const mouseRef = useRef({ x: 0, y: 0 });
  const selectionRef = useRef<SelectionRect | null>(null);
  const interactionRef = useRef<Interaction | null>(null);
  const redrawFrameRef = useRef<number | null>(null);

  const [cursor, setCursor] = useState('crosshair');

  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      imgRef.current = img;
      redraw();
    };
    img.onerror = () => cancelSelection(fullImagePath);
    img.src = imageSrc;
  }, [fullImagePath, imageSrc]);

  // 确保 webview 获取键盘焦点（ESC 等按键能被接收）
  useEffect(() => {
    window.focus();
    document.body.focus();
  }, []);

  /** 回到十字准星状态 */
  const resetToCrosshair = useCallback(() => {
    phaseRef.current = 'crosshair';
    selectionRef.current = null;
    interactionRef.current = null;
    setCursor('crosshair');
    redraw();
  }, []);

  /** 提交截图 */
  const submitSelection = useCallback(async (sel: SelectionRect) => {
    const img = imgRef.current;
    const canvas = canvasRef.current;
    if (!img || !canvas) return;

    const scaleX = img.naturalWidth / canvas.width;
    const scaleY = img.naturalHeight / canvas.height;

    try {
      await invoke('crop_and_open_editor', {
        sourcePath: fullImagePath,
        sourceWidth: img.naturalWidth,
        sourceHeight: img.naturalHeight,
        x: Math.round(sel.x * scaleX),
        y: Math.round(sel.y * scaleY),
        width: Math.round(sel.w * scaleX),
        height: Math.round(sel.h * scaleY),
      });
    } catch (err) {
      console.error('crop_and_open_editor failed:', err);
    }
    await closeSelf();
  }, [fullImagePath]);

  const confirmSelection = useCallback(async () => {
    const sel = selectionRef.current;
    if (!canConfirmSelection(sel)) return;
    await submitSelection(sel);
  }, [submitSelection]);

  /** 核心绘制 */
  const redraw = useCallback(() => {
    redrawFrameRef.current = null;
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img) return;

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
    const phase = phaseRef.current;

    let rx = 0, ry = 0, rw = 0, rh = 0;
    let hasRect = false;

    if (phase === 'drawing') {
      const sx = startRef.current.x;
      const sy = startRef.current.y;
      rx = Math.min(sx, mx);
      ry = Math.min(sy, my);
      rw = Math.abs(mx - sx);
      rh = Math.abs(my - sy);
      hasRect = rw > 1 && rh > 1;
    } else if ((phase === 'selected' || phase === 'moving' || phase === 'resizing') && selectionRef.current) {
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

      if (selectionRef.current && (phase === 'selected' || phase === 'moving' || phase === 'resizing')) {
        for (const handle of selectionHandleRects(selectionRef.current)) {
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

      if (phase === 'selected' && selectionRef.current) {
        const toolbar = toolbarLayoutForSelection(selectionRef.current, { width: W, height: H });
        ctx.fillStyle = 'rgba(17, 24, 39, 0.92)';
        ctx.fillRect(toolbar.x, toolbar.y, toolbar.w, toolbar.h);
        ctx.strokeStyle = 'rgba(255,255,255,0.22)';
        ctx.lineWidth = 1;
        ctx.strokeRect(toolbar.x + 0.5, toolbar.y + 0.5, toolbar.w - 1, toolbar.h - 1);

        ctx.font = '13px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'center';
        for (const button of toolbar.buttons) {
          ctx.fillStyle = button.action === 'confirm' ? '#0ea5e9' : 'rgba(255,255,255,0.12)';
          ctx.fillRect(button.x, button.y, button.w, button.h);
          ctx.fillStyle = '#ffffff';
          ctx.fillText(button.label, button.x + button.w / 2, button.y + button.h / 2);
        }
        ctx.textAlign = 'start';
        ctx.textBaseline = 'alphabetic';

        const hint = '双击选区或点确定';
        ctx.font = '13px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
        const hintW = ctx.measureText(hint).width + 14;
        const hintX = rx + Math.max(0, (rw - hintW) / 2);
        const hintY = ry + rh - 10;
        if (rw >= hintW + 12 && rh >= 42) {
          ctx.fillStyle = 'rgba(0,0,0,0.55)';
          ctx.fillRect(hintX, hintY - 18, hintW, 24);
          ctx.fillStyle = '#fff';
          ctx.fillText(hint, hintX + 7, hintY - 2);
        }
      }
    }

    // 十字准星（仅 crosshair 状态）
    if (phase === 'crosshair') {
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
  }, []);

  const canvasBounds = useCallback((): Bounds => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }), []);

  const updateHoverCursor = useCallback((point: Point) => {
    const selection = selectionRef.current;
    const phase = phaseRef.current;
    if (!selection || phase !== 'selected') {
      setCursor(phase === 'crosshair' || phase === 'drawing' ? 'crosshair' : 'default');
      return;
    }

    if (hitTestToolbar(selection, canvasBounds(), point)) {
      setCursor('pointer');
      return;
    }

    setCursor(cursorForSelectionHit(hitTestSelection(selection, point)));
  }, [canvasBounds]);

  const scheduleRedraw = useCallback(() => {
    if (redrawFrameRef.current !== null) return;
    redrawFrameRef.current = requestAnimationFrame(redraw);
  }, [redraw]);

  useEffect(() => {
    return () => {
      if (redrawFrameRef.current !== null) {
        cancelAnimationFrame(redrawFrameRef.current);
      }
    };
  }, []);

  // 鼠标事件
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const onMouseMove = (e: MouseEvent) => {
      const point = { x: e.clientX, y: e.clientY };
      mouseRef.current = point;
      const interaction = interactionRef.current;

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
      const selection = selectionRef.current;

      if (phaseRef.current === 'selected' && selection) {
        const toolbarAction = hitTestToolbar(selection, canvasBounds(), point);
        if (toolbarAction === 'confirm') {
          await confirmSelection();
          return;
        }
        if (toolbarAction === 'reset') {
          resetToCrosshair();
          return;
        }
        if (toolbarAction === 'cancel') {
          await cancelSelection(fullImagePath);
          return;
        }
      }

      if (!shouldStartNewSelectionOnMouseDown(phaseRef.current, selection, point) && selection) {
        const hit = hitTestSelection(selection, point);
        if (hit === 'inside') {
          phaseRef.current = 'moving';
          interactionRef.current = { type: 'move', startPoint: point, initialSelection: selection };
          setCursor('move');
          mouseRef.current = point;
          scheduleRedraw();
          return;
        }
        if (hit !== 'outside') {
          phaseRef.current = 'resizing';
          interactionRef.current = { type: 'resize', handle: hit, initialSelection: selection };
          setCursor(cursorForSelectionHit(hit));
          mouseRef.current = point;
          scheduleRedraw();
          return;
        }

        mouseRef.current = point;
        return;
      }

      phaseRef.current = 'drawing';
      interactionRef.current = null;
      startRef.current = point;
      mouseRef.current = point;
      selectionRef.current = null;
      setCursor('crosshair');
      scheduleRedraw();
    };

    const onMouseUp = async (e: MouseEvent) => {
      const phase = phaseRef.current;
      if (phase === 'moving' || phase === 'resizing') {
        phaseRef.current = 'selected';
        interactionRef.current = null;
        updateHoverCursor({ x: e.clientX, y: e.clientY });
        scheduleRedraw();
        return;
      }

      if (phase !== 'drawing') return;

      const sel = normalizeSelection(startRef.current, { x: e.clientX, y: e.clientY });
      if (!sel) {
        resetToCrosshair();
        return;
      }

      phaseRef.current = 'selected';
      interactionRef.current = null;
      selectionRef.current = sel;
      updateHoverCursor({ x: e.clientX, y: e.clientY });
      redraw();
    };

    const onDblClick = async (e: MouseEvent) => {
      if (shouldConfirmSelectionOnDoubleClick(
        phaseRef.current,
        selectionRef.current,
        { x: e.clientX, y: e.clientY },
      )) {
        await confirmSelection();
      }
    };

    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('mousedown', onMouseDown);
    canvas.addEventListener('mouseup', onMouseUp);
    canvas.addEventListener('dblclick', onDblClick);

    return () => {
      canvas.removeEventListener('mousemove', onMouseMove);
      canvas.removeEventListener('mousedown', onMouseDown);
      canvas.removeEventListener('mouseup', onMouseUp);
      canvas.removeEventListener('dblclick', onDblClick);
    };
  }, [
    canvasBounds,
    confirmSelection,
    redraw,
    resetToCrosshair,
    scheduleRedraw,
    updateHoverCursor,
  ]);

  const handleEscape = useCallback(async () => {
    if (getEscapeAction(phaseRef.current) === 'close') {
      await cancelSelection(fullImagePath);
    }
  }, [fullImagePath]);

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

      if (e.key === 'Enter' && phaseRef.current === 'selected' && canConfirmSelection(selectionRef.current)) {
        e.preventDefault();
        confirmSelection();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [confirmSelection, handleEscape]);

  // 右键取消
  useEffect(() => {
    const onContextMenu = async (e: MouseEvent) => {
      e.preventDefault();
      if (phaseRef.current === 'crosshair') {
        await cancelSelection(fullImagePath);
      } else {
        resetToCrosshair();
      }
    };
    window.addEventListener('contextmenu', onContextMenu);
    return () => window.removeEventListener('contextmenu', onContextMenu);
  }, [fullImagePath, resetToCrosshair]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        cursor,
        margin: 0,
        padding: 0,
      }}
    />
  );
}
