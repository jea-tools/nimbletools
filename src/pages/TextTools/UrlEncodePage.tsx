import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, Check } from 'lucide-react';

export default function UrlEncodePage() {
  const { t } = useTranslation();
  const [input, setInput] = useState('');
  const [output, setOutput] = useState('');
  const [mode, setMode] = useState<'encode' | 'decode'>('encode');
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');

  const handleProcess = () => {
    setError('');
    try {
      setOutput(mode === 'encode' ? encodeURIComponent(input) : decodeURIComponent(input));
    } catch {
      setError('Invalid input');
      setOutput('');
    }
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(output);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="page-container">
      <p className="page-description">{t('extraTools.urlEncode.desc')}</p>

      <div className="card">
        <div className="tabs" style={{ borderBottom: 'none', marginBottom: 'var(--space-4)' }}>
          <button className={`tab ${mode === 'encode' ? 'active' : ''}`} onClick={() => { setMode('encode'); setOutput(''); setError(''); }}>
            Encode
          </button>
          <button className={`tab ${mode === 'decode' ? 'active' : ''}`} onClick={() => { setMode('decode'); setOutput(''); setError(''); }}>
            Decode
          </button>
        </div>

        <div className="form-group">
          <label className="form-label">{t('textTools.base64.input')}</label>
          <textarea className="form-input" rows={4} value={input} onChange={(e) => setInput(e.target.value)}
            placeholder={mode === 'encode' ? 'Hello World & 你好' : 'Hello%20World%20%26%20%E4%BD%A0%E5%A5%BD'} />
        </div>

        <div className="flex gap-2 mb-4">
          <button className="btn btn-primary" onClick={handleProcess} disabled={!input.trim()}>
            {mode === 'encode' ? 'Encode' : 'Decode'}
          </button>
          <button className="btn btn-ghost" onClick={() => { setInput(''); setOutput(''); setError(''); }}>{t('common.clear')}</button>
        </div>

        {error && <div className="status-bar error">{error}</div>}

        {output && (
          <div className="form-group">
            <div className="flex items-center justify-between mb-2">
              <label className="form-label" style={{ marginBottom: 0 }}>{t('textTools.base64.output')}</label>
              <button className="btn btn-ghost btn-sm" onClick={handleCopy}>
                {copied ? <Check size={14} /> : <Copy size={14} />}
                {copied ? t('common.copied') : t('common.copy')}
              </button>
            </div>
            <textarea className="form-input select-text" rows={4} value={output} readOnly />
          </div>
        )}
      </div>
    </div>
  );
}
