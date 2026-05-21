import { KeyboardEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  Check, ChevronDown, ChevronRight, Copy, FileJson, Folder, FolderPlus,
  History, Import, Play, Plus, Save, Send, Terminal, Trash2, Upload,
} from 'lucide-react';
import type {
  CurlFolder, CurlHistoryEntry, CurlProject, CurlRequest, CurlRequestEditor,
  CurlSendResponse, CurlWorkspace, ImportedCurlRequest, KeyValueRow,
} from '../../types/curl';
import {
  activeRows, editorFromRequest, ensureTrailingBlankRow, formatResponseBody, historySnapshotToEditor,
  newBlankRequest, newKeyValueRow, toCommandInput, toSavePayload,
} from '../../utils/curlEditor';

type EditorTab = 'params' | 'headers' | 'body' | 'response' | 'history';
type EditableNameTarget =
  | { type: 'project'; id: number; value: string }
  | { type: 'folder'; id: number; value: string }
  | { type: 'request'; id: number; value: string };
type PendingCurlAction =
  | { type: 'select'; request: CurlRequest }
  | { type: 'create' }
  | { type: 'import' }
  | { type: 'delete'; request: CurlRequest }
  | { type: 'deleteProject'; project: CurlProject }
  | { type: 'deleteFolder'; folder: CurlFolder }
  | { type: 'restoreHistory'; entry: CurlHistoryEntry };
type Notice = { type: 'success' | 'error'; text: string };
type DeleteCandidate =
  | { type: 'project'; id: number; name: string }
  | { type: 'folder'; id: number; name: string }
  | { type: 'request'; id: number; name: string };

function formatTime(ts: number): string {
  return new Date(ts * 1000).toLocaleString();
}

function statusColor(status: number | null): string {
  if (!status) return 'var(--text-tertiary)';
  if (status >= 200 && status < 300) return 'var(--accent-success)';
  if (status >= 400) return 'var(--accent-error)';
  return 'var(--accent-warning)';
}

function comparableRows(rows: KeyValueRow[]): Pick<KeyValueRow, 'enabled' | 'key' | 'value'>[] {
  return activeRows(rows).map(({ enabled, key, value }) => ({ enabled, key, value }));
}

function savedComparableRows(json: string): Pick<KeyValueRow, 'enabled' | 'key' | 'value'>[] {
  try {
    const rows = JSON.parse(json);
    if (!Array.isArray(rows)) return [];
    return rows
      .filter((row) => row?.enabled !== false && String(row?.key || '').trim())
      .map((row) => ({ enabled: true, key: String(row.key || '').trim(), value: String(row.value || '') }));
  } catch {
    return [];
  }
}

function comparableEditor(editor: CurlRequestEditor) {
  const payload = toSavePayload(editor);
  return {
    project_id: payload.project_id,
    folder_id: payload.folder_id,
    name: payload.name,
    method: payload.method,
    url: payload.url,
    headers: comparableRows(editor.headers),
    query: comparableRows(editor.query),
    body_type: payload.body_type,
    body: payload.body,
  };
}

function comparableRequest(request: CurlRequest) {
  return {
    project_id: request.project_id,
    folder_id: request.folder_id ?? null,
    name: request.name,
    method: request.method,
    url: request.url,
    headers: savedComparableRows(request.headers_json),
    query: savedComparableRows(request.query_json),
    body_type: request.body_type,
    body: request.body,
  };
}

