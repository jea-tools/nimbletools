import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import { Upload, X, FileText, CheckCircle, AlertCircle } from 'lucide-react';

interface ProcessResult { success: boolean; message: string; output_paths: string[]; }

export default function FileMergePage() {
  const { t } = useTranslation();
  const [files, setFiles] = useState<string[]>([]);
  const [verifyCrc, setVerifyCrc] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<ProcessResult | null>(null);

  const handleSelectFiles = async () => {
    const selected = await open({ multiple: true });
    if (selected) {
      const paths = (Array.isArray(selected) ? selected : [selected]) as string[];
      // 自动按文件名排序（part1, part2...）
      paths.sort();
      setFiles((prev) => [...prev, ...paths]);
    }
  };

  const handleProcess = async () => {
    if (files.length < 2) return;
    const outputPath = await save({ defaultPath: 'merged_output' });
    if (!outputPath) return;

    setProcessing(true); setResult(null);
    try {
      const res = await invoke<ProcessResult>('merge_files', {
        request: { input_paths: files, output_path: outputPath, verify_crc: verifyCrc },
      });
      setResult(res);
    } catch (e) {
      setResult({ success: false, message: String(e), output_paths: [] });
    } finally { setProcessing(false); }
  };

  return (
    <div className="page-container">
      <p className="page-description">{t('fileTools.merge.desc')}</p>

      <div className="card">
        <div className="dropzone" onClick={handleSelectFiles}>
          <Upload className="dropzone-icon" />
          <p className="dropzone-text">{t('common.dropFiles')}</p>
        </div>
        {files.length > 0 && (
          <div className="file-list mt-4">
            {files.map((f, i) => (
              <div className="file-item" key={i}>
                <span className="text-xs text-tertiary font-medium" style={{ width: 24 }}>{i + 1}</span>
                <FileText size={16} className="text-tertiary" />
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
        <label className="flex items-center gap-3">
          <div className="toggle-switch">
            <input type="checkbox" checked={verifyCrc} onChange={(e) => setVerifyCrc(e.target.checked)} />
            <span className="toggle-slider" />
          </div>
          <span className="text-sm">{t('fileTools.merge.verifyCrc')}</span>
        </label>
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
