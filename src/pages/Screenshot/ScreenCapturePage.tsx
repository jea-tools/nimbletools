import { useState, useRef, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import { tempDir } from '@tauri-apps/api/path';
import {
  Camera, Download, Trash2, Undo2, Copy, X,
  Pen, Square, Circle, Type, ArrowUpRight, Minus, Keyboard, Info,
} from 'lucide-react';
import {
  getHotkey, saveHotkey, clearHotkey, eventToShortcutString,
} from '../../utils/hotkeyStore';
import {
  getCanvasClipboardPayload,
  getCanvasTextPatches,
  waitForNextPaint,
} from '../../utils/canvasClipboard';

interface ScreenshotResult { success: boolean; path: string; message: string; }

type ToolType = 'pen' | 'rect' | 'circle' | 'arrow' | 'line' | 'text';

interface DrawAction {
  type: ToolType;
  color: string;
  lineWidth: number;
  points?: { x: number; y: number }[];
  startX?: number; startY?: number;
  endX?: number; endY?: number;
  text?: string;
}

const COLORS = ['#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#8b5cf6', '#ffffff', '#000000'];
const LINE_WIDTHS = [2, 4, 6, 8];

const canCopyViaNativeAnnotationRenderer = (
  sourcePath: string | null,
  currentAction: DrawAction | null,
) => Boolean(sourcePath) && !currentAction;

export default function ScreenCapturePage() {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [, setImageSrc] = useState<string | null>(null);
  const [imageObj, setImageObj] = useState<HTMLImageElement | null>(null);
  const [tool, setTool] = useState<ToolType>('pen');
  const [color, setColor] = useState('#ef4444');
  const [lineWidth, setLineWidth] = useState(4);
  const [actions, setActions] = useState<DrawAction[]>([]);
  const [isDrawing, setIsDrawing] = useState(false);
  const [currentAction, setCurrentAction] = useState<DrawAction | null>(null);
  const [message, setMessage] = useState('');
  const [hotkey, setHotkeyState] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const tempFileRef = useRef<string | null>(null);

  useEffect(() => {
    getHotkey('screenshot').then(setHotkeyState);
  }, []);

  // 录制截图快捷键
  useEffect(() => {
    if (!isRecording) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const shortcut = eventToShortcutString(e);
      if (!shortcut) return;
      setHotkeyState(shortcut);
      saveHotkey('screenshot', shortcut).catch(console.warn);
      setIsRecording(false);
    };
    const handleBlur = () => setIsRecording(false);
    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('blur', handleBlur);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('blur', handleBlur);
    };
  }, [isRecording]);

  const handleClearHotkey = async () => {
    await clearHotkey('screenshot');
    setHotkeyState('');
    setIsRecording(false);
  };

  const handleCapture = async () => {
    const tmp = await tempDir();
    const tmpPath = `${tmp}nimbletools_screenshot_${Date.now()}.png`;
    try {
      const result = await invoke<ScreenshotResult>('take_screenshot', { outputPath: tmpPath });
      if (result.success) {
        // 使用 Tauri fs 读取截图文件
        const { readFile } = await import('@tauri-apps/plugin-fs');
        const bytes = await readFile(result.path);
        const blob = new Blob([bytes], { type: 'image/png' });
        const url = URL.createObjectURL(blob);
        loadImage(url);
        tempFileRef.current = result.path;
        setMessage('');
      } else {
        setMessage(result.message);
      }
    } catch (e) {
      setMessage(String(e));
    }
  };

  const loadImage = (src: string) => {
    const img = new Image();
    img.onload = () => {
      setImageObj(img);
      setImageSrc(src);
      setActions([]);
    };
    img.src = src;
  };

  // 粘贴图片支持
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          const blob = item.getAsFile();
          if (blob) {
            const url = URL.createObjectURL(blob);
            loadImage(url);
          }
          break;
        }
      }
    };
    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
  }, []);

  // 绘制 canvas
  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !imageObj) return;
    const ctx = canvas.getContext('2d')!;

    canvas.width = imageObj.width;
    canvas.height = imageObj.height;
    ctx.drawImage(imageObj, 0, 0);

    // 重绘所有标注
    const allActions = currentAction ? [...actions, currentAction] : actions;
    for (const action of allActions) {
      ctx.strokeStyle = action.color;
      ctx.fillStyle = action.color;
      ctx.lineWidth = action.lineWidth;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      switch (action.type) {
        case 'pen':
          if (action.points && action.points.length > 1) {
            ctx.beginPath();
            ctx.moveTo(action.points[0].x, action.points[0].y);
            for (let i = 1; i < action.points.length; i++) {
              ctx.lineTo(action.points[i].x, action.points[i].y);
            }
            ctx.stroke();
          }
          break;
        case 'rect':
          if (action.startX !== undefined && action.endX !== undefined) {
            ctx.strokeRect(
              action.startX, action.startY!,
              action.endX - action.startX, action.endY! - action.startY!
            );
          }
          break;
        case 'circle':
          if (action.startX !== undefined && action.endX !== undefined) {
            const rx = Math.abs(action.endX - action.startX) / 2;
            const ry = Math.abs(action.endY! - action.startY!) / 2;
            const cx = action.startX + (action.endX - action.startX) / 2;
            const cy = action.startY! + (action.endY! - action.startY!) / 2;
            ctx.beginPath();
            ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
            ctx.stroke();
          }
          break;
        case 'arrow':
        case 'line':
          if (action.startX !== undefined && action.endX !== undefined) {
            ctx.beginPath();
            ctx.moveTo(action.startX, action.startY!);
            ctx.lineTo(action.endX, action.endY!);
            ctx.stroke();
            if (action.type === 'arrow') {
              drawArrowHead(ctx, action.startX, action.startY!, action.endX, action.endY!, action.lineWidth);
            }
          }
          break;
        case 'text':
          if (action.text && action.startX !== undefined) {
            ctx.font = `${action.lineWidth * 6}px Inter, sans-serif`;
            ctx.fillText(action.text, action.startX, action.startY!);
          }
          break;
      }
    }
  }, [imageObj, actions, currentAction]);

  useEffect(() => { redraw(); }, [redraw]);

  const drawArrowHead = (
    ctx: CanvasRenderingContext2D,
    fromX: number, fromY: number, toX: number, toY: number, lw: number
  ) => {
    const headLen = lw * 4;
    const angle = Math.atan2(toY - fromY, toX - fromX);
    ctx.beginPath();
    ctx.moveTo(toX, toY);
    ctx.lineTo(toX - headLen * Math.cos(angle - Math.PI / 6), toY - headLen * Math.sin(angle - Math.PI / 6));
    ctx.moveTo(toX, toY);
    ctx.lineTo(toX - headLen * Math.cos(angle + Math.PI / 6), toY - headLen * Math.sin(angle + Math.PI / 6));
    ctx.stroke();
  };

  const getCanvasCoords = (e: React.MouseEvent): { x: number; y: number } => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!imageObj) return;
    const { x, y } = getCanvasCoords(e);
    setIsDrawing(true);

    if (tool === 'text') {
      const text = prompt('Enter text:');
      if (text) {
        setActions((prev) => [...prev, { type: 'text', color, lineWidth, startX: x, startY: y, text }]);
      }
      setIsDrawing(false);
      return;
    }

    const action: DrawAction = {
      type: tool, color, lineWidth,
      ...(tool === 'pen' ? { points: [{ x, y }] } : { startX: x, startY: y, endX: x, endY: y }),
    };
    setCurrentAction(action);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDrawing || !currentAction) return;
    const { x, y } = getCanvasCoords(e);

    if (currentAction.type === 'pen') {
      setCurrentAction((prev) => ({
        ...prev!,
        points: [...(prev!.points || []), { x, y }],
      }));
    } else {
      setCurrentAction((prev) => ({ ...prev!, endX: x, endY: y }));
    }
  };

  const handleMouseUp = () => {
    if (currentAction) {
      setActions((prev) => [...prev, currentAction]);
      setCurrentAction(null);
    }
    setIsDrawing(false);
  };

  const handleUndo = () => {
    setActions((prev) => prev.slice(0, -1));
  };

  const handleClear = () => setActions([]);

  /** 清理截图临时文件 */
  const cleanupTempFile = async () => {
    const tempPath = tempFileRef.current;
    if (!tempPath) return;
    try {
      const { remove } = await import('@tauri-apps/plugin-fs');
      await remove(tempPath);
    } catch { /* 文件可能已被清理 */ }
    tempFileRef.current = null;
  };

  /** 重置截图状态（清空图片、标注并删除临时文件） */
  const resetImage = async () => {
    setImageObj(null);
    setImageSrc(null);
    setActions([]);
    setCurrentAction(null);
    setMessage('');
    await cleanupTempFile();
  };

  /** 复制到剪贴板：先清界面，下一帧再执行重 IPC/剪贴板写入 */
  const handleCopy = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const sourcePath = tempFileRef.current;
    const copyActions = [...actions, ...(currentAction ? [currentAction] : [])];
    const useNativeAnnotationRenderer = canCopyViaNativeAnnotationRenderer(
      sourcePath,
      currentAction,
    );
    const payload = useNativeAnnotationRenderer ? null : getCanvasClipboardPayload(canvas);
    if (!useNativeAnnotationRenderer && !payload) return;

    setImageObj(null);
    setImageSrc(null);
    setActions([]);
    setCurrentAction(null);
    setMessage('');

    await waitForNextPaint();

    try {
      if (useNativeAnnotationRenderer && sourcePath) {
        const textPatches = getCanvasTextPatches(canvas, copyActions);
        if (!textPatches) return;
        await invoke('copy_annotated_screenshot_to_clipboard', {
          sourcePath,
          actions: copyActions,
          textPatches,
        });
      } else if (payload) {
        await invoke('copy_image_to_clipboard', {
          width: payload.width,
          height: payload.height,
          rgbaData: payload.rgbaData,
        });
      }
    } catch (e) {
      setMessage(String(e));
    } finally {
      void cleanupTempFile();
    }
  };

  /** 删除当前截图 */
  const handleDelete = async () => {
    await resetImage();
  };

  const handleSave = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const savePath = await save({
      filters: [{ name: 'Image', extensions: ['png'] }],
      defaultPath: `screenshot_${Date.now()}.png`,
    });
    if (!savePath) return;

    try {
      if (actions.length === 0 && !currentAction && tempFileRef.current) {
        await invoke('copy_screenshot_file', {
          sourcePath: tempFileRef.current,
          outputPath: savePath,
        });
      } else {
        const payload = getCanvasClipboardPayload(canvas);
        if (!payload) return;
        await invoke('save_screenshot_canvas', {
          outputPath: savePath,
          width: payload.width,
          height: payload.height,
          rgbaData: payload.rgbaData,
        });
      }
      setMessage(t('common.save') + ': ' + (savePath.split('/').pop() || savePath.split('\\').pop()));
      await resetImage();
    } catch (e) {
      setMessage(String(e));
    }
  };

  const tools: { type: ToolType; icon: React.ReactNode; label: string }[] = [
    { type: 'pen', icon: <Pen size={16} />, label: 'Pen' },
    { type: 'rect', icon: <Square size={16} />, label: 'Rect' },
    { type: 'circle', icon: <Circle size={16} />, label: 'Circle' },
    { type: 'arrow', icon: <ArrowUpRight size={16} />, label: 'Arrow' },
    { type: 'line', icon: <Minus size={16} />, label: 'Line' },
    { type: 'text', icon: <Type size={16} />, label: 'Text' },
  ];

  return (
    <div className="page-container">
      {/* 快捷键设置 */}
      <div className="card" style={{ padding: 'var(--space-3)', marginBottom: 'var(--space-3)' }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Keyboard size={16} className="text-secondary" />
            <div>
              <div className="text-sm font-medium">{t('screenshot.hotkeyLabel')}</div>
              <div className="text-xs text-tertiary">{t('screenshot.hotkeyDesc')}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              className={`hotkey-recorder ${isRecording ? 'recording' : ''}`}
              onClick={() => setIsRecording(!isRecording)}
            >
              {isRecording ? t('extraTools.clipboard.pressKey') : (hotkey || t('extraTools.clipboard.notSet'))}
            </button>
            {hotkey && (
              <button className="btn btn-ghost btn-sm" onClick={handleClearHotkey}>
                {t('common.clear')}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 白屏提示 */}
      <div className="card" style={{
        padding: 'var(--space-2) var(--space-3)',
        marginBottom: 'var(--space-3)',
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-2)',
        background: 'var(--bg-hover)',
        borderLeft: '3px solid var(--accent-primary)',
      }}>
        <Info size={14} style={{ flexShrink: 0, color: 'var(--accent-primary)' }} />
        <span className="text-xs text-secondary">{t('screenshot.flashHint')}</span>
      </div>

      {/* Toolbar */}
      <div className="card" style={{ padding: 'var(--space-3)' }}>
        <div className="flex items-center gap-3 flex-wrap">
          <button className="btn btn-primary btn-sm" onClick={handleCapture}>
            <Camera size={14} /> Capture
          </button>

          <div style={{ width: 1, height: 24, background: 'var(--border-primary)' }} />

          {/* Drawing tools */}
          {tools.map((t) => (
            <button
              key={t.type}
              className={`btn btn-icon ${tool === t.type ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setTool(t.type)}
              title={t.label}
              style={{ width: 32, height: 32 }}
            >
              {t.icon}
            </button>
          ))}

          <div style={{ width: 1, height: 24, background: 'var(--border-primary)' }} />

          {/* Colors */}
          {COLORS.map((c) => (
            <button
              key={c}
              onClick={() => setColor(c)}
              style={{
                width: 20, height: 20, borderRadius: '50%', background: c,
                border: color === c ? '2px solid var(--accent-primary)' : '2px solid var(--border-primary)',
                cursor: 'pointer', transition: 'transform var(--transition-fast)',
              }}
            />
          ))}

          <div style={{ width: 1, height: 24, background: 'var(--border-primary)' }} />

          {/* Line width */}
          {LINE_WIDTHS.map((w) => (
            <button
              key={w}
              className={`btn btn-sm ${lineWidth === w ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setLineWidth(w)}
            >
              {w}px
            </button>
          ))}

          <div className="ml-auto flex gap-2">
            <button className="btn btn-ghost btn-sm" onClick={handleDelete} disabled={!imageObj}>
              <X size={14} /> {t('common.delete')}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={handleUndo} disabled={actions.length === 0}>
              <Undo2 size={14} /> {t('common.undo')}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={handleClear} disabled={actions.length === 0}>
              <Trash2 size={14} /> {t('common.clear')}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={handleCopy} disabled={!imageObj}>
              <Copy size={14} /> {t('common.copy')}
            </button>
            <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={!imageObj}>
              <Download size={14} /> {t('common.save')}
            </button>
          </div>
        </div>
      </div>

      {/* Canvas Area */}
      <div className="card" style={{ padding: 0, overflow: 'hidden', marginTop: 'var(--space-4)' }}>
        {!imageObj ? (
          <div
            className="dropzone"
            style={{ margin: 'var(--space-4)', minHeight: 300 }}
            onClick={handleCapture}
          >
            <Camera className="dropzone-icon" />
            <p className="dropzone-text">Click "Capture" or paste an image (Ctrl+V)</p>
          </div>
        ) : (
          <div style={{ overflow: 'auto', maxHeight: '60vh', background: 'var(--bg-tertiary)' }}>
            <canvas
              ref={canvasRef}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
              style={{
                display: 'block',
                maxWidth: '100%',
                cursor: tool === 'text' ? 'text' : 'crosshair',
              }}
            />
          </div>
        )}
      </div>

      {message && (
        <div className="status-bar info mt-4">{message}</div>
      )}
    </div>
  );
}
