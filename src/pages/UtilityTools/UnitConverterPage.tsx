import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowRightLeft } from 'lucide-react';

interface UnitCategory {
  key: string;
  labelKey: string;
  units: { key: string; label: string; toBase: (v: number) => number; fromBase: (v: number) => number }[];
}

const CATEGORIES: UnitCategory[] = [
  {
    key: 'length', labelKey: 'utilityTools.unitConverter.length',
    units: [
      { key: 'mm', label: 'mm', toBase: (v) => v / 1000, fromBase: (v) => v * 1000 },
      { key: 'cm', label: 'cm', toBase: (v) => v / 100, fromBase: (v) => v * 100 },
      { key: 'm', label: 'm', toBase: (v) => v, fromBase: (v) => v },
      { key: 'km', label: 'km', toBase: (v) => v * 1000, fromBase: (v) => v / 1000 },
      { key: 'in', label: 'inch', toBase: (v) => v * 0.0254, fromBase: (v) => v / 0.0254 },
      { key: 'ft', label: 'feet', toBase: (v) => v * 0.3048, fromBase: (v) => v / 0.3048 },
      { key: 'yd', label: 'yard', toBase: (v) => v * 0.9144, fromBase: (v) => v / 0.9144 },
      { key: 'mi', label: 'mile', toBase: (v) => v * 1609.344, fromBase: (v) => v / 1609.344 },
    ],
  },
  {
    key: 'weight', labelKey: 'utilityTools.unitConverter.weight',
    units: [
      { key: 'mg', label: 'mg', toBase: (v) => v / 1e6, fromBase: (v) => v * 1e6 },
      { key: 'g', label: 'g', toBase: (v) => v / 1000, fromBase: (v) => v * 1000 },
      { key: 'kg', label: 'kg', toBase: (v) => v, fromBase: (v) => v },
      { key: 't', label: 'ton', toBase: (v) => v * 1000, fromBase: (v) => v / 1000 },
      { key: 'oz', label: 'oz', toBase: (v) => v * 0.0283495, fromBase: (v) => v / 0.0283495 },
      { key: 'lb', label: 'lb', toBase: (v) => v * 0.453592, fromBase: (v) => v / 0.453592 },
    ],
  },
  {
    key: 'temperature', labelKey: 'utilityTools.unitConverter.temperature',
    units: [
      { key: 'c', label: '°C', toBase: (v) => v, fromBase: (v) => v },
      { key: 'f', label: '°F', toBase: (v) => (v - 32) * 5 / 9, fromBase: (v) => v * 9 / 5 + 32 },
      { key: 'k', label: 'K', toBase: (v) => v - 273.15, fromBase: (v) => v + 273.15 },
    ],
  },
  {
    key: 'area', labelKey: 'utilityTools.unitConverter.area',
    units: [
      { key: 'sqmm', label: 'mm²', toBase: (v) => v / 1e6, fromBase: (v) => v * 1e6 },
      { key: 'sqcm', label: 'cm²', toBase: (v) => v / 1e4, fromBase: (v) => v * 1e4 },
      { key: 'sqm', label: 'm²', toBase: (v) => v, fromBase: (v) => v },
      { key: 'ha', label: 'ha', toBase: (v) => v * 1e4, fromBase: (v) => v / 1e4 },
      { key: 'sqkm', label: 'km²', toBase: (v) => v * 1e6, fromBase: (v) => v / 1e6 },
      { key: 'sqft', label: 'ft²', toBase: (v) => v * 0.092903, fromBase: (v) => v / 0.092903 },
      { key: 'acre', label: 'acre', toBase: (v) => v * 4046.86, fromBase: (v) => v / 4046.86 },
    ],
  },
  {
    key: 'volume', labelKey: 'utilityTools.unitConverter.volume',
    units: [
      { key: 'ml', label: 'mL', toBase: (v) => v / 1000, fromBase: (v) => v * 1000 },
      { key: 'l', label: 'L', toBase: (v) => v, fromBase: (v) => v },
      { key: 'gal', label: 'gal (US)', toBase: (v) => v * 3.78541, fromBase: (v) => v / 3.78541 },
      { key: 'qt', label: 'qt', toBase: (v) => v * 0.946353, fromBase: (v) => v / 0.946353 },
      { key: 'cup', label: 'cup', toBase: (v) => v * 0.236588, fromBase: (v) => v / 0.236588 },
      { key: 'floz', label: 'fl oz', toBase: (v) => v * 0.0295735, fromBase: (v) => v / 0.0295735 },
    ],
  },
  {
    key: 'speed', labelKey: 'utilityTools.unitConverter.speed',
    units: [
      { key: 'ms', label: 'm/s', toBase: (v) => v, fromBase: (v) => v },
      { key: 'kmh', label: 'km/h', toBase: (v) => v / 3.6, fromBase: (v) => v * 3.6 },
      { key: 'mph', label: 'mph', toBase: (v) => v * 0.44704, fromBase: (v) => v / 0.44704 },
      { key: 'kn', label: 'knot', toBase: (v) => v * 0.514444, fromBase: (v) => v / 0.514444 },
    ],
  },
  {
    key: 'data', labelKey: 'utilityTools.unitConverter.data',
    units: [
      { key: 'b', label: 'Bytes', toBase: (v) => v, fromBase: (v) => v },
      { key: 'kb', label: 'KB', toBase: (v) => v * 1024, fromBase: (v) => v / 1024 },
      { key: 'mb', label: 'MB', toBase: (v) => v * 1024 ** 2, fromBase: (v) => v / 1024 ** 2 },
      { key: 'gb', label: 'GB', toBase: (v) => v * 1024 ** 3, fromBase: (v) => v / 1024 ** 3 },
      { key: 'tb', label: 'TB', toBase: (v) => v * 1024 ** 4, fromBase: (v) => v / 1024 ** 4 },
    ],
  },
];

