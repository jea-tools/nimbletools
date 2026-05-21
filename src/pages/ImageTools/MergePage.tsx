import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import { Upload, X, FileImage, CheckCircle, AlertCircle, ArrowDown, ArrowRight } from 'lucide-react';

interface ProcessResult { success: boolean; message: string; output_paths: string[]; }

export default function ImageMergePage() {
  const { t } = useTranslation();
  const [files, setFiles] = useState<string[]>([]);
  const [direction, setDirection] = useState<'horizontal' | 'vertical'>('horizontal');
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<ProcessResult | null>(null);

  const handleSelectFiles = async () => {
    const selected = await open({
      multiple: true,
      filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp'] }],
    });
    if (selected) setFiles((prev) => [...prev, ...(Array.isArray(selected) ? selected : [selected])]);
  };

  const handleProcess = async () => {
    if (files.length < 2) return;
    const outputPath = await save({
      filters: [{ name: 'Image', extensions: ['png', 'jpg', 'webp'] }],
      defaultPath: 'merged.png',
    });
    if (!outputPath) return;

    setProcessing(true); setResult(null);
    try {
      const res = await invoke<ProcessResult>('merge_images', {
        request: { input_paths: files, output_path: outputPath, direction },
      });
      setResult(res);
    } catch (e) {
      setResult({ success: false, message: String(e), output_paths: [] });
    } finally { setProcessing(false); }
  };

  const moveFile = (from: number, to: number) => {
    if (to < 0 || to >= files.length) return;
    const next = [...files];
    [next[from], next[to]] = [next[to], next[from]];
    setFiles(next);
  };

  return (
    <div className="page-container">
      <p className="page-description">{t('imageTools.merge.desc')}</p>

      <div className="card">
        <div className="dropzone" onClick={handleSelectFiles}>
          <Upload className="dropzone-icon" />
          <p className="dropzone-text">{t('imageTools.merge.addImages')}</p>
        </div>
        {files.length > 0 && (
          <div className="file-list mt-4">
            {files.map((f, i) => (
              <div className="file-item" key={i}>
                <span className="text-xs text-tertiary font-medium" style={{ width: 24 }}>{i + 1}</span>
                <FileImage size={16} className="text-tertiary" />
                <span className="file-name">{f.split('/').pop()}</span>
                <button className="btn btn-ghost btn-sm" onClick={() => moveFile(i, i - 1)} disabled={i === 0}>↑</button>
                <button className="btn btn-ghost btn-sm" onClick={() => moveFile(i, i + 1)} disabled={i === files.length - 1}>↓</button>
                <button className="btn btn-ghost btn-icon file-remove" onClick={() => setFiles((p) => p.filter((_, j) => j !== i))}>
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <div className="form-group">
          <label className="form-label">{t('imageTools.merge.direction')}</label>
          <div className="flex gap-2">
            <button
              className={`btn ${direction === 'horizontal' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setDirection('horizontal')}
            >
              <ArrowRight size={14} /> {t('imageTools.merge.horizontal')}
            </button>
            <button
              className={`btn ${direction === 'vertical' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setDirection('vertical')}
            >
              <ArrowDown size={14} /> {t('imageTools.merge.vertical')}
            </button>
          </div>
        </div>
      </div>

      <div className="flex gap-2 mb-4">
        <button className="btn btn-primary btn-lg" onClick={handleProcess} disabled={files.length < 2 || processing}>
          {processing ? <><span className="spinner" /> {t('common.processing')}</> : t('common.process')}
        </button>
        <button className="btn btn-ghost" onClick={() => { setFiles([]); setResult(null); }}>{t('common.clear')}</button>
      </div>

      {result && (
        <div className={`status-bar ${result.success ? 'success' : 'error'}`}>
          {result.success ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
          {result.message}
        </div>
      )}
    </div>
  );
}
