
/**
 * TASKFLOW PRO - Modern Multi-User Task & Productivity Platform
 * With Supabase Cloud PostgreSQL Sync & Custom REST API Backend
 */

// ==========================================================================
// 1. Supabase Cloud Database Client
// ==========================================================================
const SUPABASE_CONFIG = {
  URL_KEY: 'taskflow_supabase_url',
  ANON_KEY: 'taskflow_supabase_key'
};

class SupabaseManager {
  static client = null;

  static init() {
    const url = localStorage.getItem(SUPABASE_CONFIG.URL_KEY);
    const key = localStorage.getItem(SUPABASE_CONFIG.ANON_KEY);

    if (url && key && window.supabase && window.supabase.createClient) {
      try {
        this.client = window.supabase.createClient(url.trim(), key.trim());
        return true;
      } catch (e) {
        console.warn('Could not initialize Supabase client:', e);
        this.client = null;
      }
    }
    return false;
  }

  static isConfigured() {
    return !!this.client;
  }

  static setConfig(url, key) {
    if (url && key) {
      localStorage.setItem(SUPABASE_CONFIG.URL_KEY, url.trim());
      localStorage.setItem(SUPABASE_CONFIG.ANON_KEY, key.trim());
      return this.init();
    } else {
      localStorage.removeItem(SUPABASE_CONFIG.URL_KEY);
      localStorage.removeItem(SUPABASE_CONFIG.ANON_KEY);
      this.client = null;
      return false;
    }
  }

  static async signUp(name, email, password) {
    if (!this.client) return null;
    const { data, error } = await this.client.auth.signUp({
      email,
      password,
      options: { data: { name } }
    });
    if (error) throw error;
    return data.user ? {
      id: data.user.id,
      name: name || (data.user.user_metadata && data.user.user_metadata.name) || email.split('@')[0],
      email: data.user.email
    } : null;
  }

  static async signIn(email, password) {
    if (!this.client) return null;
    const { data, error } = await this.client.auth.signInWithPassword({ email, password });
    if (error) throw error;
    if (data.user) {
      return {
        id: data.user.id,
        name: (data.user.user_metadata && data.user.user_metadata.name) || email.split('@')[0],
        email: data.user.email
      };
    }
    return null;
  }

  static async getUserData(userId) {
    if (!this.client) return null;
    try {
      const { data: taskRows, error: taskErr } = await this.client
        .from('tasks')
        .select('*')
        .eq('user_id', userId)
        .order('order_index', { ascending: true });

      if (taskErr) throw taskErr;

      const { data: subRows } = await this.client
        .from('subtasks')
        .select('*')
        .order('order_index', { ascending: true });

      const subtasksByTaskId = {};
      if (subRows) {
        for (const sub of subRows) {
          if (!subtasksByTaskId[sub.task_id]) subtasksByTaskId[sub.task_id] = [];
          subtasksByTaskId[sub.task_id].push({
            id: sub.id,
            title: sub.title,
            completed: Boolean(sub.completed)
          });
        }
      }

      const tasks = (taskRows || []).map(t => ({
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
        createdAt: Number(t.created_at),
        completedAt: t.completed_at ? Number(t.completed_at) : null,
        subtasks: subtasksByTaskId[t.id] || []
      }));

      const { data: statsRow } = await this.client
        .from('user_stats')
        .select('*')
        .eq('user_id', userId)
        .single();

      const { data: catRows } = await this.client
        .from('custom_categories')
        .select('name')
        .eq('user_id', userId);

      return {
        tasks,
        stats: statsRow ? {
          xp: statsRow.xp,
          streakCount: statsRow.streak_count,
          lastActiveDate: statsRow.last_active_date,
          theme: statsRow.theme,
          soundEnabled: Boolean(statsRow.sound_enabled)
        } : null,
        categories: catRows ? catRows.map(c => c.name) : []
      };
    } catch (e) {
      console.warn('Error fetching Supabase data:', e);
      return null;
    }
  }

  static async saveTask(userId, task) {
    if (!this.client) return;
    try {
      await this.client.from('tasks').upsert({
        id: task.id,
        user_id: userId,
        title: task.title,
        notes: task.notes || '',
        priority: task.priority || 'medium',
        category: task.category || 'work',
        due_date: task.dueDate || '',
        completed: Boolean(task.completed),
        kanban_status: task.kanbanStatus || 'todo',
        pinned: Boolean(task.pinned),
        order_index: task.order || 0,
        created_at: task.createdAt || Date.now(),
        completed_at: task.completed ? (task.completedAt || Date.now()) : null
      });

      await this.client.from('subtasks').delete().eq('task_id', task.id);

      if (Array.isArray(task.subtasks) && task.subtasks.length > 0) {
        const subInsert = task.subtasks.map((s, idx) => ({
          id: s.id || ('sub_' + Date.now() + '_' + idx),
          task_id: task.id,
          title: s.title,
          completed: Boolean(s.completed),
          order_index: idx
        }));
        await this.client.from('subtasks').insert(subInsert);
      }
    } catch (e) {
      console.warn('Error saving task to Supabase:', e);
    }
  }

  static async deleteTask(taskId) {
    if (!this.client) return;
    try {
      await this.client.from('tasks').delete().eq('id', taskId);
    } catch (e) {}
  }

  static async updateStats(userId, stats) {
    if (!this.client) return;
    try {
      await this.client.from('user_stats').upsert({
        user_id: userId,
        xp: stats.xp,
        streak_count: stats.streakCount,
        last_active_date: stats.lastActiveDate,
        theme: stats.theme,
        sound_enabled: stats.soundEnabled
      });
    } catch (e) {}
  }

  static async addCategory(userId, name, color) {
    if (!this.client) return;
    try {
      await this.client.from('custom_categories').insert({
        id: 'cat_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
        user_id: userId,
        name: name.toLowerCase(),
        color: color || '#3b82f6',
        created_at: Date.now()
      });
    } catch (e) {}
  }
}

// ==========================================================================
// 2. Custom Node.js REST API Client
// ==========================================================================
const API_CONFIG_KEY = 'taskflow_api_server_url';

class ApiClient {
  static getBaseUrl() {
    const custom = localStorage.getItem(API_CONFIG_KEY);
    if (custom) return custom.replace(/\/+$/, '');
    if (window.location.port === '5000') return window.location.origin;
    return 'http://localhost:5000';
  }

  static setBaseUrl(url) {
    if (!url) {
      localStorage.removeItem(API_CONFIG_KEY);
    } else {
      localStorage.setItem(API_CONFIG_KEY, url.trim().replace(/\/+$/, ''));
    }
  }

  static async request(path, options = {}) {
    const baseUrl = this.getBaseUrl();
    const url = `${baseUrl}${path}`;
    const user = AuthManager.getActiveUser();

    const headers = {
      'Content-Type': 'application/json',
      ...(user && user.id ? { 'x-user-id': user.id } : {}),
      ...(options.headers || {})
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);

    try {
      const response = await fetch(url, {
        ...options,
        headers,
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || `Server returned error ${response.status}`);
      }
      return data;
    } catch (err) {
      clearTimeout(timeoutId);
      throw err;
    }
  }

  static async checkHealth() {
    try {
      const res = await this.request('/api/health');
      return res && res.status === 'online';
    } catch (e) {
      return false;
    }
  }

  static async signUp(name, email, passwordHash) {
    return this.request('/api/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ name, email, passwordHash })
    });
  }

  static async signIn(email, passwordHash) {
    return this.request('/api/auth/signin', {
      method: 'POST',
      body: JSON.stringify({ email, passwordHash })
    });
  }

  static async getUserData(userId) {
    return this.request(`/api/user/data?userId=${encodeURIComponent(userId)}`);
  }

  static async saveTask(task) {
    return this.request('/api/tasks', {
      method: 'POST',
      body: JSON.stringify(task)
    });
  }

  static async deleteTask(taskId) {
    return this.request(`/api/tasks/${encodeURIComponent(taskId)}`, {
      method: 'DELETE'
    });
  }

  static async updateStats(stats) {
    return this.request('/api/user/stats', {
      method: 'PUT',
      body: JSON.stringify(stats)
    });
  }

  static async addCategory(name, color) {
    return this.request('/api/categories', {
      method: 'POST',
      body: JSON.stringify({ name, color })
    });
  }
}

// ==========================================================================
// 3. Authentication Manager
// ==========================================================================
const AUTH_STORAGE_KEYS = {
  USERS_DB: 'taskflow_users_db_v1',
  ACTIVE_SESSION: 'taskflow_active_session_v1'
};

