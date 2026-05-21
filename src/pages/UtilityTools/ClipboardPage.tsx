import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { convertFileSrc } from '@tauri-apps/api/core';
import {
  Trash2, Copy, Check, RefreshCw, ClipboardList, X, Keyboard,
  Pin, PinOff, Image, FileText, Folder, File, Settings, Filter,
} from 'lucide-react';
import {
  getHotkey, saveHotkey, clearHotkey, eventToShortcutString,
} from '../../utils/hotkeyStore';

interface ClipboardEntry {
  id: number;
  content_type: string;
  content: string;
  preview: string;
  timestamp: number;
  pinned: boolean;
}

type FilterType = 'all' | 'text' | 'image' | 'files';
type Notice = { type: 'success' | 'error'; text: string };

const PREVIEW_MAX_LENGTH = 200;
const MAX_HISTORY_OPTIONS = [100, 200, 500, 1000, 2000, 5000];

function formatTime(ts: number): string {
  return new Date(ts * 1000).toLocaleString();
}

function fileName(path: string): string {
  return path.split('/').pop()?.split('\\').pop() || path;
}

function isImagePath(p: string): boolean {
  return /\.(png|jpe?g|gif|bmp|webp|svg|ico|tiff?)$/i.test(p);
}

export default function ClipboardPage() {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<ClipboardEntry[]>([]);
  const [maxHistory, setMaxHistory] = useState(500);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [hotkey, setHotkeyState] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [filter, setFilter] = useState<FilterType>('all');
  const [showSettings, setShowSettings] = useState(false);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const recorderRef = useRef<HTMLButtonElement>(null);
  const loadedRef = useRef(false);

  useEffect(() => {
    getHotkey('clipboard').then(setHotkeyState);
  }, []);

  const loadHistory = useCallback(async (showLoading = !loadedRef.current) => {
    if (showLoading) setLoading(true);
    try {
      const resp = await invoke<{ entries: ClipboardEntry[]; max_history: number }>('get_clipboard_history');
      setEntries(resp.entries);
      setMaxHistory(resp.max_history);
      loadedRef.current = true;
    } catch (err) {
      if (showLoading || !loadedRef.current) {
        setNotice({ type: 'error', text: `读取剪贴板历史失败: ${String(err)}` });
      }
    } finally {
      if (showLoading) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadHistory();
    const interval = setInterval(() => {
      void loadHistory(false);
    }, 2000);
    return () => clearInterval(interval);
  }, [loadHistory]);

  // 快捷键录制
  useEffect(() => {
    if (!isRecording) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const shortcut = eventToShortcutString(e);
      if (!shortcut) return;
      setHotkeyState(shortcut);
      saveHotkey('clipboard', shortcut)
        .then(() => setNotice({ type: 'success', text: '快捷键已保存' }))
        .catch((err) => setNotice({ type: 'error', text: `快捷键保存失败: ${String(err)}` }));
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

  const handleCopy = async (entry: ClipboardEntry) => {
    try {
      await invoke('copy_clipboard_item', {
        contentType: entry.content_type,
        content: entry.content,
      });
      setCopiedId(entry.id);
      setNotice({ type: 'success', text: '已复制到剪贴板' });
      setTimeout(() => setCopiedId(null), 2000);
    } catch (err) {
      setNotice({ type: 'error', text: `复制失败: ${String(err)}` });
    }
  };

  const handleRemove = async (id: number) => {
    try {
      await invoke('remove_clipboard_item', { id });
      await loadHistory();
      setNotice({ type: 'success', text: '已删除' });
    } catch (err) {
      setNotice({ type: 'error', text: `删除失败: ${String(err)}` });
    }
  };

  const handleClearAll = async () => {
    try {
      await invoke('clear_clipboard_history');
      await loadHistory();
      setConfirmClear(false);
      setNotice({ type: 'success', text: '已清空未收藏记录' });
    } catch (err) {
      setNotice({ type: 'error', text: `清空失败: ${String(err)}` });
    }
  };

  const handleTogglePin = async (id: number) => {
    try {
      await invoke('toggle_pin_clipboard_item', { id });
      await loadHistory();
    } catch (err) {
      setNotice({ type: 'error', text: `收藏状态更新失败: ${String(err)}` });
    }
  };

  const handleMaxChange = async (val: number) => {
    try {
      await invoke('set_clipboard_max_history', { max: val });
      setMaxHistory(val);
      setNotice({ type: 'success', text: '最大保存条数已更新' });
    } catch (err) {
      setNotice({ type: 'error', text: `设置失败: ${String(err)}` });
    }
  };

  const handleClearHotkey = async () => {
    try {
      await clearHotkey('clipboard');
      setHotkeyState('');
      setIsRecording(false);
      setNotice({ type: 'success', text: '快捷键已清空' });
    } catch (err) {
      setNotice({ type: 'error', text: `快捷键清空失败: ${String(err)}` });
    }
  };

  const filtered = entries.filter((e) => filter === 'all' || e.content_type === filter);
  const textCount = entries.filter((e) => e.content_type === 'text').length;
  const imageCount = entries.filter((e) => e.content_type === 'image').length;
  const filesCount = entries.filter((e) => e.content_type === 'files').length;

  return (
    <div className="page-container">
      <p className="page-description">{t('extraTools.clipboard.desc')}</p>

      {/* 快捷键 + 设置 */}
      <div className="card" style={{ padding: 'var(--space-4)' }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Keyboard size={18} className="text-secondary" />
            <div>
              <div className="text-sm font-medium">{t('extraTools.clipboard.hotkeyLabel')}</div>
              <div className="text-xs text-tertiary">{t('extraTools.clipboard.hotkeyDesc')}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              ref={recorderRef}
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

      {notice && (
        <div className={`status-bar ${notice.type}`} onClick={() => setNotice(null)}>
          {notice.text}
        </div>
      )}

      {/* 设置面板 */}
      {showSettings && (
        <div className="card" style={{ padding: 'var(--space-4)' }}>
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium">最大保存条数</div>
            <select
              value={maxHistory}
              onChange={(e) => handleMaxChange(Number(e.target.value))}
              style={{
                padding: '4px 8px', borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border-primary)', background: 'var(--input-bg)',
                color: 'var(--text-primary)', fontSize: 'var(--font-size-sm)',
              }}
            >
              {MAX_HISTORY_OPTIONS.map((v) => (
                <option key={v} value={v}>{v} 条</option>
              ))}
            </select>
          </div>
          <div className="text-xs text-tertiary" style={{ marginTop: 4 }}>
            收藏的条目不受数量限制。数据保存在本地 SQLite 数据库中，重启不丢失。
          </div>
        </div>
      )}

      {/* 工具栏 */}
      <div className="card" style={{ padding: 'var(--space-3)' }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {/* 分类过滤 */}
            <div className="flex gap-1">
              {([
                ['all', `全部 ${entries.length}`, <Filter size={12} />],
                ['text', `文本 ${textCount}`, <FileText size={12} />],
                ['image', `图片 ${imageCount}`, <Image size={12} />],
                ['files', `文件 ${filesCount}`, <Folder size={12} />],
              ] as [FilterType, string, React.ReactNode][]).map(([type, label, icon]) => (
                <button
                  key={type}
                  className={`btn btn-sm ${filter === type ? 'btn-primary' : 'btn-ghost'}`}
                  onClick={() => setFilter(type)}
                  style={{ fontSize: 11, padding: '2px 8px', gap: 4 }}
                >
                  {icon} {label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex gap-1">
            <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setShowSettings(!showSettings)} title="设置">
              <Settings size={14} />
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => loadHistory(true)}>
              <RefreshCw size={14} />
            </button>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => setConfirmClear(true)}
              disabled={entries.length === 0}
              style={{ color: 'var(--accent-error)' }}
            >
              <Trash2 size={14} /> {t('common.clear')}
            </button>
          </div>
        </div>
      </div>

      {confirmClear && (
        <div className="status-bar error" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <span>确认清空所有未收藏的剪贴板记录？收藏记录会保留。</span>
          <div className="flex gap-2 ml-auto">
            <button className="btn btn-ghost btn-sm" onClick={() => setConfirmClear(false)}>取消</button>
            <button className="btn btn-secondary btn-sm" onClick={handleClearAll}>清空</button>
          </div>
        </div>
      )}

      {/* 历史列表 */}
      {loading ? (
        <div className="card" style={{ textAlign: 'center', padding: 'var(--space-8)' }}>
          <span className="spinner" style={{ color: 'var(--accent-primary)' }} />
          <p className="text-secondary" style={{ marginTop: 'var(--space-3)' }}>正在读取剪贴板历史...</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: 'var(--space-8)' }}>
          <ClipboardList size={48} className="text-tertiary" style={{ margin: '0 auto var(--space-4)' }} />
          <p className="text-secondary">{t('extraTools.clipboard.empty')}</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          {filtered.map((entry) => (
            <div
              className="card clipboard-history-item"
              key={entry.id}
              style={{
                padding: 'var(--space-3)',
                borderLeft: entry.pinned ? '3px solid var(--accent-warning)' : '3px solid transparent',
              }}
            >
              <div className="flex items-start justify-between gap-3">
                <div style={{ flex: 1, minWidth: 0 }}>
                  <EntryContent entry={entry} />
                  <div className="flex items-center gap-2" style={{ marginTop: 8 }}>
                    <span style={{
                      fontSize: 10, padding: '1px 6px', borderRadius: 10,
                      background: 'var(--bg-tertiary)', color: 'var(--text-tertiary)',
                    }}>
                      {entry.content_type === 'text' ? '文本' : entry.content_type === 'image' ? '图片' : '文件'}
                    </span>
                    <span className="text-xs text-tertiary">{formatTime(entry.timestamp)}</span>
                    {entry.pinned && <span style={{ fontSize: 10, color: 'var(--accent-warning)' }}>⭐ 已收藏</span>}
                  </div>
                </div>
                <div className="flex gap-1" style={{ flexShrink: 0 }}>
                  <button
                    className="btn btn-ghost btn-icon btn-sm"
                    onClick={() => handleTogglePin(entry.id)}
                    title={entry.pinned ? '取消收藏' : '收藏'}
                  >
                    {entry.pinned ? <PinOff size={14} /> : <Pin size={14} />}
                  </button>
                  <button
                    className="btn btn-ghost btn-icon btn-sm"
                    onClick={() => handleCopy(entry)}
                    title={t('common.copy')}
                  >
                    {copiedId === entry.id ? <Check size={14} /> : <Copy size={14} />}
                  </button>
                  <button
                    className="btn btn-ghost btn-icon btn-sm"
                    onClick={() => handleRemove(entry.id)}
                    title={t('common.delete')}
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** 按类型渲染条目内容 */
function EntryContent({ entry }: { entry: ClipboardEntry }) {
  if (entry.content_type === 'image') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
        <div style={{
          width: 80, height: 80, borderRadius: 'var(--radius-sm)',
          overflow: 'hidden', background: 'var(--bg-tertiary)',
          border: '1px solid var(--border-primary)', flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <img
            src={convertFileSrc(entry.content)}
            alt="clipboard"
            style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
          />
        </div>
        <span className="text-sm text-secondary">{entry.preview}</span>
      </div>
    );
  }

  if (entry.content_type === 'files') {
    let files: string[] = [];
    try { files = JSON.parse(entry.content); } catch { /* noop */ }
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {files.slice(0, 5).map((f, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--font-size-sm)' }}>
            {isImagePath(f) ? <Image size={14} className="text-tertiary" /> :
             f.endsWith('/') || !f.split('/').pop()?.includes('.') ?
              <Folder size={14} className="text-tertiary" /> :
              <File size={14} className="text-tertiary" />}
            <span>{fileName(f)}</span>
          </div>
        ))}
        {files.length > 5 && <span className="text-xs text-tertiary">+{files.length - 5} 个文件</span>}
      </div>
    );
  }

  // 文本
  return (
    <pre className="clipboard-content-preview">
      {entry.content.length > PREVIEW_MAX_LENGTH
        ? entry.content.slice(0, PREVIEW_MAX_LENGTH) + '…'
        : entry.content}
    </pre>
  );
}
