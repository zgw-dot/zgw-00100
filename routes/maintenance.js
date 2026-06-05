const express = require('express');
const router = express.Router();
const { run, get, all, logAction, transaction, checkTimeSlotConflicts, filterConflictsByPermission } = require('../database');
const { authenticate, requireAdmin } = require('../middleware/auth');
const moment = require('moment');

function getStatusText(status) {
  const map = {
    'pending': '待处理',
    'in_progress': '维修中',
    'completed': '已完成'
  };
  return map[status] || status;
}

router.get('/', authenticate, async (req, res) => {
  const { status, equipment_id } = req.query;
  let sql = `
    SELECT mr.*, e.device_code, e.name as equipment_name,
           u.name as reporter_name, t.name as technician_name
    FROM maintenance_records mr
    LEFT JOIN equipment e ON mr.equipment_id = e.id
    LEFT JOIN users u ON mr.reporter_id = u.id
    LEFT JOIN users t ON mr.technician_id = t.id
    WHERE 1=1
  `;
  const params = [];

  if (status) {
    sql += ' AND mr.status = ?';
    params.push(status);
  }
  if (equipment_id) {
    sql += ' AND mr.equipment_id = ?';
    params.push(equipment_id);
  }

  sql += ' ORDER BY mr.created_at DESC';
  const records = await all(sql, params);
  records.forEach(r => r.status_text = getStatusText(r.status));

  res.json({ records });
});

router.post('/', authenticate, async (req, res) => {
  const { equipment_id, issue_description, priority } = req.body;

  if (!equipment_id || !issue_description) {
    return res.status(400).json({
      error: '设备ID和问题描述为必填项',
      code: 'MISSING_REQUIRED_FIELDS'
    });
  }

  const equipment = await get('SELECT * FROM equipment WHERE id = ?', [equipment_id]);
  if (!equipment) {
    return res.status(404).json({ error: '设备不存在', code: 'EQUIPMENT_NOT_FOUND' });
  }

  if (equipment.status === 'borrowed') {
    return res.status(400).json({
      error: '设备已借出，无法提交维修申请',
      code: 'EQUIPMENT_BORROWED'
    });
  }

  const activeMaintenance = await get(`
    SELECT id FROM maintenance_records
    WHERE equipment_id = ? AND status IN ('pending', 'in_progress')
  `, [equipment_id]);

  if (activeMaintenance) {
    return res.status(400).json({
      error: '该设备已有未完成的维修记录',
      code: 'ACTIVE_MAINTENANCE_EXISTS'
    });
  }

  const result = await run(`
    INSERT INTO maintenance_records (equipment_id, reporter_id, issue_description, priority, status)
    VALUES (?, ?, ?, ?, 'pending')
  `, [equipment_id, req.user.id, issue_description, priority || 'normal']);

  await logAction(
    req.user.id,
    'CREATE_MAINTENANCE',
    'maintenance_record',
    result.lastID,
    { equipment_id, issue_description, priority },
    req.ip
  );

  const record = await get('SELECT * FROM maintenance_records WHERE id = ?', [result.lastID]);
  record.status_text = getStatusText(record.status);

  res.status(201).json({
    message: '维修申请已提交',
    record
  });
});

