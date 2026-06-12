import { useState, useEffect, useRef, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { convertFileSrc } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import {
  Image, FileText, Folder, Search, Star,
  Clipboard, Type, ImageIcon, Pin, Trash2,
} from 'lucide-react';
import {
  editSearchWithKey,
  quickPasteIndexForKey,
  shouldEditSearchWhenInputUnfocused,
} from './clipboardPopupKeyboard';

interface ClipboardEntry {
  id: number;
  content_type: 'text' | 'image' | 'files';
  content: string;
  preview: string;
  timestamp: number;
  pinned: boolean;
}

const PREVIEW_MAX_LENGTH = 160;

function timeAgo(timestamp: number): string {
  const diff = Math.floor(Date.now() / 1000) - timestamp;
  if (diff < 60) return '刚刚';
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  return `${Math.floor(diff / 86400)} 天前`;
}

function truncate(text: string): string {
  const single = text.replace(/\n/g, ' ').replace(/\s+/g, ' ');
  return single.length > PREVIEW_MAX_LENGTH
    ? single.slice(0, PREVIEW_MAX_LENGTH) + '…'
    : single;
}

function fileName(path: string): string {
  return path.split('/').pop()?.split('\\').pop() || path;
}

function isImagePath(path: string): boolean {
  return /\.(png|jpe?g|gif|bmp|webp|svg|ico|tiff?)$/i.test(path);
}

function isLikelyFolder(path: string): boolean {
  return path.endsWith('/') || !path.split('/').pop()?.includes('.');
}

function typeIcon(type: string) {
  if (type === 'image') return <ImageIcon size={12} />;
  if (type === 'files') return <Folder size={12} />;
  return <Type size={12} />;
}

function typeLabel(type: string) {
  if (type === 'image') return '图片';
  if (type === 'files') return '文件';
  return '文本';
}

function detailText(entry: ClipboardEntry | undefined): string {
  if (!entry) return '';
  if (entry.content_type === 'text') return entry.content;
  if (entry.content_type === 'files') {
    try {
      return (JSON.parse(entry.content) as string[]).join('\n');
    } catch {
      return entry.content;
    }
  }
  return entry.preview;
}

// ─── 条目预览 ───

function EntryPreview({ entry }: { entry: ClipboardEntry }) {
  if (entry.content_type === 'image') {
    return (
      <div className="cpop-preview-image">
        <div className="cpop-thumb">
          <img
            src={convertFileSrc(entry.content)}
            alt="clipboard"
            draggable={false}
          />
        </div>
        <span className="cpop-dim">{entry.preview}</span>
      </div>
    );
  }

  if (entry.content_type === 'files') {
    let files: string[] = [];
    try { files = JSON.parse(entry.content); } catch { /* noop */ }
    return (
      <div className="cpop-preview-files">
        {files.slice(0, 3).map((f, i) => (
          <div key={i} className="cpop-file-row">
            {isLikelyFolder(f) ? <Folder size={13} /> : isImagePath(f) ? <Image size={13} /> : <FileText size={13} />}
            <span>{fileName(f)}</span>
          </div>
        ))}
        {files.length > 3 && <span className="cpop-more">+{files.length - 3} 个文件</span>}
      </div>
    );
  }

  return <div className="cpop-preview-text">{truncate(entry.content)}</div>;
}

// ─── 主组件 ───

export default function ClipboardPopup() {
  const [entries, setEntries] = useState<ClipboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const filteredRef = useRef<ClipboardEntry[]>([]);
  const selectedRef = useRef(0);
  const pastingRef = useRef(false);
  const focusTimersRef = useRef<number[]>([]);

  const focusSearchBox = useCallback(() => {
    for (const timer of focusTimersRef.current) {
      window.clearTimeout(timer);
    }
    focusTimersRef.current = [0, 40, 120, 240, 360].map((delay) => window.setTimeout(() => {
      const input = searchRef.current;
      if (!input) return;
      input.focus();
    }, delay));
  }, []);

  const loadHistory = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await invoke<{ entries: ClipboardEntry[]; max_history: number }>('get_clipboard_history');
      setEntries(resp.entries);
      setSelectedIndex(0);
    } catch (err) {
      console.warn(err);
      setEntries([]);
      setSelectedIndex(0);
      setError(`剪贴板历史加载失败: ${String(err)}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadHistory().finally(() => {
      pastingRef.current = false;
      focusSearchBox();
    });
    const unlistenPromise = listen('clipboard-popup-refresh', () => {
      pastingRef.current = false;
      setSearch('');
      void loadHistory();
      focusSearchBox();
    });
    const focusUnlistenPromise = listen('clipboard-popup-focus-search', () => {
      focusSearchBox();
    });
    return () => {
      for (const timer of focusTimersRef.current) {
        window.clearTimeout(timer);
      }
      focusTimersRef.current = [];
      unlistenPromise.then((unlisten) => unlisten()).catch(console.warn);
      focusUnlistenPromise.then((unlisten) => unlisten()).catch(console.warn);
    };
  }, [loadHistory, focusSearchBox]);

  const filtered = entries.filter((e) => {
    const q = search.toLowerCase();
    return e.preview.toLowerCase().includes(q) || e.content.toLowerCase().includes(q);
  });
  filteredRef.current = filtered;

  useEffect(() => { selectedRef.current = selectedIndex; }, [selectedIndex]);

  useEffect(() => {
    setSelectedIndex((index) => Math.max(0, Math.min(index, Math.max(0, filtered.length - 1))));
  }, [filtered.length]);

  useEffect(() => {
    const item = listRef.current?.children[selectedIndex] as HTMLElement;
    item?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  const handlePaste = useCallback((entry: ClipboardEntry) => {
    pastingRef.current = true;
    invoke('paste_clipboard_item', {
      contentType: entry.content_type,
      content: entry.content,
    }).catch((err) => {
      pastingRef.current = false;
      setError(String(err));
      console.warn(err);
    });
  }, []);

  const handleOpenAccessibilitySettings = useCallback(() => {
    invoke('open_accessibility_settings').catch(console.warn);
  }, []);

  const handleClose = useCallback(() => {
    pastingRef.current = false;
    invoke('close_clipboard_popup').catch(console.warn);
  }, []);

  const handleRemove = useCallback(async (id: number) => {
    try {
      await invoke('remove_clipboard_item', { id });
      await loadHistory();
    } catch (err) {
      setError(`删除失败: ${String(err)}`);
    }
  }, [loadHistory]);

  const handleTogglePin = useCallback(async (id: number) => {
    try {
      await invoke('toggle_pin_clipboard_item', { id });
      await loadHistory();
    } catch (err) {
      setError(`收藏失败: ${String(err)}`);
    }
  }, [loadHistory]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const f = filteredRef.current;
      const idx = selectedRef.current;
      const selected = f[idx];
      const searchFocused = document.activeElement === searchRef.current;

      const quickIndex = !e.metaKey && !e.ctrlKey && !e.altKey
        ? quickPasteIndexForKey(e.key)
        : null;
      if (quickIndex !== null) {
        if (f[quickIndex]) {
          e.preventDefault();
          handlePaste(f[quickIndex]);
        }
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'p' && selected) {
        e.preventDefault();
        void handleTogglePin(selected.id);
        return;
      }

      if ((e.metaKey || e.ctrlKey) && (e.key === 'Backspace' || e.key === 'Delete') && selected) {
        e.preventDefault();
        void handleRemove(selected.id);
        return;
      }

      switch (e.key) {
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex((i) => Math.max(0, i - 1));
          break;
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex((i) => (f.length === 0 ? 0 : Math.min(f.length - 1, i + 1)));
          break;
        case 'Enter':
          e.preventDefault();
          if (f[idx]) handlePaste(f[idx]);
          break;
        case ' ':
          if (!searchFocused) {
            e.preventDefault();
          }
          break;
        case 'Escape':
          e.preventDefault();
          handleClose();
          break;
        default:
          if (!searchFocused && shouldEditSearchWhenInputUnfocused(e)) {
            e.preventDefault();
            setSearch((value) => editSearchWithKey(value, e.key));
            focusSearchBox();
          }
          break;
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [handlePaste, handleClose, handleRemove, handleTogglePin, focusSearchBox]);

  useEffect(() => { setSelectedIndex(0); }, [search]);

  const selectedEntry = filtered[selectedIndex];

  return (
    <div className="cpop-root">
      <div className="cpop-header">
        <div className="cpop-search-wrap">
          <Search size={15} className="cpop-search-icon" />
          <input
            ref={searchRef}
            className="cpop-search"
            type="text"
            placeholder="搜索剪贴板..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <span className="cpop-result-count">{filtered.length} 项</span>
        </div>
      </div>

      <div className="cpop-content">
        <div className="cpop-list" ref={listRef}>
          {error && !loading && filtered.length > 0 && (
            <div className="cpop-error">
              <span>{error}</span>
              {error.includes('Accessibility') || error.includes('辅助功能') ? (
                <button className="btn btn-secondary btn-sm" onClick={handleOpenAccessibilitySettings}>
                  打开设置
                </button>
              ) : null}
            </div>
          )}
          {loading ? (
            <div className="cpop-empty">
              <Clipboard size={32} strokeWidth={1.5} />
              <span>正在读取剪贴板历史...</span>
            </div>
          ) : error ? (
            <div className="cpop-empty">
              <Clipboard size={32} strokeWidth={1.5} />
              <span>{error}</span>
              <button className="btn btn-secondary btn-sm" onClick={loadHistory}>重试</button>
            </div>
          ) : filtered.length === 0 ? (
            <div className="cpop-empty">
              <Clipboard size={32} strokeWidth={1.5} />
              <span>暂无记录</span>
            </div>
          ) : (
            filtered.map((entry, i) => (
              <div
                key={entry.id}
                className={`cpop-item ${i === selectedIndex ? 'active' : ''}`}
                onClick={() => handlePaste(entry)}
                onMouseEnter={() => setSelectedIndex(i)}
              >
                <div className="cpop-index">{i < 10 ? ((i + 1) % 10) : ''}</div>
                <div className="cpop-item-main">
                  <EntryPreview entry={entry} />
                  <div className="cpop-item-footer">
                    <span className={`cpop-badge cpop-badge--${entry.content_type}`}>
                      {typeIcon(entry.content_type)}
                      {typeLabel(entry.content_type)}
                    </span>
                    {entry.pinned && (
                      <span className="cpop-pin"><Star size={10} fill="currentColor" /> 收藏</span>
                    )}
                    <span className="cpop-time">{timeAgo(entry.timestamp)}</span>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="cpop-detail">
          {selectedEntry ? (
            <>
              <div className="cpop-detail-head">
                <span className={`cpop-badge cpop-badge--${selectedEntry.content_type}`}>
                  {typeIcon(selectedEntry.content_type)}
                  {typeLabel(selectedEntry.content_type)}
                </span>
                <div className="cpop-detail-actions">
                  <button
                    className="cpop-icon-btn"
                    onClick={() => handleTogglePin(selectedEntry.id)}
                    title={selectedEntry.pinned ? '取消收藏' : '收藏'}
                  >
                    <Pin size={14} fill={selectedEntry.pinned ? 'currentColor' : 'none'} />
                  </button>
                  <button
                    className="cpop-icon-btn"
                    onClick={() => handleRemove(selectedEntry.id)}
                    title="删除"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
              {selectedEntry.content_type === 'image' ? (
                <div className="cpop-detail-image">
                  <img src={convertFileSrc(selectedEntry.content)} alt="clipboard preview" />
                </div>
              ) : (
                <pre className="cpop-detail-text">{detailText(selectedEntry)}</pre>
              )}
            </>
          ) : (
            <div className="cpop-empty cpop-empty--detail">
              <Clipboard size={28} strokeWidth={1.5} />
              <span>选择一条记录预览</span>
            </div>
          )}
        </div>
      </div>

      <div className="cpop-footer">
        <div className="cpop-shortcut"><kbd>1</kbd>-<kbd>9</kbd> 快速粘贴</div>
        <div className="cpop-shortcut"><kbd>↑</kbd><kbd>↓</kbd> 选择</div>
        <div className="cpop-shortcut"><kbd>↵</kbd> 粘贴</div>
        <div className="cpop-shortcut"><kbd>⌘P</kbd> 收藏</div>
        <div className="cpop-shortcut"><kbd>⌘⌫</kbd> 删除</div>
        <div className="cpop-shortcut"><kbd>Esc</kbd> 关闭</div>
      </div>
    </div>
  );
}
