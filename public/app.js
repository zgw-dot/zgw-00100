const API_BASE = '/api';
let currentUserId = localStorage.getItem('currentUserId') || '1';
let currentUser = null;
let allEquipment = [];
let allBorrowRequests = [];
let allMaintenance = [];

async function apiRequest(endpoint, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    'x-user-id': currentUserId,
    ...options.headers
  };

  try {
    const response = await fetch(`${API_BASE}${endpoint}`, {
      ...options,
      headers
    });

    const data = await response.json();

    if (!response.ok) {
      const errorMsg = data.error || data.message || '请求失败';
      const errorCode = data.code || 'UNKNOWN_ERROR';
      showToast(`${errorMsg}\n错误码: ${errorCode}`, 'error');
      throw new Error(errorMsg);
    }

    return data;
  } catch (err) {
    if (err.name !== 'SyntaxError') {
      console.error('API Error:', err);
    }
    throw err;
  }
}

function showToast(message, type = 'success') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = `toast ${type} show`;
  setTimeout(() => {
    toast.className = `toast ${type}`;
  }, 3500);
}

function openModal(title, content) {
  document.getElementById('modalTitle').textContent = title;
  document.getElementById('modalBody').innerHTML = content;
  document.getElementById('modal').classList.add('show');
}

function closeModal() {
  document.getElementById('modal').classList.remove('show');
}

document.getElementById('modal').addEventListener('click', (e) => {
  if (e.target.id === 'modal') closeModal();
});

async function initUser() {
  document.getElementById('userSelector').value = currentUserId;
  try {
    const data = await apiRequest('/users/me');
    currentUser = data.user;
    updateUserDisplay();
    updatePermissions();
  } catch (err) {
    console.error('Failed to get user info:', err);
  }
}

function updateUserDisplay() {
  if (currentUser) {
    const roleText = currentUser.role === 'admin' ? '管理员' : '普通用户';
    document.getElementById('userDisplay').textContent = `${currentUser.name} (${roleText})`;
  }
}

function updatePermissions() {
  const isAdmin = currentUser?.role === 'admin';
  document.getElementById('addEquipmentBtn').style.display = isAdmin ? 'inline-block' : 'none';
  document.getElementById('auditLogsSection').style.display = isAdmin ? 'block' : 'none';
}

document.getElementById('userSelector').addEventListener('change', async (e) => {
  currentUserId = e.target.value;
  if (currentUserId) {
    localStorage.setItem('currentUserId', currentUserId);
    await initUser();
    await loadAllData();
  }
});

document.querySelectorAll('.nav-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    const tabName = tab.dataset.tab;
    document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(`${tabName}-tab`).classList.add('active');

    if (tabName === 'history') {
      loadEquipmentSelectors();
    }
    if (tabName === 'audit') {
      loadEquipmentSelectors();
      if (currentUser?.role === 'admin') {
        loadAuditLogs();
      }
    }
  });
});

async function loadEquipment() {
  try {
    const data = await apiRequest('/equipment');
    allEquipment = data.equipment;
    renderEquipmentTable();
  } catch (err) {
    console.error('Failed to load equipment:', err);
  }
}

