import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pipette, Copy, Check, Trash2 } from 'lucide-react';

interface ColorEntry {
  hex: string;
  rgb: string;
  hsl: string;
}

function hexToRgb(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return [r, g, b];
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, Math.round(l * 100)];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
}

const MAX_HISTORY = 10;

export default function ColorPickerPage() {
  const { t } = useTranslation();
  const [currentColor, setCurrentColor] = useState('#0064dc');
  const [history, setHistory] = useState<ColorEntry[]>([]);
  const [copied, setCopied] = useState<string | null>(null);

  const handleColorChange = (hex: string) => {
    setCurrentColor(hex);
    const [r, g, b] = hexToRgb(hex);
    const [h, s, l] = rgbToHsl(r, g, b);
    const entry: ColorEntry = {
      hex,
      rgb: `rgb(${r}, ${g}, ${b})`,
      hsl: `hsl(${h}, ${s}%, ${l}%)`,
    };
    setHistory((prev) => {
      const filtered = prev.filter((e) => e.hex !== hex);
      return [entry, ...filtered].slice(0, MAX_HISTORY);
    });
  };

  const handleCopy = async (text: string, key: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  };

  const [r, g, b] = hexToRgb(currentColor);
  const [h, s, l] = rgbToHsl(r, g, b);

  return (
    <div className="page-container">
      <p className="page-description">{t('utilityTools.colorPicker.desc')}</p>

      <div className="flex gap-6" style={{ alignItems: 'flex-start' }}>
        {/* Color Input & Display */}
        <div className="card" style={{ flex: 1 }}>
          <div className="flex items-center gap-4 mb-4">
            <div style={{
              width: 80, height: 80, borderRadius: 'var(--radius-lg)',
              background: currentColor, border: '2px solid var(--border-primary)',
              boxShadow: `0 4px 20px ${currentColor}40`,
            }} />
            <div>
              <input
                type="color"
                value={currentColor}
                onChange={(e) => handleColorChange(e.target.value)}
                style={{ width: 48, height: 48, border: 'none', cursor: 'pointer', borderRadius: 'var(--radius-md)', padding: 0 }}
              />
              <p className="text-xs text-tertiary mt-2">
                <Pipette size={12} style={{ display: 'inline', marginRight: 4 }} />
                {t('utilityTools.colorPicker.pick')}
              </p>
            </div>
          </div>

          {/* Color Values */}
          <div className="flex flex-col gap-3">
            {[
              { label: t('utilityTools.colorPicker.hex'), value: currentColor.toUpperCase(), key: 'hex' },
              { label: t('utilityTools.colorPicker.rgb'), value: `rgb(${r}, ${g}, ${b})`, key: 'rgb' },
              { label: t('utilityTools.colorPicker.hsl'), value: `hsl(${h}, ${s}%, ${l}%)`, key: 'hsl' },
            ].map((item) => (
              <div key={item.key} className="flex items-center gap-3">
                <span className="form-label" style={{ width: 40, marginBottom: 0, flexShrink: 0 }}>{item.label}</span>
                <input className="form-input text-mono select-text" value={item.value} readOnly style={{ flex: 1 }} />
                <button className="btn btn-ghost btn-sm" onClick={() => handleCopy(item.value, item.key)}>
                  {copied === item.key ? <Check size={14} /> : <Copy size={14} />}
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Color History */}
        <div className="card" style={{ width: 260 }}>
          <div className="flex items-center justify-between mb-4">
            <div className="card-title" style={{ marginBottom: 0 }}>{t('utilityTools.colorPicker.history')}</div>
            {history.length > 0 && (
              <button className="btn btn-ghost btn-sm" onClick={() => setHistory([])}>
                <Trash2 size={12} />
              </button>
            )}
          </div>
          {history.length === 0 ? (
            <p className="text-sm text-tertiary text-center" style={{ padding: 'var(--space-4)' }}>
              —
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {history.map((entry) => (
                <button
                  key={entry.hex}
                  onClick={() => setCurrentColor(entry.hex)}
                  title={entry.hex}
                  style={{
                    width: 36, height: 36, borderRadius: 'var(--radius-md)',
                    background: entry.hex, border: currentColor === entry.hex ? '2px solid var(--accent-primary)' : '2px solid var(--border-primary)',
                    cursor: 'pointer', transition: 'transform var(--transition-fast)',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.transform = 'scale(1.15)')}
                  onMouseLeave={(e) => (e.currentTarget.style.transform = 'scale(1)')}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
