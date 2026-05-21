import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, Check } from 'lucide-react';

interface Stats {
  characters: number;
  charactersNoSpaces: number;
  words: number;
  lines: number;
  paragraphs: number;
  sentences: number;
  readTimeMinutes: number;
}

function analyze(text: string): Stats {
  const WORDS_PER_MINUTE = 250;
  const characters = text.length;
  const charactersNoSpaces = text.replace(/\s/g, '').length;
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const lines = text.trim() ? text.split('\n').length : 0;
  const paragraphs = text.trim() ? text.split(/\n\s*\n/).filter((p) => p.trim()).length : 0;
  const sentences = text.trim() ? (text.match(/[.!?。！？]+/g) || []).length : 0;
  const readTimeMinutes = Math.ceil(words / WORDS_PER_MINUTE);
  return { characters, charactersNoSpaces, words, lines, paragraphs, sentences, readTimeMinutes };
}

export default function TextStatsPage() {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const [copied, setCopied] = useState(false);
  const stats = useMemo(() => analyze(text), [text]);

  const handleCopy = async () => {
    const report = Object.entries(stats).map(([k, v]) => `${k}: ${v}`).join('\n');
    await navigator.clipboard.writeText(report);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const statCards = [
    { label: t('extraTools.textStats.characters'), value: stats.characters },
    { label: t('extraTools.textStats.charsNoSpace'), value: stats.charactersNoSpaces },
    { label: t('extraTools.textStats.words'), value: stats.words },
    { label: t('extraTools.textStats.lines'), value: stats.lines },
    { label: t('extraTools.textStats.paragraphs'), value: stats.paragraphs },
    { label: t('extraTools.textStats.sentences'), value: stats.sentences },
    { label: t('extraTools.textStats.readTime'), value: `~${stats.readTimeMinutes} min` },
  ];

  return (
    <div className="page-container">
      <p className="page-description">{t('extraTools.textStats.desc')}</p>

      <div className="card">
        <textarea
          className="form-input"
          rows={10}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Paste or type your text here..."
          style={{ fontSize: 'var(--font-size-base)' }}
        />
      </div>

      <div className="flex items-center justify-between mb-4">
        <span className="text-sm text-secondary">Statistics</span>
        <button className="btn btn-ghost btn-sm" onClick={handleCopy}>
          {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? t('common.copied') : 'Copy Stats'}
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 'var(--space-3)' }}>
        {statCards.map((item) => (
          <div key={item.label} className="card" style={{ textAlign: 'center', padding: 'var(--space-4)' }}>
            <div style={{ fontSize: 'var(--font-size-2xl)', fontWeight: 700, color: 'var(--accent-primary)' }}>{item.value}</div>
            <div className="text-sm text-secondary mt-1">{item.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
