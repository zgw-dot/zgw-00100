const express = require('express');
const router = express.Router();
const { run, get, all, logAction, transaction, checkTimeSlotConflicts, filterConflictsByPermission } = require('../database');
const { authenticate, requireAdmin } = require('../middleware/auth');
const moment = require('moment');

async function generateRequestNo() {
  const date = moment().format('YYYYMMDD');
  const result = await get(`
    SELECT COUNT(*) as count FROM borrow_requests
    WHERE strftime('%Y%m%d', created_at) = ?
  `, [date]);
  const count = result.count + 1;
  return `BR${date}${String(count).padStart(4, '0')}`;
}

function getStatusText(status) {
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

function enhanceRequest(req) {
  req.status_text = getStatusText(req.status);
  return req;
}

router.post('/check-availability', authenticate, async (req, res) => {
  const { equipment_id, start_date, end_date } = req.body;

  if (!equipment_id || !start_date || !end_date) {
    return res.status(400).json({
      error: '设备ID、开始时间和结束时间为必填项',
      code: 'MISSING_REQUIRED_FIELDS'
    });
  }

  const start = moment(start_date);
  const end = moment(end_date);

  if (!start.isValid() || !end.isValid()) {
    return res.status(400).json({
      error: '日期格式无效，请使用 YYYY-MM-DD HH:mm:ss 格式',
      code: 'INVALID_DATE_FORMAT'
    });
  }

  if (end.isBefore(start)) {
    return res.status(400).json({
      error: '结束时间不能早于开始时间（时间倒挂）',
      code: 'DATE_INVERSION',
      details: { start_date, end_date }
    });
  }

  const equipment = await get('SELECT * FROM equipment WHERE id = ?', [equipment_id]);
  if (!equipment) {
    return res.status(404).json({ error: '设备不存在', code: 'EQUIPMENT_NOT_FOUND' });
  }

  const conflicts = await checkTimeSlotConflicts(equipment_id, start_date, end_date);
  const filteredConflicts = filterConflictsByPermission(conflicts, req.user);

  await logAction(
    req.user.id,
    'CHECK_AVAILABILITY',
    'equipment',
    equipment_id,
    {
      equipment_id,
      start_date,
      end_date,
      conflict_count: conflicts.length,
      has_conflict: conflicts.length > 0
    },
    req.ip
  );

  if (conflicts.length > 0) {
    return res.status(409).json({
      available: false,
      error: '该时间段与现有记录存在冲突',
      code: 'TIME_SLOT_CONFLICT',
      details: {
        conflicts: filteredConflicts,
        requested_start: start_date,
        requested_end: end_date,
        equipment: {
          id: equipment.id,
          name: equipment.name,
          device_code: equipment.device_code
        }
      }
    });
  }

  res.json({
    available: true,
    message: '该时间段可用',
    code: 'AVAILABLE',
    details: {
      requested_start: start_date,
      requested_end: end_date,
      equipment: {
        id: equipment.id,
        name: equipment.name,
        device_code: equipment.device_code
      }
    }
  });
});

router.get('/', authenticate, async (req, res) => {
  const { status, equipment_id, applicant_id } = req.query;
  let sql = `
    SELECT br.*, e.device_code, e.name as equipment_name, e.category,
           u.name as applicant_name, a.name as approver_name
    FROM borrow_requests br
    LEFT JOIN equipment e ON br.equipment_id = e.id
    LEFT JOIN users u ON br.applicant_id = u.id
    LEFT JOIN users a ON br.approver_id = a.id
    WHERE 1=1
  `;
  const params = [];

  if (status) {
    sql += ' AND br.status = ?';
    params.push(status);
  }
  if (equipment_id) {
    sql += ' AND br.equipment_id = ?';
    params.push(equipment_id);
  }
  if (applicant_id) {
    sql += ' AND br.applicant_id = ?';
    params.push(applicant_id);
  }

  if (req.user.role !== 'admin') {
    sql += ' AND br.applicant_id = ?';
    params.push(req.user.id);
  }

  sql += ' ORDER BY br.created_at DESC';
  const requests = await all(sql, params);
  requests.forEach(enhanceRequest);

  res.json({ requests });
});

router.get('/:id', authenticate, async (req, res) => {
  const request = await get(`
    SELECT br.*, e.device_code, e.name as equipment_name, e.category,
           u.name as applicant_name, a.name as approver_name
    FROM borrow_requests br
    LEFT JOIN equipment e ON br.equipment_id = e.id
    LEFT JOIN users u ON br.applicant_id = u.id
    LEFT JOIN users a ON br.approver_id = a.id
    WHERE br.id = ?
  `, [req.params.id]);

  if (!request) {
    return res.status(404).json({ error: '借用申请不存在', code: 'REQUEST_NOT_FOUND' });
  }

  if (req.user.role !== 'admin' && request.applicant_id !== req.user.id) {
    return res.status(403).json({ error: '无权查看此申请', code: 'ACCESS_DENIED' });
  }

  enhanceRequest(request);
  res.json({ request });
});

router.post('/', authenticate, async (req, res) => {
  const { equipment_id, purpose, start_date, end_date } = req.body;

  if (!equipment_id || !purpose || !start_date || !end_date) {
    return res.status(400).json({
      error: '设备ID、用途、开始时间和结束时间为必填项',
      code: 'MISSING_REQUIRED_FIELDS'
    });
  }

  const equipment = await get('SELECT * FROM equipment WHERE id = ?', [equipment_id]);
  if (!equipment) {
    return res.status(404).json({ error: '设备不存在', code: 'EQUIPMENT_NOT_FOUND' });
  }

  if (equipment.status === 'frozen') {
    return res.status(400).json({
      error: `设备"${equipment.name}"已被冻结，无法申请借用`,
      code: 'EQUIPMENT_FROZEN',
      details: { equipment_id, status: equipment.status }
    });
  }

  if (equipment.status === 'borrowed') {
    return res.status(400).json({
      error: `设备"${equipment.name}"已被借出，无法申请借用`,
      code: 'EQUIPMENT_BORROWED',
      details: { equipment_id, status: equipment.status }
    });
  }

  const start = moment(start_date);
  const end = moment(end_date);

  if (!start.isValid() || !end.isValid()) {
    return res.status(400).json({
      error: '日期格式无效，请使用 YYYY-MM-DD HH:mm:ss 格式',
      code: 'INVALID_DATE_FORMAT'
    });
  }

  if (end.isBefore(start)) {
    return res.status(400).json({
      error: '结束时间不能早于开始时间（时间倒挂）',
      code: 'DATE_INVERSION',
      details: { start_date, end_date }
    });
  }

  const formattedStart = start.format('YYYY-MM-DD HH:mm:ss');
  const formattedEnd = end.format('YYYY-MM-DD HH:mm:ss');

  const conflicts = await checkTimeSlotConflicts(equipment_id, formattedStart, formattedEnd);

  if (conflicts.length > 0) {
    const filteredConflicts = filterConflictsByPermission(conflicts, req.user);

    await logAction(
      req.user.id,
      'BORROW_REQUEST_BLOCKED_BY_CONFLICT',
      'equipment',
      equipment_id,
      {
        equipment_id,
        purpose,
        start_date: formattedStart,
        end_date: formattedEnd,
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
      error: '该时间段与现有记录存在冲突',
      code: 'TIME_SLOT_CONFLICT',
      details: {
        conflicts: filteredConflicts,
        requested_start: formattedStart,
        requested_end: formattedEnd,
        equipment: {
          id: equipment.id,
          name: equipment.name,
          device_code: equipment.device_code
        }
      }
    });
  }

  if (equipment.status === 'maintenance') {
    return res.status(400).json({
      error: `设备"${equipment.name}"当前处于维修状态，无法申请借用`,
      code: 'EQUIPMENT_IN_MAINTENANCE',
      details: { equipment_id, status: equipment.status }
    });
  }

  await logAction(
    req.user.id,
    'BORROW_REQUEST_AVAILABILITY_PASSED',
    'borrow_request',
    null,
    {
      equipment_id,
      start_date: formattedStart,
      end_date: formattedEnd
    },
    req.ip
  );

  const requestNo = await generateRequestNo();

  const result = await run(`
    INSERT INTO borrow_requests (request_no, equipment_id, applicant_id, purpose, start_date, end_date, status)
    VALUES (?, ?, ?, ?, ?, ?, 'pending')
  `, [
    requestNo,
    equipment_id,
    req.user.id,
    purpose,
    formattedStart,
    formattedEnd
  ]);

  await logAction(
    req.user.id,
    'CREATE_BORROW_REQUEST',
    'borrow_request',
    result.lastID,
    { request_no: requestNo, equipment_id, purpose, start_date: formattedStart, end_date: formattedEnd },
    req.ip
  );

  const newRequest = await get(`
    SELECT br.*, e.device_code, e.name as equipment_name,
           u.name as applicant_name
    FROM borrow_requests br
    LEFT JOIN equipment e ON br.equipment_id = e.id
    LEFT JOIN users u ON br.applicant_id = u.id
    WHERE br.id = ?
  `, [result.lastID]);

  enhanceRequest(newRequest);

  res.status(201).json({
    message: '借用申请提交成功',
    request: newRequest
  });
});

router.post('/:id/approve', authenticate, requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { approval_comment } = req.body;

  const request = await get('SELECT * FROM borrow_requests WHERE id = ?', [id]);
  if (!request) {
    return res.status(404).json({ error: '借用申请不存在', code: 'REQUEST_NOT_FOUND' });
  }

  if (request.status !== 'pending') {
    return res.status(400).json({
      error: `当前申请状态为"${getStatusText(request.status)}"，无法审批`,
      code: 'INVALID_STATUS_FOR_APPROVAL'
    });
  }

  if (request.applicant_id === req.user.id) {
    return res.status(400).json({
      error: '审批人不能审批自己提交的借用申请（借用人自审）',
      code: 'SELF_APPROVAL_NOT_ALLOWED',
      details: { applicant_id: request.applicant_id, approver_id: req.user.id }
    });
  }

  const equipment = await get('SELECT * FROM equipment WHERE id = ?', [request.equipment_id]);
  if (equipment.status !== 'available') {
    return res.status(400).json({
      error: `设备当前状态为"${equipment.status_text || equipment.status}"，无法批准借用`,
      code: 'EQUIPMENT_NOT_AVAILABLE'
    });
  }

  await run(`
    UPDATE borrow_requests
    SET status = 'approved', approver_id = ?, approval_comment = ?, approval_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `, [req.user.id, approval_comment || null, id]);

  await logAction(
    req.user.id,
    'APPROVE_BORROW_REQUEST',
    'borrow_request',
    id,
    { request_no: request.request_no, approval_comment },
    req.ip
  );

  const updatedRequest = await get(`
    SELECT br.*, e.device_code, e.name as equipment_name,
           u.name as applicant_name, a.name as approver_name
    FROM borrow_requests br
    LEFT JOIN equipment e ON br.equipment_id = e.id
    LEFT JOIN users u ON br.applicant_id = u.id
    LEFT JOIN users a ON br.approver_id = a.id
    WHERE br.id = ?
  `, [id]);

  enhanceRequest(updatedRequest);

  res.json({
    message: '借用申请已批准',
    request: updatedRequest
  });
});

