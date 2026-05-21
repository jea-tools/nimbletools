import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, Check, AlertCircle, CheckCircle } from 'lucide-react';

type FormatType = 'json' | 'xml';

function formatJson(input: string): { result: string; valid: boolean } {
  try {
    const parsed = JSON.parse(input);
    return { result: JSON.stringify(parsed, null, 2), valid: true };
  } catch {
    return { result: '', valid: false };
  }
}

function minifyJson(input: string): { result: string; valid: boolean } {
  try {
    return { result: JSON.stringify(JSON.parse(input)), valid: true };
  } catch {
    return { result: '', valid: false };
  }
}

function formatXml(input: string): { result: string; valid: boolean } {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(input, 'application/xml');
    const errorNode = doc.querySelector('parsererror');
    if (errorNode) return { result: '', valid: false };

    const serializer = new XMLSerializer();
    const raw = serializer.serializeToString(doc);

    // Simple XML pretty-print
    let formatted = '';
    let indent = 0;
    const lines = raw.replace(/></g, '>\n<').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('</')) indent--;
      formatted += '  '.repeat(Math.max(indent, 0)) + trimmed + '\n';
      if (trimmed.startsWith('<') && !trimmed.startsWith('</') && !trimmed.startsWith('<?') && !trimmed.endsWith('/>') && !trimmed.includes('</')) {
        indent++;
      }
    }
    return { result: formatted.trim(), valid: true };
  } catch {
    return { result: '', valid: false };
  }
}

function minifyXml(input: string): { result: string; valid: boolean } {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(input, 'application/xml');
    if (doc.querySelector('parsererror')) return { result: '', valid: false };
    return { result: new XMLSerializer().serializeToString(doc), valid: true };
  } catch {
    return { result: '', valid: false };
  }
}

export default function FormatterPage() {
  const { t } = useTranslation();
  const [input, setInput] = useState('');
  const [output, setOutput] = useState('');
  const [formatType, setFormatType] = useState<FormatType>('json');
  const [validity, setValidity] = useState<'valid' | 'invalid' | null>(null);
  const [copied, setCopied] = useState(false);

  const handleFormat = () => {
    const formatter = formatType === 'json' ? formatJson : formatXml;
    const { result, valid } = formatter(input);
    setOutput(valid ? result : '');
    setValidity(valid ? 'valid' : 'invalid');
  };

  const handleMinify = () => {
    const minifier = formatType === 'json' ? minifyJson : minifyXml;
    const { result, valid } = minifier(input);
    setOutput(valid ? result : '');
    setValidity(valid ? 'valid' : 'invalid');
  };

  const handleCopy = async () => {
    if (!output) return;
    await navigator.clipboard.writeText(output);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="page-container">
      <p className="page-description">{t('textTools.formatter.desc')}</p>

      <div className="card">
        <div className="tabs">
          <button className={`tab ${formatType === 'json' ? 'active' : ''}`} onClick={() => { setFormatType('json'); setOutput(''); setValidity(null); }}>
            JSON
          </button>
          <button className={`tab ${formatType === 'xml' ? 'active' : ''}`} onClick={() => { setFormatType('xml'); setOutput(''); setValidity(null); }}>
            XML
          </button>
        </div>

        <div className="form-group">
          <label className="form-label">{t('textTools.base64.input')}</label>
          <textarea
            className="form-input"
            rows={8}
            value={input}
            onChange={(e) => { setInput(e.target.value); setValidity(null); }}
            placeholder={formatType === 'json' ? '{"key": "value"}' : '<root><item>value</item></root>'}
          />
        </div>

        <div className="flex gap-2 mb-4">
          <button className="btn btn-primary" onClick={handleFormat} disabled={!input.trim()}>
            {t('textTools.formatter.format')}
          </button>
          <button className="btn btn-secondary" onClick={handleMinify} disabled={!input.trim()}>
            {t('textTools.formatter.minify')}
          </button>
          <button className="btn btn-ghost" onClick={() => { setInput(''); setOutput(''); setValidity(null); }}>
            {t('common.clear')}
          </button>
        </div>

        {validity && (
          <div className={`status-bar ${validity === 'valid' ? 'success' : 'error'}`}>
            {validity === 'valid' ? <CheckCircle size={14} /> : <AlertCircle size={14} />}
            {validity === 'valid' ? t('textTools.formatter.valid') : t('textTools.formatter.invalid')}
          </div>
        )}

        {output && (
          <div className="form-group mt-4">
            <div className="flex items-center justify-between mb-2">
              <label className="form-label" style={{ marginBottom: 0 }}>{t('textTools.base64.output')}</label>
              <button className="btn btn-ghost btn-sm" onClick={handleCopy}>
                {copied ? <Check size={14} /> : <Copy size={14} />}
                {copied ? t('common.copied') : t('common.copy')}
              </button>
            </div>
            <textarea className="form-input select-text" rows={10} value={output} readOnly />
          </div>
        )}
      </div>
    </div>
  );
}
