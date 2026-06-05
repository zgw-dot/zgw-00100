const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const moment = require('moment');

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

function isTimeOverlap(s1, e1, s2, e2) {
  const start1 = moment(s1);
  const end1 = moment(e1);
  const start2 = moment(s2);
  const end2 = moment(e2);
  return start1.isBefore(end2) && start2.isBefore(end1);
}

function getOverlapPeriod(s1, e1, s2, e2) {
  const start1 = moment(s1);
  const end1 = moment(e1);
  const start2 = moment(s2);
  const end2 = moment(e2);
  
  const overlapStart = start1.isAfter(start2) ? start1 : start2;
  const overlapEnd = end1.isBefore(end2) ? end1 : end2;
  
  return {
    overlap_start: overlapStart.format('YYYY-MM-DD HH:mm:ss'),
    overlap_end: overlapEnd.format('YYYY-MM-DD HH:mm:ss')
  };
}

async function checkTimeSlotConflicts(equipmentId, startDate, endDate, excludeRequestId = null) {
  const borrowConflicts = await all(`
    SELECT 
      br.id,
      br.request_no,
      br.equipment_id,
      br.applicant_id,
      br.status,
      br.start_date,
      br.end_date,
      u.name as applicant_name
    FROM borrow_requests br
    LEFT JOIN users u ON br.applicant_id = u.id
    WHERE br.equipment_id = ?
      AND br.status IN ('pending', 'approved', 'collected')
      ${excludeRequestId ? 'AND br.id != ?' : ''}
  `, excludeRequestId ? [equipmentId, excludeRequestId] : [equipmentId]);

  const maintenanceConflicts = await all(`
    SELECT 
      mr.id,
      mr.equipment_id,
      mr.reporter_id,
      mr.status,
      mr.started_at as start_date,
      COALESCE(mr.estimated_completion_date, mr.completed_at, datetime('now', '+7 days')) as end_date,
      u.name as reporter_name
    FROM maintenance_records mr
    LEFT JOIN users u ON mr.reporter_id = u.id
    WHERE mr.equipment_id = ?
      AND mr.status IN ('pending', 'in_progress')
  `, [equipmentId]);

  const conflicts = [];

  for (const br of borrowConflicts) {
    if (isTimeOverlap(startDate, endDate, br.start_date, br.end_date)) {
      const overlap = getOverlapPeriod(startDate, endDate, br.start_date, br.end_date);
      conflicts.push({
        type: 'borrow',
        request_id: br.id,
        request_no: br.request_no,
        status: br.status,
        applicant_id: br.applicant_id,
        applicant_name: br.applicant_name,
        start_date: br.start_date,
        end_date: br.end_date,
        ...overlap
      });
    }
  }

  for (const mr of maintenanceConflicts) {
    if (isTimeOverlap(startDate, endDate, mr.start_date, mr.end_date)) {
      const overlap = getOverlapPeriod(startDate, endDate, mr.start_date, mr.end_date);
      conflicts.push({
        type: 'maintenance',
        maintenance_id: mr.id,
        maintenance_no: `MR${String(mr.id).padStart(6, '0')}`,
        status: mr.status,
        reporter_id: mr.reporter_id,
        reporter_name: mr.reporter_name,
        start_date: mr.start_date,
        end_date: mr.end_date,
        ...overlap
      });
    }
  }

  return conflicts;
}

function filterConflictsByPermission(conflicts, user) {
  if (user.role === 'admin') {
    return conflicts;
  }
  
  return conflicts.map(conflict => {
    if (conflict.type === 'borrow') {
      if (conflict.applicant_id === user.id) {
        return conflict;
      }
      return {
        type: conflict.type,
        request_no: conflict.request_no,
        status: conflict.status,
        start_date: conflict.start_date,
        end_date: conflict.end_date,
        overlap_start: conflict.overlap_start,
        overlap_end: conflict.overlap_end,
        applicant_name: '其他用户',
        applicant_id: null
      };
    } else {
      return conflict;
    }
  });
}

module.exports = {
  db,
  run,
  get,
  all,
  exec,
  initDatabase,
  logAction,
  transaction,
  checkTimeSlotConflicts,
  filterConflictsByPermission,
  isTimeOverlap,
  getOverlapPeriod
};
