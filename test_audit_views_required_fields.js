const http = require('http');
const moment = require('moment');

const BASE_URL = 'localhost';
const PORT = 3000;

function makeRequest(method, path, data = null, userId = '1') {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: BASE_URL,
      port: PORT,
      path: `/api${path}`,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': userId
      }
    };

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        try {
          const parsed = body ? JSON.parse(body) : null;
          resolve({ status: res.statusCode, data: parsed, headers: res.headers, rawBody: body });
        } catch (e) {
          resolve({ status: res.statusCode, data: body, headers: res.headers, rawBody: body });
        }
      });
    });

    req.on('error', reject);
    if (data && method !== 'GET') {
      const jsonData = JSON.stringify(data);
      req.setHeader('Content-Length', Buffer.byteLength(jsonData));
      req.write(jsonData);
    }
    req.end();
  });
}

let passed = 0;
let failed = 0;
let testEquipmentId = null;
let createdViewId = null;
let createdViewName = null;

async function test(name, fn, requiredVars = []) {
  try {
    for (const v of requiredVars) {
      if (eval(v) === null || eval(v) === undefined) {
        console.log(`\n🧪 测试: ${name}`);
        console.log(`   ⏭️  跳过：${v} 未设置`);
        return;
      }
    }
    
    console.log(`\n🧪 测试: ${name}`);
    await fn();
    console.log(`   ✅ 通过`);
    passed++;
  } catch (e) {
    console.log(`   ❌ 失败: ${e.message}`);
    failed++;
  }
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}: 期望 ${expected}, 实际 ${actual}`);
  }
}

function assertNotNull(value, message) {
  if (value === null || value === undefined) {
    throw new Error(`${message}: 值不能为空`);
  }
}

function assertTrue(condition, message) {
  if (!condition) {
    throw new Error(`${message}: 条件不成立`);
  }
}

function assertContains(str, substr, message) {
  if (!str.includes(substr)) {
    throw new Error(`${message}: "${str}" 不包含 "${substr}"`);
  }
}

async function waitForServer() {
  console.log('\n⏳ 等待服务器启动...');
  for (let i = 0; i < 30; i++) {
    try {
      const res = await makeRequest('GET', '/equipment');
      if (res.status === 200) {
        console.log('✅ 服务器已就绪');
        return;
      }
    } catch (e) {
      // 等待服务器启动
    }
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error('服务器未在规定时间内启动');
}

async function getViewCount() {
  const res = await makeRequest('GET', '/audit/views', null, '1');
  return res.status === 200 && res.data && res.data.views ? res.data.views.length : 0;
}

async function runTests() {
  console.log('='.repeat(80));
  console.log('📊 审计视图必填字段校验 - 回归测试');
  console.log('='.repeat(80));
  console.log('验证: 创建视图时必须包含设备、时间范围、事件类型、导出格式');
  console.log('='.repeat(80));

  await waitForServer();

  await test('0. 初始化 - 创建测试设备', async () => {
    const uniqueCode = `REQ-FIELD-${Date.now()}`;
    const createRes = await makeRequest('POST', '/equipment', {
      device_code: uniqueCode,
      name: '必填字段测试专用设备',
      model: 'REQ-FIELD-MODEL',
      category: '测试设备',
      location: '测试实验室'
    }, '1');

    assertEqual(createRes.status, 201, `创建设备应该返回 201`);
    assertNotNull(createRes.data.equipment, '返回数据应该包含 equipment 对象');
    testEquipmentId = createRes.data.equipment.id;
    console.log(`   设备ID: ${testEquipmentId}`);
  });

  const viewCountBefore = await getViewCount();
  console.log(`\n📊 创建前视图数量: ${viewCountBefore}`);

  await test('1. 缺少 equipment_id - 应该返回 400 且不落库', async () => {
    const createRes = await makeRequest('POST', '/audit/views', {
      name: `缺少设备视图_${Date.now()}`,
      export_format: 'json',
      start_date: '2026-01-01',
      end_date: '2026-12-31',
      event_types: ['borrow_created']
    }, '1');

    assertEqual(createRes.status, 400, `缺少设备应该返回 400，实际: ${createRes.status}`);
    assertEqual(createRes.data.code, 'INVALID_VIEW_PARAMS', '错误码应该是 INVALID_VIEW_PARAMS');
    assertTrue(Array.isArray(createRes.data.details), '应该返回详细错误列表');
    assertTrue(createRes.data.details.some(e => e.includes('设备ID不能为空')), 
      `错误信息应该包含"设备ID不能为空"，实际错误: ${JSON.stringify(createRes.data.details)}`);
    
    const viewCountAfter = await getViewCount();
    assertEqual(viewCountAfter, viewCountBefore, 
      `视图不应该被创建，创建前: ${viewCountBefore}, 创建后: ${viewCountAfter}`);
    
    console.log(`   错误信息: ${createRes.data.details.join('; ')}`);
  }, ['testEquipmentId']);

  await test('2. 缺少 start_date - 应该返回 400 且不落库', async () => {
    const createRes = await makeRequest('POST', '/audit/views', {
      name: `缺少开始日期视图_${Date.now()}`,
      export_format: 'json',
      equipment_id: testEquipmentId,
      end_date: '2026-12-31',
      event_types: ['borrow_created']
    }, '1');

    assertEqual(createRes.status, 400, `缺少开始日期应该返回 400，实际: ${createRes.status}`);
    assertEqual(createRes.data.code, 'INVALID_VIEW_PARAMS', '错误码应该是 INVALID_VIEW_PARAMS');
    assertTrue(createRes.data.details.some(e => e.includes('开始日期不能为空')), 
      `错误信息应该包含"开始日期不能为空"，实际错误: ${JSON.stringify(createRes.data.details)}`);
    
    const viewCountAfter = await getViewCount();
    assertEqual(viewCountAfter, viewCountBefore, 
      `视图不应该被创建，创建前: ${viewCountBefore}, 创建后: ${viewCountAfter}`);
    
    console.log(`   错误信息: ${createRes.data.details.join('; ')}`);
  }, ['testEquipmentId']);

  await test('3. 缺少 end_date - 应该返回 400 且不落库', async () => {
    const createRes = await makeRequest('POST', '/audit/views', {
      name: `缺少结束日期视图_${Date.now()}`,
      export_format: 'json',
      equipment_id: testEquipmentId,
      start_date: '2026-01-01',
      event_types: ['borrow_created']
    }, '1');

    assertEqual(createRes.status, 400, `缺少结束日期应该返回 400，实际: ${createRes.status}`);
    assertEqual(createRes.data.code, 'INVALID_VIEW_PARAMS', '错误码应该是 INVALID_VIEW_PARAMS');
    assertTrue(createRes.data.details.some(e => e.includes('结束日期不能为空')), 
      `错误信息应该包含"结束日期不能为空"，实际错误: ${JSON.stringify(createRes.data.details)}`);
    
    const viewCountAfter = await getViewCount();
    assertEqual(viewCountAfter, viewCountBefore, 
      `视图不应该被创建，创建前: ${viewCountBefore}, 创建后: ${viewCountAfter}`);
    
    console.log(`   错误信息: ${createRes.data.details.join('; ')}`);
  }, ['testEquipmentId']);

  await test('4. 缺少 event_types - 应该返回 400 且不落库', async () => {
    const createRes = await makeRequest('POST', '/audit/views', {
      name: `缺少事件类型视图_${Date.now()}`,
      export_format: 'json',
      equipment_id: testEquipmentId,
      start_date: '2026-01-01',
      end_date: '2026-12-31'
    }, '1');

    assertEqual(createRes.status, 400, `缺少事件类型应该返回 400，实际: ${createRes.status}`);
    assertEqual(createRes.data.code, 'INVALID_VIEW_PARAMS', '错误码应该是 INVALID_VIEW_PARAMS');
    assertTrue(createRes.data.details.some(e => e.includes('事件类型不能为空')), 
      `错误信息应该包含"事件类型不能为空"，实际错误: ${JSON.stringify(createRes.data.details)}`);
    
    const viewCountAfter = await getViewCount();
    assertEqual(viewCountAfter, viewCountBefore, 
      `视图不应该被创建，创建前: ${viewCountBefore}, 创建后: ${viewCountAfter}`);
    
    console.log(`   错误信息: ${createRes.data.details.join('; ')}`);
  }, ['testEquipmentId']);

  await test('5. 缺少 export_format - 应该返回 400 且不落库', async () => {
    const createRes = await makeRequest('POST', '/audit/views', {
      name: `缺少导出格式视图_${Date.now()}`,
      equipment_id: testEquipmentId,
      start_date: '2026-01-01',
      end_date: '2026-12-31',
      event_types: ['borrow_created']
    }, '1');

    assertEqual(createRes.status, 400, `缺少导出格式应该返回 400，实际: ${createRes.status}`);
    assertEqual(createRes.data.code, 'INVALID_VIEW_PARAMS', '错误码应该是 INVALID_VIEW_PARAMS');
    assertTrue(createRes.data.details.some(e => e.includes('导出格式不能为空')), 
      `错误信息应该包含"导出格式不能为空"，实际错误: ${JSON.stringify(createRes.data.details)}`);
    
    const viewCountAfter = await getViewCount();
    assertEqual(viewCountAfter, viewCountBefore, 
      `视图不应该被创建，创建前: ${viewCountBefore}, 创建后: ${viewCountAfter}`);
    
    console.log(`   错误信息: ${createRes.data.details.join('; ')}`);
  }, ['testEquipmentId']);

  await test('6. event_types 为空数组 - 应该返回 400 且不落库', async () => {
    const createRes = await makeRequest('POST', '/audit/views', {
      name: `事件类型为空视图_${Date.now()}`,
      export_format: 'json',
      equipment_id: testEquipmentId,
      start_date: '2026-01-01',
      end_date: '2026-12-31',
      event_types: []
    }, '1');

    assertEqual(createRes.status, 400, `事件类型为空数组应该返回 400，实际: ${createRes.status}`);
    assertEqual(createRes.data.code, 'INVALID_VIEW_PARAMS', '错误码应该是 INVALID_VIEW_PARAMS');
    assertTrue(createRes.data.details.some(e => e.includes('事件类型数组不能为空')), 
      `错误信息应该包含"事件类型数组不能为空"，实际错误: ${JSON.stringify(createRes.data.details)}`);
    
    const viewCountAfter = await getViewCount();
    assertEqual(viewCountAfter, viewCountBefore, 
      `视图不应该被创建，创建前: ${viewCountBefore}, 创建后: ${viewCountAfter}`);
    
    console.log(`   错误信息: ${createRes.data.details.join('; ')}`);
  }, ['testEquipmentId']);

  await test('7. start_date 为空字符串 - 应该返回 400 且不落库', async () => {
    const createRes = await makeRequest('POST', '/audit/views', {
      name: `开始日期为空视图_${Date.now()}`,
      export_format: 'json',
      equipment_id: testEquipmentId,
      start_date: '',
      end_date: '2026-12-31',
      event_types: ['borrow_created']
    }, '1');

    assertEqual(createRes.status, 400, `开始日期为空字符串应该返回 400，实际: ${createRes.status}`);
    assertEqual(createRes.data.code, 'INVALID_VIEW_PARAMS', '错误码应该是 INVALID_VIEW_PARAMS');
    assertTrue(createRes.data.details.some(e => e.includes('开始日期不能为空')), 
      `错误信息应该包含"开始日期不能为空"，实际错误: ${JSON.stringify(createRes.data.details)}`);
    
    const viewCountAfter = await getViewCount();
    assertEqual(viewCountAfter, viewCountBefore, 
      `视图不应该被创建，创建前: ${viewCountBefore}, 创建后: ${viewCountAfter}`);
    
    console.log(`   错误信息: ${createRes.data.details.join('; ')}`);
  }, ['testEquipmentId']);

  await test('8. 无效的 equipment_id (字符串) - 应该返回 400 且不落库', async () => {
    const createRes = await makeRequest('POST', '/audit/views', {
      name: `设备ID无效视图_${Date.now()}`,
      export_format: 'json',
      equipment_id: 'abc',
      start_date: '2026-01-01',
      end_date: '2026-12-31',
      event_types: ['borrow_created']
    }, '1');

    assertEqual(createRes.status, 400, `设备ID无效应该返回 400，实际: ${createRes.status}`);
    assertEqual(createRes.data.code, 'INVALID_VIEW_PARAMS', '错误码应该是 INVALID_VIEW_PARAMS');
    assertTrue(createRes.data.details.some(e => e.includes('设备ID必须是正整数')), 
      `错误信息应该包含"设备ID必须是正整数"，实际错误: ${JSON.stringify(createRes.data.details)}`);
    
    const viewCountAfter = await getViewCount();
    assertEqual(viewCountAfter, viewCountBefore, 
      `视图不应该被创建，创建前: ${viewCountBefore}, 创建后: ${viewCountAfter}`);
    
    console.log(`   错误信息: ${createRes.data.details.join('; ')}`);
  }, ['testEquipmentId']);

  await test('9. 无效的 event_type 值 - 应该返回 400 且不落库', async () => {
    const createRes = await makeRequest('POST', '/audit/views', {
      name: `事件类型无效视图_${Date.now()}`,
      export_format: 'json',
      equipment_id: testEquipmentId,
      start_date: '2026-01-01',
      end_date: '2026-12-31',
      event_types: ['borrow_created', 'invalid_type']
    }, '1');

    assertEqual(createRes.status, 400, `无效事件类型应该返回 400，实际: ${createRes.status}`);
    assertEqual(createRes.data.code, 'INVALID_VIEW_PARAMS', '错误码应该是 INVALID_VIEW_PARAMS');
    assertTrue(createRes.data.details.some(e => e.includes('invalid_type')), 
      `错误信息应该包含无效的事件类型，实际错误: ${JSON.stringify(createRes.data.details)}`);
    
    const viewCountAfter = await getViewCount();
    assertEqual(viewCountAfter, viewCountBefore, 
      `视图不应该被创建，创建前: ${viewCountBefore}, 创建后: ${viewCountAfter}`);
    
    console.log(`   错误信息: ${createRes.data.details.join('; ')}`);
  }, ['testEquipmentId']);

  await test('10. 开始日期晚于结束日期 - 应该返回 400 且不落库', async () => {
    const createRes = await makeRequest('POST', '/audit/views', {
      name: `日期倒置视图_${Date.now()}`,
      export_format: 'json',
      equipment_id: testEquipmentId,
      start_date: '2026-12-31',
      end_date: '2026-01-01',
      event_types: ['borrow_created']
    }, '1');

    assertEqual(createRes.status, 400, `日期倒置应该返回 400，实际: ${createRes.status}`);
    assertEqual(createRes.data.code, 'INVALID_VIEW_PARAMS', '错误码应该是 INVALID_VIEW_PARAMS');
    assertTrue(createRes.data.details.some(e => e.includes('开始日期不能晚于结束日期')), 
      `错误信息应该包含"开始日期不能晚于结束日期"，实际错误: ${JSON.stringify(createRes.data.details)}`);
    
    const viewCountAfter = await getViewCount();
    assertEqual(viewCountAfter, viewCountBefore, 
      `视图不应该被创建，创建前: ${viewCountBefore}, 创建后: ${viewCountAfter}`);
    
    console.log(`   错误信息: ${createRes.data.details.join('; ')}`);
  }, ['testEquipmentId']);

  await test('11. 只传 name 和 export_format (原始bug场景) - 应该返回 400 且不落库', async () => {
    const createRes = await makeRequest('POST', '/audit/views', {
      name: `原始Bug场景_${Date.now()}`,
      export_format: 'json'
    }, '1');

    assertEqual(createRes.status, 400, `只传name和export_format应该返回 400，实际: ${createRes.status}`);
    assertEqual(createRes.data.code, 'INVALID_VIEW_PARAMS', '错误码应该是 INVALID_VIEW_PARAMS');
    
    const expectedErrors = ['设备ID不能为空', '开始日期不能为空', '结束日期不能为空', '事件类型不能为空'];
    for (const expected of expectedErrors) {
      assertTrue(createRes.data.details.some(e => e.includes(expected)), 
        `错误信息应该包含"${expected}"，实际错误: ${JSON.stringify(createRes.data.details)}`);
    }
    
    const viewCountAfter = await getViewCount();
    assertEqual(viewCountAfter, viewCountBefore, 
      `视图不应该被创建，创建前: ${viewCountBefore}, 创建后: ${viewCountAfter}`);
    
    console.log(`   错误数量: ${createRes.data.details.length}`);
    console.log(`   错误信息: ${createRes.data.details.join('; ')}`);
  }, ['testEquipmentId']);

  await test('12. 完整视图创建 - 应该成功', async () => {
    createdViewName = `完整测试视图_${Date.now()}`;
    const createRes = await makeRequest('POST', '/audit/views', {
      name: createdViewName,
      description: '必填字段测试-完整视图',
      equipment_id: testEquipmentId,
      start_date: '2026-01-01',
      end_date: '2026-12-31',
      event_types: ['borrow_created', 'borrow_approved', 'borrow_conflict_blocked'],
      export_format: 'json'
    }, '1');

    assertEqual(createRes.status, 201, `完整视图创建应该返回 201，实际: ${createRes.status}`);
    assertNotNull(createRes.data.view, '返回数据应该包含 view 对象');
    assertNotNull(createRes.data.view.id, '视图ID不能为空');
    assertEqual(createRes.data.view.name, createdViewName, '视图名称应该匹配');
    assertEqual(createRes.data.view.equipment_id, testEquipmentId, '设备ID应该匹配');
    assertEqual(createRes.data.view.export_format, 'json', '导出格式应该匹配');
    assertTrue(Array.isArray(createRes.data.view.event_types), 'event_types 应该是数组');
    assertEqual(createRes.data.view.event_types.length, 3, '事件类型数量应该是 3');
    assertEqual(createRes.data.view.version, 1, '版本应该是 1');
    
    createdViewId = createRes.data.view.id;
    
    const viewCountAfter = await getViewCount();
    assertEqual(viewCountAfter, viewCountBefore + 1, 
      `视图应该被创建，创建前: ${viewCountBefore}, 创建后: ${viewCountAfter}`);
    
    console.log(`   视图创建成功，ID: ${createdViewId}, 名称: ${createdViewName}`);
  }, ['testEquipmentId']);

  await test('13. 按视图ID导出JSON - 元数据包含视图信息', async () => {
    const exportRes = await makeRequest('GET', `/audit/export/timeline?view_id=${createdViewId}`, null, '1');

    assertEqual(exportRes.status, 200, `导出应该成功，实际: ${exportRes.status}`);
    
    const contentType = exportRes.headers['content-type'];
    assertTrue(contentType.includes('application/json'), `Content-Type 应该包含 application/json`);
    
    const data = typeof exportRes.data === 'string' ? JSON.parse(exportRes.data) : exportRes.data;
    assertNotNull(data.meta, '应该包含 meta 信息');
    assertNotNull(data.events, '应该包含 events 数组');
    
    assertEqual(data.meta.view_name, createdViewName, '视图名称应该匹配');
    assertEqual(data.meta.view_id, createdViewId, '视图ID应该匹配');
    assertEqual(data.meta.view_version, 1, '视图版本应该是 1');
    assertNotNull(data.meta.exported_by, '应该包含导出者');
    
    console.log(`   JSON导出成功，事件数: ${data.events.length}, 视图版本: ${data.meta.view_version}`);
  }, ['createdViewId', 'createdViewName']);

  await test('14. 更新视图导出格式为CSV - 应该成功并递增版本', async () => {
    const updateRes = await makeRequest('PUT', `/audit/views/${createdViewId}`, {
      export_format: 'csv'
    }, '1');

    assertEqual(updateRes.status, 200, `更新应该成功，实际: ${updateRes.status}`);
    assertEqual(updateRes.data.view.export_format, 'csv', '导出格式应该已更新');
    assertEqual(updateRes.data.view.version, 2, '版本应该递增到 2');
    
    console.log(`   视图更新成功，版本: ${updateRes.data.view.version}`);
  }, ['createdViewId']);

  await test('15. 按视图名称导出CSV - 元数据包含更新后的版本', async () => {
    const exportRes = await makeRequest('GET', `/audit/export/timeline?view_name=${encodeURIComponent(createdViewName)}`, null, '1');

    assertEqual(exportRes.status, 200, `导出应该成功，实际: ${exportRes.status}`);
    
    const contentType = exportRes.headers['content-type'];
    assertTrue(contentType.includes('text/csv'), `Content-Type 应该包含 text/csv`);
    
    const disposition = exportRes.headers['content-disposition'];
    assertTrue(disposition.includes('timeline_view_'), '文件名应该包含 timeline_view_');
    assertTrue(disposition.includes(createdViewName.replace(/[^a-zA-Z0-9_-]/g, '_')), '文件名应该包含视图名称');
    
    const csvContent = exportRes.rawBody;
    assertTrue(csvContent.startsWith('\uFEFF'), 'CSV 应该包含 UTF-8 BOM');
    
    const lines = csvContent.replace('\uFEFF', '').split('\n');
    assertTrue(lines.length >= 1, 'CSV 至少应该包含表头');
    
    const headerLine = lines[0].split(',').map(h => h.replace(/"/g, ''));
    assertTrue(headerLine.includes('事件ID'), 'CSV表头应该包含事件ID');
    assertTrue(headerLine.includes('事件类型'), 'CSV表头应该包含事件类型');
    assertTrue(headerLine.includes('视图版本') === false, 'CSV表头不应该包含视图版本（版本在meta中）');
    
    console.log(`   CSV导出成功，共 ${lines.length - 1} 条数据，文件名: ${disposition}`);
  }, ['createdViewId', 'createdViewName']);

  await test('16. 更新视图时部分字段为空是允许的 (更新时字段为可选)', async () => {
    const updateRes = await makeRequest('PUT', `/audit/views/${createdViewId}`, {
      description: '更新描述'
    }, '1');

    assertEqual(updateRes.status, 200, `更新应该成功，实际: ${updateRes.status}`);
    assertEqual(updateRes.data.view.version, 3, '版本应该递增到 3');
    assertEqual(updateRes.data.view.equipment_id, testEquipmentId, '设备ID应该保持不变');
    
    console.log(`   部分字段更新成功，版本: ${updateRes.data.view.version}`);
  }, ['createdViewId', 'testEquipmentId']);

  await test('17. 普通用户创建视图 - 权限拒绝并记录日志', async () => {
    const createRes = await makeRequest('POST', '/audit/views', {
      name: `普通用户视图_${Date.now()}`,
      export_format: 'json',
      equipment_id: testEquipmentId,
      start_date: '2026-01-01',
      end_date: '2026-12-31',
      event_types: ['borrow_created']
    }, '2');

    assertEqual(createRes.status, 403, `普通用户创建应该被拒绝，实际: ${createRes.status}`);
    assertEqual(createRes.data.code, 'ADMIN_REQUIRED', '错误码应该是 ADMIN_REQUIRED');
    
    const logsRes = await makeRequest('GET', '/audit/logs?action=UNAUTHORIZED_ACCESS_ATTEMPT', null, '1');
    const unauthorizedLogs = logsRes.data.logs.filter(l => 
      l.action === 'UNAUTHORIZED_ACCESS_ATTEMPT' && l.resource_type === 'audit_view'
    );
    assertTrue(unauthorizedLogs.length > 0, '应该记录越权访问日志');
    
    console.log(`   普通用户创建被正确拒绝，审计日志已记录`);
  }, ['testEquipmentId']);

  await test('18. 重名冲突 - 应该返回 409', async () => {
    const createRes = await makeRequest('POST', '/audit/views', {
      name: createdViewName,
      export_format: 'json',
      equipment_id: testEquipmentId,
      start_date: '2026-01-01',
      end_date: '2026-12-31',
      event_types: ['borrow_created']
    }, '1');

    assertEqual(createRes.status, 409, `重名应该返回 409，实际: ${createRes.status}`);
    assertEqual(createRes.data.code, 'VIEW_NAME_DUPLICATE', '错误码应该是 VIEW_NAME_DUPLICATE');
    assertTrue(createRes.data.error.includes(createdViewName), '错误信息应该包含视图名称');
    
    console.log(`   重名冲突被正确拦截`);
  }, ['createdViewName', 'testEquipmentId']);

  await test('19. 删除视图 - 应该成功', async () => {
    const deleteRes = await makeRequest('DELETE', `/audit/views/${createdViewId}`, null, '1');

    assertEqual(deleteRes.status, 200, `删除应该成功，实际: ${deleteRes.status}`);
    
    const viewCountAfter = await getViewCount();
    assertEqual(viewCountAfter, viewCountBefore, 
      `视图应该被删除，删除前: ${viewCountBefore + 1}, 删除后: ${viewCountAfter}`);
    
    console.log(`   视图删除成功`);
  }, ['createdViewId']);

  console.log('\n' + '='.repeat(80));
  console.log('📊 测试结果汇总');
  console.log('='.repeat(80));
  console.log(`   ✅ 通过: ${passed}`);
  console.log(`   ❌ 失败: ${failed}`);
  console.log(`   📈 总计: ${passed + failed}`);
  console.log('='.repeat(80));

  console.log('\n✅ 验证完成:');
  console.log('   - 缺设备ID: 400 错误，未落库');
  console.log('   - 缺开始日期: 400 错误，未落库');
  console.log('   - 缺结束日期: 400 错误，未落库');
  console.log('   - 缺事件类型: 400 错误，未落库');
  console.log('   - 缺导出格式: 400 错误，未落库');
  console.log('   - 原始Bug场景(只传name+export_format): 400 错误，返回4项详细错误');
  console.log('   - 完整视图: 可正常创建、导出JSON/CSV、版本递增');
  console.log('   - 更新时字段: 可选，不要求所有字段');
  console.log('   - 权限控制: 普通用户被拒绝并记录审计日志');
  console.log('   - 重名冲突: 返回 409 VIEW_NAME_DUPLICATE');
  console.log('   - 错误响应: 包含明确的缺失字段提示，管理员可快速定位问题');

  if (failed > 0) {
    console.log('\n⚠️  有测试失败！');
    process.exit(1);
  } else {
    console.log('\n🎉 所有回归测试通过！');
    process.exit(0);
  }
}

runTests().catch(e => {
  console.error('\n❌ 测试执行失败:', e.message);
  console.error(e.stack);
  process.exit(1);
});
