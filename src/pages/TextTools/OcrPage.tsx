import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { ScanText, Copy, Check, Upload, Loader2 } from 'lucide-react';

interface OcrResult {
  success: boolean;
  text: string;
  message: string;
}

export default function OcrPage() {
  const { t } = useTranslation();
  const [imagePath, setImagePath] = useState('');
  const [extractedText, setExtractedText] = useState('');
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const handleSelectImage = async () => {
    const selected = await open({
      multiple: false,
      filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'tiff'] }],
    });
    if (selected) {
      setImagePath(selected as string);
      setExtractedText('');
      setError('');
      await performOcr(selected as string);
    }
  };

  const performOcr = async (path: string) => {
    setProcessing(true);
    setError('');
    try {
      const result = await invoke<OcrResult>('extract_text_from_image', { imagePath: path });
      if (result.success) {
        setExtractedText(result.text);
      } else {
        setError(result.message);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setProcessing(false);
    }
  };

  const handleCopy = async () => {
    if (!extractedText) return;
    await navigator.clipboard.writeText(extractedText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="page-container">
      <p className="page-description">{t('textTools.ocr.desc')}</p>

      <div className="flex gap-6" style={{ alignItems: 'flex-start' }}>
        {/* Left: Image selection */}
        <div className="card" style={{ flex: 1 }}>
          <div className="dropzone" onClick={handleSelectImage}>
            {processing ? (
              <>
                <Loader2 className="dropzone-icon" style={{ animation: 'spin 1s linear infinite' }} />
                <p className="dropzone-text">{t('textTools.ocr.extracting')}</p>
              </>
            ) : (
              <>
                <Upload className="dropzone-icon" />
                <p className="dropzone-text">{t('textTools.ocr.paste')}</p>
                <p className="dropzone-hint">{t('common.dropHint')}</p>
              </>
            )}
          </div>

          {imagePath && (
            <div className="mt-4">
              <p className="text-xs text-tertiary" style={{ wordBreak: 'break-all' }}>
                {imagePath.split('/').pop()}
              </p>
            </div>
          )}
        </div>

        {/* Right: Result */}
        <div className="card" style={{ flex: 1 }}>
          <div className="flex items-center justify-between mb-4">
            <div className="card-title" style={{ marginBottom: 0 }}>
              <ScanText size={16} style={{ display: 'inline', marginRight: 8 }} />
              {t('textTools.ocr.result')}
            </div>
            {extractedText && (
              <button className="btn btn-ghost btn-sm" onClick={handleCopy}>
                {copied ? <Check size={14} /> : <Copy size={14} />}
                {copied ? t('common.copied') : t('textTools.ocr.copyAll')}
              </button>
            )}
          </div>

          {error && (
            <div className="status-bar error mb-4">{error}</div>
          )}

          <textarea
            className="form-input select-text"
            rows={14}
            value={extractedText}
            readOnly
            placeholder="..."
            style={{ background: 'var(--bg-tertiary)' }}
          />
        </div>
      </div>

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
