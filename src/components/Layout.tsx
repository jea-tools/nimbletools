import { Outlet, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import Sidebar from './Sidebar';

/** 根据当前路由路径映射到对应的页面标题 i18n key */
const ROUTE_TITLE_MAP: Record<string, string> = {
  '/image/convert': 'imageTools.formatConvert.title',
  '/image/resize': 'imageTools.resize.title',
  '/image/compress': 'imageTools.compress.title',
  '/image/merge': 'imageTools.merge.title',
  '/file/split': 'fileTools.split.title',
  '/file/merge': 'fileTools.merge.title',
  '/file/rename': 'fileTools.rename.title',
  '/text/ocr': 'textTools.ocr.title',
  '/text/base64': 'textTools.base64.title',
  '/text/formatter': 'textTools.formatter.title',
  '/text/url-encode': 'extraTools.urlEncode.title',
  '/text/regex': 'extraTools.regex.title',
  '/text/stats': 'extraTools.textStats.title',
  '/utility/qrcode': 'utilityTools.qrcode.title',
  '/utility/unit-converter': 'utilityTools.unitConverter.title',
  '/utility/color-picker': 'utilityTools.colorPicker.title',
  '/utility/timestamp': 'utilityTools.timestamp.title',
  '/utility/hash': 'extraTools.hash.title',
  '/utility/uuid': 'extraTools.uuid.title',
  '/utility/password': 'extraTools.password.title',
  '/utility/number-base': 'extraTools.numberBase.title',
  '/utility/curl': 'nav.curl',
  '/utility/clipboard': 'extraTools.clipboard.title',
  '/screenshot/capture': 'nav.capture',
  '/settings': 'settings.title',
};

export default function Layout() {
  const { t } = useTranslation();
  const location = useLocation();
  const titleKey = ROUTE_TITLE_MAP[location.pathname] || 'app.name';

  return (
    <div className="app-layout">
      <Sidebar />
      <main className="main-content">
        <header className="content-header">
          <h1>{t(titleKey)}</h1>
        </header>
        <div className="content-body">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
