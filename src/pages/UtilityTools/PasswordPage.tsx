import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, Check, RefreshCw, Shield } from 'lucide-react';

const CHARSETS = {
  uppercase: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  lowercase: 'abcdefghijklmnopqrstuvwxyz',
  digits: '0123456789',
  symbols: '!@#$%^&*()_+-=[]{}|;:,.<>?',
};

function generatePassword(length: number, options: Record<string, boolean>): string {
  let charset = '';
  if (options.uppercase) charset += CHARSETS.uppercase;
  if (options.lowercase) charset += CHARSETS.lowercase;
  if (options.digits) charset += CHARSETS.digits;
  if (options.symbols) charset += CHARSETS.symbols;
  if (!charset) charset = CHARSETS.lowercase + CHARSETS.digits;

  const array = new Uint32Array(length);
  crypto.getRandomValues(array);
  return Array.from(array, (v) => charset[v % charset.length]).join('');
}

function getStrength(pw: string): { level: number; label: string; color: string } {
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (pw.length >= 16) score++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^a-zA-Z0-9]/.test(pw)) score++;

  if (score <= 2) return { level: 1, label: 'Weak', color: 'var(--accent-error)' };
  if (score <= 4) return { level: 2, label: 'Medium', color: 'var(--accent-warning)' };
  return { level: 3, label: 'Strong', color: 'var(--accent-success)' };
}

export default function PasswordPage() {
  const { t } = useTranslation();
  const [length, setLength] = useState(16);
  const [options, setOptions] = useState({ uppercase: true, lowercase: true, digits: true, symbols: true });
  const [password, setPassword] = useState('');
  const [copied, setCopied] = useState(false);

  const generate = () => setPassword(generatePassword(length, options));

  const handleCopy = async () => {
    await navigator.clipboard.writeText(password);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const toggleOption = (key: string) => setOptions((prev) => ({ ...prev, [key]: !prev[key as keyof typeof prev] }));

  const strength = password ? getStrength(password) : null;

  return (
    <div className="page-container">
      <p className="page-description">{t('extraTools.password.desc')}</p>

      <div className="card">
        <div className="form-group">
          <label className="form-label">{t('extraTools.password.length')}: {length}</label>
          <input type="range" className="range-slider" min={4} max={64} value={length} onChange={(e) => setLength(Number(e.target.value))} />
          <div className="flex justify-between text-xs text-tertiary"><span>4</span><span>64</span></div>
        </div>

        <div className="flex gap-4 mb-4 flex-wrap">
          {Object.entries({ uppercase: 'A-Z', lowercase: 'a-z', digits: '0-9', symbols: '!@#' }).map(([key, label]) => (
            <label key={key} className="flex items-center gap-2">
              <div className="toggle-switch">
                <input type="checkbox" checked={options[key as keyof typeof options]} onChange={() => toggleOption(key)} />
                <span className="toggle-slider" />
              </div>
              <span className="text-sm">{label}</span>
            </label>
          ))}
        </div>

        <button className="btn btn-primary btn-lg w-full" onClick={generate}>
          <Shield size={16} /> {t('extraTools.password.generate')}
        </button>
      </div>

      {password && (
        <div className="card">
          <div className="flex items-center gap-3 mb-4">
            <input className="form-input text-mono select-text font-semibold" value={password} readOnly style={{ fontSize: 'var(--font-size-lg)', flex: 1 }} />
            <button className="btn btn-ghost" onClick={handleCopy}>
              {copied ? <Check size={16} /> : <Copy size={16} />}
            </button>
            <button className="btn btn-ghost" onClick={generate}><RefreshCw size={16} /></button>
          </div>
          {strength && (
            <div className="flex items-center gap-3">
              <div className="progress-bar" style={{ flex: 1 }}>
                <div className="progress-bar-fill" style={{ width: `${strength.level * 33.3}%`, background: strength.color }} />
              </div>
              <span className="text-sm font-medium" style={{ color: strength.color }}>{strength.label}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
