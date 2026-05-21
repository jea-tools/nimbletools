import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, Check, RefreshCw } from 'lucide-react';

export default function TimestampPage() {
  const { t } = useTranslation();
  const [currentTs, setCurrentTs] = useState(Math.floor(Date.now() / 1000));
  const [tsInput, setTsInput] = useState('');
  const [tsUnit, setTsUnit] = useState<'s' | 'ms'>('s');
  const [dateResult, setDateResult] = useState('');
  const [dateInput, setDateInput] = useState('');
  const [tsResult, setTsResult] = useState('');
  const [copied, setCopied] = useState<string | null>(null);

  // 实时更新当前时间戳
  useEffect(() => {
    const timer = setInterval(() => setCurrentTs(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(timer);
  }, []);

  const handleTsToDate = useCallback(() => {
    const num = parseInt(tsInput, 10);
    if (isNaN(num)) { setDateResult(''); return; }
    const ms = tsUnit === 's' ? num * 1000 : num;
    const date = new Date(ms);
    if (isNaN(date.getTime())) { setDateResult('Invalid'); return; }
    setDateResult(date.toLocaleString() + ' (' + date.toISOString() + ')');
  }, [tsInput, tsUnit]);

  useEffect(() => { if (tsInput) handleTsToDate(); }, [tsInput, tsUnit, handleTsToDate]);

  const handleDateToTs = () => {
    const date = new Date(dateInput);
    if (isNaN(date.getTime())) { setTsResult('Invalid'); return; }
    const ts = tsUnit === 's' ? Math.floor(date.getTime() / 1000) : date.getTime();
    setTsResult(ts.toString());
  };

  const handleCopy = async (text: string, key: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <div className="page-container">
      <p className="page-description">{t('utilityTools.timestamp.desc')}</p>

      {/* Current Timestamp */}
      <div className="card">
        <div className="card-title">{t('utilityTools.timestamp.currentTime')}</div>
        <div className="flex items-center gap-4">
          <span className="text-mono" style={{ fontSize: 'var(--font-size-2xl)', fontWeight: 700, color: 'var(--accent-primary)' }}>
            {currentTs}
          </span>
          <span className="text-secondary text-sm">({t('utilityTools.timestamp.seconds')})</span>
          <button className="btn btn-ghost btn-sm" onClick={() => handleCopy(currentTs.toString(), 'current')}>
            {copied === 'current' ? <Check size={14} /> : <Copy size={14} />}
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => setCurrentTs(Math.floor(Date.now() / 1000))}>
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {/* Unit Toggle */}
      <div className="flex gap-2 mb-4">
        <div className="tabs" style={{ borderBottom: 'none' }}>
          <button className={`tab ${tsUnit === 's' ? 'active' : ''}`} onClick={() => setTsUnit('s')}>
            {t('utilityTools.timestamp.seconds')}
          </button>
          <button className={`tab ${tsUnit === 'ms' ? 'active' : ''}`} onClick={() => setTsUnit('ms')}>
            {t('utilityTools.timestamp.milliseconds')}
          </button>
        </div>
      </div>

      <div className="flex gap-4" style={{ alignItems: 'flex-start' }}>
        {/* Timestamp → Date */}
        <div className="card" style={{ flex: 1 }}>
          <div className="card-title">{t('utilityTools.timestamp.toDate')}</div>
          <div className="form-group">
            <input
              className="form-input"
              type="number"
              value={tsInput}
              onChange={(e) => setTsInput(e.target.value)}
              placeholder={currentTs.toString()}
            />
          </div>
          {dateResult && (
            <div className="flex items-center gap-2 mt-2">
              <span className="text-sm select-text" style={{ wordBreak: 'break-all' }}>{dateResult}</span>
              <button className="btn btn-ghost btn-sm" onClick={() => handleCopy(dateResult, 'date')}>
                {copied === 'date' ? <Check size={12} /> : <Copy size={12} />}
              </button>
            </div>
          )}
        </div>

        {/* Date → Timestamp */}
        <div className="card" style={{ flex: 1 }}>
          <div className="card-title">{t('utilityTools.timestamp.toTimestamp')}</div>
          <div className="form-group">
            <input
              className="form-input"
              type="datetime-local"
              value={dateInput}
              onChange={(e) => setDateInput(e.target.value)}
              step="1"
            />
          </div>
          <button className="btn btn-primary btn-sm" onClick={handleDateToTs} disabled={!dateInput}>
            {t('common.process')}
          </button>
          {tsResult && (
            <div className="flex items-center gap-2 mt-2">
              <span className="text-mono font-semibold">{tsResult}</span>
              <button className="btn btn-ghost btn-sm" onClick={() => handleCopy(tsResult, 'ts')}>
                {copied === 'ts' ? <Check size={12} /> : <Copy size={12} />}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