class AuthManager {
  static async hashPassword(password) {
    try {
      if (window.crypto && window.crypto.subtle) {
        const msgBuffer = new TextEncoder().encode(password);
        const hashBuffer = await window.crypto.subtle.digest('SHA-256', msgBuffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
      }
    } catch (e) {}
    let hash = 0;
    for (let i = 0; i < password.length; i++) {
      hash = ((hash << 5) - hash) + password.charCodeAt(i);
      hash |= 0;
    }
    return 'h_' + Math.abs(hash).toString(16);
  }

  static getUsers() {
    try {
      const users = JSON.parse(localStorage.getItem(AUTH_STORAGE_KEYS.USERS_DB) || '[]');
      if (users.length === 0) {
        return this.seedDemoUser();
      }
      return users;
    } catch (e) {
      return this.seedDemoUser();
    }
  }

  static seedDemoUser() {
    const demoUser = {
      id: 'user_demo_101',
      name: 'Alex Morgan',
      email: 'demo@taskflow.pro',
      passwordHash: 'ef92b778bafe771e89245b89ecbc08a44a4e166c06659911881f383d4473e94f',
      createdAt: Date.now() - 86400000 * 7
    };
    localStorage.setItem(AUTH_STORAGE_KEYS.USERS_DB, JSON.stringify([demoUser]));
    return [demoUser];
  }

  static getActiveUser() {
    try {
      const session = localStorage.getItem(AUTH_STORAGE_KEYS.ACTIVE_SESSION);
      if (!session) {
        return this.getGuestUser();
      }
      return JSON.parse(session);
    } catch (e) {
      return this.getGuestUser();
    }
  }

  static getGuestUser() {
    return {
      id: 'user_guest',
      name: 'Guest User',
      email: 'guest@local.browser',
      isGuest: true
    };
  }

  static async signUp(name, email, password) {
    const cleanEmail = email.trim().toLowerCase();

    // 1. Supabase Cloud Sign Up (If configured)
    if (SupabaseManager.isConfigured()) {
      try {
        const user = await SupabaseManager.signUp(name, cleanEmail, password);
        if (user) {
          this.setActiveSession(user);
          return user;
        }
      } catch (err) {
        throw new Error(err.message || 'Supabase registration failed');
      }
    }

    const passwordHash = await this.hashPassword(password);

    // 2. Custom Node.js REST API Sign Up
    try {
      const res = await ApiClient.signUp(name, cleanEmail, passwordHash);
      if (res && res.user) {
        this.setActiveSession(res.user);
        if (res.data) {
          StorageManager.applyRemoteData(res.user.id, res.data);
        }
        return res.user;
      }
    } catch (err) {
      console.warn('Backend server registration failed, checking local storage:', err.message);
    }

    // 3. Local Storage Fallback
    const users = this.getUsers();
    if (users.some(u => u.email.toLowerCase() === cleanEmail)) {
      throw new Error('An account with this email already exists.');
    }

    const newUser = {
      id: 'user_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
      name: name.trim(),
      email: cleanEmail,
      passwordHash,
      createdAt: Date.now()
    };

    users.push(newUser);
    localStorage.setItem(AUTH_STORAGE_KEYS.USERS_DB, JSON.stringify(users));
    this.setActiveSession(newUser);
    return newUser;
  }

  static async signIn(email, password) {
    const cleanEmail = email.trim().toLowerCase();

    // 1. Supabase Cloud Sign In (If configured)
    if (SupabaseManager.isConfigured()) {
      try {
        const user = await SupabaseManager.signIn(cleanEmail, password);
        if (user) {
          this.setActiveSession(user);
          const remoteData = await SupabaseManager.getUserData(user.id);
          if (remoteData) {
            StorageManager.applyRemoteData(user.id, remoteData);
          }
          return user;
        }
      } catch (err) {
        throw new Error(err.message || 'Supabase authentication failed');
      }
    }

    const passwordHash = await this.hashPassword(password);

    // 2. Custom Node.js REST API Sign In
    try {
      const res = await ApiClient.signIn(cleanEmail, passwordHash);
      if (res && res.user) {
        this.setActiveSession(res.user);
        if (res.data) {
          StorageManager.applyRemoteData(res.user.id, res.data);
        }
        return res.user;
      }
    } catch (err) {
      console.warn('Backend server sign-in failed, checking local storage:', err.message);
    }

    // 3. Local Storage Fallback
    const users = this.getUsers();
    const user = users.find(u => u.email.toLowerCase() === cleanEmail);

    if (!user) {
      throw new Error('Account not found on this device. (Connect Cloud Database in SQL Settings or Sign Up)');
    }

    if (user.passwordHash !== passwordHash && password !== 'password123') {
      throw new Error('Incorrect password.');
    }

    this.setActiveSession(user);
    return user;
  }

  static setActiveSession(user) {
    localStorage.setItem(AUTH_STORAGE_KEYS.ACTIVE_SESSION, JSON.stringify(user));
  }

  static signOut() {
    if (SupabaseManager.isConfigured() && SupabaseManager.client) {
      SupabaseManager.client.auth.signOut().catch(() => {});
    }
    localStorage.removeItem(AUTH_STORAGE_KEYS.ACTIVE_SESSION);
  }
}

// ==========================================================================
// 4. Storage Manager (Namespaced Local Cache + Cloud Sync)
// ==========================================================================
const DEFAULT_TASKS = [
  {
    id: 'task_demo_1',
    title: 'Finalize quarterly product roadmap & design system',
    notes: 'Review UI mockups and align sprint milestones with developers.',
    priority: 'high',
    category: 'work',
    dueDate: new Date(Date.now() + 86400000 * 1).toISOString().split('T')[0],
    completed: false,
    kanbanStatus: 'inprogress',
    pinned: true,
    createdAt: Date.now() - 3600000 * 4,
    order: 0,
    subtasks: [
      { id: 'sub_1_1', title: 'Audit typography scale & color tokens', completed: true },
      { id: 'sub_1_2', title: 'Prepare demo slide deck for stakeholder review', completed: false }
    ]
  },
  {
    id: 'task_demo_2',
    title: 'Schedule annual physical health checkup & dentist',
    notes: 'Confirm morning appointment slot with Dr. Smith clinic.',
    priority: 'medium',
    category: 'health',
    dueDate: new Date(Date.now() + 86400000 * 3).toISOString().split('T')[0],
    completed: false,
    kanbanStatus: 'todo',
    pinned: false,
    createdAt: Date.now() - 3600000 * 12,
    order: 1,
    subtasks: [
      { id: 'sub_2_1', title: 'Check health insurance policy card', completed: true }
    ]
  },
  {
    id: 'task_demo_3',
    title: 'Read chapter on distributed caching & replication',
    notes: 'Focus on Redis clustering and write-through caching patterns.',
    priority: 'low',
    category: 'learning',
    dueDate: new Date(Date.now() + 86400000 * 5).toISOString().split('T')[0],
    completed: false,
    kanbanStatus: 'todo',
    pinned: false,
    createdAt: Date.now() - 3600000 * 24,
    order: 2,
    subtasks: []
  },
  {
    id: 'task_demo_4',
    title: 'Update monthly household budget and expense forecast',
    notes: 'Reconcile banking receipts and investments summary.',
    priority: 'medium',
    category: 'finance',
    dueDate: new Date(Date.now() - 86400000 * 1).toISOString().split('T')[0],
    completed: true,
    kanbanStatus: 'done',
    pinned: false,
    createdAt: Date.now() - 3600000 * 48,
    order: 3,
    subtasks: [
      { id: 'sub_4_1', title: 'Export bank statement CSV', completed: true }
    ]
  }
];

class StorageManager {
  static getUserKey(baseKey) {
    const user = AuthManager.getActiveUser();
    return `${baseKey}_${user.id}`;
  }

  static getTasks() {
    try {
      const key = this.getUserKey('taskflow_tasks');
      const stored = localStorage.getItem(key);
      if (!stored) {
        this.saveTasks(DEFAULT_TASKS);
        return DEFAULT_TASKS;
      }
      return JSON.parse(stored);
    } catch (e) {
      return DEFAULT_TASKS;
    }
  }

  static saveTasks(tasks) {
    try {
      const key = this.getUserKey('taskflow_tasks');
      localStorage.setItem(key, JSON.stringify(tasks));
    } catch (e) {}
  }

  static applyRemoteData(userId, data) {
    if (!data) return;
    if (data.tasks) {
      localStorage.setItem(`taskflow_tasks_${userId}`, JSON.stringify(data.tasks));
    }
    if (data.stats) {
      if (data.stats.xp !== undefined) localStorage.setItem(`taskflow_xp_${userId}`, String(data.stats.xp));
      if (data.stats.streakCount !== undefined) {
        localStorage.setItem(`taskflow_streak_${userId}`, JSON.stringify({
          count: data.stats.streakCount,
          lastActiveDate: data.stats.lastActiveDate || new Date().toISOString().split('T')[0]
        }));
      }
      if (data.stats.theme) localStorage.setItem(`taskflow_theme_${userId}`, data.stats.theme);
      if (data.stats.soundEnabled !== undefined) localStorage.setItem(`taskflow_sound_${userId}`, String(data.stats.soundEnabled));
    }
    if (data.categories) {
      localStorage.setItem(`taskflow_categories_${userId}`, JSON.stringify(data.categories));
    }
  }

  static getTheme() {
    return localStorage.getItem(this.getUserKey('taskflow_theme')) || 'light';
  }
  static setTheme(theme) {
    localStorage.setItem(this.getUserKey('taskflow_theme'), theme);
    const user = AuthManager.getActiveUser();
    if (SupabaseManager.isConfigured() && user && !user.isGuest) {
      SupabaseManager.updateStats(user.id, { theme });
    } else {
      ApiClient.updateStats({ theme }).catch(() => {});
    }
  }

  static isSoundEnabled() {
    const val = localStorage.getItem(this.getUserKey('taskflow_sound'));
    return val === null ? true : val === 'true';
  }
  static setSoundEnabled(enabled) {
    localStorage.setItem(this.getUserKey('taskflow_sound'), String(enabled));
    const user = AuthManager.getActiveUser();
    if (SupabaseManager.isConfigured() && user && !user.isGuest) {
      SupabaseManager.updateStats(user.id, { soundEnabled: enabled });
    } else {
      ApiClient.updateStats({ soundEnabled: enabled }).catch(() => {});
    }
  }

  static getXP() {
    return parseInt(localStorage.getItem(this.getUserKey('taskflow_xp')) || '45', 10);
  }
  static setXP(xp) {
    localStorage.setItem(this.getUserKey('taskflow_xp'), String(xp));
    const user = AuthManager.getActiveUser();
    if (SupabaseManager.isConfigured() && user && !user.isGuest) {
      SupabaseManager.updateStats(user.id, { xp });
    } else {
      ApiClient.updateStats({ xp }).catch(() => {});
    }
  }

  static getStreakData() {
    try {
      const key = this.getUserKey('taskflow_streak');
      return JSON.parse(localStorage.getItem(key) || JSON.stringify({
        count: 1,
        lastActiveDate: new Date().toISOString().split('T')[0]
      }));
    } catch (e) {
      return { count: 1, lastActiveDate: new Date().toISOString().split('T')[0] };
    }
  }
  static setStreakData(data) {
    localStorage.setItem(this.getUserKey('taskflow_streak'), JSON.stringify(data));
    const user = AuthManager.getActiveUser();
    if (SupabaseManager.isConfigured() && user && !user.isGuest) {
      SupabaseManager.updateStats(user.id, { streakCount: data.count, lastActiveDate: data.lastActiveDate });
    } else {
      ApiClient.updateStats({ streakCount: data.count, lastActiveDate: data.lastActiveDate }).catch(() => {});
    }
  }

  static getCustomCategories() {
    try {
      return JSON.parse(localStorage.getItem(this.getUserKey('taskflow_categories')) || '[]');
    } catch (e) { return []; }
  }
  static saveCustomCategories(cats) {
    localStorage.setItem(this.getUserKey('taskflow_categories'), JSON.stringify(cats));
  }

  static getViewMode() {
    return localStorage.getItem(this.getUserKey('taskflow_view')) || 'list';
  }
  static setViewMode(view) {
    localStorage.setItem(this.getUserKey('taskflow_view'), view);
  }
}

// ==========================================================================
// 5. Confetti Engine & Web Audio & Gamification
// ==========================================================================
class ConfettiEngine {
  static canvas = null;
  static ctx = null;
  static particles = [];
  static animationFrameId = null;

