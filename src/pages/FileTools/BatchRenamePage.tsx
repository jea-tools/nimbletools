import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { Upload, PenTool, CheckCircle, AlertCircle, ArrowRight } from 'lucide-react';

interface RenamePreviewItem { original: string; renamed: string; }
interface ProcessResult { success: boolean; message: string; output_paths: string[]; }

export default function BatchRenamePage() {
  const { t } = useTranslation();
  const [files, setFiles] = useState<string[]>([]);
  const [prefix, setPrefix] = useState('');
  const [suffix, setSuffix] = useState('');
  const [find, setFind] = useState('');
  const [replace, setReplace] = useState('');
  const [useRegex, setUseRegex] = useState(false);
  const [useSequential, setUseSequential] = useState(false);
  const [startNumber, setStartNumber] = useState(1);
  const [digits, setDigits] = useState(3);
  const [preview, setPreview] = useState<RenamePreviewItem[]>([]);
  const [result, setResult] = useState<ProcessResult | null>(null);
  const [processing, setProcessing] = useState(false);

  const handleSelectFiles = async () => {
    const selected = await open({ multiple: true });
    if (selected) {
      const paths = Array.isArray(selected) ? selected : [selected];
      setFiles((prev) => [...prev, ...(paths as string[])]);
    }
  };

  const handlePreview = async () => {
    if (files.length === 0) return;
    try {
      const items = await invoke<RenamePreviewItem[]>('preview_rename', {
        request: {
          file_paths: files, prefix, suffix, find, replace,
          use_regex: useRegex, use_sequential: useSequential,
          start_number: startNumber, digits,
        },
      });
      setPreview(items);
    } catch (e) {
      setResult({ success: false, message: String(e), output_paths: [] });
    }
  };

  const handleApply = async () => {
    if (preview.length === 0) return;
    setProcessing(true); setResult(null);
    try {
      const items = preview.map((p) => ({ original_path: p.original, new_path: p.renamed }));
      const res = await invoke<ProcessResult>('apply_rename', { request: { items } });
      setResult(res);
      if (res.success) {
        setFiles(preview.map((p) => p.renamed));
        setPreview([]);
      }
    } catch (e) {
      setResult({ success: false, message: String(e), output_paths: [] });
    } finally { setProcessing(false); }
  };

  const fileName = (path: string) => path.split('/').pop() || path.split('\\').pop() || path;

  return (
    <div className="page-container">
      <p className="page-description">{t('fileTools.rename.desc')}</p>

      <div className="card">
        <div className="dropzone" onClick={handleSelectFiles}>
          <Upload className="dropzone-icon" />
          <p className="dropzone-text">{t('common.dropFiles')}</p>
        </div>
        {files.length > 0 && (
          <p className="text-sm text-secondary mt-2">{files.length} files selected</p>
        )}
      </div>

      <div className="card">
        <div className="card-title">{t('fileTools.rename.findReplace')}</div>
        <div className="flex gap-4 mb-4">
          <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
            <label className="form-label">{t('fileTools.rename.prefix')}</label>
            <input className="form-input" value={prefix} onChange={(e) => setPrefix(e.target.value)} />
          </div>
          <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
            <label className="form-label">{t('fileTools.rename.suffix')}</label>
            <input className="form-input" value={suffix} onChange={(e) => setSuffix(e.target.value)} />
          </div>
        </div>
        <div className="flex gap-4 mb-4">
          <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
            <label className="form-label">{t('fileTools.rename.find')}</label>
            <input className="form-input" value={find} onChange={(e) => setFind(e.target.value)} />
          </div>
          <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
            <label className="form-label">{t('fileTools.rename.replace')}</label>
            <input className="form-input" value={replace} onChange={(e) => setReplace(e.target.value)} />
          </div>
          <label className="flex items-center gap-2" style={{ paddingTop: 'var(--space-5)' }}>
            <div className="toggle-switch">
              <input type="checkbox" checked={useRegex} onChange={(e) => setUseRegex(e.target.checked)} />
              <span className="toggle-slider" />
            </div>
            <span className="text-xs">{t('fileTools.rename.useRegex')}</span>
          </label>
        </div>

        <div className="card-title">{t('fileTools.rename.sequential')}</div>
        <div className="flex gap-4 items-end">
          <label className="flex items-center gap-2">
            <div className="toggle-switch">
              <input type="checkbox" checked={useSequential} onChange={(e) => setUseSequential(e.target.checked)} />
              <span className="toggle-slider" />
            </div>
          </label>
          <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
            <label className="form-label">{t('fileTools.rename.startNumber')}</label>
            <input className="form-input" type="number" min={0} value={startNumber} onChange={(e) => setStartNumber(Number(e.target.value))} disabled={!useSequential} />
          </div>
          <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
            <label className="form-label">{t('fileTools.rename.digits')}</label>
            <input className="form-input" type="number" min={1} max={10} value={digits} onChange={(e) => setDigits(Number(e.target.value))} disabled={!useSequential} />
          </div>
        </div>
      </div>

      <div className="flex gap-2 mb-4">
        <button className="btn btn-secondary" onClick={handlePreview} disabled={files.length === 0}>
          <PenTool size={14} /> {t('common.preview')}
        </button>
        {preview.length > 0 && (
          <button className="btn btn-primary" onClick={handleApply} disabled={processing}>
            {processing ? <><span className="spinner" /> {t('common.processing')}</> : t('fileTools.rename.apply')}
          </button>
        )}
      </div>

      {/* Preview Table */}
      {preview.length > 0 && (
        <div className="card">
          <div className="card-title">{t('common.preview')}</div>
          <div style={{ maxHeight: 300, overflowY: 'auto' }}>
            {preview.map((item, i) => (
              <div key={i} className="flex items-center gap-3" style={{ padding: 'var(--space-2) 0', borderBottom: '1px solid var(--border-primary)' }}>
                <span className="text-sm" style={{ flex: 1, wordBreak: 'break-all' }}>{fileName(item.original)}</span>
                <ArrowRight size={14} className="text-tertiary" style={{ flexShrink: 0 }} />
                <span className="text-sm font-medium" style={{ flex: 1, wordBreak: 'break-all', color: 'var(--accent-primary)' }}>{fileName(item.renamed)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {result && (
        <div className={`status-bar ${result.success ? 'success' : 'error'}`}>
          {result.success ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
          {result.message}
        </div>
      )}
    </div>
  );
}
