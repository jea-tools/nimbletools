import { useRef, useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { convertFileSrc } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getEscapeAction, type Phase } from './RegionSelector.logic';

const MIN_SELECTION_PX = 10;
const SETTINGS_KEY = 'nimble_screenshot_confirm_mode';

type ConfirmMode = 'auto' | 'dblclick';

function getConfirmMode(): ConfirmMode {
  try {
    const v = localStorage.getItem(SETTINGS_KEY);
    return v === 'dblclick' ? 'dblclick' : 'auto';
  } catch {
    return 'auto';
  }
}

async function closeSelf() {
  try {
    await getCurrentWindow().close();
  } catch {
    try { await getCurrentWindow().destroy(); } catch { /* noop */ }
  }
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
  const selectionRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  const redrawFrameRef = useRef<number | null>(null);

  const [confirmMode] = useState<ConfirmMode>(getConfirmMode);

  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      imgRef.current = img;
      redraw();
    };
    img.onerror = () => closeSelf();
    img.src = imageSrc;
  }, [imageSrc]);

  // 确保 webview 获取键盘焦点（ESC 等按键能被接收）
  useEffect(() => {
    window.focus();
    document.body.focus();
  }, []);

  /** 回到十字准星状态 */
  const resetToCrosshair = useCallback(() => {
    phaseRef.current = 'crosshair';
    selectionRef.current = null;
    redraw();
  }, []);

  /** 提交截图 */
  const submitSelection = useCallback(async (sel: { x: number; y: number; w: number; h: number }) => {
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
    } else if (phase === 'selected' && selectionRef.current) {
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

      // dblclick 模式提示
      if (phase === 'selected') {
        const hint = '双击选区确认截图';
        ctx.font = '14px -apple-system, sans-serif';
        const hintW = ctx.measureText(hint).width + 16;
        const hintX = rx + (rw - hintW) / 2;
        const hintY = ry + rh / 2;
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(hintX, hintY - 12, hintW, 28);
        ctx.fillStyle = '#fff';
        ctx.fillText(hint, hintX + 8, hintY + 6);
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
      mouseRef.current = { x: e.clientX, y: e.clientY };
      scheduleRedraw();
    };

    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return;

      // 有已确认选区时，在选区外点击 → 清除重新选
      if (phaseRef.current === 'selected') {
        const sel = selectionRef.current;
        if (sel) {
          const inSel = e.clientX >= sel.x && e.clientX <= sel.x + sel.w
                     && e.clientY >= sel.y && e.clientY <= sel.y + sel.h;
          if (!inSel) {
            selectionRef.current = null;
          }
        }
      }

      phaseRef.current = 'drawing';
      startRef.current = { x: e.clientX, y: e.clientY };
      mouseRef.current = { x: e.clientX, y: e.clientY };
      selectionRef.current = null;
    };

    const onMouseUp = async (e: MouseEvent) => {
      if (phaseRef.current !== 'drawing') return;

      const sx = startRef.current.x;
      const sy = startRef.current.y;
      const rx = Math.min(sx, e.clientX);
      const ry = Math.min(sy, e.clientY);
      const rw = Math.abs(e.clientX - sx);
      const rh = Math.abs(e.clientY - sy);

      // 太小 → 回到十字准星
      if (rw < MIN_SELECTION_PX || rh < MIN_SELECTION_PX) {
        resetToCrosshair();
        return;
      }

      const sel = { x: rx, y: ry, w: rw, h: rh };

      if (confirmMode === 'auto') {
        await submitSelection(sel);
      } else {
        // dblclick 模式：冻结选区
        phaseRef.current = 'selected';
        selectionRef.current = sel;
        redraw();
      }
    };

    const onDblClick = async (e: MouseEvent) => {
      if (confirmMode !== 'dblclick' || phaseRef.current !== 'selected' || !selectionRef.current) return;

      const sel = selectionRef.current;
      const inSel = e.clientX >= sel.x && e.clientX <= sel.x + sel.w
                 && e.clientY >= sel.y && e.clientY <= sel.y + sel.h;
      if (inSel) {
        await submitSelection(sel);
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
  }, [confirmMode, redraw, scheduleRedraw, submitSelection, resetToCrosshair]);

  const handleEscape = useCallback(async () => {
    if (getEscapeAction(phaseRef.current) === 'close') {
      await closeSelf();
    }
  }, []);

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
      if (e.key !== 'Escape') return;
      e.preventDefault();
      handleEscape();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [handleEscape]);

  // 右键取消
  useEffect(() => {
    const onContextMenu = async (e: MouseEvent) => {
      e.preventDefault();
      if (phaseRef.current === 'crosshair') {
        await closeSelf();
      } else {
        resetToCrosshair();
      }
    };
    window.addEventListener('contextmenu', onContextMenu);
    return () => window.removeEventListener('contextmenu', onContextMenu);
  }, [resetToCrosshair]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        cursor: 'crosshair',
        margin: 0,
        padding: 0,
      }}
    />
  );
}