export default function UnitConverterPage() {
  const { t } = useTranslation();
  const [categoryIdx, setCategoryIdx] = useState(0);
  const [fromIdx, setFromIdx] = useState(0);
  const [toIdx, setToIdx] = useState(1);
  const [value, setValue] = useState('1');

  const category = CATEGORIES[categoryIdx];
  const fromUnit = category.units[fromIdx] || category.units[0];
  const toUnit = category.units[toIdx] || category.units[1];

  const numValue = parseFloat(value);
  const result = isNaN(numValue) ? '' : toUnit.fromBase(fromUnit.toBase(numValue));
  const formattedResult = typeof result === 'number'
    ? (Math.abs(result) < 0.001 || Math.abs(result) > 1e9 ? result.toExponential(6) : parseFloat(result.toFixed(10)).toString())
    : '';

  const handleSwap = () => {
    setFromIdx(toIdx);
    setToIdx(fromIdx);
  };

  const handleCategoryChange = (idx: number) => {
    setCategoryIdx(idx);
    setFromIdx(0);
    setToIdx(1);
  };

  return (
    <div className="page-container">
      <p className="page-description">{t('utilityTools.unitConverter.desc')}</p>

      {/* Category Tabs */}
      <div className="tabs" style={{ flexWrap: 'wrap' }}>
        {CATEGORIES.map((cat, idx) => (
          <button
            key={cat.key}
            className={`tab ${categoryIdx === idx ? 'active' : ''}`}
            onClick={() => handleCategoryChange(idx)}
          >
            {t(cat.labelKey)}
          </button>
        ))}
      </div>

      <div className="card">
        <div className="flex gap-4 items-end">
          {/* From */}
          <div style={{ flex: 1 }}>
            <div className="form-group">
              <label className="form-label">{t('utilityTools.unitConverter.from')}</label>
              <select
                className="form-input form-select"
                value={fromIdx}
                onChange={(e) => setFromIdx(Number(e.target.value))}
              >
                {category.units.map((u, i) => (
                  <option key={u.key} value={i}>{u.label}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <input
                className="form-input"
                type="number"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                style={{ fontSize: 'var(--font-size-xl)', fontWeight: 600 }}
              />
            </div>
          </div>

          {/* Swap Button */}
          <div style={{ paddingBottom: 'var(--space-4)' }}>
            <button className="btn btn-icon btn-secondary" onClick={handleSwap} title="Swap">
              <ArrowRightLeft size={16} />
            </button>
          </div>

          {/* To */}
          <div style={{ flex: 1 }}>
            <div className="form-group">
              <label className="form-label">{t('utilityTools.unitConverter.to')}</label>
              <select
                className="form-input form-select"
                value={toIdx}
                onChange={(e) => setToIdx(Number(e.target.value))}
              >
                {category.units.map((u, i) => (
                  <option key={u.key} value={i}>{u.label}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <input
                className="form-input select-text"
                type="text"
                value={formattedResult}
                readOnly
                style={{ fontSize: 'var(--font-size-xl)', fontWeight: 600, background: 'var(--bg-tertiary)' }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
