import type { CurlRequest, CurlRequestEditor, KeyValueRow } from '../types/curl';

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

export function newKeyValueRow(): KeyValueRow {
  return {
    id: crypto.randomUUID(),
    enabled: true,
    key: '',
    value: '',
  };
}

export function ensureTrailingBlankRow(rows: KeyValueRow[]): KeyValueRow[] {
  const normalized = rows.map((row) => ({ ...row, id: row.id || crypto.randomUUID() }));
  const last = normalized[normalized.length - 1];
  if (!last || last.key.trim() || last.value.trim()) {
    return [...normalized, newKeyValueRow()];
  }
  return normalized;
}

export function activeRows(rows: KeyValueRow[]): KeyValueRow[] {
  return rows
    .filter((row) => row.enabled && row.key.trim())
    .map(({ enabled, key, value }) => ({ enabled, key: key.trim(), value }));
}

export function newBlankRequest(projectId: number, folderId?: number | null): CurlRequestEditor {
  return {
    project_id: projectId,
    folder_id: folderId ?? null,
    name: 'Untitled Request',
    method: 'GET',
    url: '',
    headers: [newKeyValueRow()],
    query: [newKeyValueRow()],
    body_type: 'none',
    body: '',
  };
}

export function editorFromRequest(request: CurlRequest): CurlRequestEditor {
  return {
    id: request.id,
    project_id: request.project_id,
    folder_id: request.folder_id,
    name: request.name,
    method: METHODS.includes(request.method) ? request.method : 'GET',
    url: request.url,
    headers: ensureTrailingBlankRow(parseRows(request.headers_json)),
    query: ensureTrailingBlankRow(parseRows(request.query_json)),
    body_type: normalizeBodyType(request.body_type),
    body: request.body,
  };
}

export function toSavePayload(editor: CurlRequestEditor) {
  return {
    id: editor.id ?? null,
    project_id: editor.project_id,
    folder_id: editor.folder_id ?? null,
    name: editor.name.trim() || 'Untitled Request',
    method: editor.method,
    url: editor.url.trim(),
    headers: activeRows(editor.headers),
    query: activeRows(editor.query),
    body_type: editor.body_type,
    body: editor.body,
  };
}

export function toCommandInput(editor: CurlRequestEditor) {
  return {
    method: editor.method,
    url: editor.url.trim(),
    headers: activeRows(editor.headers),
    query: activeRows(editor.query),
    body_type: editor.body_type,
    body: editor.body,
  };
}

export function formatResponseBody(body: string, contentType?: string): string {
  const type = contentType?.toLowerCase() || '';
  if (type.includes('json') || body.trim().startsWith('{') || body.trim().startsWith('[')) {
    try {
      return JSON.stringify(JSON.parse(body), null, 2);
    } catch {
      return body;
    }
  }
  return body;
}

export function historySnapshotToEditor(snapshot: string, fallback: CurlRequestEditor): CurlRequestEditor {
  try {
    const parsed = JSON.parse(snapshot);
    return {
      ...fallback,
      method: METHODS.includes(parsed.method) ? parsed.method : fallback.method,
      url: parsed.url || fallback.url,
      headers: ensureTrailingBlankRow(parsed.headers || []),
      query: ensureTrailingBlankRow(parsed.query || []),
      body_type: normalizeBodyType(parsed.body_type),
      body: parsed.body || '',
    };
  } catch {
    return fallback;
  }
}

function parseRows(json: string): KeyValueRow[] {
  try {
    const rows = JSON.parse(json);
    if (!Array.isArray(rows)) return [];
    return rows.map((row) => ({
      id: crypto.randomUUID(),
      enabled: row.enabled !== false,
      key: String(row.key || ''),
      value: String(row.value || ''),
    }));
  } catch {
    return [];
  }
}

function normalizeBodyType(value: string): CurlRequestEditor['body_type'] {
  if (value === 'raw' || value === 'json' || value === 'form') return value;
  return 'none';
}
