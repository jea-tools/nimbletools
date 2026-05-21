import { useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { QRCodeSVG } from 'qrcode.react';
import { Download, Copy, Check, Wifi } from 'lucide-react';

type Mode = 'text' | 'wifi';
type Encryption = 'WPA' | 'WEP' | 'nopass';

export default function QrCodePage() {
  const { t } = useTranslation();
  const [mode, setMode] = useState<Mode>('text');
  const [text, setText] = useState('');
  const [ssid, setSsid] = useState('');
  const [password, setPassword] = useState('');
  const [encryption, setEncryption] = useState<Encryption>('WPA');
  const [copied, setCopied] = useState(false);
  const svgRef = useRef<HTMLDivElement>(null);

  const qrValue = mode === 'text'
    ? text
    : `WIFI:T:${encryption};S:${ssid};P:${password};;`;

  const hasContent = mode === 'text' ? text.trim().length > 0 : ssid.trim().length > 0;

  const handleSavePng = () => {
    if (!svgRef.current) return;
    const svgEl = svgRef.current.querySelector('svg');
    if (!svgEl) return;

    const canvas = document.createElement('canvas');
    const size = 1024;
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;

    const svgData = new XMLSerializer().serializeToString(svgEl);
    const img = new window.Image();
    img.onload = () => {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, size, size);
      ctx.drawImage(img, 0, 0, size, size);
      const link = document.createElement('a');
      link.download = 'qrcode.png';
      link.href = canvas.toDataURL('image/png');
      link.click();
    };
    img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgData)));
  };

  const handleCopy = async () => {
    if (!svgRef.current) return;
    const svgEl = svgRef.current.querySelector('svg');
    if (!svgEl) return;

    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d')!;

    const svgData = new XMLSerializer().serializeToString(svgEl);
    const img = new window.Image();
    img.onload = async () => {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, 512, 512);
      ctx.drawImage(img, 0, 0, 512, 512);
      canvas.toBlob(async (blob) => {
        if (!blob) return;
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }, 'image/png');
    };
    img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgData)));
  };

  return (
    <div className="page-container">
      <p className="page-description">{t('utilityTools.qrcode.desc')}</p>

      <div className="flex gap-6" style={{ alignItems: 'flex-start' }}>
        {/* Left: Input */}
        <div className="card" style={{ flex: 1 }}>
          <div className="tabs">
            <button className={`tab ${mode === 'text' ? 'active' : ''}`} onClick={() => setMode('text')}>
              {t('utilityTools.qrcode.text')}
            </button>
            <button className={`tab ${mode === 'wifi' ? 'active' : ''}`} onClick={() => setMode('wifi')}>
              <Wifi size={14} style={{ marginRight: 4 }} />
              {t('utilityTools.qrcode.wifi')}
            </button>
          </div>

          {mode === 'text' ? (
            <div className="form-group">
              <textarea
                className="form-input"
                rows={4}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="https://example.com"
              />
            </div>
          ) : (
            <>
              <div className="form-group">
                <label className="form-label">{t('utilityTools.qrcode.ssid')}</label>
                <input className="form-input" value={ssid} onChange={(e) => setSsid(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">{t('utilityTools.qrcode.password')}</label>
                <input className="form-input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">{t('utilityTools.qrcode.encryption')}</label>
                <select className="form-input form-select" value={encryption} onChange={(e) => setEncryption(e.target.value as Encryption)}>
                  <option value="WPA">WPA/WPA2</option>
                  <option value="WEP">WEP</option>
                  <option value="nopass">None</option>
                </select>
              </div>
            </>
          )}
        </div>

        {/* Right: QR Preview */}
        <div className="card" style={{ width: 280, textAlign: 'center' }}>
          <div
            ref={svgRef}
            style={{
              padding: 'var(--space-4)',
              background: '#ffffff',
              borderRadius: 'var(--radius-md)',
              display: 'inline-block',
              marginBottom: 'var(--space-4)',
            }}
          >
            {hasContent ? (
              <QRCodeSVG value={qrValue} size={200} level="M" />
            ) : (
              <div style={{ width: 200, height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ccc' }}>
                QR Code
              </div>
            )}
          </div>

          <div className="flex gap-2 justify-center">
            <button className="btn btn-primary btn-sm" onClick={handleSavePng} disabled={!hasContent}>
              <Download size={14} /> {t('utilityTools.qrcode.savePng')}
            </button>
            <button className="btn btn-secondary btn-sm" onClick={handleCopy} disabled={!hasContent}>
              {copied ? <Check size={14} /> : <Copy size={14} />}
              {copied ? t('common.copied') : t('common.copy')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