router.post('/:id/reject', authenticate, requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { approval_comment } = req.body;

  const request = await get('SELECT * FROM borrow_requests WHERE id = ?', [id]);
  if (!request) {
    return res.status(404).json({ error: '借用申请不存在', code: 'REQUEST_NOT_FOUND' });
  }

  if (request.status !== 'pending') {
    return res.status(400).json({
      error: `当前申请状态为"${getStatusText(request.status)}"，无法审批`,
      code: 'INVALID_STATUS_FOR_APPROVAL'
    });
  }

  if (request.applicant_id === req.user.id) {
    return res.status(400).json({
      error: '审批人不能拒绝自己提交的借用申请',
      code: 'SELF_REJECT_NOT_ALLOWED'
    });
  }

  await run(`
    UPDATE borrow_requests
    SET status = 'rejected', approver_id = ?, approval_comment = ?, approval_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `, [req.user.id, approval_comment || null, id]);

  await logAction(
    req.user.id,
    'REJECT_BORROW_REQUEST',
    'borrow_request',
    id,
    { request_no: request.request_no, approval_comment },
    req.ip
  );

  res.json({ message: '借用申请已拒绝' });
});

router.post('/:id/collect', authenticate, async (req, res) => {
  const { id } = req.params;

  const request = await get('SELECT * FROM borrow_requests WHERE id = ?', [id]);
  if (!request) {
    return res.status(404).json({ error: '借用申请不存在', code: 'REQUEST_NOT_FOUND' });
  }

  if (request.applicant_id !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({
      error: '只有申请人或管理员可以执行领用操作',
      code: 'ACCESS_DENIED'
    });
  }

  if (request.status !== 'approved') {
    return res.status(400).json({
      error: `当前申请状态为"${getStatusText(request.status)}"，无法领用`,
      code: 'INVALID_STATUS_FOR_COLLECT'
    });
  }

  const equipment = await get('SELECT * FROM equipment WHERE id = ?', [request.equipment_id]);
  if (equipment.status !== 'available') {
    return res.status(400).json({
      error: `设备当前状态为"${getStatusText(equipment.status)}"，无法领用`,
      code: 'EQUIPMENT_NOT_AVAILABLE'
    });
  }

  try {
    await transaction(async () => {
      await run(`
        UPDATE borrow_requests
        SET status = 'collected', collected_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `, [id]);

      await run("UPDATE equipment SET status = 'borrowed', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        [request.equipment_id]);
    });
  } catch (err) {
    return res.status(500).json({ error: '领用操作失败', code: 'TRANSACTION_FAILED' });
  }

  await logAction(
    req.user.id,
    'COLLECT_EQUIPMENT',
    'borrow_request',
    id,
    { request_no: request.request_no, equipment_id: request.equipment_id },
    req.ip
  );

  res.json({ message: '设备领用成功' });
});

router.post('/:id/return', authenticate, async (req, res) => {
  const { id } = req.params;
  const { return_acceptance_result, return_damage_note } = req.body;

  if (!return_acceptance_result) {
    return res.status(400).json({
      error: '请填写归还验收结果',
      code: 'MISSING_ACCEPTANCE_RESULT'
    });
  }

  const request = await get('SELECT * FROM borrow_requests WHERE id = ?', [id]);
  if (!request) {
    return res.status(404).json({ error: '借用申请不存在', code: 'REQUEST_NOT_FOUND' });
  }

  if (request.status !== 'collected') {
    if (request.status === 'returned') {
      return res.status(400).json({
        error: '该借用单已完成归还，请勿重复归还（重复归还）',
        code: 'DUPLICATE_RETURN',
        details: { returned_at: request.returned_at }
      });
    }
    return res.status(400).json({
      error: `当前申请状态为"${getStatusText(request.status)}"，无法归还`,
      code: 'INVALID_STATUS_FOR_RETURN'
    });
  }

  try {
    await transaction(async () => {
      await run(`
        UPDATE borrow_requests
        SET status = 'returned',
            return_acceptance_result = ?,
            return_damage_note = ?,
            returned_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `, [return_acceptance_result, return_damage_note || null, id]);

      await run("UPDATE equipment SET status = 'available', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        [request.equipment_id]);
    });
  } catch (err) {
    return res.status(500).json({ error: '归还操作失败', code: 'TRANSACTION_FAILED' });
  }

  await logAction(
    req.user.id,
    'RETURN_EQUIPMENT',
    'borrow_request',
    id,
    {
      request_no: request.request_no,
      return_acceptance_result,
      return_damage_note
    },
    req.ip
  );

  res.json({ message: '设备归还成功' });
});

router.post('/:id/cancel', authenticate, async (req, res) => {
  const { id } = req.params;

  const request = await get('SELECT * FROM borrow_requests WHERE id = ?', [id]);
  if (!request) {
    return res.status(404).json({ error: '借用申请不存在', code: 'REQUEST_NOT_FOUND' });
  }

  if (request.applicant_id !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({
      error: '只有申请人或管理员可以取消申请',
      code: 'ACCESS_DENIED'
    });
  }

  if (!['pending', 'approved'].includes(request.status)) {
    return res.status(400).json({
      error: `当前申请状态为"${getStatusText(request.status)}"，无法取消`,
      code: 'INVALID_STATUS_FOR_CANCEL'
    });
  }

  await run("UPDATE borrow_requests SET status = 'cancelled' WHERE id = ?", [id]);

  await logAction(
    req.user.id,
    'CANCEL_BORROW_REQUEST',
    'borrow_request',
    id,
    { request_no: request.request_no },
    req.ip
  );

  res.json({ message: '借用申请已取消' });
});

module.exports = router;
