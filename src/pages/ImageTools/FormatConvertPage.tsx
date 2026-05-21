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

const FORMATS = ['jpg', 'png', 'webp', 'bmp'];

export default function FormatConvertPage() {
  const { t } = useTranslation();
  const [files, setFiles] = useState<string[]>([]);
  const [targetFormat, setTargetFormat] = useState('png');
  const [quality, setQuality] = useState(90);
  const [outputDir, setOutputDir] = useState('');
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<ProcessResult | null>(null);

  const handleSelectFiles = async () => {
    const selected = await open({
      multiple: true,
      filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif', 'tiff'] }],
    });
    if (selected) {
      const paths = Array.isArray(selected) ? selected : [selected];
      setFiles((prev) => [...prev, ...paths]);
    }
  };

  const handleSelectOutput = async () => {
    const dir = await open({ directory: true });
    if (dir) setOutputDir(dir as string);
  };

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleProcess = async () => {
    if (files.length === 0 || !outputDir) return;
    setProcessing(true);
    setResult(null);
    try {
      const res = await invoke<ProcessResult>('convert_images', {
        request: {
          input_paths: files,
          output_dir: outputDir,
          target_format: targetFormat,
          quality,
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
      <p className="page-description">{t('imageTools.formatConvert.desc')}</p>

      {/* Drop Zone */}
      <div className="card">
        <div className="dropzone" onClick={handleSelectFiles}>
          <Upload className="dropzone-icon" />
          <p className="dropzone-text">{t('common.dropFiles')}</p>
          <p className="dropzone-hint">{t('common.dropHint')}</p>
        </div>

        {files.length > 0 && (
          <div className="file-list mt-4">
            {files.map((f, i) => (
              <div className="file-item" key={i}>
                <FileImage size={16} className="text-tertiary" />
                <span className="file-name">{f.split('/').pop() || f.split('\\').pop()}</span>
                <button className="btn btn-ghost btn-icon file-remove" onClick={() => removeFile(i)}>
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Options */}
      <div className="card">
        <div className="flex gap-6" style={{ alignItems: 'flex-end' }}>
          <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
            <label className="form-label">{t('imageTools.formatConvert.targetFormat')}</label>
            <select
              className="form-input form-select"
              value={targetFormat}
              onChange={(e) => setTargetFormat(e.target.value)}
            >
              {FORMATS.map((f) => (
                <option key={f} value={f}>{f.toUpperCase()}</option>
              ))}
            </select>
          </div>

          {(targetFormat === 'jpg' || targetFormat === 'webp') && (
            <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
              <label className="form-label">{t('imageTools.formatConvert.quality')}: {quality}%</label>
              <input
                type="range"
                className="range-slider"
                min={1}
                max={100}
                value={quality}
                onChange={(e) => setQuality(Number(e.target.value))}
              />
            </div>
          )}

          <div className="form-group" style={{ flex: 2, marginBottom: 0 }}>
            <label className="form-label">{t('common.outputFolder')}</label>
            <div className="flex gap-2">
              <input className="form-input" value={outputDir} readOnly placeholder="..." style={{ flex: 1 }} />
              <button className="btn btn-secondary" onClick={handleSelectOutput}>
                {t('common.selectFolder')}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Action */}
      <div className="flex gap-2 mb-4">
        <button
          className="btn btn-primary btn-lg"
          onClick={handleProcess}
          disabled={files.length === 0 || !outputDir || processing}
        >
          {processing ? <><span className="spinner" /> {t('common.processing')}</> : t('common.process')}
        </button>
        <button className="btn btn-ghost" onClick={() => { setFiles([]); setResult(null); }}>
          {t('common.clear')}
        </button>
      </div>

      {processing && (
        <div className="progress-bar">
          <div className="progress-bar-fill" style={{ width: '100%', animation: 'pulse 1.5s infinite' }} />
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
