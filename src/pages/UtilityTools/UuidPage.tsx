import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, Check, RefreshCw } from 'lucide-react';

function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export default function UuidPage() {
  const { t } = useTranslation();
  const [count, setCount] = useState(5);
  const [uuids, setUuids] = useState<string[]>([]);
  const [uppercase, setUppercase] = useState(false);
  const [noDashes, setNoDashes] = useState(false);
  const [copied, setCopied] = useState(false);

  const generate = () => {
    const list = Array.from({ length: count }, () => {
      let uuid = generateUUID();
      if (noDashes) uuid = uuid.replace(/-/g, '');
      if (uppercase) uuid = uuid.toUpperCase();
      return uuid;
    });
    setUuids(list);
  };

  const handleCopyAll = async () => {
    await navigator.clipboard.writeText(uuids.join('\n'));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="page-container">
      <p className="page-description">{t('extraTools.uuid.desc')}</p>

      <div className="card">
        <div className="flex gap-4 items-end mb-4">
          <div className="form-group" style={{ marginBottom: 0, width: 120 }}>
            <label className="form-label">{t('extraTools.uuid.count')}</label>
            <input className="form-input" type="number" min={1} max={100} value={count} onChange={(e) => setCount(Number(e.target.value))} />
          </div>
          <label className="flex items-center gap-2">
            <div className="toggle-switch"><input type="checkbox" checked={uppercase} onChange={(e) => setUppercase(e.target.checked)} /><span className="toggle-slider" /></div>
            <span className="text-sm">A-F</span>
          </label>
          <label className="flex items-center gap-2">
            <div className="toggle-switch"><input type="checkbox" checked={noDashes} onChange={(e) => setNoDashes(e.target.checked)} /><span className="toggle-slider" /></div>
            <span className="text-sm">{t('extraTools.uuid.noDashes')}</span>
          </label>
          <button className="btn btn-primary" onClick={generate}>
            <RefreshCw size={14} /> {t('extraTools.uuid.generate')}
          </button>
        </div>

        {uuids.length > 0 && (
          <>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-secondary">{uuids.length} UUIDs</span>
              <button className="btn btn-ghost btn-sm" onClick={handleCopyAll}>
                {copied ? <Check size={14} /> : <Copy size={14} />}
                {copied ? t('common.copied') : t('common.copy')}
              </button>
            </div>
            <textarea className="form-input text-mono select-text" rows={Math.min(uuids.length, 10)} value={uuids.join('\n')} readOnly />
          </>
        )}
      </div>
    </div>
  );
}