export default function CurlPage() {
  const [workspace, setWorkspace] = useState<CurlWorkspace>({ projects: [], folders: [], requests: [] });
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  const [selectedFolderId, setSelectedFolderId] = useState<number | null>(null);
  const [selectedRequestId, setSelectedRequestId] = useState<number | null>(null);
  const [expandedProjects, setExpandedProjects] = useState<Set<number>>(new Set());
  const [expandedFolders, setExpandedFolders] = useState<Set<number>>(new Set());
  const [editor, setEditor] = useState<CurlRequestEditor | null>(null);
  const [tab, setTab] = useState<EditorTab>('params');
  const [response, setResponse] = useState<CurlSendResponse | null>(null);
  const [history, setHistory] = useState<CurlHistoryEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [importText, setImportText] = useState('');
  const [exportText, setExportText] = useState('');
  const [copied, setCopied] = useState(false);
  const [editingName, setEditingName] = useState<EditableNameTarget | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingCurlAction | null>(null);
  const [deleteCandidate, setDeleteCandidate] = useState<DeleteCandidate | null>(null);

  const selectedRequest = workspace.requests.find((r) => r.id === selectedRequestId) || null;
  const editorDirty = useMemo(() => {
    if (!editor) return false;
    if (!selectedRequest || editor.id !== selectedRequest.id) return true;
    return JSON.stringify(comparableEditor(editor)) !== JSON.stringify(comparableRequest(selectedRequest));
  }, [editor, selectedRequest]);

  const loadWorkspace = useCallback(async () => {
    const data = await invoke<CurlWorkspace>('get_curl_workspace');
    setWorkspace(data);
    if (!selectedProjectId && data.projects.length > 0) {
      setSelectedProjectId(data.projects[0].id);
      setExpandedProjects(new Set([data.projects[0].id]));
    }
  }, [selectedProjectId]);

  const loadHistory = useCallback(async (requestId?: number | null) => {
    const rows = await invoke<CurlHistoryEntry[]>('get_curl_history', {
      requestId: requestId ?? null,
      limit: 50,
    });
    setHistory(rows);
  }, []);

  useEffect(() => {
    loadWorkspace().catch((err) => setNotice({ type: 'error', text: String(err) }));
  }, [loadWorkspace]);

  useEffect(() => {
    loadHistory(selectedRequestId).catch((err) => setNotice({ type: 'error', text: `读取请求历史失败: ${String(err)}` }));
  }, [loadHistory, selectedRequestId]);

  const foldersByParent = useMemo(() => {
    const map = new Map<string, CurlFolder[]>();
    for (const folder of workspace.folders) {
      const key = `${folder.project_id}:${folder.parent_id ?? 'root'}`;
      map.set(key, [...(map.get(key) || []), folder]);
    }
    return map;
  }, [workspace.folders]);

  const requestsByFolder = useMemo(() => {
    const map = new Map<string, CurlRequest[]>();
    for (const request of workspace.requests) {
      const key = `${request.project_id}:${request.folder_id ?? 'root'}`;
      map.set(key, [...(map.get(key) || []), request]);
    }
    return map;
  }, [workspace.requests]);

  const createProject = async () => {
    setBusy(true);
    try {
      const name = `New Project ${workspace.projects.length + 1}`;
      const project = await invoke<CurlProject>('create_curl_project', { name });
      await loadWorkspace();
      setSelectedProjectId(project.id);
      setSelectedFolderId(null);
      setExpandedProjects(new Set([...expandedProjects, project.id]));
      setEditingName({ type: 'project', id: project.id, value: project.name });
    } catch (err) {
      setNotice({ type: 'error', text: `创建项目失败: ${String(err)}` });
    } finally {
      setBusy(false);
    }
  };

  const createFolder = async () => {
    if (!selectedProjectId) return;
    setBusy(true);
    try {
      const name = `New Folder ${workspace.folders.length + 1}`;
      const folder = await invoke<CurlFolder>('create_curl_folder', {
        projectId: selectedProjectId,
        parentId: selectedFolderId,
        name,
      });
      await loadWorkspace();
      setSelectedFolderId(folder.id);
      setExpandedFolders(new Set([...expandedFolders, folder.id]));
      setEditingName({ type: 'folder', id: folder.id, value: folder.name });
    } catch (err) {
      setNotice({ type: 'error', text: `创建目录失败: ${String(err)}` });
    } finally {
      setBusy(false);
    }
  };

  const createSavedRequestNow = async () => {
    if (!selectedProjectId) return;
    const blank = newBlankRequest(selectedProjectId, selectedFolderId);
    setBusy(true);
    try {
      const saved = await invoke<CurlRequest>('save_curl_request', { payload: toSavePayload(blank) });
      await loadWorkspace();
      setSelectedRequestId(saved.id);
      setEditor(editorFromRequest(saved));
      setResponse(null);
      setDeleteCandidate(null);
      setTab('params');
      setEditingName({ type: 'request', id: saved.id, value: saved.name });
    } catch (err) {
      setNotice({ type: 'error', text: `创建请求失败: ${String(err)}` });
    } finally {
      setBusy(false);
    }
  };

  const selectRequestNow = (request: CurlRequest) => {
    setSelectedProjectId(request.project_id);
    setSelectedFolderId(request.folder_id);
    setSelectedRequestId(request.id);
    setEditor(editorFromRequest(request));
    setResponse(null);
    setDeleteCandidate(null);
    setTab('params');
  };

  const saveRequest = async (): Promise<boolean> => {
    if (!editor) return true;
    setBusy(true);
    try {
      const saved = await invoke<CurlRequest>('save_curl_request', { payload: toSavePayload(editor) });
      await loadWorkspace();
      setSelectedRequestId(saved.id);
      setEditor(editorFromRequest(saved));
      setNotice({ type: 'success', text: '已保存' });
      return true;
    } catch (err) {
      setNotice({ type: 'error', text: String(err) });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const commitNameEdit = async () => {
    if (!editingName) return;
    const nextName = editingName.value.trim();
    if (!nextName) {
      setNotice({ type: 'error', text: '名称不能为空' });
      return;
    }

    const current = editingName;
    setEditingName(null);
    try {
      if (current.type === 'project') {
        await invoke<CurlProject>('rename_curl_project', { id: current.id, name: nextName });
      } else if (current.type === 'folder') {
        await invoke<CurlFolder>('rename_curl_folder', { id: current.id, name: nextName });
      } else {
        const renamed = await invoke<CurlRequest>('rename_curl_request', { id: current.id, name: nextName });
        if (editor?.id === renamed.id) {
          setEditor({ ...editor, name: renamed.name });
        }
      }
      await loadWorkspace();
    } catch (err) {
      setNotice({ type: 'error', text: `修改名称失败: ${String(err)}` });
      setEditingName(current);
    }
  };

  const handleNameKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commitNameEdit();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setEditingName(null);
    }
  };

  const deleteCandidateNow = async (candidate: DeleteCandidate) => {
    setBusy(true);
    try {
      if (candidate.type === 'project') {
        await invoke('delete_curl_project', { id: candidate.id });
      } else if (candidate.type === 'folder') {
        await invoke('delete_curl_folder', { id: candidate.id });
      } else {
        await invoke('delete_curl_request', { id: candidate.id });
      }

      const nextWorkspace = await invoke<CurlWorkspace>('get_curl_workspace');
      setWorkspace(nextWorkspace);

      const projectStillExists = selectedProjectId != null
        && nextWorkspace.projects.some((project) => project.id === selectedProjectId);
      const folderStillExists = selectedFolderId != null
        && nextWorkspace.folders.some((folder) => folder.id === selectedFolderId);
      const requestStillExists = selectedRequestId != null
        && nextWorkspace.requests.some((request) => request.id === selectedRequestId);

      if (!projectStillExists) {
        setSelectedProjectId(nextWorkspace.projects[0]?.id ?? null);
        setSelectedFolderId(null);
      } else if (!folderStillExists) {
        setSelectedFolderId(null);
      }

      if (!requestStillExists) {
        setSelectedRequestId(null);
        setEditor(null);
        setResponse(null);
      }

      if (candidate.type === 'project') {
        setExpandedProjects((prev) => {
          const next = new Set(prev);
          next.delete(candidate.id);
          return next;
        });
      } else if (candidate.type === 'folder') {
        setExpandedFolders((prev) => {
          const next = new Set(prev);
          next.delete(candidate.id);
          return next;
        });
      }

      setDeleteCandidate(null);
      setNotice({ type: 'success', text: '已删除' });
    } catch (err) {
      setNotice({ type: 'error', text: String(err) });
    } finally {
      setBusy(false);
    }
  };

  const sendRequest = async () => {
    if (!editor) return;
    setBusy(true);
    setResponse(null);
    try {
      const res = await invoke<CurlSendResponse>('send_curl_request', {
        requestId: editor.id ?? null,
        request: toCommandInput(editor),
      });
      setResponse(res);
      setTab('response');
      await loadHistory(editor.id ?? null);
    } catch (err) {
      setNotice({ type: 'error', text: String(err) });
    } finally {
      setBusy(false);
    }
  };

  const importCurlNow = async () => {
    if (!selectedProjectId || !importText.trim()) return;
    try {
      const imported = await invoke<ImportedCurlRequest>('import_curl_command', { command: importText });
      setEditor({
        ...newBlankRequest(selectedProjectId, selectedFolderId),
        name: imported.name,
        method: imported.method,
        url: imported.url,
        headers: ensureTrailingBlankRow(imported.headers),
        query: ensureTrailingBlankRow(imported.query),
        body_type: imported.body_type,
        body: imported.body,
      });
      setSelectedRequestId(null);
      setResponse(null);
      setDeleteCandidate(null);
      setImportText('');
      setNotice({ type: 'success', text: '已导入 curl' });
    } catch (err) {
      setNotice({ type: 'error', text: String(err) });
    }
  };

  const exportCurl = async () => {
    if (!editor) return;
    try {
      const command = await invoke<string>('export_curl_command_command', {
        request: toCommandInput(editor),
      });
      setExportText(command);
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setNotice({ type: 'success', text: 'curl 已导出并复制' });
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      setNotice({ type: 'error', text: String(err) });
    }
  };

  const updateRows = (key: 'headers' | 'query', rows: KeyValueRow[]) => {
    if (!editor) return;
    setEditor({ ...editor, [key]: ensureTrailingBlankRow(rows) });
  };

  const executeCurlAction = async (action: PendingCurlAction) => {
    if (action.type === 'select') {
      selectRequestNow(action.request);
    } else if (action.type === 'create') {
      await createSavedRequestNow();
    } else if (action.type === 'import') {
      await importCurlNow();
    } else if (action.type === 'delete') {
      setDeleteCandidate({ type: 'request', id: action.request.id, name: action.request.name });
    } else if (action.type === 'deleteProject') {
      setDeleteCandidate({ type: 'project', id: action.project.id, name: action.project.name });
    } else if (action.type === 'deleteFolder') {
      setDeleteCandidate({ type: 'folder', id: action.folder.id, name: action.folder.name });
    } else if (action.type === 'restoreHistory' && editor) {
      setEditor(historySnapshotToEditor(action.entry.request_snapshot_json, editor));
      setTab('params');
      setNotice({ type: 'success', text: '已从历史恢复到编辑器' });
    }
  };

  const requestCurlAction = (action: PendingCurlAction) => {
    if (action.type === 'select' && action.request.id === selectedRequestId) return;
    if (editorDirty) {
      setPendingAction(action);
      return;
    }
    void executeCurlAction(action);
  };

  const savePendingAndContinue = async () => {
    const action = pendingAction;
    if (!action) return;
    const saved = await saveRequest();
    if (!saved) return;
    setPendingAction(null);
    await executeCurlAction(action);
  };

  const discardPendingAndContinue = async () => {
    const action = pendingAction;
    if (!action) return;
    setPendingAction(null);
    await executeCurlAction(action);
  };

  const responseContentType = response?.headers.find((h) => h.key.toLowerCase() === 'content-type')?.value;

  return (
    <div className="page-container page-container-wide curl-workbench">
      <div className="curl-workbench-header">
        <div>
          <p className="page-description">导入、编辑、发送和导出 curl 请求。本地保存项目、目录、请求和历史记录。</p>
        </div>
        <div className="curl-workbench-actions">
          <button className="btn btn-secondary" onClick={createProject} disabled={busy}><Plus size={14} /> 项目</button>
          <button className="btn btn-secondary" onClick={createFolder} disabled={!selectedProjectId || busy}><FolderPlus size={14} /> 目录</button>
          <button className="btn btn-primary" onClick={() => requestCurlAction({ type: 'create' })} disabled={!selectedProjectId || busy}><FileJson size={14} /> 请求</button>
        </div>
      </div>

      <div className="curl-shell">
        <aside className="curl-sidebar">
          <div className="curl-panel-header">
            <div>
              <div className="curl-panel-title">项目</div>
              <div className="curl-panel-subtitle">{workspace.projects.length} 个项目 · {workspace.requests.length} 个请求</div>
            </div>
          </div>

          <div className="curl-tree">
            {workspace.projects.length === 0 ? (
              <div className="curl-empty-panel">
                <Terminal size={28} />
                <span>还没有项目</span>
              </div>
            ) : workspace.projects.map((project) => (
              <TreeProject
                key={project.id}
                project={project}
                selectedProjectId={selectedProjectId}
                selectedRequestId={selectedRequestId}
                expandedProjects={expandedProjects}
                expandedFolders={expandedFolders}
                foldersByParent={foldersByParent}
                requestsByFolder={requestsByFolder}
                onSelectProject={() => { setSelectedProjectId(project.id); setSelectedFolderId(null); }}
                editingName={editingName}
                onEditName={(target) => setEditingName(target)}
                onDeleteProject={(project) => requestCurlAction({ type: 'deleteProject', project })}
                onDeleteFolder={(folder) => requestCurlAction({ type: 'deleteFolder', folder })}
                onChangeEditingName={(value) => editingName && setEditingName({ ...editingName, value })}
                onCommitNameEdit={commitNameEdit}
                onNameKeyDown={handleNameKeyDown}
                onToggleProject={() => {
                  const next = new Set(expandedProjects);
                  next.has(project.id) ? next.delete(project.id) : next.add(project.id);
                  setExpandedProjects(next);
                }}
                onToggleFolder={(id) => {
                  const next = new Set(expandedFolders);
                  next.has(id) ? next.delete(id) : next.add(id);
                  setExpandedFolders(next);
                }}
                onSelectFolder={(folder) => { setSelectedProjectId(folder.project_id); setSelectedFolderId(folder.id); }}
                onSelectRequest={(request) => requestCurlAction({ type: 'select', request })}
              />
            ))}
          </div>
        </aside>

        <main className="curl-main">
          {deleteCandidate && (
            <div
              className="status-bar error curl-status-row curl-confirm-row"
              role="alert"
              aria-live="assertive"
              style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}
            >
              <span>
                确认删除{deleteCandidate.type === 'project' ? '项目' : deleteCandidate.type === 'folder' ? '目录' : '请求'}“{deleteCandidate.name}”？
                {deleteCandidate.type === 'request' ? '该操作不可撤销。' : '其下的目录、请求和历史都会删除。'}
              </span>
              <div className="flex gap-2 ml-auto">
                <button className="btn btn-ghost btn-sm" onClick={() => setDeleteCandidate(null)} disabled={busy}>取消</button>
                <button className="btn btn-secondary btn-sm" onClick={() => deleteCandidateNow(deleteCandidate)} disabled={busy}>删除</button>
              </div>
            </div>
          )}

          {!editor ? (
            <div className="curl-empty-state">
              <Send size={42} className="text-tertiary" />
              <div>
                <div className="curl-empty-title">选择一个请求，或新建/导入 curl</div>
                <div className="text-secondary">左侧管理项目和目录，右侧编辑请求参数、请求头、请求体和历史。</div>
              </div>
              <button className="btn btn-primary" onClick={() => requestCurlAction({ type: 'create' })} disabled={!selectedProjectId || busy}><Plus size={14} /> 新建请求</button>
            </div>
          ) : (
            <>
              <section className="curl-request-card">
                <div className="curl-request-title-row">
                  <div className="curl-request-name">
                    <label className="form-label">请求名称</label>
                    <input className="form-input" value={editor.name} onChange={(e) => setEditor({ ...editor, name: e.target.value })} />
                  </div>
                  <div className="curl-request-toolbar">
                    <button className="btn btn-secondary" onClick={saveRequest} disabled={busy}><Save size={14} /> 保存</button>
                    <button className="btn btn-ghost btn-icon" onClick={exportCurl} title="导出 curl"><Copy size={14} /></button>
                    {selectedRequest && <button className="btn btn-ghost btn-icon" onClick={() => requestCurlAction({ type: 'delete', request: selectedRequest })} title="删除"><Trash2 size={14} /></button>}
                  </div>
                </div>

                <div className="curl-url-row">
                  <select className="form-input curl-method-select" value={editor.method} onChange={(e) => setEditor({ ...editor, method: e.target.value })}>
                    {['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].map((m) => <option key={m}>{m}</option>)}
                  </select>
                  <input className="form-input text-mono curl-url-input" value={editor.url} onChange={(e) => setEditor({ ...editor, url: e.target.value })} placeholder="https://api.example.com/path" />
                  <button className="btn btn-primary curl-send-button" onClick={sendRequest} disabled={busy || !editor.url.trim()}><Play size={14} /> 发送</button>
                </div>
              </section>

              {pendingAction && (
                <div className="status-bar warning curl-status-row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
                  <span>当前请求有未保存修改。继续前请选择处理方式。</span>
                  <div className="flex gap-2 ml-auto">
                    <button className="btn btn-secondary btn-sm" onClick={savePendingAndContinue} disabled={busy}>保存并继续</button>
                    <button className="btn btn-ghost btn-sm" onClick={discardPendingAndContinue} disabled={busy}>放弃修改</button>
                    <button className="btn btn-ghost btn-sm" onClick={() => setPendingAction(null)} disabled={busy}>取消</button>
                  </div>
                </div>
              )}

              <section className="curl-editor-card">
                <div className="tabs curl-tabs">
                  {(['params', 'headers', 'body', 'response', 'history'] as EditorTab[]).map((item) => (
                    <button key={item} className={`tab ${tab === item ? 'active' : ''}`} onClick={() => setTab(item)}>
                      {item === 'params' ? '参数' : item === 'headers' ? '请求头' : item === 'body' ? '请求体' : item === 'response' ? '响应' : '历史'}
                    </button>
                  ))}
                </div>

                <div className="curl-tab-content">
                  {tab === 'params' && <KeyValueEditor rows={editor.query} onChange={(rows) => updateRows('query', rows)} />}
                  {tab === 'headers' && <KeyValueEditor rows={editor.headers} onChange={(rows) => updateRows('headers', rows)} />}
                  {tab === 'body' && (
                    <div>
                      <div className="curl-segmented">
                        {(['none', 'raw', 'json', 'form'] as CurlRequestEditor['body_type'][]).map((type) => (
                          <button key={type} className={`btn btn-sm ${editor.body_type === type ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setEditor({ ...editor, body_type: type })}>
                            {type === 'none' ? '无' : type === 'raw' ? 'Raw' : type === 'json' ? 'JSON' : 'Form'}
                          </button>
                        ))}
                      </div>
                      <textarea className="form-input text-mono curl-body-textarea" rows={16} value={editor.body} onChange={(e) => setEditor({ ...editor, body: e.target.value })} disabled={editor.body_type === 'none'} placeholder={editor.body_type === 'form' ? '[{"enabled":true,"key":"name","value":"Jean"}]' : '{"name":"Jean"}'} />
                    </div>
                  )}
                  {tab === 'response' && (
                    <div>
                      {!response ? (
                        <div className="curl-empty-response">还没有响应</div>
                      ) : (
                        <>
                          <div className="curl-response-meta">
                            <span className="font-semibold" style={{ color: statusColor(response.status) }}>Status {response.status ?? 'ERR'}</span>
                            <span className="text-xs text-tertiary">{response.duration_ms} ms</span>
                            {response.body_truncated && <span className="text-xs" style={{ color: 'var(--accent-warning)' }}>响应体已截断</span>}
                          </div>
                          {response.error && <div className="status-bar error mb-3">{response.error}</div>}
                          <textarea className="form-input text-mono select-text curl-response-textarea" rows={20} value={formatResponseBody(response.body, responseContentType)} readOnly />
                        </>
                      )}
                    </div>
                  )}
                  {tab === 'history' && (
                    <HistoryList
                      history={history}
                      editor={editor}
                      onRestore={(entry) => requestCurlAction({ type: 'restoreHistory', entry })}
                    />
                  )}
                </div>
              </section>

              <section className="curl-io-grid">
                <div className="curl-io-panel">
                  <div className="curl-io-title"><Import size={14} /> 导入 curl</div>
                  <textarea className="form-input text-mono curl-io-textarea" value={importText} onChange={(e) => setImportText(e.target.value)} placeholder="curl -X POST 'https://...'" />
                  <button className="btn btn-secondary btn-sm" onClick={() => requestCurlAction({ type: 'import' })} disabled={!selectedProjectId || !importText.trim()}><Upload size={13} /> 导入到编辑器</button>
                </div>
                <div className="curl-io-panel">
                  <div className="curl-io-title"><Copy size={14} /> 导出 curl {copied && <Check size={13} />}</div>
                  <textarea className="form-input text-mono select-text curl-io-textarea" value={exportText} readOnly placeholder="点击导出生成 curl" />
                  <button className="btn btn-secondary btn-sm" onClick={exportCurl} disabled={!editor}><Copy size={13} /> 复制导出命令</button>
                </div>
              </section>
            </>
          )}

          {notice && <div className={`status-bar ${notice.type} curl-status-row`} onClick={() => setNotice(null)}>{notice.text}</div>}
        </main>
      </div>
    </div>
  );
}

function TreeProject(props: {
  project: CurlProject;
  selectedProjectId: number | null;
  selectedRequestId: number | null;
  expandedProjects: Set<number>;
  expandedFolders: Set<number>;
  foldersByParent: Map<string, CurlFolder[]>;
  requestsByFolder: Map<string, CurlRequest[]>;
  onSelectProject: () => void;
  editingName: EditableNameTarget | null;
  onEditName: (target: EditableNameTarget) => void;
  onDeleteProject: (project: CurlProject) => void;
  onDeleteFolder: (folder: CurlFolder) => void;
  onChangeEditingName: (value: string) => void;
  onCommitNameEdit: () => void;
  onNameKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  onToggleProject: () => void;
  onToggleFolder: (id: number) => void;
  onSelectFolder: (folder: CurlFolder) => void;
  onSelectRequest: (request: CurlRequest) => void;
}) {
  const expanded = props.expandedProjects.has(props.project.id);
  const editing = props.editingName?.type === 'project' && props.editingName.id === props.project.id;
  const rootKey = `${props.project.id}:root`;
  const folders = props.foldersByParent.get(rootKey) || [];
  const requests = props.requestsByFolder.get(rootKey) || [];
  return (
    <div>
      <div className={`curl-tree-project-row text-sm ${props.selectedProjectId === props.project.id ? 'font-semibold' : ''}`}>
        <button className="btn btn-ghost btn-icon btn-sm" onClick={props.onToggleProject}>{expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}</button>
        {editing ? (
          <input
            autoFocus
            className="form-input"
            value={props.editingName?.value || ''}
            onChange={(event) => props.onChangeEditingName(event.target.value)}
            onBlur={props.onCommitNameEdit}
            onKeyDown={props.onNameKeyDown}
            style={{ height: 26, minWidth: 0, flex: 1 }}
          />
        ) : (
          <>
            <span
              className="curl-tree-label"
              onClick={props.onSelectProject}
              onDoubleClick={() => props.onEditName({ type: 'project', id: props.project.id, value: props.project.name })}
            >
              {props.project.name}
            </span>
            <button className="btn btn-ghost btn-icon btn-sm" onClick={() => props.onDeleteProject(props.project)} title="删除项目">
              <Trash2 size={12} />
            </button>
          </>
        )}
      </div>
      {expanded && (
        <div className="curl-tree-children">
          {folders.map((folder) => (
            <TreeFolder
              key={folder.id}
              folder={folder}
              selectedRequestId={props.selectedRequestId}
              expandedFolders={props.expandedFolders}
              foldersByParent={props.foldersByParent}
              requestsByFolder={props.requestsByFolder}
              editingName={props.editingName}
              onEditName={props.onEditName}
              onDeleteFolder={props.onDeleteFolder}
              onChangeEditingName={props.onChangeEditingName}
              onCommitNameEdit={props.onCommitNameEdit}
              onNameKeyDown={props.onNameKeyDown}
              onToggleFolder={props.onToggleFolder}
              onSelectFolder={props.onSelectFolder}
              onSelectRequest={props.onSelectRequest}
            />
          ))}
          {requests.map((request) => (
            <RequestRow
              key={request.id}
              request={request}
              selected={props.selectedRequestId === request.id}
              editingName={props.editingName}
              onEditName={props.onEditName}
              onChangeEditingName={props.onChangeEditingName}
              onCommitNameEdit={props.onCommitNameEdit}
              onNameKeyDown={props.onNameKeyDown}
              onSelect={props.onSelectRequest}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function TreeFolder(props: {
  folder: CurlFolder;
  selectedRequestId: number | null;
  expandedFolders: Set<number>;
  foldersByParent: Map<string, CurlFolder[]>;
  requestsByFolder: Map<string, CurlRequest[]>;
  editingName: EditableNameTarget | null;
  onEditName: (target: EditableNameTarget) => void;
  onDeleteFolder: (folder: CurlFolder) => void;
  onChangeEditingName: (value: string) => void;
  onCommitNameEdit: () => void;
  onNameKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  onToggleFolder: (id: number) => void;
  onSelectFolder: (folder: CurlFolder) => void;
  onSelectRequest: (request: CurlRequest) => void;
}) {
  const expanded = props.expandedFolders.has(props.folder.id);
  const editing = props.editingName?.type === 'folder' && props.editingName.id === props.folder.id;
  const key = `${props.folder.project_id}:${props.folder.id}`;
  const folders = props.foldersByParent.get(key) || [];
  const requests = props.requestsByFolder.get(key) || [];
  return (
    <div>
      <div className="curl-tree-folder-row text-sm">
        <button className="btn btn-ghost btn-icon btn-sm" onClick={() => props.onToggleFolder(props.folder.id)}>{expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}</button>
        <Folder size={13} className="text-tertiary" />
        {editing ? (
          <input
            autoFocus
            className="form-input"
            value={props.editingName?.value || ''}
            onChange={(event) => props.onChangeEditingName(event.target.value)}
            onBlur={props.onCommitNameEdit}
            onKeyDown={props.onNameKeyDown}
            style={{ height: 26, minWidth: 0, flex: 1 }}
          />
        ) : (
          <>
            <span
              className="curl-tree-label"
              onClick={() => props.onSelectFolder(props.folder)}
              onDoubleClick={() => props.onEditName({ type: 'folder', id: props.folder.id, value: props.folder.name })}
            >
              {props.folder.name}
            </span>
            <button className="btn btn-ghost btn-icon btn-sm" onClick={() => props.onDeleteFolder(props.folder)} title="删除目录">
              <Trash2 size={12} />
            </button>
          </>
        )}
      </div>
      {expanded && (
        <div className="curl-tree-children">
          {folders.map((folder) => (
            <TreeFolder
              key={folder.id}
              folder={folder}
              selectedRequestId={props.selectedRequestId}
              expandedFolders={props.expandedFolders}
              foldersByParent={props.foldersByParent}
              requestsByFolder={props.requestsByFolder}
              editingName={props.editingName}
              onEditName={props.onEditName}
              onDeleteFolder={props.onDeleteFolder}
              onChangeEditingName={props.onChangeEditingName}
              onCommitNameEdit={props.onCommitNameEdit}
              onNameKeyDown={props.onNameKeyDown}
              onToggleFolder={props.onToggleFolder}
              onSelectFolder={props.onSelectFolder}
              onSelectRequest={props.onSelectRequest}
            />
          ))}
          {requests.map((request) => (
            <RequestRow
              key={request.id}
              request={request}
              selected={props.selectedRequestId === request.id}
              editingName={props.editingName}
              onEditName={props.onEditName}
              onChangeEditingName={props.onChangeEditingName}
              onCommitNameEdit={props.onCommitNameEdit}
              onNameKeyDown={props.onNameKeyDown}
              onSelect={props.onSelectRequest}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function RequestRow({
  request,
  selected,
  editingName,
  onEditName,
  onChangeEditingName,
  onCommitNameEdit,
  onNameKeyDown,
  onSelect,
}: {
  request: CurlRequest;
  selected: boolean;
  editingName: EditableNameTarget | null;
  onEditName: (target: EditableNameTarget) => void;
  onChangeEditingName: (value: string) => void;
  onCommitNameEdit: () => void;
  onNameKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  onSelect: (request: CurlRequest) => void;
}) {
  const editing = editingName?.type === 'request' && editingName.id === request.id;
  return (
    <div className={`curl-request-row text-sm ${selected ? 'active font-semibold' : ''}`} onClick={() => onSelect(request)}>
      <span className="curl-method-badge">{request.method}</span>
      {editing ? (
        <input
          autoFocus
          className="form-input"
          value={editingName?.value || ''}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => onChangeEditingName(event.target.value)}
          onBlur={onCommitNameEdit}
          onKeyDown={onNameKeyDown}
          style={{ height: 26, width: 'calc(100% - 48px)' }}
        />
      ) : (
        <span className="curl-tree-label" onDoubleClick={(event) => {
          event.stopPropagation();
          onEditName({ type: 'request', id: request.id, value: request.name });
        }}>
          {request.name}
        </span>
      )}
    </div>
  );
}

function KeyValueEditor({ rows, onChange }: { rows: KeyValueRow[]; onChange: (rows: KeyValueRow[]) => void }) {
  const update = (index: number, patch: Partial<KeyValueRow>) => {
    const next = rows.map((row, i) => (i === index ? { ...row, ...patch } : row));
    onChange(next);
  };
  const remove = (index: number) => onChange(rows.filter((_, i) => i !== index));
  return (
    <div className="curl-key-value-editor">
      {rows.map((row, index) => (
        <div key={row.id || index} className="curl-key-value-row">
          <input type="checkbox" checked={row.enabled} onChange={(e) => update(index, { enabled: e.target.checked })} style={{ width: 16 }} />
          <input className="form-input text-mono" value={row.key} onChange={(e) => update(index, { key: e.target.value })} placeholder="键" style={{ flex: 1 }} />
          <input className="form-input text-mono" value={row.value} onChange={(e) => update(index, { value: e.target.value })} placeholder="值" style={{ flex: 1 }} />
          <button className="btn btn-ghost btn-icon btn-sm" onClick={() => remove(index)} title="删除行"><Trash2 size={13} /></button>
        </div>
      ))}
      <button className="btn btn-ghost btn-sm" onClick={() => onChange([...rows, newKeyValueRow()])}><Plus size={13} /> 添加行</button>
    </div>
  );
}

function HistoryList({ history, editor, onRestore }: { history: CurlHistoryEntry[]; editor: CurlRequestEditor; onRestore: (entry: CurlHistoryEntry) => void }) {
  if (history.length === 0) {
    return <div className="text-sm text-tertiary" style={{ padding: 'var(--space-6)', textAlign: 'center' }}><History size={28} style={{ margin: '0 auto var(--space-2)' }} />暂无历史</div>;
  }
  return (
    <div className="curl-history-list">
      {history.map((entry) => (
        <div key={entry.id} className="curl-history-row">
          <span className="text-xs font-semibold" style={{ color: 'var(--accent-primary)', width: 48 }}>{entry.method}</span>
          <span className="text-sm text-mono" style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.url}</span>
          <span className="text-xs" style={{ color: statusColor(entry.status), width: 48 }}>{entry.status ?? 'ERR'}</span>
          <span className="text-xs text-tertiary" style={{ width: 80 }}>{entry.duration_ms} ms</span>
          <span className="text-xs text-tertiary" style={{ width: 150 }}>{formatTime(entry.created_at)}</span>
          <button className="btn btn-ghost btn-sm" onClick={() => onRestore(entry)} disabled={!editor}>恢复</button>
        </div>
      ))}
    </div>
  );
}