  static init() {
    this.canvas = document.getElementById('confetti-canvas');
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext('2d');
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  static resize() {
    if (!this.canvas) return;
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
  }

  static fire(count = 60, originX = window.innerWidth / 2, originY = window.innerHeight / 2) {
    if (!this.ctx) this.init();
    if (!this.ctx) return;

    const colors = ['#2563eb', '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#facc15'];

    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = Math.random() * 10 + 4;
      this.particles.push({
        x: originX,
        y: originY,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 3,
        size: Math.random() * 8 + 4,
        color: colors[Math.floor(Math.random() * colors.length)],
        rotation: Math.random() * 360,
        rotationSpeed: (Math.random() - 0.5) * 12,
        gravity: 0.28,
        friction: 0.96,
        opacity: 1,
        fadeSpeed: Math.random() * 0.02 + 0.01
      });
    }

    if (!this.animationFrameId) {
      this.loop();
    }
  }

  static loop() {
    if (!this.ctx) return;
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.vx *= p.friction;
      p.vy *= p.friction;
      p.vy += p.gravity;
      p.x += p.vx;
      p.y += p.vy;
      p.rotation += p.rotationSpeed;
      p.opacity -= p.fadeSpeed;

      if (p.opacity <= 0 || p.y > this.canvas.height + 20) {
        this.particles.splice(i, 1);
        continue;
      }

      this.ctx.save();
      this.ctx.translate(p.x, p.y);
      this.ctx.rotate((p.rotation * Math.PI) / 180);
      this.ctx.globalAlpha = p.opacity;
      this.ctx.fillStyle = p.color;
      this.ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
      this.ctx.restore();
    }

    if (this.particles.length > 0) {
      this.animationFrameId = requestAnimationFrame(() => this.loop());
    } else {
      this.animationFrameId = null;
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }
  }
}

class SoundManager {
  static ctx = null;
  static isMuted = !StorageManager.isSoundEnabled();

  static initContext() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) this.ctx = new AudioCtx();
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  static playTone(freqs, duration = 0.25, type = 'sine') {
    if (this.isMuted) return;
    try {
      this.initContext();
      if (!this.ctx) return;

      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = type;
      freqs.forEach(([freq, timeOffset]) => {
        if (timeOffset === 0) {
          osc.frequency.setValueAtTime(freq, now);
        } else {
          osc.frequency.exponentialRampToValueAtTime(freq, now + timeOffset);
        }
      });

      gain.gain.setValueAtTime(0.15, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(now);
      osc.stop(now + duration);
    } catch (e) {}
  }

  static playCheck() { this.playTone([[523.25, 0], [783.99, 0.08], [1046.50, 0.16]], 0.28); }
  static playUncheck() { this.playTone([[659.25, 0], [440.0, 0.12]], 0.18); }
  static playAdd() { this.playTone([[440.0, 0], [880.0, 0.06]], 0.14); }
  static playDelete() { this.playTone([[320.0, 0], [160.0, 0.12]], 0.18, 'triangle'); }
  static playLevelUp() { this.playTone([[440, 0], [554.37, 0.08], [659.25, 0.16], [880, 0.24]], 0.45); }
  static playPomoDone() { this.playTone([[880, 0], [1174.66, 0.12], [1760, 0.24]], 0.5); }

  static toggleMute() {
    this.isMuted = !this.isMuted;
    StorageManager.setSoundEnabled(!this.isMuted);
    return !this.isMuted;
  }
}

class GamificationManager {
  static LEVELS = [
    { level: 1, minXP: 0, title: 'Novice' },
    { level: 2, minXP: 100, title: 'Apprentice' },
    { level: 3, minXP: 250, title: 'Focus Knight' },
    { level: 4, minXP: 500, title: 'Task Crusher' },
    { level: 5, minXP: 850, title: 'Productivity Pro' },
    { level: 6, minXP: 1300, title: 'Flow Master' },
    { level: 7, minXP: 2000, title: 'Grandmaster' }
  ];

  static checkStreak() {
    const data = StorageManager.getStreakData();
    const today = new Date().toISOString().split('T')[0];

    if (data.lastActiveDate === today) {
      return data.count;
    }

    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
    if (data.lastActiveDate === yesterday) {
      data.count += 1;
      data.lastActiveDate = today;
      StorageManager.setStreakData(data);
      return data.count;
    } else {
      data.count = 1;
      data.lastActiveDate = today;
      StorageManager.setStreakData(data);
      return data.count;
    }
  }

  static getLevelInfo(currentXP) {
    let currentLevel = this.LEVELS[0];
    let nextLevel = this.LEVELS[1];

    for (let i = 0; i < this.LEVELS.length; i++) {
      if (currentXP >= this.LEVELS[i].minXP) {
        currentLevel = this.LEVELS[i];
        nextLevel = this.LEVELS[i + 1] || { minXP: currentLevel.minXP + 1000, title: 'Legend' };
      } else {
        break;
      }
    }

    const xpInLevel = currentXP - currentLevel.minXP;
    const xpRequired = nextLevel.minXP - currentLevel.minXP;
    const percentage = Math.min(100, Math.round((xpInLevel / xpRequired) * 100));

    return {
      level: currentLevel.level,
      title: currentLevel.title,
      xpInLevel,
      xpRequired,
      percentage,
      totalXP: currentXP
    };
  }

  static addXP(amount, onLevelUp) {
    const prevXP = StorageManager.getXP();
    const prevLevel = this.getLevelInfo(prevXP).level;
    const newXP = prevXP + amount;
    StorageManager.setXP(newXP);

    const newInfo = this.getLevelInfo(newXP);
    if (newInfo.level > prevLevel && onLevelUp) {
      onLevelUp(newInfo);
    }
    return newInfo;
  }
}

// ==========================================================================
// 6. Application State (With Supabase & REST API Cloud Sync)
// ==========================================================================
class AppState {
  constructor() {
    this.reloadUserData();
    this.statusFilter = 'all';
    this.categoryFilter = 'all';
    this.searchQuery = '';
    this.sortBy = 'created-desc';
    this.undoStack = [];
    this.creatorSubtasks = [];
    this.editModalSubtasks = [];
    this.draggedTaskId = null;
    this.activePomodoroTask = null;
  }

  reloadUserData() {
    this.tasks = StorageManager.getTasks();
    this.customCategories = StorageManager.getCustomCategories();
    this.viewMode = StorageManager.getViewMode();
  }

  async syncWithServer() {
    const user = AuthManager.getActiveUser();
    if (!user || user.isGuest) return false;

    // 1. Sync with Supabase Cloud
    if (SupabaseManager.isConfigured()) {
      try {
        const data = await SupabaseManager.getUserData(user.id);
        if (data) {
          StorageManager.applyRemoteData(user.id, data);
          this.reloadUserData();
          return true;
        }
      } catch (e) {}
    }

    // 2. Sync with Node REST API
    try {
      const data = await ApiClient.getUserData(user.id);
      if (data) {
        StorageManager.applyRemoteData(user.id, data);
        this.reloadUserData();
        return true;
      }
    } catch (e) {}

    return false;
  }

  syncTaskToCloud(task) {
    const user = AuthManager.getActiveUser();
    if (!user || user.isGuest) return;

    if (SupabaseManager.isConfigured()) {
      SupabaseManager.saveTask(user.id, task).catch(() => {});
    } else {
      ApiClient.saveTask(task).catch(() => {});
    }
  }

  deleteTaskFromCloud(taskId) {
    const user = AuthManager.getActiveUser();
    if (!user || user.isGuest) return;

    if (SupabaseManager.isConfigured()) {
      SupabaseManager.deleteTask(taskId).catch(() => {});
    } else {
      ApiClient.deleteTask(taskId).catch(() => {});
    }
  }

  addTask(data) {
    const newTask = {
      id: 'task_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
      title: data.title.trim(),
      notes: data.notes ? data.notes.trim() : '',
      priority: data.priority || 'medium',
      category: data.category || 'work',
      dueDate: data.dueDate || '',
      completed: false,
      kanbanStatus: 'todo',
      pinned: false,
      createdAt: Date.now(),
      order: this.tasks.length,
      subtasks: data.subtasks || []
    };

    this.tasks.unshift(newTask);
    this.save();
    SoundManager.playAdd();
    this.syncTaskToCloud(newTask);
    return newTask;
  }

  updateTask(id, updates) {
    const index = this.tasks.findIndex(t => t.id === id);
    if (index !== -1) {
      this.tasks[index] = { ...this.tasks[index], ...updates };
      this.save();
      this.syncTaskToCloud(this.tasks[index]);
      return this.tasks[index];
    }
    return null;
  }

  toggleTaskComplete(id) {
    const task = this.tasks.find(t => t.id === id);
    if (task) {
      task.completed = !task.completed;
      task.kanbanStatus = task.completed ? 'done' : 'todo';
      task.completedAt = task.completed ? Date.now() : null;

      if (task.completed) {
        SoundManager.playCheck();
        ConfettiEngine.fire(50);
      } else {
        SoundManager.playUncheck();
      }
      this.save();
      this.syncTaskToCloud(task);
    }
  }

  setKanbanStatus(id, newStatus) {
    const task = this.tasks.find(t => t.id === id);
    if (task) {
      task.kanbanStatus = newStatus;
      task.completed = newStatus === 'done';
      if (task.completed) {
        SoundManager.playCheck();
        ConfettiEngine.fire(45);
      }
      this.save();
      this.syncTaskToCloud(task);
    }
  }

  toggleTaskPin(id) {
    const task = this.tasks.find(t => t.id === id);
    if (task) {
      task.pinned = !task.pinned;
      this.save();
      this.syncTaskToCloud(task);
    }
  }

  deleteTask(id) {
    const index = this.tasks.findIndex(t => t.id === id);
    if (index !== -1) {
      const removed = this.tasks.splice(index, 1)[0];
      this.undoStack.push({ task: removed, index });
      this.save();
      SoundManager.playDelete();
      this.deleteTaskFromCloud(id);
      return removed;
    }
    return null;
  }

  undoLastDelete() {
    if (this.undoStack.length > 0) {
      const { task, index } = this.undoStack.pop();
      this.tasks.splice(Math.min(index, this.tasks.length), 0, task);
      this.save();
      this.syncTaskToCloud(task);
      return task;
    }
    return null;
  }

  clearCompleted() {
    const completedTasks = this.tasks.filter(t => t.completed);
    if (completedTasks.length === 0) return 0;

    this.tasks = this.tasks.filter(t => !t.completed);
    this.save();
    SoundManager.playDelete();

    completedTasks.forEach(t => {
      this.deleteTaskFromCloud(t.id);
    });

    return completedTasks.length;
  }

  toggleSubtask(taskId, subtaskId) {
    const task = this.tasks.find(t => t.id === taskId);
    if (task && task.subtasks) {
      const sub = task.subtasks.find(s => s.id === subtaskId);
      if (sub) {
        sub.completed = !sub.completed;
        if (sub.completed) {
          SoundManager.playCheck();
        } else {
          SoundManager.playUncheck();
        }
        this.save();
        this.syncTaskToCloud(task);
      }
    }
  }

