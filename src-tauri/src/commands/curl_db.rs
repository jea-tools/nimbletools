use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Clone, Serialize, Deserialize)]
pub struct CurlProject {
    pub id: i64,
    pub name: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct CurlFolder {
    pub id: i64,
    pub project_id: i64,
    pub parent_id: Option<i64>,
    pub name: String,
    pub sort_order: i64,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct CurlRequest {
    pub id: i64,
    pub project_id: i64,
    pub folder_id: Option<i64>,
    pub name: String,
    pub method: String,
    pub url: String,
    pub headers_json: String,
    pub query_json: String,
    pub body_type: String,
    pub body: String,
    pub sort_order: i64,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct CurlHistoryEntry {
    pub id: i64,
    pub request_id: Option<i64>,
    pub name: String,
    pub method: String,
    pub url: String,
    pub status: Option<u16>,
    pub duration_ms: u128,
    pub request_snapshot_json: String,
    pub response_headers_json: String,
    pub response_body: String,
    pub error: Option<String>,
    pub created_at: i64,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct CurlRequestDraft {
    pub project_id: i64,
    pub folder_id: Option<i64>,
    pub name: String,
    pub method: String,
    pub url: String,
    pub headers_json: String,
    pub query_json: String,
    pub body_type: String,
    pub body: String,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct CurlHistoryDraft {
    pub request_id: Option<i64>,
    pub name: String,
    pub method: String,
    pub url: String,
    pub status: Option<u16>,
    pub duration_ms: u128,
    pub request_snapshot_json: String,
    pub response_headers_json: String,
    pub response_body: String,
    pub error: Option<String>,
}

#[derive(Serialize)]
pub struct CurlWorkspace {
    pub projects: Vec<CurlProject>,
    pub folders: Vec<CurlFolder>,
    pub requests: Vec<CurlRequest>,
}

pub struct CurlDb {
    conn: Mutex<Connection>,
}

impl CurlDb {
    pub fn open(db_path: &PathBuf) -> Result<Self, String> {
        if let Some(parent) = db_path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS curl_projects (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS curl_folders (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id INTEGER NOT NULL,
                parent_id INTEGER,
                name TEXT NOT NULL,
                sort_order INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS curl_requests (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id INTEGER NOT NULL,
                folder_id INTEGER,
                name TEXT NOT NULL,
                method TEXT NOT NULL,
                url TEXT NOT NULL,
                headers_json TEXT NOT NULL DEFAULT '[]',
                query_json TEXT NOT NULL DEFAULT '[]',
                body_type TEXT NOT NULL DEFAULT 'none',
                body TEXT NOT NULL DEFAULT '',
                sort_order INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS curl_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                request_id INTEGER,
                name TEXT NOT NULL,
                method TEXT NOT NULL,
                url TEXT NOT NULL,
                status INTEGER,
                duration_ms INTEGER NOT NULL,
                request_snapshot_json TEXT NOT NULL,
                response_headers_json TEXT NOT NULL DEFAULT '[]',
                response_body TEXT NOT NULL DEFAULT '',
                error TEXT,
                created_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_curl_folders_project ON curl_folders(project_id);
            CREATE INDEX IF NOT EXISTS idx_curl_requests_project ON curl_requests(project_id);
            CREATE INDEX IF NOT EXISTS idx_curl_requests_folder ON curl_requests(folder_id);
            CREATE INDEX IF NOT EXISTS idx_curl_history_request ON curl_history(request_id);
            CREATE INDEX IF NOT EXISTS idx_curl_history_created ON curl_history(created_at DESC);",
        )
        .map_err(|e| e.to_string())?;

        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    pub fn create_project(&self, name: &str) -> Result<CurlProject, String> {
        let conn = self.conn.lock().unwrap();
        let now = now_secs();
        conn.execute(
            "INSERT INTO curl_projects (name, created_at, updated_at) VALUES (?1, ?2, ?3)",
            params![name, now, now],
        )
        .map_err(|e| e.to_string())?;

        Ok(CurlProject {
            id: conn.last_insert_rowid(),
            name: name.to_string(),
            created_at: now,
            updated_at: now,
        })
    }

    pub fn rename_project(&self, id: i64, name: &str) -> Result<CurlProject, String> {
        let conn = self.conn.lock().unwrap();
        let now = now_secs();
        conn.execute(
            "UPDATE curl_projects SET name = ?1, updated_at = ?2 WHERE id = ?3",
            params![name, now, id],
        )
        .map_err(|e| e.to_string())?;
        Self::get_project_inner(&conn, id)
    }

    pub fn delete_project(&self, id: i64) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM curl_history WHERE request_id IN (SELECT id FROM curl_requests WHERE project_id = ?1)", params![id])
            .map_err(|e| e.to_string())?;
        conn.execute(
            "DELETE FROM curl_requests WHERE project_id = ?1",
            params![id],
        )
        .map_err(|e| e.to_string())?;
        conn.execute(
            "DELETE FROM curl_folders WHERE project_id = ?1",
            params![id],
        )
        .map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM curl_projects WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn create_folder(
        &self,
        project_id: i64,
        parent_id: Option<i64>,
        name: &str,
    ) -> Result<CurlFolder, String> {
        let conn = self.conn.lock().unwrap();
        let sort_order = next_sort_order(
            &conn,
            "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM curl_folders WHERE project_id = ?1 AND parent_id IS ?2",
            project_id,
            parent_id,
        )?;
        conn.execute(
            "INSERT INTO curl_folders (project_id, parent_id, name, sort_order) VALUES (?1, ?2, ?3, ?4)",
            params![project_id, parent_id, name, sort_order],
        )
        .map_err(|e| e.to_string())?;

        Ok(CurlFolder {
            id: conn.last_insert_rowid(),
            project_id,
            parent_id,
            name: name.to_string(),
            sort_order,
        })
    }

    pub fn rename_folder(&self, id: i64, name: &str) -> Result<CurlFolder, String> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE curl_folders SET name = ?1 WHERE id = ?2",
            params![name, id],
        )
        .map_err(|e| e.to_string())?;
        Self::get_folder_inner(&conn, id)
    }

    pub fn delete_folder(&self, id: i64) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        let child_ids = Self::collect_descendant_folder_ids(&conn, id)?;
        for folder_id in child_ids.iter().rev() {
            conn.execute(
                "DELETE FROM curl_history WHERE request_id IN (SELECT id FROM curl_requests WHERE folder_id = ?1)",
                params![folder_id],
            )
            .map_err(|e| e.to_string())?;
            conn.execute(
                "DELETE FROM curl_requests WHERE folder_id = ?1",
                params![folder_id],
            )
            .map_err(|e| e.to_string())?;
            conn.execute("DELETE FROM curl_folders WHERE id = ?1", params![folder_id])
                .map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    pub fn create_request(&self, draft: CurlRequestDraft) -> Result<CurlRequest, String> {
        let conn = self.conn.lock().unwrap();
        let now = now_secs();
        let sort_order = next_sort_order(
            &conn,
            "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM curl_requests WHERE project_id = ?1 AND folder_id IS ?2",
            draft.project_id,
            draft.folder_id,
        )?;
        conn.execute(
            "INSERT INTO curl_requests (
                project_id, folder_id, name, method, url, headers_json, query_json, body_type,
                body, sort_order, created_at, updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
            params![
                draft.project_id,
                draft.folder_id,
                draft.name,
                draft.method,
                draft.url,
                draft.headers_json,
                draft.query_json,
                draft.body_type,
                draft.body,
                sort_order,
                now,
                now
            ],
        )
        .map_err(|e| e.to_string())?;

        let id = conn.last_insert_rowid();
        Self::get_request_inner(&conn, id)
    }

    pub fn save_request(
        &self,
        id: Option<i64>,
        draft: CurlRequestDraft,
    ) -> Result<CurlRequest, String> {
        if let Some(id) = id {
            let conn = self.conn.lock().unwrap();
            let now = now_secs();
            conn.execute(
                "UPDATE curl_requests SET
                    project_id = ?1, folder_id = ?2, name = ?3, method = ?4, url = ?5,
                    headers_json = ?6, query_json = ?7, body_type = ?8, body = ?9, updated_at = ?10
                 WHERE id = ?11",
                params![
                    draft.project_id,
                    draft.folder_id,
                    draft.name,
                    draft.method,
                    draft.url,
                    draft.headers_json,
                    draft.query_json,
                    draft.body_type,
                    draft.body,
                    now,
                    id
                ],
            )
            .map_err(|e| e.to_string())?;
            Self::get_request_inner(&conn, id)
        } else {
            self.create_request(draft)
        }
    }

    pub fn rename_request(&self, id: i64, name: &str) -> Result<CurlRequest, String> {
        let conn = self.conn.lock().unwrap();
        let now = now_secs();
        conn.execute(
            "UPDATE curl_requests SET name = ?1, updated_at = ?2 WHERE id = ?3",
            params![name, now, id],
        )
        .map_err(|e| e.to_string())?;
        Self::get_request_inner(&conn, id)
    }

    pub fn delete_request(&self, id: i64) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "DELETE FROM curl_history WHERE request_id = ?1",
            params![id],
        )
        .map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM curl_requests WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn get_request(&self, id: i64) -> Result<CurlRequest, String> {
        let conn = self.conn.lock().unwrap();
        Self::get_request_inner(&conn, id)
    }

    pub fn insert_history(&self, draft: CurlHistoryDraft) -> Result<CurlHistoryEntry, String> {
        let conn = self.conn.lock().unwrap();
        let now = now_secs();
        let duration_ms = i64::try_from(draft.duration_ms).unwrap_or(i64::MAX);
        let status = draft.status.map(|status| status as i64);
        conn.execute(
            "INSERT INTO curl_history (
                request_id, name, method, url, status, duration_ms, request_snapshot_json,
                response_headers_json, response_body, error, created_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![
                draft.request_id,
                draft.name,
                draft.method,
                draft.url,
                status,
                duration_ms,
                draft.request_snapshot_json,
                draft.response_headers_json,
                draft.response_body,
                draft.error,
                now
            ],
        )
        .map_err(|e| e.to_string())?;
        Self::get_history_inner(&conn, conn.last_insert_rowid())
    }

    pub fn list_history(
        &self,
        request_id: Option<i64>,
        limit: usize,
    ) -> Result<Vec<CurlHistoryEntry>, String> {
        let conn = self.conn.lock().unwrap();
        let limit = limit.clamp(1, 200) as i64;
        if let Some(request_id) = request_id {
            let mut stmt = conn
                .prepare(
                    "SELECT id, request_id, name, method, url, status, duration_ms,
                            request_snapshot_json, response_headers_json, response_body, error, created_at
                     FROM curl_history WHERE request_id = ?1 ORDER BY created_at DESC, id DESC LIMIT ?2",
                )
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map(params![request_id, limit], Self::history_from_row)
                .map_err(|e| e.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?;
            Ok(rows)
        } else {
            let mut stmt = conn
                .prepare(
                    "SELECT id, request_id, name, method, url, status, duration_ms,
                            request_snapshot_json, response_headers_json, response_body, error, created_at
                     FROM curl_history ORDER BY created_at DESC, id DESC LIMIT ?1",
                )
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map(params![limit], Self::history_from_row)
                .map_err(|e| e.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?;
            Ok(rows)
        }
    }

    pub fn clear_history(&self, request_id: Option<i64>) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        if let Some(request_id) = request_id {
            conn.execute(
                "DELETE FROM curl_history WHERE request_id = ?1",
                params![request_id],
            )
            .map_err(|e| e.to_string())?;
        } else {
            conn.execute("DELETE FROM curl_history", [])
                .map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    pub fn list_workspace(&self) -> Result<CurlWorkspace, String> {
        let conn = self.conn.lock().unwrap();
        let projects = {
            let mut stmt = conn
                .prepare("SELECT id, name, created_at, updated_at FROM curl_projects ORDER BY updated_at DESC, id DESC")
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map([], |row| {
                    Ok(CurlProject {
                        id: row.get(0)?,
                        name: row.get(1)?,
                        created_at: row.get(2)?,
                        updated_at: row.get(3)?,
                    })
                })
                .map_err(|e| e.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?;
            rows
        };
        let folders = {
            let mut stmt = conn
                .prepare("SELECT id, project_id, parent_id, name, sort_order FROM curl_folders ORDER BY project_id, parent_id, sort_order, id")
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map([], |row| {
                    Ok(CurlFolder {
                        id: row.get(0)?,
                        project_id: row.get(1)?,
                        parent_id: row.get(2)?,
                        name: row.get(3)?,
                        sort_order: row.get(4)?,
                    })
                })
                .map_err(|e| e.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?;
            rows
        };
        let requests = {
            let mut stmt = conn
                .prepare(
                    "SELECT id, project_id, folder_id, name, method, url, headers_json, query_json,
                            body_type, body, sort_order, created_at, updated_at
                     FROM curl_requests
                     ORDER BY project_id, folder_id, sort_order, id",
                )
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map([], Self::request_from_row)
                .map_err(|e| e.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?;
            rows
        };

        Ok(CurlWorkspace {
            projects,
            folders,
            requests,
        })
    }

    fn get_request_inner(conn: &Connection, id: i64) -> Result<CurlRequest, String> {
        conn.query_row(
            "SELECT id, project_id, folder_id, name, method, url, headers_json, query_json,
                    body_type, body, sort_order, created_at, updated_at
             FROM curl_requests WHERE id = ?1",
            params![id],
            Self::request_from_row,
        )
        .map_err(|e| e.to_string())
    }

    fn get_project_inner(conn: &Connection, id: i64) -> Result<CurlProject, String> {
        conn.query_row(
            "SELECT id, name, created_at, updated_at FROM curl_projects WHERE id = ?1",
            params![id],
            |row| {
                Ok(CurlProject {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    created_at: row.get(2)?,
                    updated_at: row.get(3)?,
                })
            },
        )
        .map_err(|e| e.to_string())
    }

    fn get_folder_inner(conn: &Connection, id: i64) -> Result<CurlFolder, String> {
        conn.query_row(
            "SELECT id, project_id, parent_id, name, sort_order FROM curl_folders WHERE id = ?1",
            params![id],
            |row| {
                Ok(CurlFolder {
                    id: row.get(0)?,
                    project_id: row.get(1)?,
                    parent_id: row.get(2)?,
                    name: row.get(3)?,
                    sort_order: row.get(4)?,
                })
            },
        )
        .map_err(|e| e.to_string())
    }

    fn request_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<CurlRequest> {
        Ok(CurlRequest {
            id: row.get(0)?,
            project_id: row.get(1)?,
            folder_id: row.get(2)?,
            name: row.get(3)?,
            method: row.get(4)?,
            url: row.get(5)?,
            headers_json: row.get(6)?,
            query_json: row.get(7)?,
            body_type: row.get(8)?,
            body: row.get(9)?,
            sort_order: row.get(10)?,
            created_at: row.get(11)?,
            updated_at: row.get(12)?,
        })
    }

    fn get_history_inner(conn: &Connection, id: i64) -> Result<CurlHistoryEntry, String> {
        conn.query_row(
            "SELECT id, request_id, name, method, url, status, duration_ms,
                    request_snapshot_json, response_headers_json, response_body, error, created_at
             FROM curl_history WHERE id = ?1",
            params![id],
            Self::history_from_row,
        )
        .map_err(|e| e.to_string())
    }

    fn history_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<CurlHistoryEntry> {
        let status: Option<i64> = row.get(5)?;
        let duration_ms: i64 = row.get(6)?;
        Ok(CurlHistoryEntry {
            id: row.get(0)?,
            request_id: row.get(1)?,
            name: row.get(2)?,
            method: row.get(3)?,
            url: row.get(4)?,
            status: status.map(|status| status as u16),
            duration_ms: duration_ms.max(0) as u128,
            request_snapshot_json: row.get(7)?,
            response_headers_json: row.get(8)?,
            response_body: row.get(9)?,
            error: row.get(10)?,
            created_at: row.get(11)?,
        })
    }

    fn collect_descendant_folder_ids(conn: &Connection, root_id: i64) -> Result<Vec<i64>, String> {
        let mut ids = vec![root_id];
        let mut index = 0;
        while index < ids.len() {
            let current = ids[index];
            let mut stmt = conn
                .prepare("SELECT id FROM curl_folders WHERE parent_id = ?1")
                .map_err(|e| e.to_string())?;
            let child_ids = stmt
                .query_map(params![current], |row| row.get::<_, i64>(0))
                .map_err(|e| e.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?;
            ids.extend(child_ids);
            index += 1;
        }
        Ok(ids)
    }
}

fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

fn next_sort_order(
    conn: &Connection,
    sql: &str,
    project_id: i64,
    parent_or_folder_id: Option<i64>,
) -> Result<i64, String> {
    conn.query_row(sql, params![project_id, parent_or_folder_id], |row| {
        row.get(0)
    })
    .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_db_path(name: &str) -> PathBuf {
        let mut path = std::env::temp_dir();
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        path.push(format!("nimbletools_{}_{}.db", name, nonce));
        path
    }

    #[test]
    fn project_folder_request_round_trip() {
        let path = temp_db_path("curl_round_trip");
        let db = CurlDb::open(&path).unwrap();

        let project = db.create_project("Demo").unwrap();
        let folder = db.create_folder(project.id, None, "Users").unwrap();
        let request = db
            .create_request(CurlRequestDraft {
                project_id: project.id,
                folder_id: Some(folder.id),
                name: "List users".into(),
                method: "GET".into(),
                url: "https://api.example.test/users".into(),
                headers_json: r#"[{"enabled":true,"key":"Accept","value":"application/json"}]"#
                    .into(),
                query_json: r#"[{"enabled":true,"key":"page","value":"1"}]"#.into(),
                body_type: "none".into(),
                body: String::new(),
            })
            .unwrap();

        let tree = db.list_workspace().unwrap();
        assert_eq!(tree.projects.len(), 1);
        assert_eq!(tree.folders.len(), 1);
        assert_eq!(tree.requests.len(), 1);
        assert_eq!(tree.requests[0].id, request.id);
        assert_eq!(tree.requests[0].name, "List users");

        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn history_round_trip_can_be_filtered_by_request() {
        let path = temp_db_path("curl_history");
        let db = CurlDb::open(&path).unwrap();
        let project = db.create_project("Demo").unwrap();
        let request = db
            .create_request(CurlRequestDraft {
                project_id: project.id,
                folder_id: None,
                name: "Ping".into(),
                method: "GET".into(),
                url: "https://api.example.test/ping".into(),
                headers_json: "[]".into(),
                query_json: "[]".into(),
                body_type: "none".into(),
                body: String::new(),
            })
            .unwrap();

        let entry = db
            .insert_history(CurlHistoryDraft {
                request_id: Some(request.id),
                name: request.name.clone(),
                method: request.method.clone(),
                url: request.url.clone(),
                status: Some(200),
                duration_ms: 42,
                request_snapshot_json: "{}".into(),
                response_headers_json: "[]".into(),
                response_body: "{\"ok\":true}".into(),
                error: None,
            })
            .unwrap();
        let history = db.list_history(Some(request.id), 10).unwrap();

        assert_eq!(history.len(), 1);
        assert_eq!(history[0].id, entry.id);
        assert_eq!(history[0].status, Some(200));
        assert_eq!(history[0].response_body, "{\"ok\":true}");

        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn rename_request_updates_only_request_name() {
        let path = temp_db_path("curl_rename_request");
        let db = CurlDb::open(&path).unwrap();
        let project = db.create_project("Demo").unwrap();
        let request = db
            .create_request(CurlRequestDraft {
                project_id: project.id,
                folder_id: None,
                name: "Old Name".into(),
                method: "POST".into(),
                url: "https://api.example.test/items".into(),
                headers_json: "[]".into(),
                query_json: "[]".into(),
                body_type: "json".into(),
                body: "{\"ok\":true}".into(),
            })
            .unwrap();

        let renamed = db.rename_request(request.id, "New Name").unwrap();

        assert_eq!(renamed.name, "New Name");
        assert_eq!(renamed.method, "POST");
        assert_eq!(renamed.url, "https://api.example.test/items");
        assert_eq!(renamed.body, "{\"ok\":true}");

        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn delete_project_removes_children_and_history() {
        let path = temp_db_path("curl_delete_project");
        let db = CurlDb::open(&path).unwrap();
        let project = db.create_project("Demo").unwrap();
        let other_project = db.create_project("Keep").unwrap();
        let folder = db.create_folder(project.id, None, "Users").unwrap();
        let request = db
            .create_request(CurlRequestDraft {
                project_id: project.id,
                folder_id: Some(folder.id),
                name: "Delete me".into(),
                method: "GET".into(),
                url: "https://api.example.test/delete".into(),
                headers_json: "[]".into(),
                query_json: "[]".into(),
                body_type: "none".into(),
                body: String::new(),
            })
            .unwrap();
        let kept_request = db
            .create_request(CurlRequestDraft {
                project_id: other_project.id,
                folder_id: None,
                name: "Keep me".into(),
                method: "GET".into(),
                url: "https://api.example.test/keep".into(),
                headers_json: "[]".into(),
                query_json: "[]".into(),
                body_type: "none".into(),
                body: String::new(),
            })
            .unwrap();

        db.insert_history(CurlHistoryDraft {
            request_id: Some(request.id),
            name: request.name.clone(),
            method: request.method.clone(),
            url: request.url.clone(),
            status: Some(200),
            duration_ms: 12,
            request_snapshot_json: "{}".into(),
            response_headers_json: "[]".into(),
            response_body: "{}".into(),
            error: None,
        })
        .unwrap();
        db.insert_history(CurlHistoryDraft {
            request_id: Some(kept_request.id),
            name: kept_request.name.clone(),
            method: kept_request.method.clone(),
            url: kept_request.url.clone(),
            status: Some(200),
            duration_ms: 18,
            request_snapshot_json: "{}".into(),
            response_headers_json: "[]".into(),
            response_body: "{}".into(),
            error: None,
        })
        .unwrap();

        db.delete_project(project.id).unwrap();

        let tree = db.list_workspace().unwrap();
        assert!(tree.projects.iter().all(|row| row.id != project.id));
        assert!(tree.folders.iter().all(|row| row.project_id != project.id));
        assert!(tree.requests.iter().all(|row| row.project_id != project.id));
        assert_eq!(db.list_history(Some(request.id), 10).unwrap().len(), 0);
        assert_eq!(db.list_history(Some(kept_request.id), 10).unwrap().len(), 1);

        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn delete_folder_removes_nested_children_requests_and_history() {
        let path = temp_db_path("curl_delete_folder");
        let db = CurlDb::open(&path).unwrap();
        let project = db.create_project("Demo").unwrap();
        let root = db.create_folder(project.id, None, "Root").unwrap();
        let child = db
            .create_folder(project.id, Some(root.id), "Child")
            .unwrap();
        let sibling = db.create_folder(project.id, None, "Sibling").unwrap();
        let root_request = db
            .create_request(CurlRequestDraft {
                project_id: project.id,
                folder_id: Some(root.id),
                name: "Root request".into(),
                method: "GET".into(),
                url: "https://api.example.test/root".into(),
                headers_json: "[]".into(),
                query_json: "[]".into(),
                body_type: "none".into(),
                body: String::new(),
            })
            .unwrap();
        let child_request = db
            .create_request(CurlRequestDraft {
                project_id: project.id,
                folder_id: Some(child.id),
                name: "Child request".into(),
                method: "GET".into(),
                url: "https://api.example.test/child".into(),
                headers_json: "[]".into(),
                query_json: "[]".into(),
                body_type: "none".into(),
                body: String::new(),
            })
            .unwrap();
        let sibling_request = db
            .create_request(CurlRequestDraft {
                project_id: project.id,
                folder_id: Some(sibling.id),
                name: "Sibling request".into(),
                method: "GET".into(),
                url: "https://api.example.test/sibling".into(),
                headers_json: "[]".into(),
                query_json: "[]".into(),
                body_type: "none".into(),
                body: String::new(),
            })
            .unwrap();

        for request in [&root_request, &child_request, &sibling_request] {
            db.insert_history(CurlHistoryDraft {
                request_id: Some(request.id),
                name: request.name.clone(),
                method: request.method.clone(),
                url: request.url.clone(),
                status: Some(200),
                duration_ms: 21,
                request_snapshot_json: "{}".into(),
                response_headers_json: "[]".into(),
                response_body: "{}".into(),
                error: None,
            })
            .unwrap();
        }

        db.delete_folder(root.id).unwrap();

        let tree = db.list_workspace().unwrap();
        assert!(tree
            .folders
            .iter()
            .all(|row| row.id != root.id && row.id != child.id));
        assert!(tree.folders.iter().any(|row| row.id == sibling.id));
        assert!(tree
            .requests
            .iter()
            .all(|row| row.id != root_request.id && row.id != child_request.id));
        assert!(tree.requests.iter().any(|row| row.id == sibling_request.id));
        assert_eq!(db.list_history(Some(root_request.id), 10).unwrap().len(), 0);
        assert_eq!(
            db.list_history(Some(child_request.id), 10).unwrap().len(),
            0
        );
        assert_eq!(
            db.list_history(Some(sibling_request.id), 10).unwrap().len(),
            1
        );

        let _ = std::fs::remove_file(path);
    }
}
