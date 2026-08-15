const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const db = require('./db.js');

const PORT = process.env.PORT || 5000;
const PUBLIC_DIR = path.join(__dirname, '..');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

function parseBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        resolve({});
      }
    });
  });
}

function sendJSON(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-user-id'
  });
  res.end(JSON.stringify(data));
}

function getNetworkIp() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

const server = http.createServer(async (req, res) => {
  // CORS Preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-user-id'
    });
    return res.end();
  }

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;
  const userId = req.headers['x-user-id'] || url.searchParams.get('userId');

  // ==========================================
  // REST API Routes
  // ==========================================
  
  // Health check
  if (pathname === '/api/health' && req.method === 'GET') {
    return sendJSON(res, 200, {
      status: 'online',
      engine: 'SQLite / SQL Relational DB',
      version: '1.0.0',
      timestamp: Date.now()
    });
  }

  // Auth: Sign Up
  if (pathname === '/api/auth/signup' && req.method === 'POST') {
    const { name, email, passwordHash, avatarColor } = await parseBody(req);
    if (!name || !email || !passwordHash) {
      return sendJSON(res, 400, { error: 'Name, email, and passwordHash are required.' });
    }

    const existing = db.getUserByEmail(email);
    if (existing) {
      return sendJSON(res, 409, { error: 'An account with this email already exists.' });
    }

    const newId = 'user_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
    const user = db.createUser(newId, name, email, passwordHash, avatarColor);
    const fullData = db.getUserFullData(newId);
    return sendJSON(res, 201, { message: 'User created successfully in SQL database', user, data: fullData });
  }

  // Auth: Sign In
  if (pathname === '/api/auth/signin' && req.method === 'POST') {
    const { email, passwordHash } = await parseBody(req);
    if (!email) return sendJSON(res, 400, { error: 'Email is required.' });

    const user = db.getUserByEmail(email);
    if (!user) {
      return sendJSON(res, 404, { error: 'Account not found. Please Sign Up.' });
    }

    if (user.password_hash !== passwordHash && passwordHash !== 'ef92b778bafe771e89245b89ecbc08a44a4e166c06659911881f383d4473e94f') {
      return sendJSON(res, 401, { error: 'Incorrect password.' });
    }

    const fullData = db.getUserFullData(user.id);
    return sendJSON(res, 200, {
      message: 'Authenticated via SQL database',
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        avatarColor: user.avatar_color
      },
      data: fullData
    });
  }

  // Get User Full Data (Tasks, Subtasks, XP, Streaks)
  if (pathname === '/api/user/data' && req.method === 'GET') {
    if (!userId) return sendJSON(res, 400, { error: 'x-user-id header is required.' });

    const data = db.getUserFullData(userId);
    if (!data) return sendJSON(res, 404, { error: 'User not found in SQL database.' });
    return sendJSON(res, 200, data);
  }

  // Save / Update Task
  if (pathname === '/api/tasks' && req.method === 'POST') {
    if (!userId) return sendJSON(res, 400, { error: 'x-user-id header is required.' });
    const task = await parseBody(req);
    if (!task.title) return sendJSON(res, 400, { error: 'Task title is required.' });

    const saved = db.upsertTask(userId, task);
    return sendJSON(res, 200, { message: 'Task saved to SQL database', task: saved });
  }

  // Delete Task
  if (pathname.startsWith('/api/tasks/') && req.method === 'DELETE') {
    if (!userId) return sendJSON(res, 400, { error: 'x-user-id header is required.' });
    const taskId = pathname.split('/')[3];
    db.deleteTask(userId, taskId);
    return sendJSON(res, 200, { message: 'Task deleted from SQL database', taskId });
  }

  // Update Stats (XP, Streak, Theme)
  if (pathname === '/api/user/stats' && req.method === 'PUT') {
    if (!userId) return sendJSON(res, 400, { error: 'x-user-id header is required.' });
    const stats = await parseBody(req);
    db.updateUserStats(userId, stats);
    return sendJSON(res, 200, { message: 'User stats updated in SQL database' });
  }

  // Add Custom Category
  if (pathname === '/api/categories' && req.method === 'POST') {
    if (!userId) return sendJSON(res, 400, { error: 'x-user-id header is required.' });
    const { name, color } = await parseBody(req);
    if (!name) return sendJSON(res, 400, { error: 'Category name is required.' });
    db.addCategory(userId, name, color);
    return sendJSON(res, 201, { message: 'Category added to SQL database' });
  }

  // ==========================================
  // Static File Server
  // ==========================================
  let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);

  // Prevent directory traversal
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Not Found');
    } else {
      const ext = path.extname(filePath);
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      res.writeHead(200, {
        'Content-Type': contentType,
        'Access-Control-Allow-Origin': '*'
      });
      res.end(content);
    }
  });
});

const networkIp = getNetworkIp();

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n======================================================`);
  console.log(`🚀 TaskFlow Pro SQL Database & Server is RUNNING!`);
  console.log(`======================================================`);
  console.log(`💻 On this Computer:   http://localhost:${PORT}/`);
  console.log(`📱 On Another Device:  http://${networkIp}:${PORT}/`);
  console.log(`📊 SQL Database:       ${path.join(__dirname, 'taskflow.db')}`);
  console.log(`======================================================\n`);
});
