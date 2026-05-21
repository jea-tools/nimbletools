import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, Check } from 'lucide-react';

export default function Base64Page() {
  const { t } = useTranslation();
  const [input, setInput] = useState('');
  const [output, setOutput] = useState('');
  const [mode, setMode] = useState<'encode' | 'decode'>('encode');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const handleProcess = () => {
    setError('');
    try {
      if (mode === 'encode') {
        setOutput(btoa(unescape(encodeURIComponent(input))));
      } else {
        setOutput(decodeURIComponent(escape(atob(input))));
      }
    } catch {
      setError(t('textTools.formatter.invalid'));
      setOutput('');
    }
  };

  const handleCopy = async () => {
    if (!output) return;
    await navigator.clipboard.writeText(output);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSwap = () => {
    setMode((prev) => (prev === 'encode' ? 'decode' : 'encode'));
    setInput(output);
    setOutput('');
    setError('');
  };

  return (
    <div className="page-container">
      <p className="page-description">{t('textTools.base64.desc')}</p>

      <div className="card">
        <div className="flex items-center gap-2 mb-4">
          <div className="tabs" style={{ borderBottom: 'none', marginBottom: 0 }}>
            <button
              className={`tab ${mode === 'encode' ? 'active' : ''}`}
              onClick={() => { setMode('encode'); setOutput(''); setError(''); }}
            >
              {t('textTools.base64.encode')}
            </button>
            <button
              className={`tab ${mode === 'decode' ? 'active' : ''}`}
              onClick={() => { setMode('decode'); setOutput(''); setError(''); }}
            >
              {t('textTools.base64.decode')}
            </button>
          </div>
        </div>

        <div className="form-group">
          <label className="form-label">{t('textTools.base64.input')}</label>
          <textarea
            className="form-input"
            rows={6}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={mode === 'encode' ? 'Hello, World!' : 'SGVsbG8sIFdvcmxkIQ=='}
          />
        </div>

        <div className="flex gap-2 mb-4">
          <button className="btn btn-primary" onClick={handleProcess} disabled={!input.trim()}>
            {mode === 'encode' ? t('textTools.base64.encode') : t('textTools.base64.decode')}
          </button>
          <button className="btn btn-secondary" onClick={handleSwap} disabled={!output}>
            ⇄ Swap
          </button>
          <button className="btn btn-ghost" onClick={() => { setInput(''); setOutput(''); setError(''); }}>
            {t('common.clear')}
          </button>
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
            <textarea className="form-input select-text" rows={6} value={output} readOnly />
          </div>
        )}
      </div>
    </div>
  );
}
