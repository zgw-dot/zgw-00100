const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const dbDir = path.join(__dirname, 'data');
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const dbPath = path.join(dbDir, 'equipment.db');
const db = new sqlite3.Database(dbPath);

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

function exec(sql) {
  return new Promise((resolve, reject) => {
    db.exec(sql, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

async function initDatabase() {
  const createUsersTable = `
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin', 'member')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `;

  const createEquipmentTable = `
    CREATE TABLE IF NOT EXISTS equipment (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      model TEXT,
      location TEXT,
      status TEXT NOT NULL DEFAULT 'available' CHECK(status IN ('available', 'borrowed', 'maintenance', 'frozen')),
      description TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `;

  const createBorrowRequestsTable = `
    CREATE TABLE IF NOT EXISTS borrow_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      request_no TEXT UNIQUE NOT NULL,
      equipment_id INTEGER NOT NULL,
      applicant_id INTEGER NOT NULL,
      approver_id INTEGER,
      purpose TEXT NOT NULL,
      start_date DATETIME NOT NULL,
      end_date DATETIME NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected', 'collected', 'returned', 'cancelled')),
      approval_comment TEXT,
      approval_at DATETIME,
      collected_at DATETIME,
      return_acceptance_result TEXT,
      return_damage_note TEXT,
      returned_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (equipment_id) REFERENCES equipment(id),
      FOREIGN KEY (applicant_id) REFERENCES users(id),
      FOREIGN KEY (approver_id) REFERENCES users(id)
    )
  `;

  const createAuditLogsTable = `
    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      action TEXT NOT NULL,
      resource_type TEXT NOT NULL,
      resource_id INTEGER,
      details TEXT,
      ip_address TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `;

  const createMaintenanceRecordsTable = `
    CREATE TABLE IF NOT EXISTS maintenance_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      equipment_id INTEGER NOT NULL,
      reporter_id INTEGER NOT NULL,
      technician_id INTEGER,
      issue_description TEXT NOT NULL,
      priority TEXT DEFAULT 'normal',
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'in_progress', 'completed')),
      estimated_completion_date DATETIME,
      started_at DATETIME,
      completed_at DATETIME,
      repair_result TEXT,
      repair_cost REAL,
      damage_note TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (equipment_id) REFERENCES equipment(id),
      FOREIGN KEY (reporter_id) REFERENCES users(id),
      FOREIGN KEY (technician_id) REFERENCES users(id)
    )
  `;

  await exec(createUsersTable);
  await exec(createEquipmentTable);
  await exec(createBorrowRequestsTable);
  await exec(createAuditLogsTable);
  await exec(createMaintenanceRecordsTable);

  const userCount = await get('SELECT COUNT(*) as count FROM users');
  if (userCount.count === 0) {
    await run('INSERT INTO users (username, name, role) VALUES (?, ?, ?)', ['admin', '系统管理员', 'admin']);
    await run('INSERT INTO users (username, name, role) VALUES (?, ?, ?)', ['user1', '张三', 'member']);
    await run('INSERT INTO users (username, name, role) VALUES (?, ?, ?)', ['user2', '李四', 'member']);
    await run('INSERT INTO users (username, name, role) VALUES (?, ?, ?)', ['user3', '王五', 'member']);
  }
}

async function logAction(userId, action, resourceType, resourceId, details, ipAddress) {
  await run(
    'INSERT INTO audit_logs (user_id, action, resource_type, resource_id, details, ip_address) VALUES (?, ?, ?, ?, ?, ?)',
    [userId, action, resourceType, resourceId, JSON.stringify(details), ipAddress]
  );
}

async function transaction(callback) {
  await run('BEGIN TRANSACTION');
  try {
    await callback();
    await run('COMMIT');
  } catch (err) {
    await run('ROLLBACK');
    throw err;
  }
}

module.exports = {
  db,
  run,
  get,
  all,
  exec,
  initDatabase,
  logAction,
  transaction
};
