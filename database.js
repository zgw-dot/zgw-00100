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
      if (conflict.reporter_id === user.id) {
        return conflict;
      }
      return {
        type: conflict.type,
        maintenance_no: conflict.maintenance_no,
        status: conflict.status,
        start_date: conflict.start_date,
        end_date: conflict.end_date,
        overlap_start: conflict.overlap_start,
        overlap_end: conflict.overlap_end,
        reporter_name: '其他用户',
        reporter_id: null
      };
    }
  });
}

const EVENT_TYPE_MAP = {
  borrow_created: { text: '提交借用申请', source_type: 'borrow' },
  borrow_approved: { text: '批准借用申请', source_type: 'borrow' },
  borrow_rejected: { text: '拒绝借用申请', source_type: 'borrow' },
  borrow_collected: { text: '领用设备', source_type: 'borrow' },
  borrow_returned: { text: '归还设备', source_type: 'borrow' },
  borrow_cancelled: { text: '取消借用申请', source_type: 'borrow' },
  maintenance_created: { text: '提交维修申请', source_type: 'maintenance' },
  maintenance_started: { text: '开始维修', source_type: 'maintenance' },
  maintenance_completed: { text: '完成维修', source_type: 'maintenance' },
  borrow_conflict_blocked: { text: '借用申请因冲突被拦截', source_type: 'audit' },
  maintenance_conflict_blocked: { text: '维修因冲突被拦截', source_type: 'audit' }
};

function getEventText(eventType) {
  return EVENT_TYPE_MAP[eventType]?.text || eventType;
}

function getSourceType(eventType) {
  return EVENT_TYPE_MAP[eventType]?.source_type || 'unknown';
}

