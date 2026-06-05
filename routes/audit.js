const express = require('express');
const router = express.Router();
const { get, all } = require('../database');
const { authenticate, requireAdmin } = require('../middleware/auth');

function getActionText(action) {
  const map = {
    'CREATE_EQUIPMENT': '创建设备',
    'UPDATE_EQUIPMENT': '更新设备',
    'DELETE_EQUIPMENT': '删除设备',
    'FREEZE_EQUIPMENT': '冻结设备',
    'UNFREEZE_EQUIPMENT': '解冻设备',
    'CREATE_BORROW_REQUEST': '创建借用申请',
    'APPROVE_BORROW_REQUEST': '批准借用申请',
    'REJECT_BORROW_REQUEST': '拒绝借用申请',
    'COLLECT_EQUIPMENT': '领用设备',
    'RETURN_EQUIPMENT': '归还设备',
    'CANCEL_BORROW_REQUEST': '取消借用申请',
    'CREATE_MAINTENANCE': '创建维修申请',
    'START_MAINTENANCE': '开始维修',
    'COMPLETE_MAINTENANCE': '完成维修'
  };
  return map[action] || action;
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  return dateStr.replace('T', ' ').substring(0, 19);
}

router.get('/logs', authenticate, requireAdmin, async (req, res) => {
  const { equipment_id, start_date, end_date, action, user_id } = req.query;
  let sql = `
    SELECT al.*, u.name as user_name, e.name as equipment_name, e.device_code
    FROM audit_logs al
    LEFT JOIN users u ON al.user_id = u.id
    LEFT JOIN equipment e ON al.resource_type = 'equipment' AND al.resource_id = e.id
    WHERE 1=1
  `;
  const params = [];

  if (equipment_id) {
    sql += ' AND (al.resource_type = ? AND al.resource_id = ?)';
    params.push('equipment', equipment_id);
  }
  if (start_date) {
    sql += ' AND al.created_at >= ?';
    params.push(start_date);
  }
  if (end_date) {
    sql += ' AND al.created_at <= ?';
    params.push(end_date);
  }
  if (action) {
    sql += ' AND al.action = ?';
    params.push(action);
  }
  if (user_id) {
    sql += ' AND al.user_id = ?';
    params.push(user_id);
  }

  sql += ' ORDER BY al.created_at DESC LIMIT 500';
  const logs = await all(sql, params);
  logs.forEach(log => log.action_text = getActionText(log.action));

  res.json({ logs });
});

router.get('/timeline/:equipment_id?', authenticate, async (req, res) => {
  const equipment_id = req.params.equipment_id || req.query.equipment_id;

  if (!equipment_id) {
    return res.status(400).json({
      error: '请指定设备ID',
      code: 'MISSING_EQUIPMENT_ID'
    });
  }

  const equipment = await get('SELECT * FROM equipment WHERE id = ?', [equipment_id]);
  if (!equipment) {
    return res.status(404).json({ error: '设备不存在', code: 'EQUIPMENT_NOT_FOUND' });
  }

  const borrowEvents = await all(`
    SELECT 'borrow' as type,
           br.created_at as event_time,
           br.created_at as date,
           br.status,
           br.purpose,
           br.start_date,
           br.end_date,
           br.collected_at,
           br.returned_at,
           br.return_acceptance_result,
           br.return_damage_note,
           u.name as user_name,
           u.name as applicant_name,
           a.name as approver_name,
           br.request_no
    FROM borrow_requests br
    LEFT JOIN users u ON br.applicant_id = u.id
    LEFT JOIN users a ON br.approver_id = a.id
    WHERE br.equipment_id = ?
    ORDER BY br.created_at DESC
  `, [equipment_id]);

  const maintenanceEvents = await all(`
    SELECT 'maintenance' as type,
           mr.created_at as event_time,
           mr.created_at as date,
           mr.status,
           mr.issue_description,
           mr.priority,
           mr.started_at,
           mr.completed_at,
           mr.repair_result,
           mr.repair_result as repair_note,
           mr.damage_note,
           u.name as user_name,
           u.name as reporter_name,
           t.name as technician_name
    FROM maintenance_records mr
    LEFT JOIN users u ON mr.reporter_id = u.id
    LEFT JOIN users t ON mr.technician_id = t.id
    WHERE mr.equipment_id = ?
    ORDER BY mr.created_at DESC
  `, [equipment_id]);

  const auditEvents = await all(`
    SELECT 'audit' as type,
           al.created_at as event_time,
           al.created_at as date,
           al.action,
           al.details,
           u.name as user_name
    FROM audit_logs al
    LEFT JOIN users u ON al.user_id = u.id
    WHERE al.resource_type = 'equipment' AND al.resource_id = ?
    ORDER BY al.created_at DESC
  `, [equipment_id]);

  const timeline = [
    ...borrowEvents.map(e => ({ ...e, action_text: getBorrowActionText(e) })),
    ...maintenanceEvents.map(e => ({ ...e, action_text: getMaintenanceActionText(e) })),
    ...auditEvents.map(e => ({ ...e, action_text: getActionText(e.action) }))
  ].sort((a, b) => new Date(b.event_time) - new Date(a.event_time));

  res.json({ equipment, timeline });
});

