import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { Upload, X, FileImage, CheckCircle, AlertCircle } from 'lucide-react';

interface ProcessResult { success: boolean; message: string; output_paths: string[]; }

export default function CompressPage() {
  const { t } = useTranslation();
  const [files, setFiles] = useState<string[]>([]);
  const [quality, setQuality] = useState(75);
  const [outputDir, setOutputDir] = useState('');
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<ProcessResult | null>(null);

  const handleSelectFiles = async () => {
    const selected = await open({
      multiple: true,
      filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp'] }],
    });
    if (selected) setFiles((prev) => [...prev, ...(Array.isArray(selected) ? selected : [selected])]);
  };

  const handleSelectOutput = async () => {
    const dir = await open({ directory: true });
    if (dir) setOutputDir(dir as string);
  };

  const handleProcess = async () => {
    if (files.length === 0 || !outputDir) return;
    setProcessing(true); setResult(null);
    try {
      const res = await invoke<ProcessResult>('compress_images', {
        request: { input_paths: files, output_dir: outputDir, quality },
      });
      setResult(res);
    } catch (e) {
      setResult({ success: false, message: String(e), output_paths: [] });
    } finally { setProcessing(false); }
  };

  return (
    <div className="page-container">
      <p className="page-description">{t('imageTools.compress.desc')}</p>

      <div className="card">
        <div className="dropzone" onClick={handleSelectFiles}>
          <Upload className="dropzone-icon" />
          <p className="dropzone-text">{t('common.dropFiles')}</p>
        </div>
        {files.length > 0 && (
          <div className="file-list mt-4">
            {files.map((f, i) => (
              <div className="file-item" key={i}>
                <FileImage size={16} className="text-tertiary" />
                <span className="file-name">{f.split('/').pop()}</span>
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
          <label className="form-label">{t('imageTools.compress.quality')}: {quality}%</label>
          <input type="range" className="range-slider" min={1} max={100} value={quality} onChange={(e) => setQuality(Number(e.target.value))} />
          <div className="flex justify-between text-xs text-tertiary mt-2">
            <span>1% — {t('imageTools.compress.savings')} ↑</span>
            <span>100% — {t('imageTools.compress.quality')} ↑</span>
          </div>
        </div>

        <div className="form-group">
          <label className="form-label">{t('common.outputFolder')}</label>
          <div className="flex gap-2">
            <input className="form-input" value={outputDir} readOnly style={{ flex: 1 }} />
            <button className="btn btn-secondary" onClick={handleSelectOutput}>{t('common.selectFolder')}</button>
          </div>
        </div>
      </div>

      <div className="flex gap-2 mb-4">
        <button className="btn btn-primary btn-lg" onClick={handleProcess} disabled={files.length === 0 || !outputDir || processing}>
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
