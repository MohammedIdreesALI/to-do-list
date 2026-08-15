const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'taskflow.db');
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

const db = new DatabaseSync(DB_PATH);

// Enable foreign keys
db.exec('PRAGMA foreign_keys = ON;');

// Initialize schema
const schemaSql = fs.readFileSync(SCHEMA_PATH, 'utf8');
db.exec(schemaSql);

// Pre-seed Demo User and initial sample tasks if database is brand new
function seedInitialData() {
  const userCheck = db.prepare('SELECT id FROM users WHERE email = ?').get('demo@taskflow.pro');
  if (!userCheck) {
    const demoUserId = 'user_demo_101';
    const now = Date.now();

    // 1. Insert Demo User ('password123' hash)
    const insertUser = db.prepare(`
      INSERT INTO users (id, name, email, password_hash, avatar_color, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    insertUser.run(
      demoUserId,
      'Alex Morgan',
      'demo@taskflow.pro',
      'ef92b778bafe771e89245b89ecbc08a44a4e166c06659911881f383d4473e94f',
      'linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%)',
      now - 86400000 * 7
    );

    // 2. Insert User Stats
    const insertStats = db.prepare(`
      INSERT INTO user_stats (user_id, xp, streak_count, last_active_date, theme, sound_enabled)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    insertStats.run(demoUserId, 180, 3, new Date().toISOString().split('T')[0], 'light', 1);

    // 3. Insert Initial Tasks
    const insertTask = db.prepare(`
      INSERT INTO tasks (id, user_id, title, notes, priority, category, due_date, completed, kanban_status, pinned, order_index, created_at, completed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertSubtask = db.prepare(`
      INSERT INTO subtasks (id, task_id, title, completed, order_index)
      VALUES (?, ?, ?, ?, ?)
    `);

    const tomorrow = new Date(Date.now() + 86400000 * 1).toISOString().split('T')[0];
    const inThreeDays = new Date(Date.now() + 86400000 * 3).toISOString().split('T')[0];
    const yesterday = new Date(Date.now() - 86400000 * 1).toISOString().split('T')[0];

    // Task 1
    insertTask.run(
      'task_sql_1', demoUserId,
      'Finalize quarterly product roadmap & design system',
      'Coordinate milestone review with engineers in SQL.',
      'high', 'work', tomorrow, 0, 'inprogress', 1, 0, now - 3600000 * 4, null
    );
    insertSubtask.run('sub_1_1', 'task_sql_1', 'Audit typography scale & color tokens', 1, 0);
    insertSubtask.run('sub_1_2', 'task_sql_1', 'Prepare demo slide deck for review', 0, 1);

    // Task 2
    insertTask.run(
      'task_sql_2', demoUserId,
      'Schedule annual physical health checkup & dentist',
      'Confirm morning slot with clinic.',
      'medium', 'health', inThreeDays, 0, 'todo', 0, 1, now - 3600000 * 12, null
    );
    insertSubtask.run('sub_2_1', 'task_sql_2', 'Check health insurance policy card', 1, 0);

    // Task 3
    insertTask.run(
      'task_sql_3', demoUserId,
      'Reconcile monthly budget and investments',
      'Check spreadsheet against banking export.',
      'medium', 'finance', yesterday, 1, 'done', 0, 2, now - 3600000 * 24, now - 3600000 * 2
    );

    console.log('✅ SQLite database initialized with Demo User and relational seed data.');
  }
}

seedInitialData();

module.exports = {
  db,
  // Helper methods
  getUserByEmail(email) {
    return db.prepare('SELECT * FROM users WHERE LOWER(email) = LOWER(?)').get(email);
  },
  getUserById(id) {
    return db.prepare('SELECT id, name, email, avatar_color, created_at FROM users WHERE id = ?').get(id);
  },
  createUser(id, name, email, passwordHash, avatarColor) {
    const now = Date.now();
    db.prepare(`
      INSERT INTO users (id, name, email, password_hash, avatar_color, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, name, email, passwordHash, avatarColor || 'linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%)', now);

    db.prepare(`
      INSERT INTO user_stats (user_id, xp, streak_count, last_active_date, theme, sound_enabled)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, 20, 1, new Date().toISOString().split('T')[0], 'light', 1);

    return this.getUserById(id);
  },
  getUserFullData(userId) {
    const user = this.getUserById(userId);
    if (!user) return null;

    const stats = db.prepare('SELECT * FROM user_stats WHERE user_id = ?').get(userId) || {
      xp: 0, streak_count: 1, last_active_date: new Date().toISOString().split('T')[0], theme: 'light', sound_enabled: 1
    };

    const categories = db.prepare('SELECT name, color FROM custom_categories WHERE user_id = ?').all(userId);

    const taskRows = db.prepare('SELECT * FROM tasks WHERE user_id = ? ORDER BY order_index ASC, created_at DESC').all(userId);
    const subtaskRows = db.prepare(`
      SELECT s.* FROM subtasks s
      JOIN tasks t ON s.task_id = t.id
      WHERE t.user_id = ?
      ORDER BY s.order_index ASC
    `).all(userId);

    const subtasksByTaskId = {};
    for (const sub of subtaskRows) {
      if (!subtasksByTaskId[sub.task_id]) subtasksByTaskId[sub.task_id] = [];
      subtasksByTaskId[sub.task_id].push({
        id: sub.id,
        title: sub.title,
        completed: Boolean(sub.completed)
      });
    }

    const tasks = taskRows.map(t => ({
      id: t.id,
      title: t.title,
      notes: t.notes || '',
      priority: t.priority,
      category: t.category,
      dueDate: t.due_date || '',
      completed: Boolean(t.completed),
      kanbanStatus: t.kanban_status || 'todo',
      pinned: Boolean(t.pinned),
      order: t.order_index,
      createdAt: t.created_at,
      completedAt: t.completed_at,
      subtasks: subtasksByTaskId[t.id] || []
    }));

    return {
      user,
      stats: {
        xp: stats.xp,
        streakCount: stats.streak_count,
        lastActiveDate: stats.last_active_date,
        theme: stats.theme,
        soundEnabled: Boolean(stats.sound_enabled)
      },
      categories: categories.map(c => c.name),
      tasks
    };
  },
  upsertTask(userId, task) {
    const existing = db.prepare('SELECT id FROM tasks WHERE id = ? AND user_id = ?').get(task.id, userId);
    const now = Date.now();

    if (existing) {
      db.prepare(`
        UPDATE tasks
        SET title = ?, notes = ?, priority = ?, category = ?, due_date = ?,
            completed = ?, kanban_status = ?, pinned = ?, order_index = ?, completed_at = ?
        WHERE id = ? AND user_id = ?
      `).run(
        task.title, task.notes || '', task.priority || 'medium', task.category || 'work',
        task.dueDate || '', task.completed ? 1 : 0, task.kanbanStatus || (task.completed ? 'done' : 'todo'),
        task.pinned ? 1 : 0, task.order || 0, task.completed ? (task.completedAt || now) : null,
        task.id, userId
      );
    } else {
      db.prepare(`
        INSERT INTO tasks (id, user_id, title, notes, priority, category, due_date, completed, kanban_status, pinned, order_index, created_at, completed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        task.id, userId, task.title, task.notes || '', task.priority || 'medium', task.category || 'work',
        task.dueDate || '', task.completed ? 1 : 0, task.kanbanStatus || 'todo', task.pinned ? 1 : 0,
        task.order || 0, task.createdAt || now, task.completed ? now : null
      );
    }

    // Replace subtasks
    db.prepare('DELETE FROM subtasks WHERE task_id = ?').run(task.id);
    if (Array.isArray(task.subtasks) && task.subtasks.length > 0) {
      const insertSub = db.prepare(`
        INSERT INTO subtasks (id, task_id, title, completed, order_index)
        VALUES (?, ?, ?, ?, ?)
      `);
      task.subtasks.forEach((s, idx) => {
        insertSub.run(
          s.id || ('sub_' + Date.now() + '_' + idx),
          task.id,
          s.title,
          s.completed ? 1 : 0,
          idx
        );
      });
    }

    return task;
  },
  deleteTask(userId, taskId) {
    db.prepare('DELETE FROM tasks WHERE id = ? AND user_id = ?').run(taskId, userId);
  },
  updateUserStats(userId, stats) {
    db.prepare(`
      UPDATE user_stats
      SET xp = COALESCE(?, xp),
          streak_count = COALESCE(?, streak_count),
          last_active_date = COALESCE(?, last_active_date),
          theme = COALESCE(?, theme),
          sound_enabled = COALESCE(?, sound_enabled)
      WHERE user_id = ?
    `).run(
      stats.xp !== undefined ? stats.xp : null,
      stats.streakCount !== undefined ? stats.streakCount : null,
      stats.lastActiveDate || null,
      stats.theme || null,
      stats.soundEnabled !== undefined ? (stats.soundEnabled ? 1 : 0) : null,
      userId
    );
  },
  addCategory(userId, name, color) {
    const id = 'cat_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4);
    db.prepare(`
      INSERT INTO custom_categories (id, user_id, name, color, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, userId, name.toLowerCase(), color || '#3b82f6', Date.now());
  }
};
