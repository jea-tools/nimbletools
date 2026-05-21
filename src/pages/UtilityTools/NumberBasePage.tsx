import { useState } from 'react';
import { useTranslation } from 'react-i18next';

const BASES = [
  { label: 'BIN', radix: 2, prefix: '0b', placeholder: '1010' },
  { label: 'OCT', radix: 8, prefix: '0o', placeholder: '12' },
  { label: 'DEC', radix: 10, prefix: '', placeholder: '10' },
  { label: 'HEX', radix: 16, prefix: '0x', placeholder: 'A' },
];

export default function NumberBasePage() {
  const { t } = useTranslation();
  const [values, setValues] = useState<Record<number, string>>({ 2: '', 8: '', 10: '', 16: '' });
  const [error, setError] = useState('');

  const handleChange = (radix: number, input: string) => {
    setError('');
    const cleaned = input.replace(/\s/g, '');
    const newValues: Record<number, string> = { ...values, [radix]: cleaned };

    if (!cleaned) {
      setValues({ 2: '', 8: '', 10: '', 16: '' });
      return;
    }

    const num = parseInt(cleaned, radix);
    if (isNaN(num)) {
      setError(`Invalid ${BASES.find((b) => b.radix === radix)?.label} number`);
      setValues(newValues);
      return;
    }

    for (const base of BASES) {
      if (base.radix !== radix) {
        newValues[base.radix] = num.toString(base.radix).toUpperCase();
      }
    }
    setValues(newValues);
  };

  return (
    <div className="page-container">
      <p className="page-description">{t('extraTools.numberBase.desc')}</p>

      <div className="card">
        {BASES.map((base) => (
          <div className="form-group" key={base.radix}>
            <label className="form-label">{base.label} (Base {base.radix})</label>
            <div className="flex items-center gap-2">
              {base.prefix && <span className="text-mono text-tertiary">{base.prefix}</span>}
              <input
                className="form-input text-mono"
                value={values[base.radix]}
                onChange={(e) => handleChange(base.radix, e.target.value)}
                placeholder={base.placeholder}
                style={{ flex: 1 }}
              />
            </div>
          </div>
        ))}
        {error && <div className="status-bar error">{error}</div>}
      </div>
    </div>
  );
}