function getBorrowActionText(event) {
  const statusMap = {
    'pending': '提交借用申请',
    'approved': '申请已批准',
    'rejected': '申请已拒绝',
    'collected': '设备已领用',
    'returned': '设备已归还',
    'cancelled': '申请已取消'
  };
  return statusMap[event.status] || '借用事件';
}

function getMaintenanceActionText(event) {
  const statusMap = {
    'pending': '提交维修申请',
    'in_progress': '维修进行中',
    'completed': '维修已完成'
  };
  return statusMap[event.status] || '维修事件';
}

function getEquipmentStatusText(status) {
  const map = {
    'available': '可用',
    'borrowed': '已借出',
    'maintenance': '维修中',
    'frozen': '冻结'
  };
  return map[status] || status;
}

const exportEquipmentHandler = async (req, res) => {
  const { format = 'csv', equipment_id, start_date, end_date } = req.query;

  let sql = `
    SELECT
      e.id,
      e.device_code,
      e.name,
      e.category,
      e.model,
      e.location,
      e.status,
      e.description,
      e.created_at,
      e.updated_at
    FROM equipment e
    WHERE 1=1
  `;
  const params = [];

  if (equipment_id) {
    sql += ' AND e.id = ?';
    params.push(equipment_id);
  }
  if (start_date) {
    sql += ' AND e.created_at >= ?';
    params.push(start_date);
  }
  if (end_date) {
    sql += ' AND e.created_at <= ?';
    params.push(end_date);
  }

  sql += ' ORDER BY e.updated_at DESC';
  const records = await all(sql, params);

  records.forEach(r => {
    r.status_text = getEquipmentStatusText(r.status);
  });

  if (format === 'json') {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="equipment_export_${Date.now()}.json"`);
    return res.json({ records, exported_at: new Date().toISOString() });
  }

  const headers = [
    '设备编号', '设备名称', '设备分类', '规格型号', '存放位置',
    '状态', '描述', '创建时间', '更新时间'
  ];

  const rows = records.map(r => [
    r.device_code,
    r.name,
    r.category,
    r.model || '',
    r.location || '',
    r.status_text,
    r.description || '',
    formatDate(r.created_at),
    formatDate(r.updated_at)
  ]);

  const csvContent = [
    headers.join(','),
    ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
  ].join('\n');

  const bom = '\uFEFF';
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="equipment_export_${Date.now()}.csv"`);
  res.send(bom + csvContent);
};

const exportBorrowHandler = async (req, res) => {
  const { format = 'csv', equipment_id, start_date, end_date } = req.query;

  let sql = `
    SELECT
      br.request_no,
      e.device_code,
      e.name as equipment_name,
      e.category,
      u.name as applicant_name,
      a.name as approver_name,
      br.purpose,
      br.start_date,
      br.end_date,
      br.status,
      br.collected_at,
      br.returned_at,
      br.return_acceptance_result,
      br.return_damage_note,
      br.approval_comment,
      br.created_at
    FROM borrow_requests br
    LEFT JOIN equipment e ON br.equipment_id = e.id
    LEFT JOIN users u ON br.applicant_id = u.id
    LEFT JOIN users a ON br.approver_id = a.id
    WHERE 1=1
  `;
  const params = [];

  if (equipment_id) {
    sql += ' AND br.equipment_id = ?';
    params.push(equipment_id);
  }
  if (start_date) {
    sql += ' AND br.created_at >= ?';
    params.push(start_date);
  }
  if (end_date) {
    sql += ' AND br.created_at <= ?';
    params.push(end_date);
  }

  sql += ' ORDER BY br.created_at DESC';
  const records = await all(sql, params);

  records.forEach(r => {
    r.status_text = getBorrowStatusText(r.status);
  });

  if (format === 'json') {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="borrow_export_${Date.now()}.json"`);
    return res.json({ records, exported_at: new Date().toISOString() });
  }

  const headers = [
    '申请单号', '设备编号', '设备名称', '设备分类', '申请人', '审批人',
    '借用用途', '开始时间', '结束时间', '状态', '领用时间', '归还时间',
    '验收结果', '损坏备注', '审批意见', '创建时间'
  ];

  const rows = records.map(r => [
    r.request_no,
    r.device_code,
    r.equipment_name,
    r.category,
    r.applicant_name,
    r.approver_name || '',
    r.purpose,
    formatDate(r.start_date),
    formatDate(r.end_date),
    r.status_text,
    formatDate(r.collected_at),
    formatDate(r.returned_at),
    r.return_acceptance_result || '',
    r.return_damage_note || '',
    r.approval_comment || '',
    formatDate(r.created_at)
  ]);

  const csvContent = [
    headers.join(','),
    ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
  ].join('\n');

  const bom = '\uFEFF';
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="borrow_export_${Date.now()}.csv"`);
  res.send(bom + csvContent);
};

function getBorrowStatusText(status) {
  const map = {
    'pending': '待审批',
    'approved': '已批准',
    'rejected': '已拒绝',
    'collected': '已领用',
    'returned': '已归还',
    'cancelled': '已取消'
  };
  return map[status] || status;
}

router.get('/export', authenticate, requireAdmin, exportBorrowHandler);
router.get('/export/equipment', authenticate, requireAdmin, exportEquipmentHandler);
router.get('/export/borrow', authenticate, requireAdmin, exportBorrowHandler);

module.exports = router;
