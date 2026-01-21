import type Database from 'better-sqlite3';
import { generateMessageId } from './database.js';

export interface OrchestratorTask {
  id: string;
  title: string;
  description?: string;
  created_by: string;
  status: string;
  created_at: string;
}

export class Orchestrator {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  createTask(title: string, createdBy: string, description?: string, priority = 0): OrchestratorTask {
    const id = `task_${generateMessageId().slice(4)}`;
    this.db.prepare(`
      INSERT INTO orch_tasks (id, title, description, created_by, priority)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, title, description || '', createdBy, priority);
    
    return this.db.prepare('SELECT * FROM orch_tasks WHERE id = ?').get(id) as OrchestratorTask;
  }

  assignTask(taskId: string, agentId: string, blocking = true): any {
    const assignId = `assign_${generateMessageId().slice(4)}`;
    this.db.prepare(`
      INSERT INTO orch_assignments (id, task_id, agent_id, blocking)
      VALUES (?, ?, ?, ?)
    `).run(assignId, taskId, agentId, blocking ? 1 : 0);
    
    return this.db.prepare('SELECT * FROM orch_assignments WHERE id = ?').get(assignId);
  }

  acceptTask(taskId: string, agentId: string): boolean {
    const result = this.db.prepare(`
      UPDATE orch_assignments 
      SET status = 'accepted', accepted_at = datetime('now')
      WHERE task_id = ? AND agent_id = ? AND status = 'assigned'
    `).run(taskId, agentId);
    
    return result.changes > 0;
  }

  submitResult(taskId: string, agentId: string, resultData: string): any {
    const resultId = `result_${generateMessageId().slice(4)}`;
    this.db.prepare(`
      INSERT INTO orch_results (id, task_id, agent_id, result_data)
      VALUES (?, ?, ?, ?)
    `).run(resultId, taskId, agentId, resultData);
    
    this.db.prepare(`
      UPDATE orch_assignments 
      SET status = 'submitted', submitted_at = datetime('now')
      WHERE task_id = ? AND agent_id = ?
    `).run(taskId, agentId);
    
    return this.db.prepare('SELECT * FROM orch_results WHERE id = ?').get(resultId);
  }

  approveResult(taskId: string, agentId: string, approvalNotes?: string): boolean {
    this.db.prepare(`
      UPDATE orch_results 
      SET approved = 1, approval_notes = ?
      WHERE task_id = ? AND agent_id = ?
    `).run(approvalNotes || '', taskId, agentId);
    
    this.db.prepare(`
      UPDATE orch_assignments 
      SET status = 'approved', approved_at = datetime('now')
      WHERE task_id = ? AND agent_id = ?
    `).run(taskId, agentId);
    
    this.db.prepare(`
      UPDATE orch_tasks SET status = 'completed' WHERE id = ?
    `).run(taskId);
    
    return true;
  }

  listTasks(filter?: { status?: string; agent_id?: string }): OrchestratorTask[] {
    let query = 'SELECT * FROM orch_tasks WHERE 1=1';
    const params: any[] = [];
    
    if (filter?.status) {
      query += ' AND status = ?';
      params.push(filter.status);
    }
    
    query += ' ORDER BY created_at DESC';
    return this.db.prepare(query).all(...params) as OrchestratorTask[];
  }
}
