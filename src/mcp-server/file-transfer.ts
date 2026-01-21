import { createHash } from 'crypto';
import { readFile, writeFile, copyFile, mkdir, unlink, stat } from 'fs/promises';
import { join, basename, extname } from 'path';
import type Database from 'better-sqlite3';

export interface FileTransferInfo {
  id: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  uploader_agent: string;
  uploader_session: string;
  storage_path: string;
  checksum_sha256: string;
  uploaded_at: string;
  expires_at: string | null;
  access_mode: 'private' | 'channel' | 'public';
  allowed_agents: string[];
  download_count: number;
  metadata: Record<string, unknown>;
}

export class FileTransferManager {
  private db: Database.Database;
  private storageDir: string;

  constructor(db: Database.Database, storageDir: string) {
    this.db = db;
    this.storageDir = storageDir;
  }

  async uploadFile(
    agentId: string,
    sessionId: string,
    filepath: string,
    accessMode: 'private' | 'channel' | 'public' = 'private',
    allowedAgents: string[] = [],
    ttl?: number,
    metadata: Record<string, unknown> = {}
  ): Promise<FileTransferInfo> {
    await mkdir(this.storageDir, { recursive: true });

    const fileBuffer = await readFile(filepath);
    const fileStats = await stat(filepath);
    const checksum = createHash('sha256').update(fileBuffer).digest('hex');
    
    const fileId = `file_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
    const filename = basename(filepath);
    const storagePath = join(this.storageDir, fileId);
    
    await copyFile(filepath, storagePath);

    const mimeType = this.getMimeType(filename);
    const uploadedAt = new Date().toISOString();
    const expiresAt = ttl ? new Date(Date.now() + ttl * 1000).toISOString() : null;

    this.db.prepare(`
      INSERT INTO file_transfers (
        id, filename, mime_type, size_bytes, uploader_agent, uploader_session,
        storage_path, checksum_sha256, uploaded_at, expires_at, access_mode,
        allowed_agents, download_count, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      fileId,
      filename,
      mimeType,
      fileStats.size,
      agentId,
      sessionId,
      storagePath,
      checksum,
      uploadedAt,
      expiresAt,
      accessMode,
      JSON.stringify(allowedAgents),
      0,
      JSON.stringify(metadata)
    );

    return {
      id: fileId,
      filename,
      mime_type: mimeType,
      size_bytes: fileStats.size,
      uploader_agent: agentId,
      uploader_session: sessionId,
      storage_path: storagePath,
      checksum_sha256: checksum,
      uploaded_at: uploadedAt,
      expires_at: expiresAt,
      access_mode: accessMode,
      allowed_agents: allowedAgents,
      download_count: 0,
      metadata
    };
  }

  async downloadFile(
    fileId: string,
    agentId: string,
    saveTo: string
  ): Promise<boolean> {
    const fileInfo = this.getFileInfo(fileId);
    
    if (!fileInfo) {
      return false;
    }

    if (!this.canAccess(fileInfo, agentId)) {
      return false;
    }

    if (fileInfo.expires_at && new Date(fileInfo.expires_at) < new Date()) {
      return false;
    }

    await copyFile(fileInfo.storage_path, saveTo);

    this.db.prepare(`
      UPDATE file_transfers 
      SET download_count = download_count + 1 
      WHERE id = ?
    `).run(fileId);

    return true;
  }

  listFiles(agentId: string, channel?: string): FileTransferInfo[] {
    const rows = this.db.prepare(`
      SELECT * FROM file_transfers
      WHERE (expires_at IS NULL OR datetime(expires_at) > datetime('now'))
      ORDER BY uploaded_at DESC
    `).all() as Array<{
      id: string;
      filename: string;
      mime_type: string;
      size_bytes: number;
      uploader_agent: string;
      uploader_session: string;
      storage_path: string;
      checksum_sha256: string;
      uploaded_at: string;
      expires_at: string | null;
      access_mode: string;
      allowed_agents: string;
      download_count: number;
      metadata: string;
    }>;

    return rows
      .map(row => this.rowToFileInfo(row))
      .filter(info => this.canAccess(info, agentId));
  }

  deleteFile(fileId: string, agentId: string): boolean {
    const fileInfo = this.getFileInfo(fileId);
    
    if (!fileInfo) {
      return false;
    }

    if (fileInfo.uploader_agent !== agentId) {
      return false;
    }

    unlink(fileInfo.storage_path).catch(() => {});

    this.db.prepare(`DELETE FROM file_transfers WHERE id = ?`).run(fileId);

    return true;
  }

  getFileInfo(fileId: string): FileTransferInfo | null {
    const row = this.db.prepare(`
      SELECT * FROM file_transfers WHERE id = ?
    `).get(fileId) as {
      id: string;
      filename: string;
      mime_type: string;
      size_bytes: number;
      uploader_agent: string;
      uploader_session: string;
      storage_path: string;
      checksum_sha256: string;
      uploaded_at: string;
      expires_at: string | null;
      access_mode: string;
      allowed_agents: string;
      download_count: number;
      metadata: string;
    } | undefined;

    if (!row) {
      return null;
    }

    return this.rowToFileInfo(row);
  }

  private rowToFileInfo(row: {
    id: string;
    filename: string;
    mime_type: string;
    size_bytes: number;
    uploader_agent: string;
    uploader_session: string;
    storage_path: string;
    checksum_sha256: string;
    uploaded_at: string;
    expires_at: string | null;
    access_mode: string;
    allowed_agents: string;
    download_count: number;
    metadata: string;
  }): FileTransferInfo {
    return {
      id: row.id,
      filename: row.filename,
      mime_type: row.mime_type,
      size_bytes: row.size_bytes,
      uploader_agent: row.uploader_agent,
      uploader_session: row.uploader_session,
      storage_path: row.storage_path,
      checksum_sha256: row.checksum_sha256,
      uploaded_at: row.uploaded_at,
      expires_at: row.expires_at,
      access_mode: row.access_mode as 'private' | 'channel' | 'public',
      allowed_agents: JSON.parse(row.allowed_agents),
      download_count: row.download_count,
      metadata: JSON.parse(row.metadata)
    };
  }

  private canAccess(fileInfo: FileTransferInfo, agentId: string): boolean {
    if (fileInfo.access_mode === 'public') {
      return true;
    }

    if (fileInfo.uploader_agent === agentId) {
      return true;
    }

    if (fileInfo.access_mode === 'private' && fileInfo.allowed_agents.includes(agentId)) {
      return true;
    }

    if (fileInfo.access_mode === 'channel') {
      return true;
    }

    return false;
  }

  private getMimeType(filename: string): string {
    const ext = extname(filename).toLowerCase();
    const mimeTypes: Record<string, string> = {
      '.txt': 'text/plain',
      '.json': 'application/json',
      '.js': 'application/javascript',
      '.ts': 'application/typescript',
      '.html': 'text/html',
      '.css': 'text/css',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.svg': 'image/svg+xml',
      '.pdf': 'application/pdf',
      '.zip': 'application/zip',
      '.tar': 'application/x-tar',
      '.gz': 'application/gzip'
    };

    return mimeTypes[ext] || 'application/octet-stream';
  }
}
