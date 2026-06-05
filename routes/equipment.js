const express = require('express');
const router = express.Router();
const { run, get, all, logAction } = require('../database');
const { authenticate, requireAdmin } = require('../middleware/auth');
const moment = require('moment');

function getStatusText(status) {
  const map = {
    'available': '可用',
    'borrowed': '已借出',
    'maintenance': '维修中',
    'frozen': '冻结'
  };
  return map[status] || status;
}

router.get('/', authenticate, async (req, res) => {
  const { status, category } = req.query;
  let sql = 'SELECT * FROM equipment WHERE 1=1';
  const params = [];

  if (status) {
    sql += ' AND status = ?';
    params.push(status);
  }
  if (category) {
    sql += ' AND category = ?';
    params.push(category);
  }

  sql += ' ORDER BY updated_at DESC';
  const equipment = await all(sql, params);
  equipment.forEach(e => e.status_text = getStatusText(e.status));

  res.json({ equipment });
});

router.get('/:id', authenticate, async (req, res) => {
  const equipment = await get('SELECT * FROM equipment WHERE id = ?', [req.params.id]);
  if (!equipment) {
    return res.status(404).json({ error: '设备不存在', code: 'EQUIPMENT_NOT_FOUND' });
  }
  equipment.status_text = getStatusText(equipment.status);

  const borrowHistory = await all(`
    SELECT br.*, u.name as applicant_name, a.name as approver_name
    FROM borrow_requests br
    LEFT JOIN users u ON br.applicant_id = u.id
    LEFT JOIN users a ON br.approver_id = a.id
    WHERE br.equipment_id = ?
    ORDER BY br.created_at DESC
  `, [req.params.id]);

  const maintenanceHistory = await all(`
    SELECT mr.*, u.name as reporter_name
    FROM maintenance_records mr
    LEFT JOIN users u ON mr.reporter_id = u.id
    WHERE mr.equipment_id = ?
    ORDER BY mr.created_at DESC
  `, [req.params.id]);

  res.json({ equipment, borrowHistory, maintenanceHistory });
});

router.post('/', authenticate, requireAdmin, async (req, res) => {
  const { device_code, name, category, model, location, description } = req.body;

  if (!device_code || !name || !category) {
    return res.status(400).json({
      error: '设备编号、名称和分类为必填项',
      code: 'MISSING_REQUIRED_FIELDS'
    });
  }

  const existing = await get('SELECT id FROM equipment WHERE device_code = ?', [device_code]);
  if (existing) {
    return res.status(400).json({
      error: `设备编号 "${device_code}" 已存在，请勿重复添加`,
      code: 'DUPLICATE_DEVICE_CODE',
      details: { device_code }
    });
  }

  const result = await run(`
    INSERT INTO equipment (device_code, name, category, model, location, description, status)
    VALUES (?, ?, ?, ?, ?, ?, 'available')
  `, [device_code, name, category, model || null, location || null, description || null]);

  await logAction(
    req.user.id,
    'CREATE_EQUIPMENT',
    'equipment',
    result.lastID,
    { device_code, name, category },
    req.ip
  );

  const equipment = await get('SELECT * FROM equipment WHERE id = ?', [result.lastID]);
  equipment.status_text = getStatusText(equipment.status);

  res.status(201).json({
    message: '设备添加成功',
    equipment
  });
});