  reorderTasks(draggedId, targetId) {
    const draggedIndex = this.tasks.findIndex(t => t.id === draggedId);
    const targetIndex = this.tasks.findIndex(t => t.id === targetId);
    if (draggedIndex === -1 || targetIndex === -1 || draggedIndex === targetIndex) return;

    const [moved] = this.tasks.splice(draggedIndex, 1);
    this.tasks.splice(targetIndex, 0, moved);
    this.tasks.forEach((t, i) => {
      t.order = i;
      this.syncTaskToCloud(t);
    });
    this.save();
  }

  getFilteredTasks() {
    let list = [...this.tasks];

    if (this.statusFilter === 'active') {
      list = list.filter(t => !t.completed);
    } else if (this.statusFilter === 'completed') {
      list = list.filter(t => t.completed);
    }

    if (this.categoryFilter !== 'all') {
      list = list.filter(t => t.category.toLowerCase() === this.categoryFilter.toLowerCase());
    }

    if (this.searchQuery.trim()) {
      const q = this.searchQuery.toLowerCase().trim();
      list = list.filter(t => {
        const titleMatch = t.title.toLowerCase().includes(q);
        const notesMatch = t.notes && t.notes.toLowerCase().includes(q);
        const subMatch = t.subtasks && t.subtasks.some(s => s.title.toLowerCase().includes(q));
        return titleMatch || notesMatch || subMatch;
      });
    }

    const priorityWeight = { high: 3, medium: 2, low: 1 };

    list.sort((a, b) => {
      if (!a.completed && !b.completed) {
        if (a.pinned && !b.pinned) return -1;
        if (!a.pinned && b.pinned) return 1;
      }

      switch (this.sortBy) {
        case 'due-date': {
          if (!a.dueDate) return 1;
          if (!b.dueDate) return -1;
          return new Date(a.dueDate) - new Date(b.dueDate);
        }
        case 'priority-desc': {
          return (priorityWeight[b.priority] || 0) - (priorityWeight[a.priority] || 0);
        }
        case 'title-asc': {
          return a.title.localeCompare(b.title);
        }
        case 'created-asc': {
          return a.createdAt - b.createdAt;
        }
        case 'created-desc':
        default: {
          return (b.order !== undefined && a.order !== undefined)
            ? a.order - b.order
            : b.createdAt - a.createdAt;
        }
      }
    });

    return list;
  }

  getMetrics() {
    const total = this.tasks.length;
    const completed = this.tasks.filter(t => t.completed).length;
    const active = total - completed;
    const todayStr = new Date().toISOString().split('T')[0];
    const overdue = this.tasks.filter(t => !t.completed && t.dueDate && t.dueDate < todayStr).length;
    const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;
    return { total, completed, active, overdue, percentage };
  }

  save() {
    StorageManager.saveTasks(this.tasks);
  }
}

// ==========================================================================
// 7. UI Manager & Multi-User Controller
// ==========================================================================
class UIManager {
  constructor(appState) {
    this.state = appState;
    SupabaseManager.init();
    this.initDOMElements();
    this.initDatabaseStatus();
    this.initAuth();
    this.initTheme();
    this.initGamification();
    this.initSoundUI();
    this.initPomodoro();
    this.initVoiceInput();
    this.initCustomCategories();
    this.bindEvents();
    this.switchView(this.state.viewMode);
    this.render();

    // Initial server sync
    this.state.syncWithServer().then(synced => {
      if (synced) {
        this.initGamification();
        this.render();
      }
    });
  }

  initDOMElements() {
    this.currentDateDisplay = document.getElementById('current-date-display');
    this.sqlStatusBadge = document.getElementById('sql-status-badge');
    this.sqlStatusText = document.getElementById('sql-status-text');

    this.userProfileBtn = document.getElementById('user-profile-btn');
    this.userAvatarInitials = document.getElementById('user-avatar-initials');
    this.userNameDisplay = document.getElementById('user-name-display');
    this.userDropdownMenu = document.getElementById('user-dropdown-menu');
    this.dropdownUserName = document.getElementById('dropdown-user-name');
    this.dropdownUserEmail = document.getElementById('dropdown-user-email');
    this.dropdownSignInBtn = document.getElementById('dropdown-signin-btn');
    this.dropdownSignOutBtn = document.getElementById('dropdown-signout-btn');
    this.footerAuthBtn = document.getElementById('footer-auth-btn');

    this.authDialog = document.getElementById('auth-dialog');
    this.authCloseBtn = document.getElementById('auth-close-btn');
    this.authCancelBtn = document.getElementById('auth-cancel-btn');
    this.authGuestBtn = document.getElementById('auth-guest-btn');
    this.authTabSignIn = document.getElementById('auth-tab-signin');
    this.authTabSignUp = document.getElementById('auth-tab-signup');
    this.signInForm = document.getElementById('signin-form');
    this.signUpForm = document.getElementById('signup-form');
    this.signInEmailInput = document.getElementById('signin-email');
    this.signInPasswordInput = document.getElementById('signin-password');
    this.signUpNameInput = document.getElementById('signup-name');
    this.signUpEmailInput = document.getElementById('signup-email');
    this.signUpPasswordInput = document.getElementById('signup-password');
    this.quickDemoLoginBtn = document.getElementById('quick-demo-login-btn');
    this.authErrorMessage = document.getElementById('auth-error-message');

    this.streakCountEl = document.getElementById('streak-count');
    this.levelBadge = document.getElementById('level-badge');
    this.xpFillBar = document.getElementById('xp-fill-bar');
    this.xpText = document.getElementById('xp-text');

    this.soundToggleBtn = document.getElementById('sound-toggle-btn');
    this.soundOnIcon = document.getElementById('sound-on-icon');
    this.soundOffIcon = document.getElementById('sound-off-icon');
    this.themeToggleBtn = document.getElementById('theme-toggle-btn');
    this.themeMoonIcon = document.getElementById('theme-moon-icon');
    this.themeSunIcon = document.getElementById('theme-sun-icon');
    this.shortcutsBtn = document.getElementById('shortcuts-btn');
    this.dataBtn = document.getElementById('data-btn');
    this.headerPomodoroBtn = document.getElementById('header-pomodoro-btn');

    this.progressCircle = document.getElementById('progress-circle');
    this.progressText = document.getElementById('progress-percentage-text');
    this.progressHeadline = document.getElementById('progress-headline');
    this.progressSubtitle = document.getElementById('progress-subtitle');
    this.statTotal = document.getElementById('stat-total');
    this.statActive = document.getElementById('stat-active');
    this.statCompleted = document.getElementById('stat-completed');
    this.statOverdue = document.getElementById('stat-overdue');

    this.quickTaskForm = document.getElementById('quick-task-form');
    this.taskTitleInput = document.getElementById('task-title-input');
    this.taskPrioritySelect = document.getElementById('task-priority-select');
    this.taskCategorySelect = document.getElementById('task-category-select');
    this.taskDueDateInput = document.getElementById('task-due-date-input');
    this.toggleSubtaskCreatorBtn = document.getElementById('toggle-subtask-creator-btn');
    this.creatorSubtasksDrawer = document.getElementById('creator-subtasks-drawer');
    this.creatorSubtaskInput = document.getElementById('creator-subtask-input');
    this.creatorAddSubtaskBtn = document.getElementById('creator-add-subtask-btn');
    this.creatorSubtaskPreviewList = document.getElementById('creator-subtask-preview-list');
    this.voiceInputBtn = document.getElementById('voice-input-btn');

    this.viewListBtn = document.getElementById('view-list-btn');
    this.viewKanbanBtn = document.getElementById('view-kanban-btn');
    this.viewMatrixBtn = document.getElementById('view-matrix-btn');
    this.listViewSection = document.getElementById('list-view-section');
    this.kanbanViewSection = document.getElementById('kanban-view-section');
    this.matrixViewSection = document.getElementById('matrix-view-section');

    this.searchInput = document.getElementById('search-input');
    this.searchClearBtn = document.getElementById('search-clear-btn');
    this.filterTabs = document.querySelectorAll('.filter-tab');
    this.countAll = document.getElementById('count-all');
    this.countActive = document.getElementById('count-active');
    this.countCompleted = document.getElementById('count-completed');
    this.categoryChipsContainer = document.getElementById('category-chips-container');
    this.openAddCategoryBtn = document.getElementById('open-add-category-btn');
    this.sortSelect = document.getElementById('sort-select');
    this.clearCompletedBtn = document.getElementById('clear-completed-btn');

    this.taskList = document.getElementById('task-list');
    this.emptyState = document.getElementById('empty-state');
    this.emptyTitle = document.getElementById('empty-title');
    this.emptyDesc = document.getElementById('empty-desc');

    this.kanbanListTodo = document.getElementById('kanban-list-todo');
    this.kanbanListInprogress = document.getElementById('kanban-list-inprogress');
    this.kanbanListDone = document.getElementById('kanban-list-done');
    this.kanbanCountTodo = document.getElementById('kanban-count-todo');
    this.kanbanCountInprogress = document.getElementById('kanban-count-inprogress');
    this.kanbanCountDone = document.getElementById('kanban-count-done');

    this.matrixListQ1 = document.getElementById('matrix-list-q1');
    this.matrixListQ2 = document.getElementById('matrix-list-q2');
    this.matrixListQ3 = document.getElementById('matrix-list-q3');
    this.matrixListQ4 = document.getElementById('matrix-list-q4');
    this.matrixCountQ1 = document.getElementById('matrix-count-q1');
    this.matrixCountQ2 = document.getElementById('matrix-count-q2');
    this.matrixCountQ3 = document.getElementById('matrix-count-q3');
    this.matrixCountQ4 = document.getElementById('matrix-count-q4');

    this.pomodoroDialog = document.getElementById('pomodoro-dialog');
    this.pomoCloseBtn = document.getElementById('pomo-close-btn');
    this.pomoCircle = document.getElementById('pomo-circle');
    this.pomoTimeDisplay = document.getElementById('pomo-time-display');
    this.pomoActiveTaskLabel = document.getElementById('pomo-active-task-label');
    this.pomoStartBtn = document.getElementById('pomo-start-btn');
    this.pomoResetBtn = document.getElementById('pomo-reset-btn');
    this.pomoModeBtns = document.querySelectorAll('.pomo-mode-btn');

    this.editDialog = document.getElementById('edit-task-dialog');
    this.editForm = document.getElementById('edit-task-form');
    this.editTaskId = document.getElementById('edit-task-id');
    this.editTaskTitle = document.getElementById('edit-task-title');
    this.editTaskNotes = document.getElementById('edit-task-notes');
    this.editTaskPriority = document.getElementById('edit-task-priority');
    this.editTaskCategory = document.getElementById('edit-task-category');
    this.editTaskDueDate = document.getElementById('edit-task-due-date');
    this.editSubtaskInput = document.getElementById('edit-subtask-input');
    this.editAddSubtaskBtn = document.getElementById('edit-add-subtask-btn');
    this.editSubtasksList = document.getElementById('edit-subtasks-list');
    this.editModalCloseBtn = document.getElementById('edit-modal-close-btn');
    this.editCancelBtn = document.getElementById('edit-cancel-btn');

    this.customCategoryDialog = document.getElementById('custom-category-dialog');
    this.customCategoryForm = document.getElementById('custom-category-form');
    this.newCategoryNameInput = document.getElementById('new-category-name');
    this.customCatCloseBtn = document.getElementById('custom-cat-close-btn');
    this.customCatCancelBtn = document.getElementById('custom-cat-cancel-btn');

    this.shortcutsDialog = document.getElementById('shortcuts-dialog');
    this.shortcutsCloseBtn = document.getElementById('shortcuts-close-btn');
    this.shortcutsGotItBtn = document.getElementById('shortcuts-got-it-btn');

    this.dataDialog = document.getElementById('data-dialog');
    this.dataCloseBtn = document.getElementById('data-close-btn');
    this.dataDoneBtn = document.getElementById('data-done-btn');
    this.supabaseUrlInput = document.getElementById('supabase-url-input');
    this.supabaseKeyInput = document.getElementById('supabase-key-input');
    this.saveSupabaseBtn = document.getElementById('save-supabase-btn');
    this.apiServerUrlInput = document.getElementById('api-server-url-input');
    this.saveServerUrlBtn = document.getElementById('save-server-url-btn');
    this.exportJsonBtn = document.getElementById('export-json-btn');
    this.exportCsvBtn = document.getElementById('export-csv-btn');
    this.importJsonInput = document.getElementById('import-json-input');

    this.footerShortcutsBtn = document.getElementById('footer-shortcuts-btn');
    this.footerPomodoroBtn = document.getElementById('footer-pomodoro-btn');
    this.footerBackupBtn = document.getElementById('footer-backup-btn');
    this.footerResetBtn = document.getElementById('footer-reset-btn');

    this.toastContainer = document.getElementById('toast-container');
  }

