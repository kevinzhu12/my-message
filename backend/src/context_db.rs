// Context Database Module
// Manages the local SQLite database for storing AI-extracted contact context

use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// Contact context learned from conversations
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContactContext {
    pub handle: String,
    pub display_name: Option<String>,
    pub basic_info: BasicInfo,
    pub notes: Option<String>,
    pub last_analyzed_at: Option<i64>,
    pub last_analyzed_message_id: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct BasicInfo {
    pub birthday: Option<String>,
    pub hometown: Option<String>,
    pub work: Option<String>,
    pub school: Option<String>,
}

/// Database manager for contact context
pub struct ContextDb {
    conn: Connection,
}

impl ContextDb {
    /// Open or create the context database
    pub fn open() -> Result<Self, Box<dyn std::error::Error>> {
        let db_path = Self::get_db_path()?;

        // Ensure directory exists
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent)?;
        }

        let conn = Connection::open(&db_path)?;
        let db = ContextDb { conn };
        db.init_schema()?;
        Ok(db)
    }

    /// Get the database file path
    fn get_db_path() -> Result<PathBuf, Box<dyn std::error::Error>> {
        let home = std::env::var("HOME")?;
        Ok(PathBuf::from(home).join(".imessage-companion").join("context.db"))
    }

    /// Initialize database schema
    fn init_schema(&self) -> Result<(), Box<dyn std::error::Error>> {
        self.conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS contact_context (
                handle TEXT PRIMARY KEY,
                display_name TEXT,
                basic_info TEXT DEFAULT '{}',
                interests TEXT DEFAULT '[]',
                preferences TEXT DEFAULT '{}',
                relationship_history TEXT DEFAULT '[]',
                personality_notes TEXT,
                manual_notes TEXT,
                last_analyzed_at INTEGER,
                last_analyzed_message_id INTEGER,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_contact_context_name ON contact_context(display_name);
            "
        )?;
        Ok(())
    }

    // ============================================================================
    // Contact Cache Operations
    // ============================================================================

    pub fn get_cached_contact_name(
        &self,
        handle: &str,
    ) -> Result<Option<String>, Box<dyn std::error::Error>> {
        let result = self.conn.query_row(
            "SELECT display_name FROM contact_context
             WHERE handle = ?1 AND display_name IS NOT NULL AND display_name != ''",
            params![handle],
            |row| row.get(0),
        );

        match result {
            Ok(value) => Ok(Some(value)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(Box::new(e)),
        }
    }

    pub fn set_cached_contact_name(
        &self,
        handle: &str,
        display_name: &str,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)?
            .as_secs() as i64;

        self.conn.execute(
            "INSERT INTO contact_context (handle, display_name, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?3)
             ON CONFLICT(handle) DO UPDATE SET
                display_name = CASE
                    WHEN display_name IS NULL OR display_name = '' THEN ?2
                    ELSE display_name
                END,
                updated_at = ?3",
            params![handle, display_name, now],
        )?;
        Ok(())
    }

    pub fn search_cached_contacts_by_name(
        &self,
        query: &str,
    ) -> Result<Vec<(String, String)>, Box<dyn std::error::Error>> {
        let query_pattern = format!("%{}%", query.to_lowercase());
        let mut stmt = self.conn.prepare(
            "SELECT handle, display_name FROM contact_context
             WHERE display_name IS NOT NULL
               AND display_name != ''
               AND LOWER(display_name) LIKE ?1
             ORDER BY updated_at DESC
             LIMIT 200",
        )?;

        let rows = stmt.query_map(params![query_pattern], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| Box::new(e) as Box<dyn std::error::Error>)
    }

    // ============================================================================
    // Contact Context Operations
    // ============================================================================

    /// Get contact context by handle
    pub fn get_context(&self, handle: &str) -> Result<Option<ContactContext>, Box<dyn std::error::Error>> {
        let result = self.conn.query_row(
            "SELECT handle, display_name, basic_info, personality_notes,
                    last_analyzed_at, last_analyzed_message_id, created_at, updated_at
             FROM contact_context WHERE handle = ?1",
            params![handle],
            |row| {
                let basic_info_json: String = row.get(2)?;

                Ok(ContactContext {
                    handle: row.get(0)?,
                    display_name: row.get(1)?,
                    basic_info: serde_json::from_str(&basic_info_json).unwrap_or_default(),
                    notes: row.get(3)?,
                    last_analyzed_at: row.get(4)?,
                    last_analyzed_message_id: row.get(5)?,
                    created_at: row.get(6)?,
                    updated_at: row.get(7)?,
                })
            },
        );

        match result {
            Ok(ctx) => Ok(Some(ctx)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(Box::new(e)),
        }
    }

    /// Save or update contact context
    pub fn save_context(&self, context: &ContactContext) -> Result<(), Box<dyn std::error::Error>> {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)?
            .as_secs() as i64;

        let basic_info_json = serde_json::to_string(&context.basic_info)?;

        self.conn.execute(
            "INSERT INTO contact_context
                (handle, display_name, basic_info, personality_notes,
                 last_analyzed_at, last_analyzed_message_id, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)
             ON CONFLICT(handle) DO UPDATE SET
                display_name = COALESCE(?2, display_name),
                basic_info = ?3,
                personality_notes = ?4,
                last_analyzed_at = ?5,
                last_analyzed_message_id = ?6,
                updated_at = ?7",
            params![
                context.handle,
                context.display_name,
                basic_info_json,
                context.notes,
                context.last_analyzed_at,
                context.last_analyzed_message_id,
                now
            ],
        )?;
        Ok(())
    }

    /// Update only notes field
    pub fn update_notes(&self, handle: &str, notes: &str) -> Result<(), Box<dyn std::error::Error>> {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)?
            .as_secs() as i64;

        let rows = self.conn.execute(
            "UPDATE contact_context SET personality_notes = ?1, updated_at = ?2 WHERE handle = ?3",
            params![notes, now, handle],
        )?;

        if rows == 0 {
            // Create new entry with just notes
            self.conn.execute(
                "INSERT INTO contact_context (handle, personality_notes, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?3)",
                params![handle, notes, now],
            )?;
        }
        Ok(())
    }

}
