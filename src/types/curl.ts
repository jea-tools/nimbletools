export interface KeyValueRow {
  id?: string;
  enabled: boolean;
  key: string;
  value: string;
}

export interface CurlProject {
  id: number;
  name: string;
  created_at: number;
  updated_at: number;
}

export interface CurlFolder {
  id: number;
  project_id: number;
  parent_id: number | null;
  name: string;
  sort_order: number;
}

export interface CurlRequest {
  id: number;
  project_id: number;
  folder_id: number | null;
  name: string;
  method: string;
  url: string;
  headers_json: string;
  query_json: string;
  body_type: string;
  body: string;
  sort_order: number;
  created_at: number;
  updated_at: number;
}

export interface CurlWorkspace {
  projects: CurlProject[];
  folders: CurlFolder[];
  requests: CurlRequest[];
}

export interface CurlRequestEditor {
  id?: number;
  project_id: number;
  folder_id?: number | null;
  name: string;
  method: string;
  url: string;
  headers: KeyValueRow[];
  query: KeyValueRow[];
  body_type: 'none' | 'raw' | 'json' | 'form';
  body: string;
}

export interface CurlSendResponse {
  status: number | null;
  duration_ms: number;
  headers: KeyValueRow[];
  body: string;
  body_truncated: boolean;
  error: string | null;
  history_id: number;
}

export interface CurlHistoryEntry {
  id: number;
  request_id: number | null;
  name: string;
  method: string;
  url: string;
  status: number | null;
  duration_ms: number;
  request_snapshot_json: string;
  response_headers_json: string;
  response_body: string;
  error: string | null;
  created_at: number;
}

export interface ImportedCurlRequest {
  name: string;
  method: string;
  url: string;
  headers: KeyValueRow[];
  query: KeyValueRow[];
  body_type: 'none' | 'raw' | 'json' | 'form';
  body: string;
}