async function getTimelineEvents(equipmentId = null, startDate = null, endDate = null) {
  const events = [];
  const params = [];
  let whereSql = 'WHERE 1=1';

  if (equipmentId) {
    whereSql += ' AND br.equipment_id = ?';
    params.push(equipmentId);
  }
  if (startDate) {
    whereSql += ' AND br.created_at >= ?';
    params.push(startDate);
  }
  if (endDate) {
    whereSql += ' AND br.created_at <= ?';
    params.push(endDate);
  }

  const borrowEvents = await all(`
    SELECT
      'borrow_' || br.status as event_type,
      br.id as source_id,
      br.created_at as event_time,
      br.status,
      br.applicant_id as operator_id,
      u.name as operator_name,
      br.equipment_id,
      e.name as equipment_name,
      e.device_code,
      br.request_no,
      br.purpose,
      br.start_date as period_start,
      br.end_date as period_end,
      NULL as conflict_details
    FROM borrow_requests br
    LEFT JOIN users u ON br.applicant_id = u.id
    LEFT JOIN equipment e ON br.equipment_id = e.id
    ${whereSql}
    ORDER BY br.created_at ASC
  `, params);

  borrowEvents.forEach(e => {
    events.push({
      event_id: `borrow_${e.source_id}_created`,
      event_time: e.event_time,
      event_type: 'borrow_created',
      source_type: 'borrow',
      source_id: e.source_id,
      status: 'pending',
      status_text: '待审批',
      operator_id: e.operator_id,
      operator_name: e.operator_name,
      equipment_id: e.equipment_id,
      equipment_name: e.equipment_name,
      device_code: e.device_code,
      event_text: getEventText('borrow_created'),
      details: {
        request_no: e.request_no,
        purpose: e.purpose,
        period_start: e.period_start,
        period_end: e.period_end
      }
    });
  });

  const approvalParams = [];
  let approvalWhere = 'WHERE br.approval_at IS NOT NULL';
  if (equipmentId) {
    approvalWhere += ' AND br.equipment_id = ?';
    approvalParams.push(equipmentId);
  }
  if (startDate) {
    approvalWhere += ' AND br.approval_at >= ?';
    approvalParams.push(startDate);
  }
  if (endDate) {
    approvalWhere += ' AND br.approval_at <= ?';
    approvalParams.push(endDate);
  }

  const approvalEvents = await all(`
    SELECT
      br.status as event_type,
      br.id as source_id,
      br.approval_at as event_time,
      br.status,
      br.approver_id as operator_id,
      a.name as operator_name,
      br.equipment_id,
      e.name as equipment_name,
      e.device_code,
      br.request_no,
      br.approval_comment
    FROM borrow_requests br
    LEFT JOIN users a ON br.approver_id = a.id
    LEFT JOIN equipment e ON br.equipment_id = e.id
    ${approvalWhere}
    ORDER BY br.approval_at ASC
  `, approvalParams);

  approvalEvents.forEach(e => {
    const isRejected = e.status === 'rejected';
    const eventType = isRejected ? 'borrow_rejected' : 'borrow_approved';
    const eventStatus = isRejected ? 'rejected' : 'approved';
    const statusText = isRejected ? '已拒绝' : '已批准';
    events.push({
      event_id: `borrow_${e.source_id}_${eventStatus}`,
      event_time: e.event_time,
      event_type: eventType,
      source_type: 'borrow',
      source_id: e.source_id,
      status: eventStatus,
      status_text: statusText,
      operator_id: e.operator_id || 0,
      operator_name: e.operator_name || '系统',
      equipment_id: e.equipment_id,
      equipment_name: e.equipment_name,
      device_code: e.device_code,
      event_text: getEventText(eventType),
      details: {
        request_no: e.request_no,
        approval_comment: e.approval_comment
      }
    });
  });

  const collectParams = [];
  let collectWhere = 'WHERE br.collected_at IS NOT NULL';
  if (equipmentId) {
    collectWhere += ' AND br.equipment_id = ?';
    collectParams.push(equipmentId);
  }
  if (startDate) {
    collectWhere += ' AND br.collected_at >= ?';
    collectParams.push(startDate);
  }
  if (endDate) {
    collectWhere += ' AND br.collected_at <= ?';
    collectParams.push(endDate);
  }

  const collectEvents = await all(`
    SELECT
      br.id as source_id,
      br.collected_at as event_time,
      br.applicant_id as operator_id,
      u.name as operator_name,
      br.equipment_id,
      e.name as equipment_name,
      e.device_code,
      br.request_no
    FROM borrow_requests br
    LEFT JOIN users u ON br.applicant_id = u.id
    LEFT JOIN equipment e ON br.equipment_id = e.id
    ${collectWhere}
    ORDER BY br.collected_at ASC
  `, collectParams);

  collectEvents.forEach(e => {
    events.push({
      event_id: `borrow_${e.source_id}_collected`,
      event_time: e.event_time,
      event_type: 'borrow_collected',
      source_type: 'borrow',
      source_id: e.source_id,
      status: 'collected',
      status_text: '已领用',
      operator_id: e.operator_id,
      operator_name: e.operator_name,
      equipment_id: e.equipment_id,
      equipment_name: e.equipment_name,
      device_code: e.device_code,
      event_text: getEventText('borrow_collected'),
      details: {
        request_no: e.request_no
      }
    });
  });

  const returnParams = [];
  let returnWhere = 'WHERE br.returned_at IS NOT NULL';
  if (equipmentId) {
    returnWhere += ' AND br.equipment_id = ?';
    returnParams.push(equipmentId);
  }
  if (startDate) {
    returnWhere += ' AND br.returned_at >= ?';
    returnParams.push(startDate);
  }
  if (endDate) {
    returnWhere += ' AND br.returned_at <= ?';
    returnParams.push(endDate);
  }

  const returnEvents = await all(`
    SELECT
      br.id as source_id,
      br.returned_at as event_time,
      br.applicant_id as operator_id,
      u.name as operator_name,
      br.equipment_id,
      e.name as equipment_name,
      e.device_code,
      br.request_no,
      br.return_acceptance_result,
      br.return_damage_note
    FROM borrow_requests br
    LEFT JOIN users u ON br.applicant_id = u.id
    LEFT JOIN equipment e ON br.equipment_id = e.id
    ${returnWhere}
    ORDER BY br.returned_at ASC
  `, returnParams);

  returnEvents.forEach(e => {
    events.push({
      event_id: `borrow_${e.source_id}_returned`,
      event_time: e.event_time,
      event_type: 'borrow_returned',
      source_type: 'borrow',
      source_id: e.source_id,
      status: 'returned',
      status_text: '已归还',
      operator_id: e.operator_id,
      operator_name: e.operator_name,
      equipment_id: e.equipment_id,
      equipment_name: e.equipment_name,
      device_code: e.device_code,
      event_text: getEventText('borrow_returned'),
      details: {
        request_no: e.request_no,
        return_acceptance_result: e.return_acceptance_result,
        return_damage_note: e.return_damage_note
      }
    });
  });

  const cancelParams = [];
  let cancelWhere = "WHERE br.status = 'cancelled'";
  if (equipmentId) {
    cancelWhere += ' AND br.equipment_id = ?';
    cancelParams.push(equipmentId);
  }

  const cancelEvents = await all(`
    SELECT
      br.id as source_id,
      br.created_at as event_time,
      br.applicant_id as operator_id,
      u.name as operator_name,
      br.equipment_id,
      e.name as equipment_name,
      e.device_code,
      br.request_no
    FROM borrow_requests br
    LEFT JOIN users u ON br.applicant_id = u.id
    LEFT JOIN equipment e ON br.equipment_id = e.id
    ${cancelWhere}
    ORDER BY br.created_at ASC
  `, cancelParams);

  cancelEvents.forEach(e => {
    events.push({
      event_id: `borrow_${e.source_id}_cancelled`,
      event_time: e.event_time,
      event_type: 'borrow_cancelled',
      source_type: 'borrow',
      source_id: e.source_id,
      status: 'cancelled',
      status_text: '已取消',
      operator_id: e.operator_id,
      operator_name: e.operator_name,
      equipment_id: e.equipment_id,
      equipment_name: e.equipment_name,
      device_code: e.device_code,
      event_text: getEventText('borrow_cancelled'),
      details: {
        request_no: e.request_no
      }
    });
  });

  const maintParams = [];
  let maintWhere = 'WHERE 1=1';
  if (equipmentId) {
    maintWhere += ' AND mr.equipment_id = ?';
    maintParams.push(equipmentId);
  }
  if (startDate) {
    maintWhere += ' AND mr.created_at >= ?';
    maintParams.push(startDate);
  }
  if (endDate) {
    maintWhere += ' AND mr.created_at <= ?';
    maintParams.push(endDate);
  }

  const maintEvents = await all(`
    SELECT
      mr.id as source_id,
      mr.created_at as event_time,
      mr.status,
      mr.reporter_id as operator_id,
      u.name as operator_name,
      mr.equipment_id,
      e.name as equipment_name,
      e.device_code,
      mr.issue_description,
      mr.priority
    FROM maintenance_records mr
    LEFT JOIN users u ON mr.reporter_id = u.id
    LEFT JOIN equipment e ON mr.equipment_id = e.id
    ${maintWhere}
    ORDER BY mr.created_at ASC
  `, maintParams);

  maintEvents.forEach(e => {
    events.push({
      event_id: `maintenance_${e.source_id}_created`,
      event_time: e.event_time,
      event_type: 'maintenance_created',
      source_type: 'maintenance',
      source_id: e.source_id,
      status: 'pending',
      status_text: '待处理',
      operator_id: e.operator_id,
      operator_name: e.operator_name,
      equipment_id: e.equipment_id,
      equipment_name: e.equipment_name,
      device_code: e.device_code,
      event_text: getEventText('maintenance_created'),
      details: {
        maintenance_no: `MR${String(e.source_id).padStart(6, '0')}`,
        issue_description: e.issue_description,
        priority: e.priority
      }
    });
  });

  const maintStartParams = [];
  let maintStartWhere = 'WHERE mr.started_at IS NOT NULL';
  if (equipmentId) {
    maintStartWhere += ' AND mr.equipment_id = ?';
    maintStartParams.push(equipmentId);
  }
  if (startDate) {
    maintStartWhere += ' AND mr.started_at >= ?';
    maintStartParams.push(startDate);
  }
  if (endDate) {
    maintStartWhere += ' AND mr.started_at <= ?';
    maintStartParams.push(endDate);
  }

  const maintStartEvents = await all(`
    SELECT
      mr.id as source_id,
      mr.started_at as event_time,
      mr.technician_id as operator_id,
      t.name as operator_name,
      mr.equipment_id,
      e.name as equipment_name,
      e.device_code,
      mr.estimated_completion_date
    FROM maintenance_records mr
    LEFT JOIN users t ON mr.technician_id = t.id
    LEFT JOIN equipment e ON mr.equipment_id = e.id
    ${maintStartWhere}
    ORDER BY mr.started_at ASC
  `, maintStartParams);

  maintStartEvents.forEach(e => {
    events.push({
      event_id: `maintenance_${e.source_id}_started`,
      event_time: e.event_time,
      event_type: 'maintenance_started',
      source_type: 'maintenance',
      source_id: e.source_id,
      status: 'in_progress',
      status_text: '维修中',
      operator_id: e.operator_id || 0,
      operator_name: e.operator_name || '系统',
      equipment_id: e.equipment_id,
      equipment_name: e.equipment_name,
      device_code: e.device_code,
      event_text: getEventText('maintenance_started'),
      details: {
        maintenance_no: `MR${String(e.source_id).padStart(6, '0')}`,
        estimated_completion_date: e.estimated_completion_date
      }
    });
  });

  const maintCompleteParams = [];
  let maintCompleteWhere = 'WHERE mr.completed_at IS NOT NULL';
  if (equipmentId) {
    maintCompleteWhere += ' AND mr.equipment_id = ?';
    maintCompleteParams.push(equipmentId);
  }
  if (startDate) {
    maintCompleteWhere += ' AND mr.completed_at >= ?';
    maintCompleteParams.push(startDate);
  }
  if (endDate) {
    maintCompleteWhere += ' AND mr.completed_at <= ?';
    maintCompleteParams.push(endDate);
  }

  const maintCompleteEvents = await all(`
    SELECT
      mr.id as source_id,
      mr.completed_at as event_time,
      mr.technician_id as operator_id,
      t.name as operator_name,
      mr.equipment_id,
      e.name as equipment_name,
      e.device_code,
      mr.repair_result,
      mr.repair_cost,
      mr.damage_note
    FROM maintenance_records mr
    LEFT JOIN users t ON mr.technician_id = t.id
    LEFT JOIN equipment e ON mr.equipment_id = e.id
    ${maintCompleteWhere}
    ORDER BY mr.completed_at ASC
  `, maintCompleteParams);

  maintCompleteEvents.forEach(e => {
    events.push({
      event_id: `maintenance_${e.source_id}_completed`,
      event_time: e.event_time,
      event_type: 'maintenance_completed',
      source_type: 'maintenance',
      source_id: e.source_id,
      status: 'completed',
      status_text: '已完成',
      operator_id: e.operator_id || 0,
      operator_name: e.operator_name || '系统',
      equipment_id: e.equipment_id,
      equipment_name: e.equipment_name,
      device_code: e.device_code,
      event_text: getEventText('maintenance_completed'),
      details: {
        maintenance_no: `MR${String(e.source_id).padStart(6, '0')}`,
        repair_result: e.repair_result,
        repair_cost: e.repair_cost,
        damage_note: e.damage_note
      }
    });
  });

  const conflictParams = [];
  let conflictWhere = "WHERE al.action IN ('BORROW_REQUEST_BLOCKED_BY_CONFLICT', 'MAINTENANCE_BLOCKED_BY_CONFLICT')";
  if (equipmentId) {
    conflictWhere += ' AND al.resource_id = ?';
    conflictParams.push(equipmentId);
  }
  if (startDate) {
    conflictWhere += ' AND al.created_at >= ?';
    conflictParams.push(startDate);
  }
  if (endDate) {
    conflictWhere += ' AND al.created_at <= ?';
    conflictParams.push(endDate);
  }

  const conflictEvents = await all(`
    SELECT
      al.id as source_id,
      al.created_at as event_time,
      al.action,
      al.user_id as operator_id,
      u.name as operator_name,
      al.resource_id as equipment_id,
      e.name as equipment_name,
      e.device_code,
      al.details
    FROM audit_logs al
    LEFT JOIN users u ON al.user_id = u.id
    LEFT JOIN equipment e ON al.resource_id = e.id AND al.resource_type = 'equipment'
    ${conflictWhere}
    ORDER BY al.created_at ASC
  `, conflictParams);

  conflictEvents.forEach((e, idx) => {
    const eventType = e.action === 'BORROW_REQUEST_BLOCKED_BY_CONFLICT'
      ? 'borrow_conflict_blocked'
      : 'maintenance_conflict_blocked';
    let parsedDetails = {};
    try {
      parsedDetails = JSON.parse(e.details);
    } catch (err) {
      parsedDetails = { raw: e.details };
    }

    events.push({
      event_id: `conflict_${e.source_id}_${idx}`,
      event_time: e.event_time,
      event_type: eventType,
      source_type: 'audit',
      source_id: e.source_id,
      status: 'blocked',
      status_text: '已拦截',
      operator_id: e.operator_id,
      operator_name: e.operator_name,
      equipment_id: e.equipment_id,
      equipment_name: e.equipment_name,
      device_code: e.device_code,
      event_text: getEventText(eventType),
      details: {
        conflict_count: parsedDetails.conflict_count,
        conflicts: parsedDetails.conflicts,
        start_date: parsedDetails.start_date,
        end_date: parsedDetails.end_date
      }
    });
  });

  events.sort((a, b) => {
    const timeDiff = new Date(a.event_time) - new Date(b.event_time);
    if (timeDiff !== 0) return timeDiff;
    return a.event_id.localeCompare(b.event_id);
  });

  return events;
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
  getOverlapPeriod,
  getTimelineEvents,
  getEventText,
  getSourceType,
  EVENT_TYPE_MAP
};