router.post('/:id/start', authenticate, requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { technician_id, estimated_completion_date } = req.body;

  const record = await get('SELECT * FROM maintenance_records WHERE id = ?', [id]);
  if (!record) {
    return res.status(404).json({ error: '维修记录不存在', code: 'RECORD_NOT_FOUND' });
  }

  if (record.status !== 'pending') {
    return res.status(400).json({
      error: `当前状态为"${getStatusText(record.status)}"，无法开始维修`,
      code: 'INVALID_STATUS'
    });
  }

  const equipment = await get('SELECT * FROM equipment WHERE id = ?', [record.equipment_id]);
  if (equipment.status === 'borrowed') {
    return res.status(400).json({
      error: '设备已借出，无法开始维修',
      code: 'EQUIPMENT_BORROWED'
    });
  }

  const maintenanceStart = moment().format('YYYY-MM-DD HH:mm:ss');
  const maintenanceEnd = estimated_completion_date || moment().add(7, 'days').format('YYYY-MM-DD HH:mm:ss');

  const conflicts = await checkTimeSlotConflicts(record.equipment_id, maintenanceStart, maintenanceEnd);

  if (conflicts.length > 0) {
    const filteredConflicts = filterConflictsByPermission(conflicts, req.user);

    await logAction(
      req.user.id,
      'MAINTENANCE_BLOCKED_BY_CONFLICT',
      'equipment',
      record.equipment_id,
      {
        equipment_id: record.equipment_id,
        maintenance_id: id,
        start_date: maintenanceStart,
        end_date: maintenanceEnd,
        conflict_count: conflicts.length,
        conflicts: conflicts.map(c => ({
          type: c.type,
          request_no: c.request_no || c.maintenance_no,
          maintenance_no: c.maintenance_no,
          applicant_id: c.applicant_id,
          reporter_id: c.reporter_id,
          overlap_start: c.overlap_start,
          overlap_end: c.overlap_end
        }))
      },
      req.ip
    );

    return res.status(409).json({
      error: '维修时间段与现有借用申请存在冲突',
      code: 'TIME_SLOT_CONFLICT',
      details: {
        conflicts: filteredConflicts,
        requested_start: maintenanceStart,
        requested_end: maintenanceEnd,
        equipment: {
          id: equipment.id,
          name: equipment.name,
          device_code: equipment.device_code
        }
      }
    });
  }

  await logAction(
    req.user.id,
    'MAINTENANCE_AVAILABILITY_PASSED',
    'maintenance_record',
    id,
    {
      equipment_id: record.equipment_id,
      start_date: maintenanceStart,
      end_date: maintenanceEnd
    },
    req.ip
  );

  try {
    await transaction(async () => {
      await run(`
        UPDATE maintenance_records
        SET status = 'in_progress',
            technician_id = ?,
            estimated_completion_date = ?,
            started_at = ?
        WHERE id = ?
      `, [technician_id || null, estimated_completion_date || null, maintenanceStart, id]);

      await run("UPDATE equipment SET status = 'maintenance', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        [record.equipment_id]);
    });
  } catch (err) {
    return res.status(500).json({ error: '开始维修失败', code: 'TRANSACTION_FAILED' });
  }

  await logAction(
    req.user.id,
    'START_MAINTENANCE',
    'maintenance_record',
    id,
    { technician_id, estimated_completion_date },
    req.ip
  );

  res.json({ message: '维修已开始，设备已自动冻结' });
});

router.post('/:id/complete', authenticate, requireAdmin, async (req, res) => {
  const { id } = req.params;
  let { repair_result, repair_note, repair_cost, damage_note } = req.body;

  repair_result = repair_result || repair_note;

  if (!repair_result) {
    return res.status(400).json({
      error: '请填写维修结果',
      code: 'MISSING_REPAIR_RESULT'
    });
  }

  const record = await get('SELECT * FROM maintenance_records WHERE id = ?', [id]);
  if (!record) {
    return res.status(404).json({ error: '维修记录不存在', code: 'RECORD_NOT_FOUND' });
  }

  if (record.status !== 'in_progress') {
    return res.status(400).json({
      error: `当前状态为"${getStatusText(record.status)}"，无法完成维修`,
      code: 'INVALID_STATUS'
    });
  }

  try {
    await transaction(async () => {
      await run(`
        UPDATE maintenance_records
        SET status = 'completed',
            repair_result = ?,
            repair_cost = ?,
            damage_note = ?,
            completed_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `, [repair_result, repair_cost || null, damage_note || null, id]);

      await run("UPDATE equipment SET status = 'available', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        [record.equipment_id]);
    });
  } catch (err) {
    return res.status(500).json({ error: '完成维修失败', code: 'TRANSACTION_FAILED' });
  }

  await logAction(
    req.user.id,
    'COMPLETE_MAINTENANCE',
    'maintenance_record',
    id,
    { repair_result, repair_cost, damage_note },
    req.ip
  );

  res.json({ message: '维修已完成，设备已解冻' });
});

module.exports = router;
