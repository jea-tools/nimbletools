import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ThemeProvider } from './components/ThemeProvider';
import Layout from './components/Layout';

// 图片处理
import FormatConvertPage from './pages/ImageTools/FormatConvertPage';
import ResizePage from './pages/ImageTools/ResizePage';
import CompressPage from './pages/ImageTools/CompressPage';
import ImageMergePage from './pages/ImageTools/MergePage';
import WatermarkPage from './pages/ImageTools/WatermarkPage';

// 文件工具
import FileSplitPage from './pages/FileTools/FileSplitPage';
import FileMergePage from './pages/FileTools/FileMergePage';
import BatchRenamePage from './pages/FileTools/BatchRenamePage';

// 文本工具
import Base64Page from './pages/TextTools/Base64Page';
import FormatterPage from './pages/TextTools/FormatterPage';
import OcrPage from './pages/TextTools/OcrPage';
import UrlEncodePage from './pages/TextTools/UrlEncodePage';
import RegexTesterPage from './pages/TextTools/RegexTesterPage';
import TextStatsPage from './pages/TextTools/TextStatsPage';

// 实用工具
import QrCodePage from './pages/UtilityTools/QrCodePage';
import UnitConverterPage from './pages/UtilityTools/UnitConverterPage';
import ColorPickerPage from './pages/UtilityTools/ColorPickerPage';
import TimestampPage from './pages/UtilityTools/TimestampPage';
import HashPage from './pages/UtilityTools/HashPage';
import UuidPage from './pages/UtilityTools/UuidPage';
import PasswordPage from './pages/UtilityTools/PasswordPage';
import NumberBasePage from './pages/UtilityTools/NumberBasePage';
import CurlPage from './pages/UtilityTools/CurlPage';
import ClipboardPage from './pages/UtilityTools/ClipboardPage';

// 截图标注
import ScreenCapturePage from './pages/Screenshot/ScreenCapturePage';

// 设置
import SettingsPage from './pages/Settings/SettingsPage';

// 剪贴板弹窗
import ClipboardPopup from './pages/ClipboardPopup';

function MainApp() {

  return (
    <ThemeProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<Navigate to="/image/convert" replace />} />

            {/* 图片处理 */}
            <Route path="/image/convert" element={<FormatConvertPage />} />
            <Route path="/image/resize" element={<ResizePage />} />
            <Route path="/image/compress" element={<CompressPage />} />
            <Route path="/image/merge" element={<ImageMergePage />} />
            <Route path="/image/watermark" element={<WatermarkPage />} />

            {/* 文件工具 */}
            <Route path="/file/split" element={<FileSplitPage />} />
            <Route path="/file/merge" element={<FileMergePage />} />
            <Route path="/file/rename" element={<BatchRenamePage />} />

            {/* 文本工具 */}
            <Route path="/text/ocr" element={<OcrPage />} />
            <Route path="/text/base64" element={<Base64Page />} />
            <Route path="/text/formatter" element={<FormatterPage />} />
            <Route path="/text/url-encode" element={<UrlEncodePage />} />
            <Route path="/text/regex" element={<RegexTesterPage />} />
            <Route path="/text/stats" element={<TextStatsPage />} />

            {/* 实用工具 */}
            <Route path="/utility/qrcode" element={<QrCodePage />} />
            <Route path="/utility/unit-converter" element={<UnitConverterPage />} />
            <Route path="/utility/color-picker" element={<ColorPickerPage />} />
            <Route path="/utility/timestamp" element={<TimestampPage />} />
            <Route path="/utility/hash" element={<HashPage />} />
            <Route path="/utility/uuid" element={<UuidPage />} />
            <Route path="/utility/password" element={<PasswordPage />} />
            <Route path="/utility/number-base" element={<NumberBasePage />} />
            <Route path="/utility/curl" element={<CurlPage />} />
            <Route path="/utility/clipboard" element={<ClipboardPage />} />

            {/* 截图 */}
            <Route path="/screenshot/capture" element={<ScreenCapturePage />} />

            {/* 设置 */}
            <Route path="/settings" element={<SettingsPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </ThemeProvider>
  );
}

// 截图标注编辑器（懒加载）
import ScreenshotEditor from './pages/ScreenshotEditor';
import RegionSelector from './pages/RegionSelector';

type WindowMode = 'main' | 'clipboard-popup' | 'screenshot-editor' | 'region-selector' | null;

export default function App() {
  const [windowMode, setWindowMode] = useState<WindowMode>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const mode = params.get('window');
    if (mode === 'clipboard-popup' || mode === 'screenshot-editor' || mode === 'region-selector') {
      setWindowMode(mode);
    } else {
      setWindowMode('main');
    }
  }, []);

  if (windowMode === null) return null;

  if (windowMode === 'clipboard-popup') {
    return (
      <ThemeProvider>
        <ClipboardPopup />
      </ThemeProvider>
    );
  }

  if (windowMode === 'screenshot-editor') {
    return (
      <ThemeProvider>
        <ScreenshotEditor />
      </ThemeProvider>
    );
  }

  if (windowMode === 'region-selector') {
    return <RegionSelector />;
  }

  return <MainApp />;
}
