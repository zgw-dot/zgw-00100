const express = require('express');
const router = express.Router();
const { get, all, getTimelineEvents, getEventText, getSourceType } = require('../database');
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

function filterTimelineByPermission(events, user) {
  if (user.role === 'admin') {
    return events;
  }

  return events.map(event => {
    const isOperator = event.operator_id === user.id;
    const filteredEvent = { ...event };

    if (event.source_type === 'borrow' || event.source_type === 'maintenance') {
      if (!isOperator) {
        filteredEvent.operator_name = '其他用户';
        filteredEvent.operator_id = null;
        if (filteredEvent.details) {
          if (filteredEvent.details.approval_comment) {
            filteredEvent.details.approval_comment = null;
          }
          if (filteredEvent.details.return_damage_note) {
            filteredEvent.details.return_damage_note = null;
          }
          if (filteredEvent.details.repair_result) {
            filteredEvent.details.repair_result = null;
          }
          if (filteredEvent.details.damage_note) {
            filteredEvent.details.damage_note = null;
          }
        }
      }
    }

    if (event.event_type === 'borrow_conflict_blocked' || event.event_type === 'maintenance_conflict_blocked') {
      if (filteredEvent.details && filteredEvent.details.conflicts) {
        filteredEvent.details.conflicts = filteredEvent.details.conflicts.map(c => {
          const isOwnConflict = (c.type === 'borrow' && c.applicant_id === user.id) ||
                               (c.type === 'maintenance' && c.reporter_id === user.id);
          if (!isOwnConflict) {
            return {
              type: c.type,
              request_no: c.request_no,
              maintenance_no: c.maintenance_no,
              status: c.status,
              overlap_start: c.overlap_start,
              overlap_end: c.overlap_end,
              applicant_name: c.type === 'borrow' ? '其他用户' : undefined,
              reporter_name: c.type === 'maintenance' ? '其他用户' : undefined,
              applicant_id: null,
              reporter_id: null
            };
          }
          return c;
        });
      }
    }

    return filteredEvent;
  });
}

const exportTimelineHandler = async (req, res) => {
  const { format = 'csv', equipment_id, start_date, end_date } = req.query;

  if (format !== 'csv' && format !== 'json') {
    return res.status(400).json({
      error: '不支持的导出格式，仅支持 csv 和 json',
      code: 'INVALID_EXPORT_FORMAT'
    });
  }

  if (equipment_id) {
    const equipment = await get('SELECT * FROM equipment WHERE id = ?', [equipment_id]);
    if (!equipment) {
      return res.status(404).json({
        error: '设备不存在',
        code: 'EQUIPMENT_NOT_FOUND'
      });
    }
  }

  const events = await getTimelineEvents(equipment_id, start_date, end_date);

  const exportMeta = {
    exported_at: new Date().toISOString(),
    exported_by: req.user.name,
    exported_by_id: req.user.id,
    filters: {
      equipment_id: equipment_id || null,
      start_date: start_date || null,
      end_date: end_date || null,
      format: format
    },
    event_count: events.length,
    equipment_info: equipment_id ? await get('SELECT id, device_code, name FROM equipment WHERE id = ?', [equipment_id]) : null
  };

  if (format === 'json') {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    const filename = equipment_id
      ? `timeline_equipment_${equipment_id}_${Date.now()}.json`
      : `timeline_all_${Date.now()}.json`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.json({
      meta: exportMeta,
      events: events
    });
  }

  const headers = [
    '事件ID', '事件时间', '事件类型', '事件描述', '来源类型', '来源ID',
    '状态', '状态描述', '操作者ID', '操作者姓名',
    '设备ID', '设备编号', '设备名称', '详情'
  ];

  const rows = events.map(e => [
    e.event_id,
    formatDate(e.event_time),
    e.event_type,
    e.event_text,
    e.source_type,
    e.source_id,
    e.status,
    e.status_text,
    e.operator_id || '',
    e.operator_name || '',
    e.equipment_id || '',
    e.device_code || '',
    e.equipment_name || '',
    JSON.stringify(e.details || {}).replace(/"/g, '""')
  ]);

  const csvContent = [
    headers.join(','),
    ...rows.map(row => row.map(cell => `"${String(cell)}"`).join(','))
  ].join('\n');

  const bom = '\uFEFF';
  const filename = equipment_id
    ? `timeline_equipment_${equipment_id}_${Date.now()}.csv`
    : `timeline_all_${Date.now()}.csv`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(bom + csvContent);
};

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

  const events = await getTimelineEvents(equipment_id);
  const filteredEvents = filterTimelineByPermission(events, req.user);

  res.json({
    equipment,
    timeline: filteredEvents
  });
});

router.get('/export', authenticate, requireAdmin, exportBorrowHandler);
router.get('/export/equipment', authenticate, requireAdmin, exportEquipmentHandler);
router.get('/export/borrow', authenticate, requireAdmin, exportBorrowHandler);
router.get('/export/timeline', authenticate, requireAdmin, exportTimelineHandler);

module.exports = router;