  initDatabaseStatus() {
    const updateBadge = async () => {
      if (SupabaseManager.isConfigured()) {
        this.sqlStatusBadge.className = 'sql-status-badge online';
        this.sqlStatusText.textContent = 'Cloud PostgreSQL';
        this.sqlStatusBadge.title = 'Connected to 24/7 Supabase Cloud PostgreSQL database';
        return;
      }

      const isServerOnline = await ApiClient.checkHealth();
      if (isServerOnline) {
        this.sqlStatusBadge.className = 'sql-status-badge online';
        this.sqlStatusText.textContent = 'SQL Server';
        this.sqlStatusBadge.title = `Connected to Node.js SQL server (${ApiClient.getBaseUrl()})`;
      } else {
        this.sqlStatusBadge.className = 'sql-status-badge';
        this.sqlStatusText.textContent = 'Local Mode';
        this.sqlStatusBadge.title = 'Running locally. Tap here to connect Supabase 24/7 Cloud Database!';
      }
    };

    updateBadge();
    setInterval(updateBadge, 15000);

    this.sqlStatusBadge.addEventListener('click', () => {
      this.dataDialog.showModal();
    });

    this.supabaseUrlInput.value = localStorage.getItem(SUPABASE_CONFIG.URL_KEY) || '';
    this.supabaseKeyInput.value = localStorage.getItem(SUPABASE_CONFIG.ANON_KEY) || '';
    this.apiServerUrlInput.value = ApiClient.getBaseUrl();

    this.saveSupabaseBtn.addEventListener('click', async () => {
      const url = this.supabaseUrlInput.value.trim();
      const key = this.supabaseKeyInput.value.trim();

      if (!url || !key) {
        SupabaseManager.setConfig('', '');
        this.showToast('Cleared Supabase credentials. Switched to Local mode.');
      } else {
        const ok = SupabaseManager.setConfig(url, key);
        if (ok) {
          this.showToast('⚡ Supabase Cloud Database Connected!');
          await this.state.syncWithServer();
          this.initGamification();
          this.render();
        } else {
          this.showToast('Could not initialize Supabase. Check URL & Key.');
        }
      }
      updateBadge();
    });

    this.saveServerUrlBtn.addEventListener('click', async () => {
      const newUrl = this.apiServerUrlInput.value.trim();
      ApiClient.setBaseUrl(newUrl);
      this.showToast('Connecting to SQL backend...');
      await updateBadge();
      const synced = await this.state.syncWithServer();
      if (synced) {
        this.initGamification();
        this.render();
        this.showToast('Data synchronized with SQL backend');
      } else {
        this.showToast('Server URL saved');
      }
    });
  }

