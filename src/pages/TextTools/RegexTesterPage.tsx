import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

export default function RegexTesterPage() {
  const { t } = useTranslation();
  const [pattern, setPattern] = useState('');
  const [flags, setFlags] = useState('gi');
  const [testText, setTestText] = useState('');
  const [error, setError] = useState('');

  const matches = useMemo(() => {
    if (!pattern || !testText) return [];
    setError('');
    try {
      const re = new RegExp(pattern, flags);
      const results: { start: number; end: number; match: string; groups: string[] }[] = [];
      let m;
      if (flags.includes('g')) {
        while ((m = re.exec(testText)) !== null) {
          results.push({ start: m.index, end: m.index + m[0].length, match: m[0], groups: m.slice(1) });
          if (!m[0]) break; // 防止空匹配死循环
        }
      } else {
        m = re.exec(testText);
        if (m) results.push({ start: m.index, end: m.index + m[0].length, match: m[0], groups: m.slice(1) });
      }
      return results;
    } catch (e) {
      setError(String(e));
      return [];
    }
  }, [pattern, flags, testText]);

  // 高亮文本
  const highlightedHtml = useMemo(() => {
    if (matches.length === 0 || !testText) return '';
    let html = '';
    let lastIdx = 0;
    for (const m of matches) {
      html += escapeHtml(testText.slice(lastIdx, m.start));
      html += `<mark style="background:var(--accent-primary-light);color:var(--accent-primary);padding:1px 2px;border-radius:2px">${escapeHtml(m.match)}</mark>`;
      lastIdx = m.end;
    }
    html += escapeHtml(testText.slice(lastIdx));
    return html;
  }, [matches, testText]);

  return (
    <div className="page-container">
      <p className="page-description">{t('extraTools.regex.desc')}</p>

      <div className="card">
        <div className="flex gap-3 mb-4">
          <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
            <label className="form-label">Pattern</label>
            <div className="flex gap-2">
              <span className="text-mono text-secondary" style={{ lineHeight: '36px' }}>/</span>
              <input className="form-input text-mono" value={pattern} onChange={(e) => setPattern(e.target.value)} placeholder="[a-z]+" style={{ flex: 1 }} />
              <span className="text-mono text-secondary" style={{ lineHeight: '36px' }}>/</span>
              <input className="form-input text-mono" value={flags} onChange={(e) => setFlags(e.target.value)} style={{ width: 60 }} />
            </div>
          </div>
        </div>

        {error && <div className="status-bar error mb-4">{error}</div>}

        <div className="form-group">
          <label className="form-label">Test String</label>
          <textarea className="form-input" rows={5} value={testText} onChange={(e) => setTestText(e.target.value)}
            placeholder="Enter text to test against..." />
        </div>
      </div>

      {testText && pattern && !error && (
        <>
          <div className="card">
            <div className="card-title">{t('extraTools.regex.matches')} ({matches.length})</div>
            <div
              className="form-input select-text"
              style={{ minHeight: 60, whiteSpace: 'pre-wrap', wordBreak: 'break-all', lineHeight: 1.8 }}
              dangerouslySetInnerHTML={{ __html: highlightedHtml }}
            />
          </div>

          {matches.length > 0 && (
            <div className="card">
              <div className="card-title">Match Details</div>
              <div style={{ maxHeight: 200, overflowY: 'auto' }}>
                {matches.map((m, i) => (
                  <div key={i} className="flex gap-4 text-sm" style={{ padding: 'var(--space-1) 0', borderBottom: '1px solid var(--border-primary)' }}>
                    <span className="text-tertiary" style={{ width: 30 }}>#{i + 1}</span>
                    <span className="text-mono font-medium" style={{ color: 'var(--accent-primary)' }}>{m.match}</span>
                    <span className="text-tertiary">@{m.start}</span>
                    {m.groups.length > 0 && (
                      <span className="text-secondary">Groups: {m.groups.map((g, j) => `$${j + 1}="${g}"`).join(', ')}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
