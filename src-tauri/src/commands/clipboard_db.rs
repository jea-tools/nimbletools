use rusqlite::{params, Connection};
use std::path::PathBuf;
use std::sync::Mutex;

const DEFAULT_MAX_HISTORY: usize = 500;

#[derive(Clone, serde::Serialize)]
pub struct DbClipboardEntry {
    pub id: i64,
    pub content_type: String,
    pub content: String,
    pub preview: String,
    pub timestamp: i64,
    pub pinned: bool,
}

pub struct ClipboardDb {
    conn: Mutex<Connection>,
}

impl ClipboardDb {
    pub fn open(db_path: &PathBuf) -> Result<Self, String> {
        if let Some(parent) = db_path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let conn = Connection::open(db_path).map_err(|e| e.to_string())?;

        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS clips (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                content_type TEXT NOT NULL DEFAULT 'text',
                content TEXT NOT NULL,
                preview TEXT NOT NULL DEFAULT '',
                timestamp INTEGER NOT NULL,
                pinned INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_clips_timestamp ON clips(timestamp DESC);
            CREATE INDEX IF NOT EXISTS idx_clips_content ON clips(content);",
        )
        .map_err(|e| e.to_string())?;

        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    /// 插入条目，返回 (新 id, 因超限被删除的图片路径列表)
    pub fn insert(
        &self,
        content_type: &str,
        content: &str,
        preview: &str,
        timestamp: i64,
    ) -> Result<(i64, Vec<String>), String> {
        let conn = self.conn.lock().unwrap();
        // 去重：已有相同内容则更新时间戳并返回
        let existing: Option<i64> = conn
            .query_row(
                "SELECT id FROM clips WHERE content = ?1",
                params![content],
                |row| row.get(0),
            )
            .ok();

        if let Some(id) = existing {
            conn.execute(
                "UPDATE clips SET timestamp = ?1 WHERE id = ?2",
                params![timestamp, id],
            )
            .map_err(|e| e.to_string())?;
            return Ok((id, vec![]));
        }

        conn.execute(
            "INSERT INTO clips (content_type, content, preview, timestamp) VALUES (?1, ?2, ?3, ?4)",
            params![content_type, content, preview, timestamp],
        )
        .map_err(|e| e.to_string())?;

        let id = conn.last_insert_rowid();

        // 超限清理：先查出待删除的图片条目路径，再执行删除
        let max = self.get_max_history_inner(&conn);
        let removed_paths = Self::collect_image_paths_to_purge(&conn, max);
        conn.execute(
            "DELETE FROM clips WHERE pinned = 0 AND id NOT IN (
                SELECT id FROM clips ORDER BY pinned DESC, timestamp DESC LIMIT ?1
            )",
            params![max as i64],
        )
        .map_err(|e| e.to_string())?;

        Ok((id, removed_paths))
    }

    pub fn list(&self, limit: usize) -> Vec<DbClipboardEntry> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn
            .prepare("SELECT id, content_type, content, preview, timestamp, pinned FROM clips ORDER BY pinned DESC, timestamp DESC LIMIT ?1")
            .unwrap();

        stmt.query_map(params![limit as i64], |row| {
            Ok(DbClipboardEntry {
                id: row.get(0)?,
                content_type: row.get(1)?,
                content: row.get(2)?,
                preview: row.get(3)?,
                timestamp: row.get(4)?,
                pinned: row.get::<_, i64>(5)? != 0,
            })
        })
        .unwrap()
        .filter_map(|r| r.ok())
        .collect()
    }

    /// 删除单条，返回被删条目的 (content_type, content)
    pub fn remove(&self, id: i64) -> Option<(String, String)> {
        let conn = self.conn.lock().unwrap();
        let entry = conn
            .query_row(
                "SELECT content_type, content FROM clips WHERE id = ?1",
                params![id],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
            )
            .ok();
        let _ = conn.execute("DELETE FROM clips WHERE id = ?1", params![id]);
        entry
    }

    /// 清空未收藏条目，返回被删的图片路径列表
    pub fn clear_all(&self) -> Vec<String> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn
            .prepare("SELECT content FROM clips WHERE pinned = 0 AND content_type = 'image'")
            .unwrap();
        let paths: Vec<String> = stmt
            .query_map([], |row| row.get(0))
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();
        let _ = conn.execute("DELETE FROM clips WHERE pinned = 0", []);
        paths
    }

    /// 查询超限将被删除的图片条目路径
    fn collect_image_paths_to_purge(conn: &Connection, max: usize) -> Vec<String> {
        let mut stmt = conn
            .prepare(
                "SELECT content FROM clips
                 WHERE pinned = 0 AND content_type = 'image'
                   AND id NOT IN (
                     SELECT id FROM clips ORDER BY pinned DESC, timestamp DESC LIMIT ?1
                   )",
            )
            .unwrap();
        stmt.query_map(params![max as i64], |row| row.get(0))
            .unwrap()
            .filter_map(|r| r.ok())
            .collect()
    }

    pub fn toggle_pin(&self, id: i64) -> bool {
        let conn = self.conn.lock().unwrap();
        let current: bool = conn
            .query_row(
                "SELECT pinned FROM clips WHERE id = ?1",
                params![id],
                |row| Ok(row.get::<_, i64>(0)? != 0),
            )
            .unwrap_or(false);
        let new_val = !current;
        let _ = conn.execute(
            "UPDATE clips SET pinned = ?1 WHERE id = ?2",
            params![new_val as i64, id],
        );
        new_val
    }

    pub fn find_by_content(&self, content: &str) -> Option<i64> {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT id FROM clips WHERE content = ?1",
            params![content],
            |row| row.get(0),
        )
        .ok()
    }

    // ─── 设置 ───

    #[allow(dead_code)]
    pub fn get_setting(&self, key: &str) -> Option<String> {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT value FROM settings WHERE key = ?1",
            params![key],
            |row| row.get(0),
        )
        .ok()
    }

    pub fn set_setting(&self, key: &str, value: &str) {
        let conn = self.conn.lock().unwrap();
        let _ = conn.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
            params![key, value],
        );
    }

    pub fn get_max_history(&self) -> usize {
        let conn = self.conn.lock().unwrap();
        self.get_max_history_inner(&conn)
    }

    fn get_max_history_inner(&self, conn: &Connection) -> usize {
        conn.query_row(
            "SELECT value FROM settings WHERE key = 'max_history'",
            [],
            |row| row.get::<_, String>(0),
        )
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(DEFAULT_MAX_HISTORY)
    }
}
