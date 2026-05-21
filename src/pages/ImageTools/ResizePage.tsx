import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { Upload, X, FileImage, CheckCircle, AlertCircle } from 'lucide-react';

interface ProcessResult {
  success: boolean;
  message: string;
  output_paths: string[];
}

export default function ResizePage() {
  const { t } = useTranslation();
  const [files, setFiles] = useState<string[]>([]);
  const [mode, setMode] = useState<'pixels' | 'percentage'>('pixels');
  const [width, setWidth] = useState(800);
  const [height, setHeight] = useState(600);
  const [aspectRatio, setAspectRatio] = useState(800 / 600);
  const [percentage, setPercentage] = useState(50);
  const [keepAspectRatio, setKeepAspectRatio] = useState(true);
  const [outputDir, setOutputDir] = useState('');
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<ProcessResult | null>(null);

  // 选择文件后自动获取第一张图片的尺寸作为默认值
  const updateDefaultSize = async (paths: string[]) => {
    if (paths.length === 0) return;
    try {
      const info = await invoke<{ width: number; height: number }>('get_image_info', { path: paths[0] });
      if (info.width > 0 && info.height > 0) {
        setWidth(info.width);
        setHeight(info.height);
        setAspectRatio(info.width / info.height);
      }
    } catch { /* ignore */ }
  };

  const handleWidthChange = (w: number) => {
    setWidth(w);
    if (keepAspectRatio && w > 0) {
      setHeight(Math.round(w / aspectRatio));
    }
  };

  const handleHeightChange = (h: number) => {
    setHeight(h);
    if (keepAspectRatio && h > 0) {
      setWidth(Math.round(h * aspectRatio));
    }
  };

  const handleAspectToggle = (checked: boolean) => {
    setKeepAspectRatio(checked);
    if (checked && width > 0 && height > 0) {
      setAspectRatio(width / height);
    }
  };

  const handleSelectFiles = async () => {
    const selected = await open({
      multiple: true,
      filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp'] }],
    });
    if (selected) {
      const paths = Array.isArray(selected) ? selected : [selected];
      setFiles((prev) => {
        const newFiles = [...prev, ...paths];
        if (prev.length === 0) updateDefaultSize(paths);
        return newFiles;
      });
    }
  };

  const handleSelectOutput = async () => {
    const dir = await open({ directory: true });
    if (dir) setOutputDir(dir as string);
  };

  const handleProcess = async () => {
    if (files.length === 0 || !outputDir) return;
    setProcessing(true);
    setResult(null);
    try {
      const res = await invoke<ProcessResult>('resize_images', {
        request: {
          input_paths: files,
          output_dir: outputDir,
          width,
          height,
          keep_aspect_ratio: keepAspectRatio,
          use_percentage: mode === 'percentage',
          percentage,
        },
      });
      setResult(res);
    } catch (e) {
      setResult({ success: false, message: String(e), output_paths: [] });
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="page-container">
      <p className="page-description">{t('imageTools.resize.desc')}</p>

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
        <div className="tabs">
          <button className={`tab ${mode === 'pixels' ? 'active' : ''}`} onClick={() => setMode('pixels')}>
            {t('imageTools.resize.byPixels')}
          </button>
          <button className={`tab ${mode === 'percentage' ? 'active' : ''}`} onClick={() => setMode('percentage')}>
            {t('imageTools.resize.byPercentage')}
          </button>
        </div>

        {mode === 'pixels' ? (
          <div className="flex gap-4 items-end">
            <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
              <label className="form-label">{t('imageTools.resize.width')} (px)</label>
              <input className="form-input" type="number" min={1} value={width} onChange={(e) => handleWidthChange(Number(e.target.value))} />
            </div>
            <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
              <label className="form-label">{t('imageTools.resize.height')} (px)</label>
              <input className="form-input" type="number" min={1} value={height} onChange={(e) => handleHeightChange(Number(e.target.value))} />
            </div>
            <label className="flex items-center gap-2" style={{ paddingBottom: 'var(--space-2)' }}>
              <div className="toggle-switch">
                <input type="checkbox" checked={keepAspectRatio} onChange={(e) => handleAspectToggle(e.target.checked)} />
                <span className="toggle-slider" />
              </div>
              <span className="text-sm">{t('imageTools.resize.keepAspectRatio')}</span>
            </label>
          </div>
        ) : (
          <div className="form-group">
            <label className="form-label">{t('imageTools.resize.percentage')}: {percentage}%</label>
            <input type="range" className="range-slider" min={1} max={500} value={percentage} onChange={(e) => setPercentage(Number(e.target.value))} />
          </div>
        )}

        <div className="form-group mt-4">
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
