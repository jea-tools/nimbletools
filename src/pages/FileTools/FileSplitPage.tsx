import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { FileText, CheckCircle, AlertCircle } from 'lucide-react';

interface ProcessResult { success: boolean; message: string; output_paths: string[]; }

export default function FileSplitPage() {
  const { t } = useTranslation();
  const [filePath, setFilePath] = useState('');
  const [mode, setMode] = useState<'size' | 'count'>('size');
  const [chunkSizeMb, setChunkSizeMb] = useState(10);
  const [chunkCount, setChunkCount] = useState(5);
  const [outputDir, setOutputDir] = useState('');
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<ProcessResult | null>(null);

  const handleSelectFile = async () => {
    const selected = await open({ multiple: false });
    if (selected) setFilePath(selected as string);
  };

  const handleSelectOutput = async () => {
    const dir = await open({ directory: true });
    if (dir) setOutputDir(dir as string);
  };

  const handleProcess = async () => {
    if (!filePath || !outputDir) return;
    setProcessing(true); setResult(null);
    try {
      const res = await invoke<ProcessResult>('split_file', {
        request: {
          input_path: filePath,
          output_dir: outputDir,
          mode,
          chunk_size_mb: chunkSizeMb,
          chunk_count: chunkCount,
        },
      });
      setResult(res);
    } catch (e) {
      setResult({ success: false, message: String(e), output_paths: [] });
    } finally { setProcessing(false); }
  };

  return (
    <div className="page-container">
      <p className="page-description">{t('fileTools.split.desc')}</p>

      <div className="card">
        <div className="form-group">
          <label className="form-label">{t('common.selectFiles')}</label>
          <div className="flex gap-2">
            <input className="form-input" value={filePath} readOnly style={{ flex: 1 }} placeholder="..." />
            <button className="btn btn-secondary" onClick={handleSelectFile}>
              <FileText size={14} /> {t('common.selectFiles')}
            </button>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="tabs">
          <button className={`tab ${mode === 'size' ? 'active' : ''}`} onClick={() => setMode('size')}>
            {t('fileTools.split.bySize')}
          </button>
          <button className={`tab ${mode === 'count' ? 'active' : ''}`} onClick={() => setMode('count')}>
            {t('fileTools.split.byCount')}
          </button>
        </div>

        {mode === 'size' ? (
          <div className="form-group">
            <label className="form-label">{t('fileTools.split.chunkSize')} (MB)</label>
            <input className="form-input" type="number" min={1} value={chunkSizeMb} onChange={(e) => setChunkSizeMb(Number(e.target.value))} />
          </div>
        ) : (
          <div className="form-group">
            <label className="form-label">{t('fileTools.split.chunkCount')}</label>
            <input className="form-input" type="number" min={2} value={chunkCount} onChange={(e) => setChunkCount(Number(e.target.value))} />
          </div>
        )}

        <div className="form-group">
          <label className="form-label">{t('common.outputFolder')}</label>
          <div className="flex gap-2">
            <input className="form-input" value={outputDir} readOnly style={{ flex: 1 }} />
            <button className="btn btn-secondary" onClick={handleSelectOutput}>{t('common.selectFolder')}</button>
          </div>
        </div>
      </div>

      <div className="flex gap-2 mb-4">
        <button className="btn btn-primary btn-lg" onClick={handleProcess} disabled={!filePath || !outputDir || processing}>
          {processing ? <><span className="spinner" /> {t('common.processing')}</> : t('common.process')}
        </button>
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
