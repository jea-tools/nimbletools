import { useState, useRef, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { save } from '@tauri-apps/plugin-dialog';
import { readFile } from '@tauri-apps/plugin-fs';
import {
  Download, Trash2, Undo2, Copy, X,
  Pen, Square, Circle, Type, ArrowUpRight, Minus,
} from 'lucide-react';
import {
  getCanvasClipboardPayload,
  getCanvasTextPatches,
  waitForNextPaint,
} from '../utils/canvasClipboard';
import {
  renderScreenshotActions,
  type AnnotationTool,
  type ScreenshotAction,
} from '../utils/screenshotAnnotations';

/** 文本输入框状态（覆盖在画布上的内联编辑） */
interface TextInputState {
  canvasX: number;
  canvasY: number;
  screenX: number;
  screenY: number;
  value: string;
}

const COLORS = ['#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#8b5cf6', '#ffffff', '#000000'];
const LINE_WIDTHS = [2, 4, 6, 8];

const TOOLS: { type: AnnotationTool; icon: React.ReactNode; label: string }[] = [
  { type: 'pen', icon: <Pen size={16} />, label: '画笔' },
  { type: 'rect', icon: <Square size={16} />, label: '矩形' },
  { type: 'circle', icon: <Circle size={16} />, label: '椭圆' },
  { type: 'arrow', icon: <ArrowUpRight size={16} />, label: '箭头' },
  { type: 'line', icon: <Minus size={16} />, label: '直线' },
  { type: 'text', icon: <Type size={16} />, label: '文字' },
];

const canCopyViaNativeAnnotationRenderer = (
  sourcePath: string | null,
  currentAction: ScreenshotAction | null,
) => Boolean(sourcePath) && !currentAction;

export default function ScreenshotEditor() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textInputRef = useRef<HTMLTextAreaElement>(null);
  const [imageObj, setImageObj] = useState<HTMLImageElement | null>(null);
  const [tool, setTool] = useState<AnnotationTool>('arrow');
  const [color, setColor] = useState('#ef4444');
  const [lineWidth, setLineWidth] = useState(4);
  const [actions, setActions] = useState<ScreenshotAction[]>([]);
  const [isDrawing, setIsDrawing] = useState(false);
  const [currentAction, setCurrentAction] = useState<ScreenshotAction | null>(null);
  const [status, setStatus] = useState('');
  const [textInput, setTextInput] = useState<TextInputState | null>(null);
  const [sourceImagePath, setSourceImagePath] = useState<string | null>(null);

  // 从 URL 参数获取截图路径并加载
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const imagePath = params.get('image');
    if (!imagePath) return;
    setSourceImagePath(imagePath);

    (async () => {
      try {
        const bytes = await readFile(imagePath);
        const blob = new Blob([bytes], { type: 'image/png' });
        const url = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => setImageObj(img);
        img.src = url;
      } catch (e) {
        setStatus(`加载失败: ${e}`);
      }
    })();
  }, []);

  // 绘制
  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !imageObj) return;
    const ctx = canvas.getContext('2d')!;

    canvas.width = imageObj.width;
    canvas.height = imageObj.height;
    ctx.drawImage(imageObj, 0, 0);

    renderScreenshotActions(ctx, currentAction ? [...actions, currentAction] : actions);
  }, [imageObj, actions, currentAction]);

  useEffect(() => { redraw(); }, [redraw]);

  const getCanvasCoords = (e: React.MouseEvent) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (canvas.width / rect.width),
      y: (e.clientY - rect.top) * (canvas.height / rect.height),
    };
  };

  /** 提交文本输入 */
  const commitTextInput = useCallback(() => {
    if (!textInput || !textInput.value.trim()) {
      setTextInput(null);
      return;
    }
    setActions((prev) => [...prev, {
      type: 'text',
      color,
      lineWidth,
      startX: textInput.canvasX,
      startY: textInput.canvasY,
      text: textInput.value,
    }]);
    setTextInput(null);
  }, [textInput, color, lineWidth]);

  const drawPendingTextInput = useCallback((): boolean => {
    if (!textInput || !textInput.value.trim()) return false;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx) return false;
    ctx.fillStyle = color;
    ctx.font = `${lineWidth * 6}px Inter, sans-serif`;
    ctx.fillText(textInput.value, textInput.canvasX, textInput.canvasY);
    return true;
  }, [textInput, color, lineWidth]);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!imageObj) return;
    const { x, y } = getCanvasCoords(e);

    if (tool === 'text') {
      // 如果已有文本输入框，先提交
      if (textInput) {
        commitTextInput();
      }
      // 在点击位置打开内联文本输入框
      setTextInput({
        canvasX: x,
        canvasY: y,
        screenX: e.clientX,
        screenY: e.clientY,
        value: '',
      });
      // 延迟聚焦确保 DOM 已渲染
      setTimeout(() => textInputRef.current?.focus(), 30);
      return;
    }

    // 点击画布时，提交未完成的文本输入
    if (textInput) {
      commitTextInput();
    }

    setIsDrawing(true);
    setCurrentAction({
      type: tool, color, lineWidth,
      ...(tool === 'pen' ? { points: [{ x, y }] } : { startX: x, startY: y, endX: x, endY: y }),
    });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDrawing || !currentAction) return;
    const { x, y } = getCanvasCoords(e);

    if (currentAction.type === 'pen') {
      setCurrentAction((prev) => ({ ...prev!, points: [...(prev!.points || []), { x, y }] }));
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

  // 复制到剪贴板：先隐藏窗口，下一帧再执行重 IPC/剪贴板写入，完成后关闭
  const handleCopyToClipboard = async () => {
    // 提交未完成的文本
    const hadPendingText = drawPendingTextInput();
    if (textInput) commitTextInput();
    const copyActions = [
      ...actions,
      ...(currentAction ? [currentAction] : []),
      ...(hadPendingText && textInput ? [{
        type: 'text' as const,
        color,
        lineWidth,
        startX: textInput.canvasX,
        startY: textInput.canvasY,
        text: textInput.value,
      }] : []),
    ];
    const useNativeAnnotationRenderer = canCopyViaNativeAnnotationRenderer(sourceImagePath, currentAction);

    const currentWindow = getCurrentWindow();
    await currentWindow.hide().catch(() => undefined);
    await waitForNextPaint();

    try {
      if (useNativeAnnotationRenderer && sourceImagePath) {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const textPatches = getCanvasTextPatches(canvas, copyActions);
        if (!textPatches) return;
        await invoke('copy_annotated_screenshot_to_clipboard', {
          sourcePath: sourceImagePath,
          actions: copyActions,
          textPatches,
        });
      } else {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const payload = getCanvasClipboardPayload(canvas);
        if (!payload) return;
        await invoke('copy_image_to_clipboard', {
          width: payload.width,
          height: payload.height,
          rgbaData: payload.rgbaData,
        });
      }
    } catch (e) {
      console.error(e);
    } finally {
      await invoke('close_screenshot_editor').catch(() => currentWindow.close());
    }
  };

  // 保存文件
  const handleSave = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const hadPendingText = drawPendingTextInput();
    if (textInput) commitTextInput();
    const savePath = await save({
      filters: [{ name: 'Image', extensions: ['png'] }],
      defaultPath: `screenshot_${Date.now()}.png`,
    });
    if (!savePath) return;

    try {
      if (actions.length === 0 && !currentAction && !hadPendingText && sourceImagePath) {
        await invoke('copy_screenshot_file', {
          sourcePath: sourceImagePath,
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
      setStatus(`✅ 已保存: ${savePath.split('/').pop()}`);
      setTimeout(() => {
        invoke('close_screenshot_editor').catch(() => window.close());
      }, 500);
    } catch (e) {
      setStatus(`保存失败: ${e}`);
    }
  };

  // 关闭编辑器
  const handleClose = () => {
    invoke('close_screenshot_editor').catch(() => window.close());
  };

  // 快捷键
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // 文本输入时只处理 Escape
      if (textInput && e.key !== 'Escape') return;

      if (e.key === 'Escape') {
        if (textInput) {
          commitTextInput();
        } else {
          handleClose();
        }
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
        e.preventDefault();
        setActions((prev) => prev.slice(0, -1));
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'c' && imageObj) {
        e.preventDefault();
        handleCopyToClipboard();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 's' && imageObj) {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [imageObj, textInput, commitTextInput]);

  // 文本输入框的 fontSize 需要匹配画布上的渲染大小
  const textFontSize = lineWidth * 6;

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100vh',
      background: 'var(--bg-primary)', color: 'var(--text-primary)',
      fontFamily: 'Inter, system-ui, sans-serif',
    }}>
      {/* 顶部工具栏 - 可拖动窗口 */}
      <div
        data-tauri-drag-region
        style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
          borderBottom: '1px solid var(--border-primary)',
          background: 'var(--bg-secondary)',
        }}
      >
        {/* 工具选择 */}
        <div style={{ display: 'flex', gap: 2 }}>
          {TOOLS.map((t) => (
            <button
              key={t.type}
              className={`btn btn-icon ${tool === t.type ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => {
                if (textInput) commitTextInput();
                setTool(t.type);
              }}
              title={t.label}
              style={{ width: 32, height: 32 }}
            >
              {t.icon}
            </button>
          ))}
        </div>

        <div style={{ width: 1, height: 24, background: 'var(--border-primary)' }} />

        {/* 颜色 */}
        <div style={{ display: 'flex', gap: 4 }}>
          {COLORS.map((c) => (
            <button
              key={c}
              onClick={() => setColor(c)}
              style={{
                width: 18, height: 18, borderRadius: '50%', background: c, border: 'none',
                outline: color === c ? '2px solid var(--accent-primary)' : '2px solid var(--border-primary)',
                outlineOffset: 1, cursor: 'pointer',
              }}
            />
          ))}
        </div>

        <div style={{ width: 1, height: 24, background: 'var(--border-primary)' }} />

        {/* 线宽 */}
        <div style={{ display: 'flex', gap: 2 }}>
          {LINE_WIDTHS.map((w) => (
            <button
              key={w}
              className={`btn btn-sm ${lineWidth === w ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setLineWidth(w)}
              style={{ padding: '2px 6px', fontSize: 11 }}
            >
              {w}
            </button>
          ))}
        </div>

        {/* 操作按钮 */}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
          <button className="btn btn-ghost btn-sm" onClick={() => setActions((p) => p.slice(0, -1))} disabled={actions.length === 0} title="撤销 (⌘Z)">
            <Undo2 size={14} />
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => setActions([])} disabled={actions.length === 0} title="清除">
            <Trash2 size={14} />
          </button>
          <button className="btn btn-primary btn-sm" onClick={handleCopyToClipboard} disabled={!imageObj} title="复制到剪贴板 (⌘C)">
            <Copy size={14} /> 复制
          </button>
          <button className="btn btn-ghost btn-sm" onClick={handleSave} disabled={!imageObj} title="保存 (⌘S)">
            <Download size={14} /> 保存
          </button>
          <button className="btn btn-ghost btn-sm" onClick={handleClose} title="关闭 (Esc)">
            <X size={14} />
          </button>
        </div>
      </div>

      {/* 画布区域 */}
      <div style={{ flex: 1, overflow: 'auto', background: '#1a1a2e', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
        {imageObj ? (
          <>
            <canvas
              ref={canvasRef}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
              style={{
                maxWidth: '100%', maxHeight: '100%',
                cursor: tool === 'text' ? 'text' : 'crosshair',
              }}
            />
            {/* 内联文本输入框 - 覆盖在画布上 */}
            {textInput && (
              <textarea
                ref={textInputRef}
                value={textInput.value}
                onChange={(e) => setTextInput((prev) => prev ? { ...prev, value: e.target.value } : null)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    commitTextInput();
                  }
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    setTextInput(null);
                  }
                }}
                onBlur={commitTextInput}
                style={{
                  position: 'fixed',
                  left: textInput.screenX,
                  top: textInput.screenY - textFontSize,
                  minWidth: 120,
                  minHeight: textFontSize + 8,
                  padding: '2px 4px',
                  fontSize: textFontSize * getCanvasDisplayScale(),
                  fontFamily: 'Inter, sans-serif',
                  color,
                  background: 'rgba(0, 0, 0, 0.3)',
                  border: `2px solid ${color}`,
                  borderRadius: 4,
                  outline: 'none',
                  resize: 'none',
                  lineHeight: 1.2,
                  zIndex: 100,
                }}
                placeholder="输入文字..."
              />
            )}
          </>
        ) : (
          <div style={{ color: 'var(--text-tertiary)', fontSize: 14 }}>加载截图中...</div>
        )}
      </div>

      {/* 状态栏 */}
      {status && (
        <div style={{
          padding: '6px 12px', fontSize: 12, textAlign: 'center',
          background: 'var(--bg-secondary)', borderTop: '1px solid var(--border-primary)',
        }}>
          {status}
        </div>
      )}
    </div>
  );

  /** 获取画布当前的显示缩放比例（CSS 尺寸 / 实际像素） */
  function getCanvasDisplayScale(): number {
    const canvas = canvasRef.current;
    if (!canvas) return 1;
    const rect = canvas.getBoundingClientRect();
    return rect.width / canvas.width;
  }
}