function renderEquipmentTable() {
  const statusFilter = document.getElementById('equipmentStatusFilter').value;
  const searchTerm = document.getElementById('equipmentSearch').value.toLowerCase();

  let filtered = allEquipment;
  if (statusFilter) {
    filtered = filtered.filter(e => e.status === statusFilter);
  }
  if (searchTerm) {
    filtered = filtered.filter(e =>
      e.device_code.toLowerCase().includes(searchTerm) ||
      e.name.toLowerCase().includes(searchTerm)
    );
  }

  const tbody = document.getElementById('equipmentTableBody');
  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7">
          <div class="empty-state">
            <div class="empty-state-icon">📦</div>
            <p>暂无设备数据</p>
          </div>
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = filtered.map(e => {
    const isAdmin = currentUser?.role === 'admin';
    const canBorrow = e.status === 'available';
    const actions = [];

    if (canBorrow && !isAdmin) {
      actions.push(`<button class="btn btn-sm btn-primary" onclick="openBorrowModal(${e.id})">申请借用</button>`);
    }
    if (isAdmin) {
      if (e.status === 'frozen') {
        actions.push(`<button class="btn btn-sm btn-success" onclick="unfreezeEquipment(${e.id})">解冻</button>`);
      } else if (e.status !== 'borrowed') {
        actions.push(`<button class="btn btn-sm btn-warning" onclick="freezeEquipment(${e.id})">冻结</button>`);
      }
      actions.push(`<button class="btn btn-sm btn-secondary" onclick="viewEquipmentDetail(${e.id})">详情</button>`);
    } else {
      actions.push(`<button class="btn btn-sm btn-secondary" onclick="viewEquipmentDetail(${e.id})">详情</button>`);
    }

    return `
      <tr>
        <td><code>${e.device_code}</code></td>
        <td>${e.name}</td>
        <td>${e.category}</td>
        <td>${e.model || '-'}</td>
        <td>${e.location || '-'}</td>
        <td><span class="status-badge status-${e.status}">${e.status_text}</span></td>
        <td>
          <div class="action-buttons">
            ${actions.join('')}
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

document.getElementById('equipmentStatusFilter').addEventListener('change', renderEquipmentTable);
document.getElementById('equipmentSearch').addEventListener('input', renderEquipmentTable);

document.getElementById('addEquipmentBtn').addEventListener('click', () => {
  openModal('新增设备', `
    <form id="addEquipmentForm">
      <div class="form-row">
        <div class="form-group">
          <label>设备编号 *</label>
          <input type="text" name="device_code" required placeholder="如: NB-2024-001">
        </div>
        <div class="form-group">
          <label>设备分类 *</label>
          <select name="category" required>
            <option value="">请选择</option>
            <option value="电脑设备">电脑设备</option>
            <option value="会议设备">会议设备</option>
            <option value="摄影设备">摄影设备</option>
            <option value="平板设备">平板设备</option>
            <option value="开发设备">开发设备</option>
            <option value="测试设备">测试设备</option>
            <option value="其他">其他</option>
          </select>
        </div>
      </div>
      <div class="form-group">
        <label>设备名称 *</label>
        <input type="text" name="name" required placeholder="如: 联想笔记本电脑">
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>型号</label>
          <input type="text" name="model" placeholder="如: ThinkPad X1">
        </div>
        <div class="form-group">
          <label>存放位置</label>
          <input type="text" name="location" placeholder="如: A区3楼设备柜">
        </div>
      </div>
      <div class="form-group">
        <label>设备描述</label>
        <textarea name="description" placeholder="设备详细描述..."></textarea>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-secondary" onclick="closeModal()">取消</button>
        <button type="submit" class="btn btn-primary">添加设备</button>
      </div>
    </form>
  `);

  document.getElementById('addEquipmentForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    const data = Object.fromEntries(formData.entries());

    try {
      await apiRequest('/equipment', {
        method: 'POST',
        body: JSON.stringify(data)
      });
      showToast('设备添加成功');
      closeModal();
      await loadEquipment();
      loadEquipmentSelectors();
    } catch (err) {
      console.error('Failed to add equipment:', err);
    }
  });
});

async function openBorrowModal(equipmentId) {
  const equipment = allEquipment.find(e => e.id === equipmentId);
  if (!equipment) return;

  const today = new Date().toISOString().slice(0, 16).replace('T', ' ');
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 16).replace('T', ' ');

  openModal('申请借用设备', `
    <div style="margin-bottom: 1rem; padding: 1rem; background: #f0f9ff; border-radius: 8px;">
      <p><strong>设备:</strong> ${equipment.name} (${equipment.device_code})</p>
      <p><strong>状态:</strong> ${equipment.status_text}</p>
    </div>
    <form id="borrowForm">
      <input type="hidden" name="equipment_id" value="${equipmentId}">
      <div class="form-group">
        <label>借用用途 *</label>
        <textarea name="purpose" required placeholder="请详细描述借用用途..."></textarea>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>开始时间 *</label>
          <input type="datetime-local" name="start_date" required value="${today}">
        </div>
        <div class="form-group">
          <label>结束时间 *</label>
          <input type="datetime-local" name="end_date" required value="${tomorrow}">
        </div>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-secondary" onclick="closeModal()">取消</button>
        <button type="submit" class="btn btn-primary">提交申请</button>
      </div>
    </form>
  `);

  document.getElementById('borrowForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    const data = {
      equipment_id: parseInt(formData.get('equipment_id')),
      purpose: formData.get('purpose'),
      start_date: formData.get('start_date').replace('T', ' ') + ':00',
      end_date: formData.get('end_date').replace('T', ' ') + ':00'
    };

    try {
      await apiRequest('/borrow', {
        method: 'POST',
        body: JSON.stringify(data)
      });
      showToast('借用申请提交成功');
      closeModal();
      await loadBorrowRequests();
    } catch (err) {
      console.error('Failed to submit borrow request:', err);
    }
  });
}

async function viewEquipmentDetail(id) {
  try {
    const data = await apiRequest(`/equipment/${id}`);
    const eq = data.equipment;
    const borrowHistory = data.borrowHistory || [];
    const maintenanceHistory = data.maintenanceHistory || [];

    openModal('设备详情', `
      <h4 style="margin-bottom: 1rem;">基本信息</h4>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; margin-bottom: 1.5rem;">
        <p><strong>设备编号:</strong> <code>${eq.device_code}</code></p>
        <p><strong>状态:</strong> <span class="status-badge status-${eq.status}">${eq.status_text}</span></p>
        <p><strong>设备名称:</strong> ${eq.name}</p>
        <p><strong>分类:</strong> ${eq.category}</p>
        <p><strong>型号:</strong> ${eq.model || '-'}</p>
        <p><strong>位置:</strong> ${eq.location || '-'}</p>
      </div>
      <p style="margin-bottom: 1.5rem;"><strong>描述:</strong> ${eq.description || '暂无描述'}</p>

      <h4 style="margin-bottom: 1rem;">借用历史 (${borrowHistory.length})</h4>
      ${borrowHistory.length === 0 ? '<p style="color: #6b7280;">暂无借用记录</p>' : `
        <div style="max-height: 200px; overflow-y: auto;">
          ${borrowHistory.map(b => `
            <div style="padding: 0.75rem; border-left: 3px solid #667eea; margin-bottom: 0.5rem; background: #f9fafb;">
              <p><strong>${b.request_no}</strong> - <span class="status-badge status-${b.status}">${b.status}</span></p>
              <p style="font-size: 0.85rem; color: #6b7280;">申请人: ${b.applicant_name} | 审批人: ${b.approver_name || '-'}</p>
              <p style="font-size: 0.85rem; color: #6b7280;">${b.start_date} ~ ${b.end_date}</p>
              ${b.return_damage_note ? `<p style="font-size: 0.85rem; color: #ef4444;">损坏备注: ${b.return_damage_note}</p>` : ''}
            </div>
          `).join('')}
        </div>
      `}

      <h4 style="margin: 1.5rem 0 1rem;">维修历史 (${maintenanceHistory.length})</h4>
      ${maintenanceHistory.length === 0 ? '<p style="color: #6b7280;">暂无维修记录</p>' : `
        <div style="max-height: 200px; overflow-y: auto;">
          ${maintenanceHistory.map(m => `
            <div style="padding: 0.75rem; border-left: 3px solid #f59e0b; margin-bottom: 0.5rem; background: #f9fafb;">
              <p><span class="status-badge status-${m.status}">${m.status}</span></p>
              <p style="font-size: 0.85rem;"><strong>问题:</strong> ${m.issue_description}</p>
              <p style="font-size: 0.85rem; color: #6b7280;">报修人: ${m.reporter_name} | ${m.created_at}</p>
              ${m.repair_note ? `<p style="font-size: 0.85rem; color: #10b981;">维修说明: ${m.repair_note}</p>` : ''}
            </div>
          `).join('')}
        </div>
      `}

      <div class="form-actions">
        <button type="button" class="btn btn-primary" onclick="closeModal()">关闭</button>
      </div>
    `);
  } catch (err) {
    console.error('Failed to load equipment detail:', err);
  }
}

async function freezeEquipment(id) {
  if (!confirm('确定要冻结此设备吗？冻结后将无法申请借用。')) return;
  try {
    await apiRequest(`/equipment/${id}/freeze`, { method: 'POST' });
    showToast('设备已冻结');
    await loadEquipment();
  } catch (err) {
    console.error('Failed to freeze equipment:', err);
  }
}

async function unfreezeEquipment(id) {
  try {
    await apiRequest(`/equipment/${id}/unfreeze`, { method: 'POST' });
    showToast('设备已解冻');
    await loadEquipment();
  } catch (err) {
    console.error('Failed to unfreeze equipment:', err);
  }
}

async function loadBorrowRequests() {
  try {
    const data = await apiRequest('/borrow');
    allBorrowRequests = data.requests;
    renderBorrowTable();
  } catch (err) {
    console.error('Failed to load borrow requests:', err);
  }
}

function renderBorrowTable() {
  const statusFilter = document.getElementById('borrowStatusFilter').value;
  let filtered = allBorrowRequests;
  if (statusFilter) {
    filtered = filtered.filter(b => b.status === statusFilter);
  }

  const tbody = document.getElementById('borrowTableBody');
  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7">
          <div class="empty-state">
            <div class="empty-state-icon">📋</div>
            <p>暂无借用申请</p>
          </div>
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = filtered.map(b => {
    const isAdmin = currentUser?.role === 'admin';
    const isApplicant = b.applicant_id === parseInt(currentUserId);
    const actions = [];

    if (isAdmin && b.status === 'pending') {
      actions.push(`<button class="btn btn-sm btn-success" onclick="approveBorrow(${b.id})">批准</button>`);
      actions.push(`<button class="btn btn-sm btn-danger" onclick="rejectBorrow(${b.id})">拒绝</button>`);
    }
    if ((isApplicant || isAdmin) && b.status === 'approved') {
      actions.push(`<button class="btn btn-sm btn-primary" onclick="collectEquipment(${b.id})">领用</button>`);
    }
    if ((isApplicant || isAdmin) && b.status === 'collected') {
      actions.push(`<button class="btn btn-sm btn-success" onclick="returnEquipment(${b.id})">归还</button>`);
    }
    if ((isApplicant || isAdmin) && ['pending', 'approved'].includes(b.status)) {
      actions.push(`<button class="btn btn-sm btn-secondary" onclick="cancelBorrow(${b.id})">取消</button>`);
    }
    actions.push(`<button class="btn btn-sm btn-secondary" onclick="viewBorrowDetail(${b.id})">详情</button>`);

    return `
      <tr>
        <td><code>${b.request_no}</code></td>
        <td>${b.equipment_name} <small style="color: #6b7280;">(${b.device_code})</small></td>
        <td>${b.applicant_name}</td>
        <td>${b.purpose.slice(0, 15)}${b.purpose.length > 15 ? '...' : ''}</td>
        <td>
          <div style="font-size: 0.8rem;">
            <div>${b.start_date}</div>
            <div style="color: #6b7280;">至 ${b.end_date}</div>
          </div>
        </td>
        <td><span class="status-badge status-${b.status}">${b.status_text}</span></td>
        <td>
          <div class="action-buttons">
            ${actions.join('')}
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

document.getElementById('borrowStatusFilter').addEventListener('change', renderBorrowTable);

document.getElementById('applyBorrowBtn').addEventListener('click', () => {
  const availableEquipment = allEquipment.filter(e => e.status === 'available');
  if (availableEquipment.length === 0) {
    showToast('当前没有可用设备', 'warning');
    return;
  }

  const today = new Date().toISOString().slice(0, 16).replace('T', ' ');
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 16).replace('T', ' ');

  openModal('申请借用设备', `
    <form id="borrowForm">
      <div class="form-group">
        <label>选择设备 *</label>
        <select name="equipment_id" required>
          <option value="">请选择可用设备</option>
          ${availableEquipment.map(e => `<option value="${e.id}">${e.name} (${e.device_code})</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label>借用用途 *</label>
        <textarea name="purpose" required placeholder="请详细描述借用用途..."></textarea>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>开始时间 *</label>
          <input type="datetime-local" name="start_date" required value="${today}">
        </div>
        <div class="form-group">
          <label>结束时间 *</label>
          <input type="datetime-local" name="end_date" required value="${tomorrow}">
        </div>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-secondary" onclick="closeModal()">取消</button>
        <button type="submit" class="btn btn-primary">提交申请</button>
      </div>
    </form>
  `);

  document.getElementById('borrowForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    const data = {
      equipment_id: parseInt(formData.get('equipment_id')),
      purpose: formData.get('purpose'),
      start_date: formData.get('start_date').replace('T', ' ') + ':00',
      end_date: formData.get('end_date').replace('T', ' ') + ':00'
    };

    try {
      await apiRequest('/borrow', {
        method: 'POST',
        body: JSON.stringify(data)
      });
      showToast('借用申请提交成功');
      closeModal();
      await loadBorrowRequests();
      await loadEquipment();
    } catch (err) {
      console.error('Failed to submit borrow request:', err);
    }
  });
});

async function approveBorrow(id) {
  if (!confirm('确定要批准此借用申请吗？')) return;
  try {
    await apiRequest(`/borrow/${id}/approve`, { method: 'POST' });
    showToast('借用申请已批准');
    await loadBorrowRequests();
  } catch (err) {
    console.error('Failed to approve borrow:', err);
  }
}

async function rejectBorrow(id) {
  openModal('拒绝借用申请', `
    <form id="rejectForm">
      <div class="form-group">
        <label>拒绝原因</label>
        <textarea name="approval_comment" placeholder="请填写拒绝原因..."></textarea>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-secondary" onclick="closeModal()">取消</button>
        <button type="submit" class="btn btn-danger">确认拒绝</button>
      </div>
    </form>
  `);

  document.getElementById('rejectForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    const data = {
      approval_comment: formData.get('approval_comment')
    };

    try {
      await apiRequest(`/borrow/${id}/reject`, {
        method: 'POST',
        body: JSON.stringify(data)
      });
      showToast('借用申请已拒绝');
      closeModal();
      await loadBorrowRequests();
    } catch (err) {
      console.error('Failed to reject borrow:', err);
    }
  });
}

async function collectEquipment(id) {
  if (!confirm('确定要领用此设备吗？')) return;
  try {
    await apiRequest(`/borrow/${id}/collect`, { method: 'POST' });
    showToast('设备领用成功');
    await loadBorrowRequests();
    await loadEquipment();
  } catch (err) {
    console.error('Failed to collect equipment:', err);
  }
}

async function returnEquipment(id) {
  openModal('归还设备', `
    <form id="returnForm">
      <div class="form-group">
        <label>归还验收结果 *</label>
        <select name="return_acceptance_result" required>
          <option value="">请选择</option>
          <option value="完好无损">完好无损</option>
          <option value="轻微磨损">轻微磨损</option>
          <option value="功能正常但外观有损">功能正常但外观有损</option>
          <option value="设备损坏">设备损坏</option>
        </select>
      </div>
      <div class="form-group">
        <label>损坏备注</label>
        <textarea name="return_damage_note" placeholder="如有损坏，请详细描述..."></textarea>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-secondary" onclick="closeModal()">取消</button>
        <button type="submit" class="btn btn-success">确认归还</button>
      </div>
    </form>
  `);

  document.getElementById('returnForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    const data = {
      return_acceptance_result: formData.get('return_acceptance_result'),
      return_damage_note: formData.get('return_damage_note')
    };

    try {
      await apiRequest(`/borrow/${id}/return`, {
        method: 'POST',
        body: JSON.stringify(data)
      });
      showToast('设备归还成功');
      closeModal();
      await loadBorrowRequests();
      await loadEquipment();
    } catch (err) {
      console.error('Failed to return equipment:', err);
    }
  });
}

async function cancelBorrow(id) {
  if (!confirm('确定要取消此借用申请吗？')) return;
  try {
    await apiRequest(`/borrow/${id}/cancel`, { method: 'POST' });
    showToast('借用申请已取消');
    await loadBorrowRequests();
    await loadEquipment();
  } catch (err) {
    console.error('Failed to cancel borrow:', err);
  }
}

async function viewBorrowDetail(id) {
  try {
    const data = await apiRequest(`/borrow/${id}`);
    const b = data.request;

    openModal('借用申请详情', `
      <h4 style="margin-bottom: 1rem;">基本信息</h4>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; margin-bottom: 1rem;">
        <p><strong>申请单号:</strong> <code>${b.request_no}</code></p>
        <p><strong>状态:</strong> <span class="status-badge status-${b.status}">${b.status_text}</span></p>
        <p><strong>设备:</strong> ${b.equipment_name} (${b.device_code})</p>
        <p><strong>申请人:</strong> ${b.applicant_name}</p>
      </div>
      <p style="margin-bottom: 1rem;"><strong>用途:</strong> ${b.purpose}</p>
      <p style="margin-bottom: 1rem;"><strong>借用时间:</strong> ${b.start_date} ~ ${b.end_date}</p>
      ${b.approver_name ? `<p style="margin-bottom: 1rem;"><strong>审批人:</strong> ${b.approver_name}</p>` : ''}
      ${b.approval_comment ? `<p style="margin-bottom: 1rem;"><strong>审批意见:</strong> ${b.approval_comment}</p>` : ''}
      ${b.collected_at ? `<p style="margin-bottom: 1rem;"><strong>领用时间:</strong> ${b.collected_at}</p>` : ''}
      ${b.return_acceptance_result ? `<p style="margin-bottom: 1rem;"><strong>验收结果:</strong> ${b.return_acceptance_result}</p>` : ''}
      ${b.return_damage_note ? `<p style="margin-bottom: 1rem; color: #ef4444;"><strong>损坏备注:</strong> ${b.return_damage_note}</p>` : ''}
      ${b.returned_at ? `<p style="margin-bottom: 1rem;"><strong>归还时间:</strong> ${b.returned_at}</p>` : ''}

      <div class="form-actions">
        <button type="button" class="btn btn-primary" onclick="closeModal()">关闭</button>
      </div>
    `);
  } catch (err) {
    console.error('Failed to load borrow detail:', err);
  }
}

async function loadMaintenance() {
  try {
    const data = await apiRequest('/maintenance');
    allMaintenance = data.records;
    renderMaintenanceTable();
  } catch (err) {
    console.error('Failed to load maintenance:', err);
  }
}

function renderMaintenanceTable() {
  const statusFilter = document.getElementById('maintenanceStatusFilter').value;
  let filtered = allMaintenance;
  if (statusFilter) {
    filtered = filtered.filter(m => m.status === statusFilter);
  }

  const tbody = document.getElementById('maintenanceTableBody');
  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7">
          <div class="empty-state">
            <div class="empty-state-icon">🔩</div>
            <p>暂无维修记录</p>
          </div>
        </td>
      </tr>
    `;
    return;
  }

  const isAdmin = currentUser?.role === 'admin';
  tbody.innerHTML = filtered.map(m => {
    const actions = [];
    if (isAdmin && m.status === 'pending') {
      actions.push(`<button class="btn btn-sm btn-primary" onclick="startMaintenance(${m.id})">开始维修</button>`);
    }
    if (isAdmin && m.status === 'in_progress') {
      actions.push(`<button class="btn btn-sm btn-success" onclick="completeMaintenance(${m.id})">完成维修</button>`);
    }
    actions.push(`<button class="btn btn-sm btn-secondary" onclick="viewMaintenanceDetail(${m.id})">详情</button>`);

    return `
      <tr>
        <td>#${m.id}</td>
        <td>${m.equipment_name} <small style="color: #6b7280;">(${m.device_code})</small></td>
        <td>${m.reporter_name}</td>
        <td>${m.issue_description.slice(0, 20)}${m.issue_description.length > 20 ? '...' : ''}</td>
        <td><span class="status-badge status-${m.status}">${m.status_text}</span></td>
        <td>${m.created_at}</td>
        <td>
          <div class="action-buttons">
            ${actions.join('')}
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

document.getElementById('maintenanceStatusFilter').addEventListener('change', renderMaintenanceTable);

document.getElementById('reportMaintenanceBtn').addEventListener('click', () => {
  const availableEquipment = allEquipment.filter(e =>
    e.status === 'available' || e.status === 'frozen'
  );

  if (availableEquipment.length === 0) {
    showToast('当前没有可报修的设备', 'warning');
    return;
  }

  openModal('设备报修', `
    <form id="maintenanceForm">
      <div class="form-group">
        <label>选择设备 *</label>
        <select name="equipment_id" required>
          <option value="">请选择需要维修的设备</option>
          ${availableEquipment.map(e => `<option value="${e.id}">${e.name} (${e.device_code})</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label>问题描述 *</label>
        <textarea name="issue_description" required placeholder="请详细描述设备问题..."></textarea>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-secondary" onclick="closeModal()">取消</button>
        <button type="submit" class="btn btn-warning">提交报修</button>
      </div>
    </form>
  `);

  document.getElementById('maintenanceForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    const data = {
      equipment_id: parseInt(formData.get('equipment_id')),
      issue_description: formData.get('issue_description')
    };

    try {
      await apiRequest('/maintenance', {
        method: 'POST',
        body: JSON.stringify(data)
      });
      showToast('报修申请提交成功');
      closeModal();
      await loadMaintenance();
      await loadEquipment();
    } catch (err) {
      console.error('Failed to report maintenance:', err);
    }
  });
});

async function startMaintenance(id) {
  if (!confirm('确定要开始维修吗？设备将被标记为维修中状态。')) return;
  try {
    await apiRequest(`/maintenance/${id}/start`, { method: 'POST' });
    showToast('维修已开始，设备已冻结');
    await loadMaintenance();
    await loadEquipment();
  } catch (err) {
    console.error('Failed to start maintenance:', err);
  }
}

async function completeMaintenance(id) {
  openModal('完成维修', `
    <form id="completeMaintenanceForm">
      <div class="form-group">
        <label>维修说明</label>
        <textarea name="repair_note" placeholder="请描述维修过程和结果..."></textarea>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-secondary" onclick="closeModal()">取消</button>
        <button type="submit" class="btn btn-success">完成维修</button>
      </div>
    </form>
  `);

  document.getElementById('completeMaintenanceForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    const data = {
      repair_note: formData.get('repair_note')
    };

    try {
      await apiRequest(`/maintenance/${id}/complete`, {
        method: 'POST',
        body: JSON.stringify(data)
      });
      showToast('维修已完成，设备已解冻');
      closeModal();
      await loadMaintenance();
      await loadEquipment();
    } catch (err) {
      console.error('Failed to complete maintenance:', err);
    }
  });
}

async function viewMaintenanceDetail(id) {
  const m = allMaintenance.find(x => x.id === id);
  if (!m) return;

  openModal('维修记录详情', `
    <h4 style="margin-bottom: 1rem;">基本信息</h4>
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; margin-bottom: 1rem;">
      <p><strong>设备:</strong> ${m.equipment_name} (${m.device_code})</p>
      <p><strong>状态:</strong> <span class="status-badge status-${m.status}">${m.status_text}</span></p>
      <p><strong>报修人:</strong> ${m.reporter_name}</p>
      <p><strong>报修时间:</strong> ${m.created_at}</p>
    </div>
    <p style="margin-bottom: 1rem;"><strong>问题描述:</strong> ${m.issue_description}</p>
    ${m.start_date ? `<p style="margin-bottom: 1rem;"><strong>开始维修:</strong> ${m.start_date}</p>` : ''}
    ${m.end_date ? `<p style="margin-bottom: 1rem;"><strong>完成维修:</strong> ${m.end_date}</p>` : ''}
    ${m.repair_note ? `<p style="margin-bottom: 1rem;"><strong>维修说明:</strong> ${m.repair_note}</p>` : ''}

    <div class="form-actions">
      <button type="button" class="btn btn-primary" onclick="closeModal()">关闭</button>
    </div>
  `);
}

function loadEquipmentSelectors() {
  const options = allEquipment.map(e =>
    `<option value="${e.id}">${e.device_code} - ${e.name}</option>`
  ).join('');

  document.getElementById('historyEquipmentFilter').innerHTML = `
    <option value="">选择设备查看时间线</option>
    ${options}
  `;
  document.getElementById('exportEquipmentId').innerHTML = `
    <option value="">全部设备</option>
    ${options}
  `;
  document.getElementById('exportBorrowEquipmentId').innerHTML = `
    <option value="">全部设备</option>
    ${options}
  `;
}

document.getElementById('historyEquipmentFilter').addEventListener('change', async (e) => {
  const equipmentId = e.target.value;
  if (!equipmentId) {
    document.getElementById('timelineContainer').innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">📜</div>
        <p>请选择设备查看时间线</p>
      </div>
    `;
    return;
  }

  try {
    const data = await apiRequest(`/audit/timeline?equipment_id=${equipmentId}`);
    renderTimeline(data);
  } catch (err) {
    console.error('Failed to load timeline:', err);
  }
});

function renderTimeline(data) {
  const { equipment, timeline } = data;
  const container = document.getElementById('timelineContainer');

  if (timeline.length === 0) {
    container.innerHTML = `
      <div style="margin-bottom: 1rem; padding: 1rem; background: #f0f9ff; border-radius: 8px;">
        <h4>${equipment.name} (${equipment.device_code})</h4>
      </div>
      <div class="empty-state">
        <div class="empty-state-icon">📜</div>
        <p>暂无时间线记录</p>
      </div>
    `;
    return;
  }

  const actionNames = {
    'CREATE_EQUIPMENT': '创建设备',
    'UPDATE_EQUIPMENT': '更新设备',
    'DELETE_EQUIPMENT': '删除设备',
    'FREEZE_EQUIPMENT': '冻结设备',
    'UNFREEZE_EQUIPMENT': '解冻设备',
    'CREATE_BORROW_REQUEST': '提交借用申请',
    'APPROVE_BORROW_REQUEST': '批准借用申请',
    'REJECT_BORROW_REQUEST': '拒绝借用申请',
    'COLLECT_EQUIPMENT': '领用设备',
    'RETURN_EQUIPMENT': '归还设备',
    'CANCEL_BORROW_REQUEST': '取消借用申请',
    'CREATE_MAINTENANCE': '提交维修申请',
    'START_MAINTENANCE': '开始维修',
    'COMPLETE_MAINTENANCE': '完成维修'
  };

  container.innerHTML = `
    <div style="margin-bottom: 1.5rem; padding: 1rem; background: #f0f9ff; border-radius: 8px;">
      <h4>${equipment.name} (${equipment.device_code})</h4>
      <p style="margin: 0; color: #6b7280; font-size: 0.9rem;">
        当前状态: <span class="status-badge status-${equipment.status}">${equipment.status_text || equipment.status}</span>
      </p>
    </div>
    <div class="timeline">
      ${timeline.map(item => {
        let title = '';
        let content = '';

        if (item.type === 'borrow') {
          const statusMap = {
            'pending': '待审批', 'approved': '已批准', 'rejected': '已拒绝',
            'collected': '已领用', 'returned': '已归还', 'cancelled': '已取消'
          };
          title = `借用申请 - ${statusMap[item.status] || item.status}`;
          content = `
            <p><strong>申请人:</strong> ${item.user_name}</p>
            <p><strong>用途:</strong> ${item.purpose}</p>
            <p><strong>时间:</strong> ${item.start_date} ~ ${item.end_date}</p>
            ${item.return_acceptance_result ? `<p><strong>验收:</strong> ${item.return_acceptance_result}</p>` : ''}
            ${item.return_damage_note ? `<p style="color: #ef4444;"><strong>损坏:</strong> ${item.return_damage_note}</p>` : ''}
          `;
        } else if (item.type === 'maintenance') {
          const statusMap = {
            'pending': '待处理', 'in_progress': '维修中', 'completed': '已完成'
          };
          title = `维修记录 - ${statusMap[item.status] || item.status}`;
          content = `
            <p><strong>报修人:</strong> ${item.user_name}</p>
            <p><strong>问题:</strong> ${item.issue_description}</p>
            ${item.repair_note ? `<p style="color: #10b981;"><strong>维修:</strong> ${item.repair_note}</p>` : ''}
          `;
        } else if (item.type === 'audit') {
          title = actionNames[item.action] || item.action;
          content = `
            <p><strong>操作人:</strong> ${item.user_name}</p>
            ${item.details_parsed ? `<p><strong>详情:</strong> ${JSON.stringify(item.details_parsed)}</p>` : ''}
          `;
        }

        return `
          <div class="timeline-item ${item.type}">
            <div class="timeline-content">
              <div class="timeline-time">${item.event_time}</div>
              <span class="timeline-type ${item.type}">${item.type === 'borrow' ? '借用' : item.type === 'maintenance' ? '维修' : '操作'}</span>
              <h4>${title}</h4>
              ${content}
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

async function loadAuditLogs() {
  try {
    const data = await apiRequest('/audit/logs');
    const logs = data.logs;

    const actions = [...new Set(logs.map(l => l.action))];
    document.getElementById('auditActionFilter').innerHTML = `
      <option value="">全部操作</option>
      ${actions.map(a => `<option value="${a}">${a}</option>`).join('')}
    `;

    renderAuditLogs(logs);
  } catch (err) {
    console.error('Failed to load audit logs:', err);
  }
}

function renderAuditLogs(logs) {
  const actionFilter = document.getElementById('auditActionFilter').value;
  const typeFilter = document.getElementById('auditTypeFilter').value;

  let filtered = logs;
  if (actionFilter) filtered = filtered.filter(l => l.action === actionFilter);
  if (typeFilter) filtered = filtered.filter(l => l.target_type === typeFilter);

  const tbody = document.getElementById('auditTableBody');
  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="5">
          <div class="empty-state">
            <div class="empty-state-icon">📝</div>
            <p>暂无审计日志</p>
          </div>
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = filtered.slice(0, 100).map(l => `
    <tr>
      <td style="font-size: 0.8rem;">${l.created_at}</td>
      <td>${l.user_name || '-'}</td>
      <td>${l.action_text || l.action}</td>
      <td>${l.target_type}</td>
      <td style="font-size: 0.75rem; max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
        ${l.details_parsed ? JSON.stringify(l.details_parsed) : '-'}
      </td>
    </tr>
  `).join('');
}

document.getElementById('auditActionFilter').addEventListener('change', async () => {
  const data = await apiRequest('/audit/logs');
  renderAuditLogs(data.logs);
});
document.getElementById('auditTypeFilter').addEventListener('change', async () => {
  const data = await apiRequest('/audit/logs');
  renderAuditLogs(data.logs);
});

async function exportEquipment() {
  const equipmentId = document.getElementById('exportEquipmentId').value;
  const startDate = document.getElementById('exportEquipmentStart').value;
  const endDate = document.getElementById('exportEquipmentEnd').value;
  const format = document.getElementById('exportEquipmentFormat').value;

  let url = `/api/audit/export/equipment?format=${format}`;
  if (equipmentId) url += `&equipment_id=${equipmentId}`;
  if (startDate) url += `&start_date=${startDate}`;
  if (endDate) url += `&end_date=${endDate}`;

  window.location.href = url;
  showToast('正在导出设备数据...');
}

async function exportBorrow() {
  const equipmentId = document.getElementById('exportBorrowEquipmentId').value;
  const startDate = document.getElementById('exportBorrowStart').value;
  const endDate = document.getElementById('exportBorrowEnd').value;
  const format = document.getElementById('exportBorrowFormat').value;

  let url = `/api/audit/export/borrow?format=${format}`;
  if (equipmentId) url += `&equipment_id=${equipmentId}`;
  if (startDate) url += `&start_date=${startDate}`;
  if (endDate) url += `&end_date=${endDate}`;

  window.location.href = url;
  showToast('正在导出借用记录...');
}

async function loadAllData() {
  await Promise.all([
    loadEquipment(),
    loadBorrowRequests(),
    loadMaintenance()
  ]);
  loadEquipmentSelectors();
}

async function init() {
  await initUser();
  await loadAllData();
}

init();
