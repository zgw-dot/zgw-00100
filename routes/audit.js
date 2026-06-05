const express = require('express');
const router = express.Router();
const {
  get,
  all,
  getTimelineEvents,
  getEventText,
  getSourceType,
  logAction,
  createAuditView,
  getAuditViewById,
  getAuditViewByName,
  getAllAuditViews,
  updateAuditView,
  deleteAuditView,
  EVENT_TYPE_MAP
} = require('../database');
const { authenticate, requireAdmin } = require('../middleware/auth');

const VALID_EVENT_TYPES = Object.keys(EVENT_TYPE_MAP);
const VALID_EXPORT_FORMATS = ['json', 'csv'];

function validateViewParams(params, isUpdate = false) {
  const errors = [];

  if (!isUpdate) {
    if (!params.name || typeof params.name !== 'string' || params.name.trim().length === 0) {
      errors.push('视图名称不能为空');
    } else if (params.name.length > 100) {
      errors.push('视图名称不能超过100个字符');
    }
  }

  if (params.name !== undefined && params.name !== null) {
    if (typeof params.name !== 'string' || params.name.trim().length === 0) {
      errors.push('视图名称不能为空');
    } else if (params.name.length > 100) {
      errors.push('视图名称不能超过100个字符');
    }
  }

  if (params.export_format !== undefined) {
    if (!VALID_EXPORT_FORMATS.includes(params.export_format)) {
      errors.push(`导出格式必须是以下之一: ${VALID_EXPORT_FORMATS.join(', ')}`);
    }
  }

  if (params.event_types !== undefined && params.event_types !== null) {
    if (!Array.isArray(params.event_types)) {
      errors.push('事件类型必须是数组');
    } else {
      for (const et of params.event_types) {
        if (!VALID_EVENT_TYPES.includes(et)) {
          errors.push(`无效的事件类型: ${et}，有效值: ${VALID_EVENT_TYPES.join(', ')}`);
        }
      }
    }
  }

  if (params.start_date !== undefined && params.start_date !== null) {
    const date = new Date(params.start_date);
    if (isNaN(date.getTime())) {
      errors.push('开始日期格式无效');
    }
  }

  if (params.end_date !== undefined && params.end_date !== null) {
    const date = new Date(params.end_date);
    if (isNaN(date.getTime())) {
      errors.push('结束日期格式无效');
    }
  }

  if (params.start_date && params.end_date) {
    const start = new Date(params.start_date);
    const end = new Date(params.end_date);
    if (start > end) {
      errors.push('开始日期不能晚于结束日期');
    }
  }

  return errors;
}

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
  const { format = 'csv', equipment_id, start_date, end_date, event_types, view_id, view_name } = req.query;

  let view = null;
  if (view_id) {
    view = await getAuditViewById(view_id);
    if (!view) {
      return res.status(404).json({
        error: '视图不存在',
        code: 'VIEW_NOT_FOUND'
      });
    }
  } else if (view_name) {
    view = await getAuditViewByName(view_name);
    if (!view) {
      return res.status(404).json({
        error: '视图不存在',
        code: 'VIEW_NOT_FOUND'
      });
    }
  }

  let effectiveFormat = format;
  let effectiveEquipmentId = equipment_id;
  let effectiveStartDate = start_date;
  let effectiveEndDate = end_date;
  let effectiveEventTypes = event_types;

  if (view) {
    effectiveFormat = view.export_format;
    if (view.equipment_id !== null) effectiveEquipmentId = view.equipment_id;
    if (view.start_date !== null) effectiveStartDate = view.start_date;
    if (view.end_date !== null) effectiveEndDate = view.end_date;
    if (view.event_types && view.event_types.length > 0) effectiveEventTypes = view.event_types;
  }

  if (effectiveFormat !== 'csv' && effectiveFormat !== 'json') {
    return res.status(400).json({
      error: '不支持的导出格式，仅支持 csv 和 json',
      code: 'INVALID_EXPORT_FORMAT'
    });
  }

  if (effectiveEquipmentId) {
    const equipment = await get('SELECT * FROM equipment WHERE id = ?', [effectiveEquipmentId]);
    if (!equipment) {
      return res.status(404).json({
        error: '设备不存在',
        code: 'EQUIPMENT_NOT_FOUND'
      });
    }
  }

  let parsedEventTypes = null;
  if (effectiveEventTypes) {
    if (typeof effectiveEventTypes === 'string') {
      try {
        parsedEventTypes = JSON.parse(effectiveEventTypes);
      } catch (e) {
        parsedEventTypes = effectiveEventTypes.split(',').map(s => s.trim());
      }
    } else if (Array.isArray(effectiveEventTypes)) {
      parsedEventTypes = effectiveEventTypes;
    }
  }

  const events = await getTimelineEvents(effectiveEquipmentId, effectiveStartDate, effectiveEndDate, parsedEventTypes);

  const exportMeta = {
    exported_at: new Date().toISOString(),
    exported_by: req.user.name,
    exported_by_id: req.user.id,
    filters: {
      equipment_id: effectiveEquipmentId || null,
      start_date: effectiveStartDate || null,
      end_date: effectiveEndDate || null,
      event_types: parsedEventTypes || null,
      format: effectiveFormat
    },
    event_count: events.length,
    equipment_info: effectiveEquipmentId ? await get('SELECT id, device_code, name FROM equipment WHERE id = ?', [effectiveEquipmentId]) : null
  };

  if (view) {
    exportMeta.view_name = view.name;
    exportMeta.view_version = view.version;
    exportMeta.view_id = view.id;

    logAction(
      req.user.id,
      'EXPORT_AUDIT_VIEW',
      'audit_view',
      view.id,
      {
        view_name: view.name,
        view_version: view.version,
        format: effectiveFormat,
        event_count: events.length
      },
      req.ip
    ).catch(err => console.error('记录审计日志失败:', err));
  }

  if (effectiveFormat === 'json') {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    const filename = view
      ? `timeline_view_${view.name.replace(/[^a-zA-Z0-9_-]/g, '_')}_${Date.now()}.json`
      : effectiveEquipmentId
        ? `timeline_equipment_${effectiveEquipmentId}_${Date.now()}.json`
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
  const filename = view
    ? `timeline_view_${view.name.replace(/[^a-zA-Z0-9_-]/g, '_')}_${Date.now()}.csv`
    : effectiveEquipmentId
      ? `timeline_equipment_${effectiveEquipmentId}_${Date.now()}.csv`
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

router.post('/views', authenticate, requireAdmin, async (req, res) => {
  try {
    const errors = validateViewParams(req.body, false);
    if (errors.length > 0) {
      return res.status(400).json({
        error: '参数验证失败',
        code: 'INVALID_VIEW_PARAMS',
        details: errors
      });
    }

    const existingView = await getAuditViewByName(req.body.name);
    if (existingView) {
      return res.status(409).json({
        error: `视图名称 "${req.body.name}" 已存在`,
        code: 'VIEW_NAME_DUPLICATE'
      });
    }

    if (req.body.equipment_id) {
      const equipment = await get('SELECT * FROM equipment WHERE id = ?', [req.body.equipment_id]);
      if (!equipment) {
        return res.status(404).json({
          error: '设备不存在',
          code: 'EQUIPMENT_NOT_FOUND'
        });
      }
    }

    const view = await createAuditView(req.body, req.user.id);

    logAction(
      req.user.id,
      'CREATE_AUDIT_VIEW',
      'audit_view',
      view.id,
      {
        view_name: view.name,
        filters: {
          equipment_id: view.equipment_id,
          start_date: view.start_date,
          end_date: view.end_date,
          event_types: view.event_types,
          export_format: view.export_format
        }
      },
      req.ip
    ).catch(err => console.error('记录审计日志失败:', err));

    res.status(201).json({ view });
  } catch (err) {
    if (err.message && err.message.includes('UNIQUE constraint failed')) {
      return res.status(409).json({
        error: `视图名称 "${req.body.name}" 已存在`,
        code: 'VIEW_NAME_DUPLICATE'
      });
    }
    throw err;
  }
});

router.get('/views', authenticate, requireAdmin, async (req, res) => {
  const views = await getAllAuditViews();
  res.json({ views });
});

router.get('/views/:id', authenticate, requireAdmin, async (req, res) => {
  const view = await getAuditViewById(req.params.id);
  if (!view) {
    return res.status(404).json({
      error: '视图不存在',
      code: 'VIEW_NOT_FOUND'
    });
  }
  res.json({ view });
});

router.put('/views/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const view = await getAuditViewById(req.params.id);
    if (!view) {
      return res.status(404).json({
        error: '视图不存在',
        code: 'VIEW_NOT_FOUND'
      });
    }

    const errors = validateViewParams(req.body, true);
    if (errors.length > 0) {
      return res.status(400).json({
        error: '参数验证失败',
        code: 'INVALID_VIEW_PARAMS',
        details: errors
      });
    }

    if (req.body.name && req.body.name !== view.name) {
      const existingView = await getAuditViewByName(req.body.name);
      if (existingView) {
        return res.status(409).json({
          error: `视图名称 "${req.body.name}" 已存在`,
          code: 'VIEW_NAME_DUPLICATE'
        });
      }
    }

    if (req.body.equipment_id) {
      const equipment = await get('SELECT * FROM equipment WHERE id = ?', [req.body.equipment_id]);
      if (!equipment) {
        return res.status(404).json({
          error: '设备不存在',
          code: 'EQUIPMENT_NOT_FOUND'
        });
      }
    }

    const updatedView = await updateAuditView(req.params.id, req.body);

    logAction(
      req.user.id,
      'UPDATE_AUDIT_VIEW',
      'audit_view',
      updatedView.id,
      {
        old_name: view.name,
        new_name: updatedView.name,
        new_version: updatedView.version,
        changes: req.body
      },
      req.ip
    ).catch(err => console.error('记录审计日志失败:', err));

    res.json({ view: updatedView });
  } catch (err) {
    if (err.message && err.message.includes('UNIQUE constraint failed')) {
      return res.status(409).json({
        error: `视图名称 "${req.body.name}" 已存在`,
        code: 'VIEW_NAME_DUPLICATE'
      });
    }
    throw err;
  }
});

router.delete('/views/:id', authenticate, requireAdmin, async (req, res) => {
  const view = await getAuditViewById(req.params.id);
  if (!view) {
    return res.status(404).json({
      error: '视图不存在',
      code: 'VIEW_NOT_FOUND'
    });
  }

  const deleted = await deleteAuditView(req.params.id);
  if (!deleted) {
    return res.status(500).json({
      error: '删除视图失败',
      code: 'VIEW_DELETE_FAILED'
    });
  }

  logAction(
    req.user.id,
    'DELETE_AUDIT_VIEW',
    'audit_view',
    null,
    {
      view_name: view.name,
      view_id: view.id
    },
    req.ip
  ).catch(err => console.error('记录审计日志失败:', err));

  res.json({ message: '视图删除成功' });
});

router.get('/event-types', authenticate, async (req, res) => {
  const eventTypes = VALID_EVENT_TYPES.map(type => ({
    type,
    text: getEventText(type),
    source_type: getSourceType(type)
  }));
  res.json({ event_types: eventTypes });
});

module.exports = router;
