import type { BbPluginApi } from "@get-bb/plugin-sdk";

/**
 * Plugin storage migrations are global to one BB plugin database. Every
 * server slice calls this same ordered list rather than competing for a
 * migration index with a slice-local list.
 */
const workSidebarStorageMigrations = [
  `CREATE TABLE IF NOT EXISTS work_binding_state (
     singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
     bindings_json TEXT NOT NULL,
     updated_at TEXT NOT NULL
   );
   CREATE TABLE IF NOT EXISTS work_binding_metadata (
     key TEXT PRIMARY KEY,
     value TEXT NOT NULL
   );`,
  `CREATE TABLE IF NOT EXISTS sidebar_task_assignee_state (
     task_id TEXT PRIMARY KEY,
     assignee TEXT NOT NULL CHECK (assignee IN ('agent', 'human')),
     updated_at TEXT NOT NULL
   );
   CREATE TABLE IF NOT EXISTS sidebar_task_assignee_metadata (
     key TEXT PRIMARY KEY,
     value TEXT NOT NULL
   );`,
  `CREATE TABLE IF NOT EXISTS work_item_queue_state (
     root_thread_id TEXT PRIMARY KEY,
     queue_json TEXT NOT NULL,
     updated_at TEXT NOT NULL
   );
   CREATE TABLE IF NOT EXISTS work_item_queue_metadata (
     key TEXT PRIMARY KEY,
     value TEXT NOT NULL
   );`,
  `CREATE TABLE IF NOT EXISTS tracker_link_state (
     root_thread_id TEXT PRIMARY KEY,
     links_json TEXT NOT NULL,
     updated_at TEXT NOT NULL
   );
   CREATE TABLE IF NOT EXISTS tracker_link_metadata (
     key TEXT PRIMARY KEY,
     value TEXT NOT NULL
   );`,
  `CREATE TABLE IF NOT EXISTS human_inbox_messages (
     id TEXT PRIMARY KEY,
     thread_id TEXT NOT NULL,
     project_id TEXT NOT NULL,
     subject TEXT,
     body TEXT NOT NULL,
     agent_thread_id TEXT,
     provider_id TEXT,
     agent_label TEXT,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL,
     acknowledged_at TEXT,
     bookmarked_at TEXT,
     revision INTEGER NOT NULL CHECK (revision > 0),
     idempotency_key TEXT,
     UNIQUE(thread_id, idempotency_key)
   );
   CREATE INDEX IF NOT EXISTS human_inbox_messages_thread_updated
     ON human_inbox_messages(thread_id, updated_at DESC, id DESC);
   CREATE INDEX IF NOT EXISTS human_inbox_messages_thread_saved
     ON human_inbox_messages(thread_id, bookmarked_at, acknowledged_at, updated_at DESC);`,
];

export function pluginStorageDatabase(bb: Pick<BbPluginApi, "storage">) {
  const database = bb.storage.database();
  bb.storage.migrate(database, workSidebarStorageMigrations);
  return database;
}