router.put('/:id', authenticate, requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { device_code, name, category, model, location, description, status } = req.body;

  const equipment = await get('SELECT * FROM equipment WHERE id = ?', [id]);
  if (!equipment) {
    return res.status(404).json({ error: '设备不存在', code: 'EQUIPMENT_NOT_FOUND' });
  }

  if (device_code && device_code !== equipment.device_code) {
    const existing = await get('SELECT id FROM equipment WHERE device_code = ? AND id != ?', [device_code, id]);
    if (existing) {
      return res.status(400).json({
        error: `设备编号 "${device_code}" 已存在，无法修改`,
        code: 'DUPLICATE_DEVICE_CODE',
        details: { device_code }
      });
    }
  }

  const validStatuses = ['available', 'borrowed', 'maintenance', 'frozen'];
  if (status && !validStatuses.includes(status)) {
    return res.status(400).json({
      error: `无效的设备状态: ${status}`,
      code: 'INVALID_STATUS'
    });
  }

  await run(`
    UPDATE equipment
    SET device_code = COALESCE(?, device_code),
        name = COALESCE(?, name),
        category = COALESCE(?, category),
        model = COALESCE(?, model),
        location = COALESCE(?, location),
        description = COALESCE(?, description),
        status = COALESCE(?, status),
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `, [
    device_code || equipment.device_code,
    name || equipment.name,
    category || equipment.category,
    model || equipment.model,
    location || equipment.location,
    description || equipment.description,
    status || equipment.status,
    id
  ]);

  await logAction(
    req.user.id,
    'UPDATE_EQUIPMENT',
    'equipment',
    id,
    { old: equipment, new: req.body },
    req.ip
  );

  const updated = await get('SELECT * FROM equipment WHERE id = ?', [id]);
  updated.status_text = getStatusText(updated.status);

  res.json({
    message: '设备更新成功',
    equipment: updated
  });
});

router.delete('/:id', authenticate, requireAdmin, async (req, res) => {
  const { id } = req.params;

  const equipment = await get('SELECT * FROM equipment WHERE id = ?', [id]);
  if (!equipment) {
    return res.status(404).json({ error: '设备不存在', code: 'EQUIPMENT_NOT_FOUND' });
  }

  const activeRequest = await get(`
    SELECT id FROM borrow_requests
    WHERE equipment_id = ? AND status IN ('pending', 'approved', 'collected')
  `, [id]);

  if (activeRequest) {
    return res.status(400).json({
      error: '设备存在未完成的借用申请，无法删除',
      code: 'ACTIVE_BORROW_EXISTS'
    });
  }

  await run('DELETE FROM equipment WHERE id = ?', [id]);

  await logAction(
    req.user.id,
    'DELETE_EQUIPMENT',
    'equipment',
    id,
    { device_code: equipment.device_code, name: equipment.name },
    req.ip
  );

  res.json({ message: '设备删除成功' });
});

router.post('/:id/freeze', authenticate, requireAdmin, async (req, res) => {
  const { id } = req.params;

  const equipment = await get('SELECT * FROM equipment WHERE id = ?', [id]);
  if (!equipment) {
    return res.status(404).json({ error: '设备不存在', code: 'EQUIPMENT_NOT_FOUND' });
  }

  if (equipment.status === 'borrowed') {
    return res.status(400).json({
      error: '设备已借出，无法冻结',
      code: 'CANNOT_FREEZE_BORROWED'
    });
  }

  await run("UPDATE equipment SET status = 'frozen', updated_at = CURRENT_TIMESTAMP WHERE id = ?", [id]);

  await logAction(
    req.user.id,
    'FREEZE_EQUIPMENT',
    'equipment',
    id,
    { device_code: equipment.device_code },
    req.ip
  );

  res.json({ message: '设备已冻结' });
});

router.post('/:id/unfreeze', authenticate, requireAdmin, async (req, res) => {
  const { id } = req.params;

  const equipment = await get('SELECT * FROM equipment WHERE id = ?', [id]);
  if (!equipment) {
    return res.status(404).json({ error: '设备不存在', code: 'EQUIPMENT_NOT_FOUND' });
  }

  if (equipment.status !== 'frozen') {
    return res.status(400).json({
      error: '设备未处于冻结状态',
      code: 'NOT_FROZEN'
    });
  }

  await run("UPDATE equipment SET status = 'available', updated_at = CURRENT_TIMESTAMP WHERE id = ?", [id]);

  await logAction(
    req.user.id,
    'UNFREEZE_EQUIPMENT',
    'equipment',
    id,
    { device_code: equipment.device_code },
    req.ip
  );

  res.json({ message: '设备已解冻' });
});

module.exports = router;
