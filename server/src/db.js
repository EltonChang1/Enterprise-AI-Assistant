import fs from 'fs';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';

const DEFAULT_DB_PATH = './data/enterprise_ai.db';

export function createDatabase(dbPath = process.env.DB_PATH || DEFAULT_DB_PATH) {
  const resolved = path.resolve(process.cwd(), dbPath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });

  const db = new DatabaseSync(resolved);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS organizations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      org_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin','user','viewer')),
      token TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(org_id) REFERENCES organizations(id)
    );

    CREATE TABLE IF NOT EXISTS documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      org_id INTEGER NOT NULL,
      source TEXT NOT NULL,
      uploaded_by INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(org_id) REFERENCES organizations(id),
      FOREIGN KEY(uploaded_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS knowledge_chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      org_id INTEGER NOT NULL,
      document_id INTEGER NOT NULL,
      text TEXT NOT NULL,
      embedding_json TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(org_id) REFERENCES organizations(id),
      FOREIGN KEY(document_id) REFERENCES documents(id)
    );

    CREATE TABLE IF NOT EXISTS chat_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      org_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      mode TEXT NOT NULL,
      question TEXT,
      answer TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(org_id) REFERENCES organizations(id),
      FOREIGN KEY(user_id) REFERENCES users(id)
    );
  `);

  const orgCount = db.prepare('SELECT COUNT(*) as count FROM organizations').get().count;
  if (orgCount === 0) {
    const insertOrg = db.prepare('INSERT INTO organizations (name, slug) VALUES (?, ?)');
    const orgResult = insertOrg.run('Acme Corp', 'acme');

    const insertUser = db.prepare(
      'INSERT INTO users (org_id, name, email, role, token) VALUES (?, ?, ?, ?, ?)'
    );

    insertUser.run(orgResult.lastInsertRowid, 'Acme Admin', 'admin@acme.example', 'admin', 'acme-admin-token');
    insertUser.run(orgResult.lastInsertRowid, 'Acme Analyst', 'analyst@acme.example', 'user', 'acme-user-token');
    insertUser.run(orgResult.lastInsertRowid, 'Acme Viewer', 'viewer@acme.example', 'viewer', 'acme-viewer-token');
  }

  return db;
}

export function findUserByToken(db, token) {
  return db
    .prepare(
      `
      SELECT u.id, u.org_id as orgId, u.name, u.email, u.role, u.token, o.name as orgName, o.slug as orgSlug
      FROM users u
      JOIN organizations o ON o.id = u.org_id
      WHERE u.token = ?
    `
    )
    .get(token);
}

export function getOrgKnowledgeSummary(db, orgId) {
  const chunksIndexed = db
    .prepare('SELECT COUNT(*) as count FROM knowledge_chunks WHERE org_id = ?')
    .get(orgId).count;

  const sources = db
    .prepare(
      `
      SELECT DISTINCT source
      FROM documents
      WHERE org_id = ?
      ORDER BY source ASC
    `
    )
    .all(orgId)
    .map((row) => row.source);

  return { chunksIndexed, sources };
}

export function insertDocumentWithChunks(db, { orgId, source, userId, chunks }) {
  const insertDoc = db.prepare(
    'INSERT INTO documents (org_id, source, uploaded_by) VALUES (?, ?, ?)'
  );
  const insertChunk = db.prepare(
    'INSERT INTO knowledge_chunks (org_id, document_id, text, embedding_json) VALUES (?, ?, ?, ?)'
  );

  db.exec('BEGIN');
  try {
    const doc = insertDoc.run(orgId, source, userId);
    const docId = Number(doc.lastInsertRowid);
    for (const chunk of chunks) {
      insertChunk.run(orgId, docId, chunk.text, chunk.embeddingJson);
    }
    db.exec('COMMIT');
    return doc;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function getOrgChunks(db, orgId) {
  return db
    .prepare(
      `
      SELECT c.id, c.text, c.embedding_json as embeddingJson, d.source
      FROM knowledge_chunks c
      JOIN documents d ON d.id = c.document_id
      WHERE c.org_id = ?
    `
    )
    .all(orgId);
}

export function insertChatLog(db, { orgId, userId, mode, question, answer }) {
  db.prepare(
    'INSERT INTO chat_logs (org_id, user_id, mode, question, answer) VALUES (?, ?, ?, ?, ?)'
  ).run(orgId, userId, mode, question || null, answer || null);
}
