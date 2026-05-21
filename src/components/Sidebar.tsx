import { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useTheme } from './ThemeProvider';
import {
  Image, FileText, Type, Wrench, Camera, Settings,
  ChevronRight, Sun, Moon, Zap,
  ArrowRightLeft, Maximize2, Minimize2, Layers, Droplets,
  Scissors, Merge, PenTool,
  ScanText, Binary, Braces, Link, Regex, BarChart3,
  QrCode, Ruler, Pipette, Clock, Hash, Fingerprint, KeyRound, ToggleLeft,
  ClipboardList, Send,
} from 'lucide-react';

interface NavGroupConfig {
  key: string;
  labelKey: string;
  icon: React.ReactNode;
  items: { path: string; labelKey: string; icon: React.ReactNode }[];
}

const NAV_GROUPS: NavGroupConfig[] = [
  {
    key: 'image',
    labelKey: 'nav.imageTools',
    icon: <Image size={16} />,
    items: [
      { path: '/image/convert', labelKey: 'nav.formatConvert', icon: <ArrowRightLeft size={16} /> },
      { path: '/image/resize', labelKey: 'nav.resize', icon: <Maximize2 size={16} /> },
      { path: '/image/compress', labelKey: 'nav.compress', icon: <Minimize2 size={16} /> },
      { path: '/image/merge', labelKey: 'nav.merge', icon: <Layers size={16} /> },
      { path: '/image/watermark', labelKey: 'nav.watermark', icon: <Droplets size={16} /> },
    ],
  },
  {
    key: 'file',
    labelKey: 'nav.fileTools',
    icon: <FileText size={16} />,
    items: [
      { path: '/file/split', labelKey: 'nav.fileSplit', icon: <Scissors size={16} /> },
      { path: '/file/merge', labelKey: 'nav.fileMerge', icon: <Merge size={16} /> },
      { path: '/file/rename', labelKey: 'nav.batchRename', icon: <PenTool size={16} /> },
    ],
  },
  {
    key: 'text',
    labelKey: 'nav.textTools',
    icon: <Type size={16} />,
    items: [
      { path: '/text/ocr', labelKey: 'nav.ocr', icon: <ScanText size={16} /> },
      { path: '/text/base64', labelKey: 'nav.base64', icon: <Binary size={16} /> },
      { path: '/text/formatter', labelKey: 'nav.jsonXml', icon: <Braces size={16} /> },
      { path: '/text/url-encode', labelKey: 'nav.urlEncode', icon: <Link size={16} /> },
      { path: '/text/regex', labelKey: 'nav.regex', icon: <Regex size={16} /> },
      { path: '/text/stats', labelKey: 'nav.textStats', icon: <BarChart3 size={16} /> },
    ],
  },
  {
    key: 'utility',
    labelKey: 'nav.utilityTools',
    icon: <Wrench size={16} />,
    items: [
      { path: '/utility/qrcode', labelKey: 'nav.qrcode', icon: <QrCode size={16} /> },
      { path: '/utility/unit-converter', labelKey: 'nav.unitConverter', icon: <Ruler size={16} /> },
      { path: '/utility/color-picker', labelKey: 'nav.colorPicker', icon: <Pipette size={16} /> },
      { path: '/utility/timestamp', labelKey: 'nav.timestamp', icon: <Clock size={16} /> },
      { path: '/utility/hash', labelKey: 'nav.hash', icon: <Hash size={16} /> },
      { path: '/utility/uuid', labelKey: 'nav.uuid', icon: <Fingerprint size={16} /> },
      { path: '/utility/password', labelKey: 'nav.password', icon: <KeyRound size={16} /> },
      { path: '/utility/number-base', labelKey: 'nav.numberBase', icon: <ToggleLeft size={16} /> },
      { path: '/utility/curl', labelKey: 'nav.curl', icon: <Send size={16} /> },
      { path: '/utility/clipboard', labelKey: 'nav.clipboard', icon: <ClipboardList size={16} /> },
    ],
  },
  {
    key: 'screenshot',
    labelKey: 'nav.screenshot',
    icon: <Camera size={16} />,
    items: [
      { path: '/screenshot/capture', labelKey: 'nav.capture', icon: <Camera size={16} /> },
    ],
  },
];

export default function Sidebar() {
  const { t } = useTranslation();
  const { theme, toggleTheme } = useTheme();
  const location = useLocation();

  // 根据当前路由自动展开对应分组
  const getInitialExpanded = (): Record<string, boolean> => {
    const expanded: Record<string, boolean> = {};
    for (const group of NAV_GROUPS) {
      expanded[group.key] = group.items.some((item) => location.pathname.startsWith(item.path));
    }
    // 默认展开第一个
    if (!Object.values(expanded).some(Boolean)) {
      expanded[NAV_GROUPS[0].key] = true;
    }
    return expanded;
  };

  const [expanded, setExpanded] = useState<Record<string, boolean>>(getInitialExpanded);

  const toggleGroup = (key: string) => {
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="app-logo">
          <Zap size={14} />
        </div>
        <span className="app-title">NimbleTools</span>
      </div>

      <nav className="sidebar-nav">
        {NAV_GROUPS.map((group) => (
          <div className="nav-group" key={group.key}>
            <div className="nav-group-header" onClick={() => toggleGroup(group.key)}>
              {group.icon}
              <span>{t(group.labelKey)}</span>
              <ChevronRight
                size={12}
                className={`chevron ${expanded[group.key] ? 'expanded' : ''}`}
              />
            </div>
            {expanded[group.key] && (
              <div className="nav-group-items">
                {group.items.map((item) => (
                  <NavLink
                    key={item.path}
                    to={item.path}
                    className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
                  >
                    <span className="nav-icon">{item.icon}</span>
                    <span>{t(item.labelKey)}</span>
                  </NavLink>
                ))}
              </div>
            )}
          </div>
        ))}
      </nav>

      <div className="sidebar-footer">
        <NavLink
          to="/settings"
          className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
          style={{ marginBottom: 'var(--space-2)' }}
        >
          <span className="nav-icon"><Settings size={16} /></span>
          <span>{t('nav.settings')}</span>
        </NavLink>
        <button className="theme-toggle-btn" onClick={toggleTheme}>
          {theme === 'light' ? <Moon size={14} /> : <Sun size={14} />}
          <span>{theme === 'light' ? t('settings.dark') : t('settings.light')}</span>
        </button>
      </div>
    </aside>
  );
}