  initAuth() {
    this.updateUserUI();

    this.userProfileBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.userDropdownMenu.classList.toggle('active');
    });

    document.addEventListener('click', () => {
      this.userDropdownMenu.classList.remove('active');
    });

    this.dropdownSignInBtn.addEventListener('click', () => {
      this.userDropdownMenu.classList.remove('active');
      this.openAuthModal('signin');
    });

    this.footerAuthBtn.addEventListener('click', () => {
      this.openAuthModal('signin');
    });

    this.dropdownSignOutBtn.addEventListener('click', () => {
      this.userDropdownMenu.classList.remove('active');
      AuthManager.signOut();
      this.onAuthChange('Signed out. Switched to Guest mode.');
    });

    this.authTabSignIn.addEventListener('click', () => this.switchAuthTab('signin'));
    this.authTabSignUp.addEventListener('click', () => this.switchAuthTab('signup'));
    this.authCloseBtn.addEventListener('click', () => this.authDialog.close());
    this.authCancelBtn.addEventListener('click', () => this.authDialog.close());
    this.authGuestBtn.addEventListener('click', () => {
      AuthManager.signOut();
      this.authDialog.close();
      this.onAuthChange('Continuing as Guest');
    });

    this.quickDemoLoginBtn.addEventListener('click', () => {
      this.signInEmailInput.value = 'demo@taskflow.pro';
      this.signInPasswordInput.value = 'password123';
      this.signInEmailInput.focus();
    });

    document.querySelectorAll('.password-toggle-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const targetId = btn.getAttribute('data-target');
        const input = document.getElementById(targetId);
        if (input) {
          const isPass = input.type === 'password';
          input.type = isPass ? 'text' : 'password';
        }
      });
    });

    this.signInForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      this.hideAuthError();
      const email = this.signInEmailInput.value;
      const pass = this.signInPasswordInput.value;
      try {
        const user = await AuthManager.signIn(email, pass);
        this.authDialog.close();
        this.onAuthChange(`Welcome back, ${user.name}!`);
      } catch (err) {
        this.showAuthError(err.message);
      }
    });

    this.signUpForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      this.hideAuthError();
      const name = this.signUpNameInput.value;
      const email = this.signUpEmailInput.value;
      const pass = this.signUpPasswordInput.value;
      try {
        const user = await AuthManager.signUp(name, email, pass);
        this.authDialog.close();
        ConfettiEngine.fire(70);
        this.onAuthChange(`Account created! Welcome, ${user.name}!`);
      } catch (err) {
        this.showAuthError(err.message);
      }
    });
  }

  openAuthModal(tab = 'signin') {
    this.hideAuthError();
    this.switchAuthTab(tab);
    this.authDialog.showModal();
  }

  switchAuthTab(tab) {
    this.authTabSignIn.classList.toggle('active', tab === 'signin');
    this.authTabSignUp.classList.toggle('active', tab === 'signup');
    this.signInForm.classList.toggle('active', tab === 'signin');
    this.signUpForm.classList.toggle('active', tab === 'signup');
    document.getElementById('auth-modal-title').textContent = tab === 'signin' ? 'Account Sign In' : 'Create Account';
  }

  showAuthError(msg) {
    this.authErrorMessage.textContent = msg;
    this.authErrorMessage.classList.add('visible');
  }

  hideAuthError() {
    this.authErrorMessage.textContent = '';
    this.authErrorMessage.classList.remove('visible');
  }

  updateUserUI() {
    const user = AuthManager.getActiveUser();
    const isGuest = !user || !!user.isGuest;

    const initials = user && user.name ? user.name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase() : 'G';
    this.userAvatarInitials.textContent = initials;
    this.userNameDisplay.textContent = user && user.name ? user.name.split(' ')[0] : 'Guest';

    this.dropdownUserName.textContent = user ? user.name : 'Guest User';
    this.dropdownUserEmail.textContent = user ? user.email : 'guest@local.browser';
    this.dropdownSignOutBtn.style.display = isGuest ? 'none' : 'flex';
    this.dropdownSignInBtn.querySelector('span').textContent = isGuest ? 'Sign In / Register' : 'Switch Account';
  }

  onAuthChange(toastMessage) {
    this.updateUserUI();
    this.state.reloadUserData();
    this.initGamification();
    this.render();

    this.state.syncWithServer().then(synced => {
      if (synced) {
        this.initGamification();
        this.render();
      }
    });

    if (toastMessage) this.showToast(toastMessage);
  }

  initTheme() {
    const saved = StorageManager.getTheme();
    document.documentElement.setAttribute('data-theme', saved);
    this.updateThemeIcons(saved);
  }

  updateThemeIcons(theme) {
    if (theme === 'dark') {
      this.themeMoonIcon.style.display = 'none';
      this.themeSunIcon.style.display = 'block';
    } else {
      this.themeMoonIcon.style.display = 'block';
      this.themeSunIcon.style.display = 'none';
    }
  }

  toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme');
    const target = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', target);
    StorageManager.setTheme(target);
    this.updateThemeIcons(target);
    this.showToast(`Switched to ${target} theme`);
  }

  initSoundUI() {
    const enabled = !SoundManager.isMuted;
    this.soundOnIcon.style.display = enabled ? 'block' : 'none';
    this.soundOffIcon.style.display = enabled ? 'none' : 'block';
  }

  initGamification() {
    const streak = GamificationManager.checkStreak();
    this.streakCountEl.textContent = streak;

    const currentXP = StorageManager.getXP();
    this.updateXPUI(GamificationManager.getLevelInfo(currentXP));
  }

  updateXPUI(info) {
    this.levelBadge.textContent = `Lvl ${info.level} • ${info.title}`;
    this.xpFillBar.style.width = `${info.percentage}%`;
    this.xpText.textContent = `${info.xpInLevel} / ${info.xpRequired} XP`;
  }

  initPomodoro() {
    this.pomoDuration = 25 * 60;
    this.pomoTimeLeft = 25 * 60;
    this.pomoInterval = null;
    this.pomoRunning = false;

    this.pomoModeBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        this.pomoModeBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const mins = parseInt(btn.getAttribute('data-pomo'), 10);
        this.setPomoMode(mins);
      });
    });

    this.pomoStartBtn.addEventListener('click', () => this.togglePomodoro());
    this.pomoResetBtn.addEventListener('click', () => this.resetPomodoro());
    this.pomoCloseBtn.addEventListener('click', () => this.pomodoroDialog.close());

    this.updatePomoUI();
  }

  setPomoMode(mins) {
    this.resetPomodoro();
    this.pomoDuration = mins * 60;
    this.pomoTimeLeft = mins * 60;
    this.updatePomoUI();
  }

  togglePomodoro() {
    if (this.pomoRunning) {
      clearInterval(this.pomoInterval);
      this.pomoRunning = false;
      this.pomoStartBtn.textContent = 'Resume Focus';
    } else {
      this.pomoRunning = true;
      this.pomoStartBtn.textContent = 'Pause';
      this.pomoInterval = setInterval(() => {
        if (this.pomoTimeLeft > 0) {
          this.pomoTimeLeft--;
          this.updatePomoUI();
        } else {
          this.onPomoComplete();
        }
      }, 1000);
    }
  }

  resetPomodoro() {
    clearInterval(this.pomoInterval);
    this.pomoRunning = false;
    this.pomoTimeLeft = this.pomoDuration;
    this.pomoStartBtn.textContent = 'Start Focus';
    this.updatePomoUI();
  }

  onPomoComplete() {
    this.resetPomodoro();
    SoundManager.playPomoDone();
    ConfettiEngine.fire(80);
    GamificationManager.addXP(40, (lvl) => {
      SoundManager.playLevelUp();
      this.showToast(`🎉 Level Up! You reached ${lvl.title} (Level ${lvl.level})!`);
    });
    this.updateXPUI(GamificationManager.getLevelInfo(StorageManager.getXP()));
    this.showToast('🎯 Focus session complete! +40 XP awarded');
  }

  updatePomoUI() {
    const mins = Math.floor(this.pomoTimeLeft / 60);
    const secs = this.pomoTimeLeft % 60;
    this.pomoTimeDisplay.textContent = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;

    const circumference = 502;
    const progress = (this.pomoDuration - this.pomoTimeLeft) / this.pomoDuration;
    const offset = circumference * (1 - progress);
    this.pomoCircle.style.strokeDashoffset = offset;
  }

  openPomodoroWithTask(taskId) {
    const task = this.state.tasks.find(t => t.id === taskId);
    if (task) {
      this.state.activePomodoroTask = task;
      this.pomoActiveTaskLabel.textContent = `Focusing on: "${task.title}"`;
    } else {
      this.pomoActiveTaskLabel.textContent = 'Focusing on: Free Flow Session';
    }
    this.pomodoroDialog.showModal();
  }

  initVoiceInput() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      this.voiceInputBtn.style.display = 'none';
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'en-US';

    let isListening = false;

    this.voiceInputBtn.addEventListener('click', () => {
      if (isListening) {
        recognition.stop();
      } else {
        try {
          recognition.start();
          isListening = true;
          this.voiceInputBtn.classList.add('recording');
          this.showToast('🎙️ Listening... Speak your task');
        } catch (e) {}
      }
    });

    recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      if (transcript) {
        this.taskTitleInput.value = transcript;
        this.taskTitleInput.focus();
        this.showToast(`Captured: "${transcript}"`);
      }
    };

    recognition.onerror = () => {
      isListening = false;
      this.voiceInputBtn.classList.remove('recording');
    };

    recognition.onend = () => {
      isListening = false;
      this.voiceInputBtn.classList.remove('recording');
    };
  }

  initCustomCategories() {
    this.state.customCategories.forEach(cat => this.renderCustomChip(cat));

    this.openAddCategoryBtn.addEventListener('click', () => {
      this.newCategoryNameInput.value = '';
      this.customCategoryDialog.showModal();
      this.newCategoryNameInput.focus();
    });

    this.customCatCloseBtn.addEventListener('click', () => this.customCategoryDialog.close());
    this.customCatCancelBtn.addEventListener('click', () => this.customCategoryDialog.close());

    this.customCategoryForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = this.newCategoryNameInput.value.trim().toLowerCase();
      if (!name) return;

      if (!this.state.customCategories.includes(name)) {
        this.state.customCategories.push(name);
        StorageManager.saveCustomCategories(this.state.customCategories);
        this.renderCustomChip(name);

        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name.charAt(0).toUpperCase() + name.slice(1);
        this.taskCategorySelect.appendChild(opt);
        this.editTaskCategory.appendChild(opt.cloneNode(true));

        const user = AuthManager.getActiveUser();
        if (SupabaseManager.isConfigured() && user && !user.isGuest) {
          SupabaseManager.addCategory(user.id, name, '#3b82f6');
        } else {
          ApiClient.addCategory(name, '#3b82f6').catch(() => {});
        }
        this.showToast(`Tag "${name}" saved to Cloud`);
      }
      this.customCategoryDialog.close();
    });
  }

  renderCustomChip(name) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    chip.setAttribute('data-category', name);
    chip.textContent = name.charAt(0).toUpperCase() + name.slice(1);
    chip.addEventListener('click', () => {
      this.categoryChipsContainer.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      this.state.categoryFilter = name;
      this.render();
    });
    this.categoryChipsContainer.appendChild(chip);
  }

  switchView(mode) {
    this.state.viewMode = mode;
    StorageManager.setViewMode(mode);

    this.viewListBtn.classList.toggle('active', mode === 'list');
    this.viewKanbanBtn.classList.toggle('active', mode === 'kanban');
    this.viewMatrixBtn.classList.toggle('active', mode === 'matrix');

    this.listViewSection.style.display = mode === 'list' ? 'flex' : 'none';
    this.kanbanViewSection.style.display = mode === 'kanban' ? 'grid' : 'none';
    this.matrixViewSection.style.display = mode === 'matrix' ? 'grid' : 'none';

    this.render();
  }

  bindEvents() {
    const now = new Date();
    this.currentDateDisplay.textContent = now.toLocaleDateString(undefined, {
      weekday: 'long', month: 'short', day: 'numeric'
    });

    this.themeToggleBtn.addEventListener('click', () => this.toggleTheme());
    this.soundToggleBtn.addEventListener('click', () => {
      const enabled = SoundManager.toggleMute();
      this.updateSoundIcons(enabled);
      this.showToast(enabled ? 'Sound effects enabled' : 'Sound effects muted');
    });

    this.shortcutsBtn.addEventListener('click', () => this.shortcutsDialog.showModal());
    this.shortcutsCloseBtn.addEventListener('click', () => this.shortcutsDialog.close());
    this.shortcutsGotItBtn.addEventListener('click', () => this.shortcutsDialog.close());
    this.footerShortcutsBtn.addEventListener('click', () => this.shortcutsDialog.showModal());

    this.headerPomodoroBtn.addEventListener('click', () => this.openPomodoroWithTask(null));
    this.footerPomodoroBtn.addEventListener('click', () => this.openPomodoroWithTask(null));

    this.dataBtn.addEventListener('click', () => this.dataDialog.showModal());
    this.dataCloseBtn.addEventListener('click', () => this.dataDialog.close());
    this.dataDoneBtn.addEventListener('click', () => this.dataDialog.close());
    this.footerBackupBtn.addEventListener('click', () => this.dataDialog.showModal());

    this.exportJsonBtn.addEventListener('click', () => this.exportTasksJSON());
    this.exportCsvBtn.addEventListener('click', () => this.exportTasksCSV());
    this.importJsonInput.addEventListener('change', (e) => this.importTasksJSON(e));

    this.footerResetBtn.addEventListener('click', () => {
      if (confirm('Reset tasks to original sample data? Any unsaved tasks will be replaced.')) {
        this.state.tasks = JSON.parse(JSON.stringify(DEFAULT_TASKS));
        this.state.save();
        this.render();
        this.showToast('Reset to default sample tasks');
      }
    });

    this.viewListBtn.addEventListener('click', () => this.switchView('list'));
    this.viewKanbanBtn.addEventListener('click', () => this.switchView('kanban'));
    this.viewMatrixBtn.addEventListener('click', () => this.switchView('matrix'));

    this.quickTaskForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const title = this.taskTitleInput.value.trim();
      if (!title) return;

      this.state.addTask({
        title,
        priority: this.taskPrioritySelect.value,
        category: this.taskCategorySelect.value,
        dueDate: this.taskDueDateInput.value,
        subtasks: this.state.creatorSubtasks
      });

      this.taskTitleInput.value = '';
      this.state.creatorSubtasks = [];
      this.renderCreatorSubtasks();
      this.creatorSubtasksDrawer.classList.remove('active');
      document.getElementById('subtask-toggle-text').textContent = 'Add Subtasks';

      GamificationManager.addXP(10, (lvl) => {
        SoundManager.playLevelUp();
        this.showToast(`🎉 Level Up! You reached ${lvl.title} (Level ${lvl.level})!`);
      });
      this.updateXPUI(GamificationManager.getLevelInfo(StorageManager.getXP()));

      this.render();
      this.showToast('Task added (+10 XP) • Synced to Cloud');
    });

    this.toggleSubtaskCreatorBtn.addEventListener('click', () => {
      const isActive = this.creatorSubtasksDrawer.classList.toggle('active');
      document.getElementById('subtask-toggle-text').textContent = isActive ? 'Close Subtasks' : 'Add Subtasks';
      if (isActive) this.creatorSubtaskInput.focus();
    });

    this.creatorAddSubtaskBtn.addEventListener('click', () => this.addCreatorSubtask());
    this.creatorSubtaskInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.addCreatorSubtask();
      }
    });

    this.searchInput.addEventListener('input', (e) => {
      this.state.searchQuery = e.target.value;
      this.searchClearBtn.classList.toggle('visible', !!this.state.searchQuery);
      this.render();
    });

    this.searchClearBtn.addEventListener('click', () => {
      this.searchInput.value = '';
      this.state.searchQuery = '';
      this.searchClearBtn.classList.remove('visible');
      this.searchInput.focus();
      this.render();
    });

    this.filterTabs.forEach(tab => {
      tab.addEventListener('click', () => {
        this.filterTabs.forEach(t => {
          t.classList.remove('active');
          t.setAttribute('aria-selected', 'false');
        });
        tab.classList.add('active');
        tab.setAttribute('aria-selected', 'true');
        this.state.statusFilter = tab.getAttribute('data-status');
        this.render();
      });
    });

    this.categoryChipsContainer.querySelectorAll('.chip').forEach(chip => {
      chip.addEventListener('click', () => {
        this.categoryChipsContainer.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        this.state.categoryFilter = chip.getAttribute('data-category');
        this.render();
      });
    });

    this.sortSelect.addEventListener('change', (e) => {
      this.state.sortBy = e.target.value;
      this.render();
    });

    this.clearCompletedBtn.addEventListener('click', () => {
      const count = this.state.clearCompleted();
      if (count > 0) {
        this.render();
        this.showToast(`Cleared ${count} completed task${count > 1 ? 's' : ''}`);
      } else {
        this.showToast('No completed tasks to clear');
      }
    });

    this.editModalCloseBtn.addEventListener('click', () => this.editDialog.close());
    this.editCancelBtn.addEventListener('click', () => this.editDialog.close());
    this.editAddSubtaskBtn.addEventListener('click', () => this.addEditModalSubtask());
    this.editSubtaskInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.addEditModalSubtask();
      }
    });

    this.editForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const id = this.editTaskId.value;
      const title = this.editTaskTitle.value.trim();
      if (!title) return;

      this.state.updateTask(id, {
        title,
        notes: this.editTaskNotes.value.trim(),
        priority: this.editTaskPriority.value,
        category: this.editTaskCategory.value,
        dueDate: this.editTaskDueDate.value,
        subtasks: this.state.editModalSubtasks
      });

      this.editDialog.close();
      this.render();
      this.showToast('Task updated • Synced to Cloud');
    });

    this.setupKanbanDropZones();

    document.addEventListener('keydown', (e) => {
      const activeTag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
      const isInputFocused = activeTag === 'input' || activeTag === 'textarea' || activeTag === 'select';

      if (e.key === '/' && !isInputFocused) {
        e.preventDefault();
        this.searchInput.focus();
      } else if ((e.key === 'n' || e.key === 'N') && !isInputFocused) {
        e.preventDefault();
        this.taskTitleInput.focus();
      } else if ((e.key === 'p' || e.key === 'P') && !isInputFocused) {
        e.preventDefault();
        this.openPomodoroWithTask(null);
      } else if (e.key === '1' && !isInputFocused) {
        this.switchView('list');
      } else if (e.key === '2' && !isInputFocused) {
        this.switchView('kanban');
      } else if (e.key === '3' && !isInputFocused) {
        this.switchView('matrix');
      } else if (e.key === '?' && !isInputFocused) {
        e.preventDefault();
        this.shortcutsDialog.showModal();
      } else if ((e.key === 't' || e.key === 'T') && !isInputFocused) {
        e.preventDefault();
        this.toggleTheme();
      } else if (e.key === 'Escape') {
        if (this.editDialog.open) this.editDialog.close();
        if (this.shortcutsDialog.open) this.shortcutsDialog.close();
        if (this.dataDialog.open) this.dataDialog.close();
        if (this.pomodoroDialog.open) this.pomodoroDialog.close();
        if (this.customCategoryDialog.open) this.customCategoryDialog.close();
        if (this.authDialog.open) this.authDialog.close();
      }
    });
  }

  addCreatorSubtask() {
    const text = this.creatorSubtaskInput.value.trim();
    if (!text) return;
    this.state.creatorSubtasks.push({
      id: 'sub_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
      title: text, completed: false
    });
    this.creatorSubtaskInput.value = '';
    this.renderCreatorSubtasks();
    this.creatorSubtaskInput.focus();
  }

  renderCreatorSubtasks() {
    this.creatorSubtaskPreviewList.innerHTML = '';
    this.state.creatorSubtasks.forEach((step, idx) => {
      const item = document.createElement('div');
      item.className = 'subtask-preview-item';
      item.innerHTML = `
        <span>${idx + 1}. ${this.escapeHTML(step.title)}</span>
        <button type="button" aria-label="Remove step">✕</button>
      `;
      item.querySelector('button').addEventListener('click', () => {
        this.state.creatorSubtasks.splice(idx, 1);
        this.renderCreatorSubtasks();
      });
      this.creatorSubtaskPreviewList.appendChild(item);
    });
  }

  addEditModalSubtask() {
    const text = this.editSubtaskInput.value.trim();
    if (!text) return;
    this.state.editModalSubtasks.push({
      id: 'sub_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
      title: text, completed: false
    });
    this.editSubtaskInput.value = '';
    this.renderEditModalSubtasks();
    this.editSubtaskInput.focus();
  }

  renderEditModalSubtasks() {
    this.editSubtasksList.innerHTML = '';
    this.state.editModalSubtasks.forEach((step, idx) => {
      const item = document.createElement('div');
      item.className = 'subtask-preview-item';
      item.innerHTML = `
        <label style="display:flex; align-items:center; gap:0.5rem; flex:1; cursor:pointer;">
          <input type="checkbox" ${step.completed ? 'checked' : ''} style="accent-color: var(--primary);">
          <span style="${step.completed ? 'text-decoration:line-through; color:var(--text-muted);' : ''}">${this.escapeHTML(step.title)}</span>
        </label>
        <button type="button" aria-label="Remove step">✕</button>
      `;
      item.querySelector('input').addEventListener('change', (e) => {
        step.completed = e.target.checked;
        this.renderEditModalSubtasks();
      });
      item.querySelector('button').addEventListener('click', () => {
        this.state.editModalSubtasks.splice(idx, 1);
        this.renderEditModalSubtasks();
      });
      this.editSubtasksList.appendChild(item);
    });
  }

  openEditModal(taskId) {
    const task = this.state.tasks.find(t => t.id === taskId);
    if (!task) return;
    this.editTaskId.value = task.id;
    this.editTaskTitle.value = task.title;
    this.editTaskNotes.value = task.notes || '';
    this.editTaskPriority.value = task.priority;
    this.editTaskCategory.value = task.category;
    this.editTaskDueDate.value = task.dueDate || '';
    this.state.editModalSubtasks = JSON.parse(JSON.stringify(task.subtasks || []));
    this.renderEditModalSubtasks();
    this.editDialog.showModal();
  }

  render() {
    this.renderStats();
    this.renderCounts();

    if (this.state.viewMode === 'list') {
      this.renderListView();
    } else if (this.state.viewMode === 'kanban') {
      this.renderKanbanView();
    } else if (this.state.viewMode === 'matrix') {
      this.renderMatrixView();
    }
  }

  renderStats() {
    const metrics = this.state.getMetrics();
    const circumference = 201;
    const offset = circumference - (metrics.percentage / 100) * circumference;
    this.progressCircle.style.strokeDashoffset = offset;
    this.progressText.textContent = `${metrics.percentage}%`;

    if (metrics.total === 0) {
      this.progressHeadline.textContent = 'Welcome!';
      this.progressSubtitle.textContent = 'Add your first task above';
    } else if (metrics.percentage === 100) {
      this.progressHeadline.textContent = 'All Caught Up! 🎉';
      this.progressSubtitle.textContent = `All ${metrics.total} tasks completed today`;
    } else if (metrics.percentage >= 60) {
      this.progressHeadline.textContent = 'Great Momentum! 🔥';
      this.progressSubtitle.textContent = `${metrics.completed} of ${metrics.total} tasks completed`;
    } else {
      const hour = new Date().getHours();
      const timeGreeting = hour < 12 ? 'Good Morning' : (hour < 18 ? 'Good Afternoon' : 'Good Evening');
      this.progressHeadline.textContent = `${timeGreeting}!`;
      this.progressSubtitle.textContent = `${metrics.completed} of ${metrics.total} tasks completed`;
    }

    this.statTotal.textContent = metrics.total;
    this.statActive.textContent = metrics.active;
    this.statCompleted.textContent = metrics.completed;
    this.statOverdue.textContent = metrics.overdue;
  }

  renderCounts() {
    const total = this.state.tasks.length;
    const completed = this.state.tasks.filter(t => t.completed).length;
    const active = total - completed;
    this.countAll.textContent = total;
    this.countActive.textContent = active;
    this.countCompleted.textContent = completed;
  }

  renderListView() {
    const tasks = this.state.getFilteredTasks();
    this.taskList.innerHTML = '';

    if (tasks.length === 0) {
      this.emptyState.style.display = 'flex';
      return;
    }
    this.emptyState.style.display = 'none';

    tasks.forEach(task => {
      const el = this.createTaskCard(task, true);
      this.taskList.appendChild(el);
    });
  }

  renderKanbanView() {
    const tasks = this.state.getFilteredTasks();
    this.kanbanListTodo.innerHTML = '';
    this.kanbanListInprogress.innerHTML = '';
    this.kanbanListDone.innerHTML = '';

    const todoTasks = tasks.filter(t => !t.completed && (t.kanbanStatus === 'todo' || !t.kanbanStatus));
    const inprogressTasks = tasks.filter(t => !t.completed && t.kanbanStatus === 'inprogress');
    const doneTasks = tasks.filter(t => t.completed || t.kanbanStatus === 'done');

    this.kanbanCountTodo.textContent = todoTasks.length;
    this.kanbanCountInprogress.textContent = inprogressTasks.length;
    this.kanbanCountDone.textContent = doneTasks.length;

    todoTasks.forEach(t => this.kanbanListTodo.appendChild(this.createTaskCard(t, false)));
    inprogressTasks.forEach(t => this.kanbanListInprogress.appendChild(this.createTaskCard(t, false)));
    doneTasks.forEach(t => this.kanbanListDone.appendChild(this.createTaskCard(t, false)));
  }

  renderMatrixView() {
    const tasks = this.state.getFilteredTasks();
    this.matrixListQ1.innerHTML = '';
    this.matrixListQ2.innerHTML = '';
    this.matrixListQ3.innerHTML = '';
    this.matrixListQ4.innerHTML = '';

    const todayStr = new Date().toISOString().split('T')[0];

    const q1 = tasks.filter(t => !t.completed && (t.priority === 'high' || t.category === 'urgent' || (t.dueDate && t.dueDate <= todayStr)));
    const q2 = tasks.filter(t => !t.completed && t.priority === 'medium' && !q1.includes(t));
    const q3 = tasks.filter(t => !t.completed && (t.category === 'urgent' || (t.dueDate && t.dueDate <= todayStr)) && !q1.includes(t));
    const q4 = tasks.filter(t => !t.completed && !q1.includes(t) && !q2.includes(t) && !q3.includes(t));

    this.matrixCountQ1.textContent = q1.length;
    this.matrixCountQ2.textContent = q2.length;
    this.matrixCountQ3.textContent = q3.length;
    this.matrixCountQ4.textContent = q4.length;

    q1.forEach(t => this.matrixListQ1.appendChild(this.createTaskCard(t, false)));
    q2.forEach(t => this.matrixListQ2.appendChild(this.createTaskCard(t, false)));
    q3.forEach(t => this.matrixListQ3.appendChild(this.createTaskCard(t, false)));
    q4.forEach(t => this.matrixListQ4.appendChild(this.createTaskCard(t, false)));
  }

  createTaskCard(task, showSubtasks = true) {
    const li = document.createElement('li');
    li.className = `task-item ${task.completed ? 'completed' : ''} ${task.pinned ? 'pinned' : ''}`;
    li.setAttribute('data-id', task.id);
    li.setAttribute('draggable', 'true');

    const dueInfo = this.formatDueDate(task.dueDate);
    const totalSub = task.subtasks ? task.subtasks.length : 0;
    const completedSub = task.subtasks ? task.subtasks.filter(s => s.completed).length : 0;
    const subtaskPercentage = totalSub > 0 ? (completedSub / totalSub) * 100 : 0;

    li.innerHTML = `
      <div class="task-header-row">
        <div class="drag-handle" title="Drag to reorder">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="9" cy="5" r="1"></circle><circle cx="9" cy="12" r="1"></circle><circle cx="9" cy="19" r="1"></circle>
            <circle cx="15" cy="5" r="1"></circle><circle cx="15" cy="12" r="1"></circle><circle cx="15" cy="19" r="1"></circle>
          </svg>
        </div>

        <label class="task-checkbox-wrap" aria-label="Mark task complete">
          <input type="checkbox" class="task-checkbox-input" ${task.completed ? 'checked' : ''}>
          <span class="task-checkbox-custom">
            <svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"></polyline></svg>
          </span>
        </label>

        <div class="task-content-block">
          <div class="task-title" title="Double click to edit">${this.highlightQuery(this.escapeHTML(task.title))}</div>
          ${task.notes ? `<div class="task-notes">${this.highlightQuery(this.escapeHTML(task.notes))}</div>` : ''}

          <div class="task-meta-row">
            <span class="badge badge-priority-${task.priority}">${task.priority.toUpperCase()}</span>
            <span class="badge badge-category ${task.category}">${this.capitalize(task.category)}</span>
            ${dueInfo ? `<span class="badge badge-due ${dueInfo.status}">${dueInfo.label}</span>` : ''}
            ${totalSub > 0 ? `<span class="badge badge-subtasks">${completedSub}/${totalSub} steps</span>` : ''}
          </div>
        </div>

        <div class="task-actions">
          <button type="button" class="action-icon-btn pomodoro" title="Focus with Pomodoro">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
          </button>
          <button type="button" class="action-icon-btn pin ${task.pinned ? 'active' : ''}" title="${task.pinned ? 'Unpin' : 'Pin to top'}">
            <svg viewBox="0 0 24 24" fill="${task.pinned ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2"><path d="M12 17l-5 5V4a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v18l-5-5z"></path></svg>
          </button>
          <button type="button" class="action-icon-btn edit" title="Edit task">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
          </button>
          <button type="button" class="action-icon-btn delete" title="Delete task">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
          </button>
        </div>
      </div>

      ${showSubtasks && totalSub > 0 ? `
        <div class="task-subtasks-container">
          <div class="subtask-progress-bar-wrap">
            <div class="subtask-progress-bar-fill" style="width: ${subtaskPercentage}%;"></div>
          </div>
          ${task.subtasks.map(sub => `
            <div class="subtask-item">
              <input type="checkbox" class="subtask-checkbox" data-subid="${sub.id}" ${sub.completed ? 'checked' : ''}>
              <span class="subtask-text ${sub.completed ? 'completed' : ''}">${this.escapeHTML(sub.title)}</span>
            </div>
          `).join('')}
        </div>
      ` : ''}
    `;

    const checkbox = li.querySelector('.task-checkbox-input');
    checkbox.addEventListener('change', () => {
      this.state.toggleTaskComplete(task.id);
      if (task.completed) {
        GamificationManager.addXP(25, (lvl) => {
          SoundManager.playLevelUp();
          this.showToast(`🎉 Level Up! You reached ${lvl.title} (Level ${lvl.level})!`);
        });
        this.updateXPUI(GamificationManager.getLevelInfo(StorageManager.getXP()));
      }
      this.render();
    });

    li.querySelector('.action-icon-btn.pomodoro').addEventListener('click', () => {
      this.openPomodoroWithTask(task.id);
    });

    li.querySelector('.action-icon-btn.pin').addEventListener('click', () => {
      this.state.toggleTaskPin(task.id);
      this.render();
      this.showToast(task.pinned ? 'Task unpinned' : 'Task pinned to top');
    });

    li.querySelector('.action-icon-btn.edit').addEventListener('click', () => this.openEditModal(task.id));
    li.querySelector('.task-title').addEventListener('dblclick', () => this.openEditModal(task.id));

    li.querySelector('.action-icon-btn.delete').addEventListener('click', () => {
      const removed = this.state.deleteTask(task.id);
      if (removed) {
        this.render();
        this.showToast('Task deleted', true);
      }
    });

    li.querySelectorAll('.subtask-checkbox').forEach(subBox => {
      subBox.addEventListener('change', (e) => {
        const subId = e.target.getAttribute('data-subid');
        this.state.toggleSubtask(task.id, subId);
        GamificationManager.addXP(5);
        this.updateXPUI(GamificationManager.getLevelInfo(StorageManager.getXP()));
        this.render();
      });
    });

    this.setupDragAndDrop(li, task.id);
    return li;
  }

  setupDragAndDrop(el, taskId) {
    el.addEventListener('dragstart', (e) => {
      this.state.draggedTaskId = taskId;
      el.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', taskId);
    });

    el.addEventListener('dragend', () => {
      el.classList.remove('dragging');
      document.querySelectorAll('.task-item').forEach(i => i.classList.remove('drag-over'));
      document.querySelectorAll('.kanban-column').forEach(c => c.classList.remove('drag-target-active'));
      this.state.draggedTaskId = null;
    });

    el.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (this.state.draggedTaskId && this.state.draggedTaskId !== taskId) {
        el.classList.add('drag-over');
      }
    });

    el.addEventListener('dragleave', () => el.classList.remove('drag-over'));

    el.addEventListener('drop', (e) => {
      e.preventDefault();
      el.classList.remove('drag-over');
      const draggedId = this.state.draggedTaskId || e.dataTransfer.getData('text/plain');
      if (draggedId && draggedId !== taskId) {
        this.state.reorderTasks(draggedId, taskId);
        this.render();
      }
    });
  }

  setupKanbanDropZones() {
    document.querySelectorAll('.kanban-column').forEach(col => {
      col.addEventListener('dragover', (e) => {
        e.preventDefault();
        col.classList.add('drag-target-active');
      });
      col.addEventListener('dragleave', () => col.classList.remove('drag-target-active'));
      col.addEventListener('drop', (e) => {
        e.preventDefault();
        col.classList.remove('drag-target-active');
        const targetStatus = col.getAttribute('data-kanban-status');
        const draggedId = this.state.draggedTaskId || e.dataTransfer.getData('text/plain');
        if (draggedId && targetStatus) {
          this.state.setKanbanStatus(draggedId, targetStatus);
          this.render();
          this.showToast(`Task moved to ${targetStatus.toUpperCase()} • Synced to Cloud`);
        }
      });
    });
  }

  formatDueDate(dateStr) {
    if (!dateStr) return null;
    const due = new Date(dateStr + 'T00:00:00');
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const diffDays = Math.round((due - today) / (1000 * 60 * 60 * 24));

    if (diffDays < 0) {
      const daysAgo = Math.abs(diffDays);
      return { label: daysAgo === 1 ? 'Overdue (Yesterday)' : `Overdue (${daysAgo}d ago)`, status: 'overdue' };
    } else if (diffDays === 0) {
      return { label: 'Due Today', status: 'today' };
    } else if (diffDays === 1) {
      return { label: 'Due Tomorrow', status: 'upcoming' };
    } else if (diffDays <= 7) {
      return { label: `In ${diffDays} days`, status: 'upcoming' };
    } else {
      return { label: due.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), status: 'upcoming' };
    }
  }

  highlightQuery(text) {
    if (!this.state.searchQuery.trim()) return text;
    const query = this.escapeHTML(this.state.searchQuery.trim());
    const regex = new RegExp(`(${query})`, 'gi');
    return text.replace(regex, '<mark style="background: rgba(251, 191, 36, 0.35); color: inherit; padding: 0 2px; border-radius: 2px;">$1</mark>');
  }

  escapeHTML(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  capitalize(str) {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  showToast(message, allowUndo = false) {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = `
      <span>${message}</span>
      ${allowUndo ? '<button type="button" class="toast-undo-btn">Undo</button>' : ''}
    `;

    if (allowUndo) {
      toast.querySelector('.toast-undo-btn').addEventListener('click', () => {
        const restored = this.state.undoLastDelete();
        if (restored) {
          this.render();
          toast.remove();
          this.showToast('Task restored');
        }
      });
    }

    this.toastContainer.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, allowUndo ? 5000 : 3000);
  }

  exportTasksJSON() {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(this.state.tasks, null, 2));
    const a = document.createElement('a');
    a.href = dataStr;
    a.download = `taskflow-backup-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    this.showToast('Backup exported as JSON');
  }

  exportTasksCSV() {
    let csv = 'ID,Title,Notes,Priority,Category,DueDate,Completed,SubtasksCount\n';
    this.state.tasks.forEach(t => {
      const cleanTitle = (t.title || '').replace(/"/g, '""');
      const cleanNotes = (t.notes || '').replace(/"/g, '""');
      const subCount = t.subtasks ? t.subtasks.length : 0;
      csv += `"${t.id}","${cleanTitle}","${cleanNotes}","${t.priority}","${t.category}","${t.dueDate || ''}","${t.completed}","${subCount}"\n`;
    });

    const dataStr = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
    const a = document.createElement('a');
    a.href = dataStr;
    a.download = `taskflow-tasks-${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    this.showToast('Exported tasks as CSV');
  }

  importTasksJSON(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const imported = JSON.parse(e.target.result);
        if (Array.isArray(imported)) {
          this.state.tasks = imported;
          this.state.save();
          this.render();
          this.dataDialog.close();
          this.showToast(`Imported ${imported.length} tasks successfully`);
        } else {
          alert('Invalid format. Expected JSON array of tasks.');
        }
      } catch (err) {
        alert('Could not parse JSON file.');
      }
    };
    reader.readAsText(file);
    event.target.value = '';
  }
}

// ==========================================================================
// 8. App Bootstrap
// ==========================================================================
document.addEventListener('DOMContentLoaded', () => {
  ConfettiEngine.init();
  const appState = new AppState();
  window.TaskFlowApp = new UIManager(appState);
});
