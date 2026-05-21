import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../components/ThemeProvider';
import { Sun, Moon, Monitor, Globe, Camera } from 'lucide-react';

const LANGUAGES = [
  { code: 'en-US', label: 'English' },
  { code: 'zh-CN', label: '简体中文' },
];

const SCREENSHOT_CONFIRM_KEY = 'nimble_screenshot_confirm_mode';

export default function SettingsPage() {
  const { t, i18n } = useTranslation();
  const { theme, toggleTheme } = useTheme();

  const [screenshotMode, setScreenshotMode] = useState(() => {
    return localStorage.getItem(SCREENSHOT_CONFIRM_KEY) || 'auto';
  });

  useEffect(() => {
    localStorage.setItem(SCREENSHOT_CONFIRM_KEY, screenshotMode);
  }, [screenshotMode]);

  return (
    <div className="page-container">
      <div className="card">
        <div className="card-title">{t('settings.general')}</div>

        {/* Theme */}
        <div className="flex items-center justify-between" style={{ padding: 'var(--space-3) 0', borderBottom: '1px solid var(--border-primary)' }}>
          <div className="flex items-center gap-3">
            {theme === 'light' ? <Sun size={18} /> : <Moon size={18} />}
            <span>{t('settings.theme')}</span>
          </div>
          <div className="flex gap-2">
            <button
              className={`btn btn-sm ${theme === 'light' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => theme !== 'light' && toggleTheme()}
            >
              <Sun size={14} /> {t('settings.light')}
            </button>
            <button
              className={`btn btn-sm ${theme === 'dark' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => theme !== 'dark' && toggleTheme()}
            >
              <Moon size={14} /> {t('settings.dark')}
            </button>
          </div>
        </div>

        {/* Language */}
        <div className="flex items-center justify-between" style={{ padding: 'var(--space-3) 0', borderBottom: '1px solid var(--border-primary)' }}>
          <div className="flex items-center gap-3">
            <Globe size={18} />
            <span>{t('settings.language')}</span>
          </div>
          <select
            className="form-input form-select"
            style={{ width: 'auto' }}
            value={i18n.language}
            onChange={(e) => i18n.changeLanguage(e.target.value)}
          >
            {LANGUAGES.map((lang) => (
              <option key={lang.code} value={lang.code}>{lang.label}</option>
            ))}
          </select>
        </div>

        {/* Screenshot confirm mode */}
        <div className="flex items-center justify-between" style={{ padding: 'var(--space-3) 0' }}>
          <div className="flex items-center gap-3">
            <Camera size={18} />
            <span>{t('settings.screenshotMode')}</span>
          </div>
          <select
            className="form-input form-select"
            style={{ width: 'auto' }}
            value={screenshotMode}
            onChange={(e) => setScreenshotMode(e.target.value)}
          >
            <option value="auto">{t('settings.screenshotAuto')}</option>
            <option value="dblclick">{t('settings.screenshotDblclick')}</option>
          </select>
        </div>
      </div>

      {/* About */}
      <div className="card">
        <div className="card-title">{t('settings.about')}</div>
        <div className="flex items-center gap-3" style={{ padding: 'var(--space-2) 0' }}>
          <Monitor size={18} className="text-tertiary" />
          <div>
            <p className="font-medium">NimbleTools</p>
            <p className="text-sm text-tertiary">{t('settings.version')}: 0.1.0</p>
          </div>
        </div>
        <p className="text-sm text-secondary mt-2">
          {t('app.description')}
        </p>
      </div>
    </div>
  );
}
