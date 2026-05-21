import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { FileText, Hash, Copy, Check } from 'lucide-react';

interface HashResult {
  success: boolean;
  md5: string; sha1: string; sha256: string; sha512: string;
  message: string;
}

export default function HashPage() {
  const { t } = useTranslation();
  const [mode, setMode] = useState<'text' | 'file'>('text');
  const [textInput, setTextInput] = useState('');
  const [filePath, setFilePath] = useState('');
  const [result, setResult] = useState<HashResult | null>(null);
  const [processing, setProcessing] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const handleHashText = async () => {
    if (!textInput.trim()) return;
    setProcessing(true);
    try {
      const res = await invoke<HashResult>('calculate_text_hash', { text: textInput });
      setResult(res);
    } catch (e) {
      setResult({ success: false, md5: '', sha1: '', sha256: '', sha512: '', message: String(e) });
    } finally { setProcessing(false); }
  };

  const handleSelectFile = async () => {
    const selected = await open({ multiple: false });
    if (selected) {
      setFilePath(selected as string);
      setProcessing(true);
      try {
        const res = await invoke<HashResult>('calculate_file_hash', { filePath: selected });
        setResult(res);
      } catch (e) {
        setResult({ success: false, md5: '', sha1: '', sha256: '', sha512: '', message: String(e) });
      } finally { setProcessing(false); }
    }
  };

  const handleCopy = async (value: string, key: string) => {
    await navigator.clipboard.writeText(value);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  };

  const hashRows = result && result.success ? [
    { label: 'MD5', value: result.md5 },
    { label: 'SHA-1', value: result.sha1 },
    { label: 'SHA-256', value: result.sha256 },
    { label: 'SHA-512', value: result.sha512 },
  ] : [];

  return (
    <div className="page-container">
      <p className="page-description">{t('extraTools.hash.desc')}</p>

      <div className="card">
        <div className="tabs">
          <button className={`tab ${mode === 'text' ? 'active' : ''}`} onClick={() => { setMode('text'); setResult(null); }}>
            {t('textTools.base64.textMode')}
          </button>
          <button className={`tab ${mode === 'file' ? 'active' : ''}`} onClick={() => { setMode('file'); setResult(null); }}>
            {t('textTools.base64.fileMode')}
          </button>
        </div>

        {mode === 'text' ? (
          <>
            <div className="form-group">
              <textarea className="form-input" rows={4} value={textInput} onChange={(e) => setTextInput(e.target.value)} placeholder="Enter text..." />
            </div>
            <button className="btn btn-primary" onClick={handleHashText} disabled={!textInput.trim() || processing}>
              {processing ? <><span className="spinner" /> {t('common.processing')}</> : <><Hash size={14} /> {t('common.process')}</>}
            </button>
          </>
        ) : (
          <>
            <div className="form-group">
              <div className="flex gap-2">
                <input className="form-input" value={filePath} readOnly style={{ flex: 1 }} placeholder="..." />
                <button className="btn btn-secondary" onClick={handleSelectFile} disabled={processing}>
                  <FileText size={14} /> {t('common.selectFiles')}
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {result && !result.success && (
        <div className="status-bar error">{result.message}</div>
      )}

      {hashRows.length > 0 && (
        <div className="card">
          {hashRows.map((row) => (
            <div key={row.label} className="flex items-center gap-3" style={{ padding: 'var(--space-2) 0', borderBottom: '1px solid var(--border-primary)' }}>
              <span className="form-label font-semibold" style={{ width: 60, marginBottom: 0, flexShrink: 0 }}>{row.label}</span>
              <input className="form-input text-mono select-text text-xs" value={row.value} readOnly style={{ flex: 1 }} />
              <button className="btn btn-ghost btn-sm" onClick={() => handleCopy(row.value, row.label)}>
                {copied === row.label ? <Check size={14} /> : <Copy size={14} />}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
