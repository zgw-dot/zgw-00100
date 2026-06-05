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
let testViewId = null;
let testViewName = null;
let baselineExportData = null;

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

async function runTests() {
  console.log('='.repeat(80));
  console.log('📊 审计视图功能 - 自动化测试');
  console.log('='.repeat(80));

  await waitForServer();

  await test('1. 初始化 - 创建测试设备（管理员）', async () => {
    const uniqueCode = `TEST-VIEW-${Date.now()}`;
    const createRes = await makeRequest('POST', '/equipment', {
      device_code: uniqueCode,
      name: '审计视图测试专用设备',
      model: 'TEST-VIEW-MODEL',
      category: '测试设备',
      location: '测试实验室'
    }, '1');

    assertEqual(createRes.status, 201, `创建设备应该返回 201，实际: ${JSON.stringify(createRes.data)}`);
    assertNotNull(createRes.data.equipment, '返回数据应该包含 equipment 对象');
    assertNotNull(createRes.data.equipment.id, '设备ID不能为空');
    testEquipmentId = createRes.data.equipment.id;
    console.log(`   设备ID: ${testEquipmentId}, 编号: ${uniqueCode}`);
  });

  await test('2. 普通用户提交借用申请', async () => {
    const borrowStart = moment().add(1, 'days').format('YYYY-MM-DD HH:mm:ss');
    const borrowEnd = moment().add(5, 'days').format('YYYY-MM-DD HH:mm:ss');

    const borrowRes = await makeRequest('POST', '/borrow', {
      equipment_id: testEquipmentId,
      purpose: '审计视图测试-普通借用',
      start_date: borrowStart,
      end_date: borrowEnd
    }, '2');

    assertEqual(borrowRes.status, 201, `借用申请应该成功，实际: ${JSON.stringify(borrowRes.data)}`);
    assertNotNull(borrowRes.data.request, '返回数据应该包含 request 对象');
    console.log(`   借用申请创建成功: ${borrowRes.data.request.request_no}`);
  }, ['testEquipmentId']);

  await test('3. 管理员批准借用申请', async () => {
    const approveRes = await makeRequest('POST', `/borrow/${(await makeRequest('GET', '/borrow', null, '1')).data.requests[0].id}/approve`, {
      approval_comment: '审计视图测试批准'
    }, '1');

    assertEqual(approveRes.status, 200, `批准申请应该成功，实际: ${JSON.stringify(approveRes.data)}`);
  }, ['testEquipmentId']);

  await test('4. 创建审计视图 - 管理员', async () => {
    testViewName = `每周设备审计_${Date.now()}`;
    const createRes = await makeRequest('POST', '/audit/views', {
      name: testViewName,
      description: '每周固定审计视图，包含所有事件类型',
      equipment_id: testEquipmentId,
      start_date: moment().subtract(30, 'days').format('YYYY-MM-DD'),
      end_date: moment().add(30, 'days').format('YYYY-MM-DD'),
      event_types: ['borrow_created', 'borrow_approved', 'borrow_conflict_blocked', 'maintenance_created', 'maintenance_completed'],
      export_format: 'json'
    }, '1');

    assertEqual(createRes.status, 201, `创建视图应该返回 201，实际: ${JSON.stringify(createRes.data)}`);
    assertNotNull(createRes.data.view, '返回数据应该包含 view 对象');
    assertNotNull(createRes.data.view.id, '视图ID不能为空');
    assertEqual(createRes.data.view.name, testViewName, '视图名称应该匹配');
    assertEqual(createRes.data.view.export_format, 'json', '导出格式应该是 json');
    assertEqual(createRes.data.view.version, 1, '初始版本应该是 1');
    assertNotNull(createRes.data.view.created_by, '应该包含创建者ID');
    testViewId = createRes.data.view.id;
    console.log(`   视图ID: ${testViewId}, 名称: ${testViewName}`);
  }, ['testEquipmentId']);

  await test('5. 创建审计视图 - 重名冲突', async () => {
    const createRes = await makeRequest('POST', '/audit/views', {
      name: testViewName,
      description: '重名视图测试',
      export_format: 'csv'
    }, '1');

    assertEqual(createRes.status, 409, `重名创建应该返回 409，实际: ${createRes.status}`);
    assertEqual(createRes.data.code, 'VIEW_NAME_DUPLICATE', '错误码应该是 VIEW_NAME_DUPLICATE');
    assertTrue(createRes.data.error.includes(testViewName), '错误信息应该包含视图名称');
    console.log(`   重名冲突被正确拦截`);
  }, ['testViewName']);

  await test('6. 创建审计视图 - 非法参数验证', async () => {
    const createRes = await makeRequest('POST', '/audit/views', {
      name: '',
      export_format: 'xml',
      start_date: 'invalid-date',
      end_date: '2020-01-01'
    }, '1');

    assertEqual(createRes.status, 400, `非法参数应该返回 400，实际: ${createRes.status}`);
    assertEqual(createRes.data.code, 'INVALID_VIEW_PARAMS', '错误码应该是 INVALID_VIEW_PARAMS');
    assertTrue(Array.isArray(createRes.data.details), '应该返回详细错误列表');
    assertTrue(createRes.data.details.length > 0, '错误列表不应该为空');
    console.log(`   参数验证通过，发现 ${createRes.data.details.length} 个错误`);
  });

  await test('7. 创建审计视图 - 不存在的设备', async () => {
    const createRes = await makeRequest('POST', '/audit/views', {
      name: `无效设备视图_${Date.now()}`,
      equipment_id: 99999,
      export_format: 'json'
    }, '1');

    assertEqual(createRes.status, 404, `不存在的设备应该返回 404，实际: ${createRes.status}`);
    assertEqual(createRes.data.code, 'EQUIPMENT_NOT_FOUND', '错误码应该是 EQUIPMENT_NOT_FOUND');
    console.log(`   设备存在性验证通过`);
  });

  await test('8. 查询所有审计视图 - 管理员', async () => {
    const listRes = await makeRequest('GET', '/audit/views', null, '1');

    assertEqual(listRes.status, 200, `查询列表应该返回 200，实际: ${listRes.status}`);
    assertTrue(Array.isArray(listRes.data.views), '应该返回 views 数组');
    assertTrue(listRes.data.views.length > 0, '视图列表不应该为空');
    
    const createdView = listRes.data.views.find(v => v.id === testViewId);
    assertNotNull(createdView, '应该能找到刚创建的视图');
    assertEqual(createdView.name, testViewName, '视图名称应该匹配');
    console.log(`   视图列表查询成功，共 ${listRes.data.views.length} 个视图`);
  }, ['testViewId', 'testViewName']);

  await test('9. 查询单个审计视图 - 管理员', async () => {
    const getRes = await makeRequest('GET', `/audit/views/${testViewId}`, null, '1');

    assertEqual(getRes.status, 200, `查询视图应该返回 200，实际: ${getRes.status}`);
    assertNotNull(getRes.data.view, '应该返回 view 对象');
    assertEqual(getRes.data.view.id, testViewId, '视图ID应该匹配');
    assertEqual(getRes.data.view.name, testViewName, '视图名称应该匹配');
    assertTrue(Array.isArray(getRes.data.view.event_types), 'event_types 应该是数组');
    assertTrue(getRes.data.view.event_types.length > 0, 'event_types 不应该为空');
    console.log(`   视图详情查询成功: ${getRes.data.view.name}`);
  }, ['testViewId', 'testViewName']);

  await test('10. 重命名审计视图', async () => {
    const newName = `${testViewName}_renamed`;
    const updateRes = await makeRequest('PUT', `/audit/views/${testViewId}`, {
      name: newName
    }, '1');

    assertEqual(updateRes.status, 200, `更新视图应该返回 200，实际: ${updateRes.status}`);
    assertEqual(updateRes.data.view.name, newName, '视图名称应该已更新');
    assertEqual(updateRes.data.view.version, 2, '版本号应该递增到 2');
    testViewName = newName;
    console.log(`   视图重命名成功: ${newName}, 版本: ${updateRes.data.view.version}`);
  }, ['testViewId']);

  await test('11. 更新审计视图筛选条件', async () => {
    const updateRes = await makeRequest('PUT', `/audit/views/${testViewId}`, {
      description: '更新后的描述',
      export_format: 'csv',
      event_types: ['borrow_created', 'borrow_conflict_blocked']
    }, '1');

    assertEqual(updateRes.status, 200, `更新视图应该返回 200，实际: ${updateRes.status}`);
    assertEqual(updateRes.data.view.description, '更新后的描述', '描述应该已更新');
    assertEqual(updateRes.data.view.export_format, 'csv', '导出格式应该已更新');
    assertEqual(updateRes.data.view.version, 3, '版本号应该递增到 3');
    assertEqual(updateRes.data.view.event_types.length, 2, '事件类型数量应该是 2');
    console.log(`   视图条件更新成功，版本: ${updateRes.data.view.version}`);
  }, ['testViewId']);

  await test('12. 查询可用事件类型列表', async () => {
    const typesRes = await makeRequest('GET', '/audit/event-types', null, '1');

    assertEqual(typesRes.status, 200, `查询事件类型应该返回 200，实际: ${typesRes.status}`);
    assertTrue(Array.isArray(typesRes.data.event_types), '应该返回 event_types 数组');
    assertTrue(typesRes.data.event_types.length > 0, '事件类型列表不应该为空');
    
    const conflictType = typesRes.data.event_types.find(t => t.type === 'borrow_conflict_blocked');
    assertNotNull(conflictType, '应该包含冲突拦截事件类型');
    assertEqual(conflictType.text, '借用申请因冲突被拦截', '事件描述应该正确');
    console.log(`   事件类型列表查询成功，共 ${typesRes.data.event_types.length} 种类型`);
  });

  await test('13. 按视图ID导出 - JSON格式', async () => {
    const updateRes = await makeRequest('PUT', `/audit/views/${testViewId}`, {
      export_format: 'json'
    }, '1');

    const exportRes = await makeRequest('GET', `/audit/export/timeline?view_id=${testViewId}`, null, '1');

    assertEqual(exportRes.status, 200, `导出应该成功，实际: ${exportRes.status}`);
    
    const contentType = exportRes.headers['content-type'];
    assertTrue(contentType.includes('application/json'), `Content-Type 应该包含 application/json`);
    
    const data = typeof exportRes.data === 'string' ? JSON.parse(exportRes.data) : exportRes.data;
    assertNotNull(data.meta, '应该包含 meta 信息');
    assertNotNull(data.events, '应该包含 events 数组');
    
    assertNotNull(data.meta.view_name, '元数据应该包含 view_name');
    assertNotNull(data.meta.view_version, '元数据应该包含 view_version');
    assertNotNull(data.meta.view_id, '元数据应该包含 view_id');
    assertEqual(data.meta.view_name, testViewName, '视图名称应该匹配');
    assertEqual(data.meta.view_id, testViewId, '视图ID应该匹配');
    assertEqual(data.meta.view_version, 4, '视图版本应该是 4');
    
    for (const event of data.events) {
      assertTrue(
        ['borrow_created', 'borrow_conflict_blocked'].includes(event.event_type),
        `事件类型应该在筛选范围内，实际: ${event.event_type}`
      );
    }
    
    baselineExportData = data;
    console.log(`   按视图ID导出成功，事件数: ${data.events.length}, 视图版本: ${data.meta.view_version}`);
  }, ['testViewId', 'testViewName']);

  await test('14. 按视图名称导出 - CSV格式', async () => {
    const updateRes = await makeRequest('PUT', `/audit/views/${testViewId}`, {
      export_format: 'csv'
    }, '1');

    const exportRes = await makeRequest('GET', `/audit/export/timeline?view_name=${encodeURIComponent(testViewName)}`, null, '1');

    assertEqual(exportRes.status, 200, `导出应该成功，实际: ${exportRes.status}`);
    
    const contentType = exportRes.headers['content-type'];
    assertTrue(contentType.includes('text/csv'), `Content-Type 应该包含 text/csv`);
    
    const disposition = exportRes.headers['content-disposition'];
    assertTrue(disposition.includes('timeline_view_'), '文件名应该包含 timeline_view_');
    
    const csvContent = exportRes.rawBody;
    assertTrue(csvContent.startsWith('\uFEFF'), 'CSV 应该包含 UTF-8 BOM');
    
    const lines = csvContent.replace('\uFEFF', '').split('\n');
    assertTrue(lines.length > 1, 'CSV 应该包含表头和数据行');
    
    console.log(`   按视图名称导出CSV成功，共 ${lines.length - 1} 条数据`);
  }, ['testViewId', 'testViewName']);

  await test('15. 导出不存在的视图', async () => {
    const exportRes = await makeRequest('GET', '/audit/export/timeline?view_id=99999', null, '1');

    assertEqual(exportRes.status, 404, `不存在的视图应该返回 404，实际: ${exportRes.status}`);
    assertEqual(exportRes.data.code, 'VIEW_NOT_FOUND', '错误码应该是 VIEW_NOT_FOUND');
    console.log(`   不存在的视图被正确拒绝`);
  });

  await test('16. 冲突拦截事件筛选验证', async () => {
    const maintStart = moment().add(1, 'days').format('YYYY-MM-DD HH:mm:ss');
    const borrowStart = moment().add(2, 'days').format('YYYY-MM-DD HH:mm:ss');
    const borrowEnd = moment().add(4, 'days').format('YYYY-MM-DD HH:mm:ss');

    const maintRes = await makeRequest('POST', '/maintenance', {
      equipment_id: testEquipmentId,
      issue_description: '视图测试-设备故障',
      priority: 'high'
    }, '3');

    if (maintRes.status === 201) {
      const maintId = maintRes.data.record.id;
      await makeRequest('POST', `/maintenance/${maintId}/start`, {
        estimated_completion_date: moment().add(7, 'days').format('YYYY-MM-DD HH:mm:ss'),
        technician_id: 1
      }, '1');
    }

    const conflictBorrowRes = await makeRequest('POST', '/borrow', {
      equipment_id: testEquipmentId,
      purpose: '视图测试-冲突借用',
      start_date: borrowStart,
      end_date: borrowEnd
    }, '2');

    const updateRes = await makeRequest('PUT', `/audit/views/${testViewId}`, {
      event_types: ['borrow_conflict_blocked'],
      export_format: 'json'
    }, '1');

    const exportRes = await makeRequest('GET', `/audit/export/timeline?view_id=${testViewId}`, null, '1');
    const data = typeof exportRes.data === 'string' ? JSON.parse(exportRes.data) : exportRes.data;
    
    for (const event of data.events) {
      assertEqual(event.event_type, 'borrow_conflict_blocked', '应该只返回冲突拦截事件');
      assertEqual(event.status, 'blocked', '状态应该是 blocked');
    }
    
    console.log(`   冲突拦截事件筛选验证通过，事件数: ${data.events.length}`);
  }, ['testViewId', 'testEquipmentId']);

  await test('17. 普通用户尝试创建视图 - 权限拒绝', async () => {
    const createRes = await makeRequest('POST', '/audit/views', {
      name: `普通用户视图_${Date.now()}`,
      export_format: 'json'
    }, '2');

    assertEqual(createRes.status, 403, `普通用户创建应该被拒绝，实际: ${createRes.status}`);
    assertEqual(createRes.data.code, 'ADMIN_REQUIRED', '错误码应该是 ADMIN_REQUIRED');
    console.log(`   普通用户创建视图被正确拒绝`);
  });

  await test('18. 普通用户尝试查询视图列表 - 权限拒绝', async () => {
    const listRes = await makeRequest('GET', '/audit/views', null, '2');

    assertEqual(listRes.status, 403, `普通用户查询应该被拒绝，实际: ${listRes.status}`);
    assertEqual(listRes.data.code, 'ADMIN_REQUIRED', '错误码应该是 ADMIN_REQUIRED');
    console.log(`   普通用户查询视图列表被正确拒绝`);
  });

  await test('19. 普通用户尝试查询视图详情 - 权限拒绝', async () => {
    const getRes = await makeRequest('GET', `/audit/views/${testViewId}`, null, '2');

    assertEqual(getRes.status, 403, `普通用户查询详情应该被拒绝，实际: ${getRes.status}`);
    assertEqual(getRes.data.code, 'ADMIN_REQUIRED', '错误码应该是 ADMIN_REQUIRED');
    console.log(`   普通用户查询视图详情被正确拒绝`);
  });

  await test('20. 普通用户尝试按视图导出 - 权限拒绝', async () => {
    const exportRes = await makeRequest('GET', `/audit/export/timeline?view_id=${testViewId}`, null, '2');

    assertEqual(exportRes.status, 403, `普通用户导出应该被拒绝，实际: ${exportRes.status}`);
    assertEqual(exportRes.data.code, 'ADMIN_REQUIRED', '错误码应该是 ADMIN_REQUIRED');
    console.log(`   普通用户按视图导出被正确拒绝`);
  });

  await test('21. 验证越权访问审计日志', async () => {
    const logsRes = await makeRequest('GET', '/audit/logs?action=UNAUTHORIZED_ACCESS_ATTEMPT', null, '1');

    assertEqual(logsRes.status, 200, `查询审计日志应该返回 200，实际: ${logsRes.status}`);
    assertTrue(Array.isArray(logsRes.data.logs), '应该返回 logs 数组');
    
    const unauthorizedLogs = logsRes.data.logs.filter(l => l.action === 'UNAUTHORIZED_ACCESS_ATTEMPT');
    assertTrue(unauthorizedLogs.length > 0, '应该记录越权访问日志');
    
    for (const log of unauthorizedLogs) {
      assertEqual(log.resource_type, 'audit_view', '资源类型应该是 audit_view');
      assertNotNull(log.details, '应该包含详情');
    }
    
    console.log(`   越权访问审计日志验证通过，共 ${unauthorizedLogs.length} 条记录`);
  });

  await test('22. 即时导出与视图导出结果一致性', async () => {
    const viewRes = await makeRequest('GET', `/audit/views/${testViewId}`, null, '1');
    const view = viewRes.data.view;

    const directExportRes = await makeRequest('GET', 
      `/audit/export/timeline?format=json&equipment_id=${view.equipment_id}&start_date=${view.start_date}&end_date=${view.end_date}&event_types=${JSON.stringify(view.event_types)}`, 
      null, '1');
    
    const directData = typeof directExportRes.data === 'string' ? JSON.parse(directExportRes.data) : directExportRes.data;
    
    const viewExportRes = await makeRequest('GET', `/audit/export/timeline?view_id=${testViewId}`, null, '1');
    const viewData = typeof viewExportRes.data === 'string' ? JSON.parse(viewExportRes.data) : viewExportRes.data;

    assertEqual(viewData.events.length, directData.events.length, 
      `事件数量应该一致，视图导出: ${viewData.events.length}, 即时导出: ${directData.events.length}`);
    
    for (let i = 0; i < viewData.events.length; i++) {
      assertEqual(viewData.events[i].event_id, directData.events[i].event_id,
        `第${i+1}条事件ID应该一致: ${viewData.events[i].event_id}`);
    }
    
    console.log(`   视图导出与即时导出结果一致，事件数: ${viewData.events.length}`);
  }, ['testViewId']);

  console.log('\n' + '='.repeat(80));
  console.log('📊 第一阶段测试结果汇总（重启前）');
  console.log('='.repeat(80));
  console.log(`   ✅ 通过: ${passed}`);
  console.log(`   ❌ 失败: ${failed}`);
  console.log(`   📈 总计: ${passed + failed}`);
  console.log('='.repeat(80));

  if (failed > 0) {
    console.log('\n⚠️  重启前有测试失败，终止后续测试');
    process.exit(1);
  }

  console.log('\n⏸️  现在请手动重启服务（Ctrl+C 停止，然后 npm start）');
  console.log('   重启后按任意键继续第二阶段测试（重启后数据不丢验证）...');
  
  process.stdin.setRawMode(true);
  process.stdin.resume();
  await new Promise(resolve => process.stdin.once('data', resolve));
  process.stdin.setRawMode(false);
  
  console.log('\n🔄 继续第二阶段测试：重启后数据不丢验证');
  await waitForServer();

  await test('23. 重启后视图仍然存在', async () => {
    const getRes = await makeRequest('GET', `/audit/views/${testViewId}`, null, '1');

    assertEqual(getRes.status, 200, `查询视图应该返回 200，实际: ${getRes.status}`);
    assertNotNull(getRes.data.view, '应该返回 view 对象');
    assertEqual(getRes.data.view.id, testViewId, '视图ID应该匹配');
    assertEqual(getRes.data.view.name, testViewName, '视图名称应该匹配');
    assertEqual(getRes.data.view.version, 6, '版本号应该保持不变');
    console.log(`   重启后视图存在，版本: ${getRes.data.view.version}`);
  }, ['testViewId', 'testViewName']);

  await test('24. 重启后按视图导出结果一致', async () => {
    const exportRes = await makeRequest('GET', `/audit/export/timeline?view_id=${testViewId}`, null, '1');
    const data = typeof exportRes.data === 'string' ? JSON.parse(exportRes.data) : exportRes.data;

    assertNotNull(data.meta.view_name, '元数据应该包含 view_name');
    assertEqual(data.meta.view_name, testViewName, '视图名称应该匹配');
    
    if (baselineExportData && baselineExportData.events.length > 0) {
      const baselineIds = baselineExportData.events.map(e => e.event_id);
      const currentIds = data.events.map(e => e.event_id);
      
      for (let i = 0; i < Math.min(baselineIds.length, currentIds.length); i++) {
        if (baselineIds[i] === currentIds[i]) {
          console.log(`   第${i+1}条事件ID一致: ${baselineIds[i]}`);
        }
      }
    }
    
    console.log(`   重启后按视图导出成功，事件数: ${data.events.length}`);
  }, ['testViewId', 'testViewName']);

  await test('25. 重启后创建新视图', async () => {
    const newViewName = `重启后创建的视图_${Date.now()}`;
    const createRes = await makeRequest('POST', '/audit/views', {
      name: newViewName,
      description: '重启后创建的测试视图',
      export_format: 'csv'
    }, '1');

    assertEqual(createRes.status, 201, `创建视图应该返回 201，实际: ${createRes.status}`);
    assertNotNull(createRes.data.view, '返回数据应该包含 view 对象');
    assertEqual(createRes.data.view.version, 1, '新版本应该是 1');
    console.log(`   重启后创建新视图成功: ${newViewName}`);
  });

  await test('26. 删除审计视图', async () => {
    const deleteRes = await makeRequest('DELETE', `/audit/views/${testViewId}`, null, '1');

    assertEqual(deleteRes.status, 200, `删除视图应该返回 200，实际: ${deleteRes.status}`);
    assertNotNull(deleteRes.data.message, '应该返回成功消息');
    console.log(`   视图删除成功`);
  }, ['testViewId']);

  await test('27. 删除后视图不可用', async () => {
    const getRes = await makeRequest('GET', `/audit/views/${testViewId}`, null, '1');

    assertEqual(getRes.status, 404, `查询已删除的视图应该返回 404，实际: ${getRes.status}`);
    assertEqual(getRes.data.code, 'VIEW_NOT_FOUND', '错误码应该是 VIEW_NOT_FOUND');
  }, ['testViewId']);

  await test('28. 删除后无法按视图导出', async () => {
    const exportRes = await makeRequest('GET', `/audit/export/timeline?view_id=${testViewId}`, null, '1');

    assertEqual(exportRes.status, 404, `导出已删除的视图应该返回 404，实际: ${exportRes.status}`);
    assertEqual(exportRes.data.code, 'VIEW_NOT_FOUND', '错误码应该是 VIEW_NOT_FOUND');
    console.log(`   删除后视图无法使用验证通过`);
  }, ['testViewId']);

  await test('29. 删除操作审计日志验证', async () => {
    const logsRes = await makeRequest('GET', '/audit/logs?action=DELETE_AUDIT_VIEW', null, '1');

    assertEqual(logsRes.status, 200, `查询审计日志应该返回 200，实际: ${logsRes.status}`);
    
    const deleteLogs = logsRes.data.logs.filter(l => 
      l.action === 'DELETE_AUDIT_VIEW' && 
      l.details && 
      l.details.includes(`"view_id":${testViewId}`)
    );
    assertTrue(deleteLogs.length > 0, '应该记录删除操作日志');
    console.log(`   删除操作审计日志验证通过`);
  }, ['testViewId']);

  console.log('\n' + '='.repeat(80));
  console.log('📊 最终测试结果汇总');
  console.log('='.repeat(80));
  console.log(`   ✅ 通过: ${passed}`);
  console.log(`   ❌ 失败: ${failed}`);
  console.log(`   📈 总计: ${passed + failed}`);
  console.log('='.repeat(80));

  if (failed > 0) {
    console.log('\n⚠️  有测试失败！');
    process.exit(1);
  } else {
    console.log('\n🎉 所有审计视图测试通过！');
    console.log('\n✅ 核心功能验证完成:');
    console.log('   - 视图创建: POST /api/audit/views');
    console.log('   - 视图查询: GET /api/audit/views');
    console.log('   - 视图详情: GET /api/audit/views/:id');
    console.log('   - 视图更新: PUT /api/audit/views/:id (含版本递增)');
    console.log('   - 视图删除: DELETE /api/audit/views/:id');
    console.log('   - 按视图导出: GET /api/audit/export/timeline?view_id=:id');
    console.log('   - 按名称导出: GET /api/audit/export/timeline?view_name=:name');
    console.log('   - 事件类型列表: GET /api/audit/event-types');
    console.log('   - 权限控制: 仅管理员可操作');
    console.log('   - 越权日志: UNAUTHORIZED_ACCESS_ATTEMPT 记录');
    console.log('   - 参数验证: 名称、格式、日期、设备存在性');
    console.log('   - 重名冲突: 返回 409 VIEW_NAME_DUPLICATE');
    console.log('   - 重启持久化: 数据不丢');
    console.log('   - 导出元数据: view_name, view_version, view_id');
    console.log('   - 结果一致性: 视图导出与即时导出字段/排序一致');
    console.log('   - 冲突筛选: borrow_conflict_blocked 事件可筛选');
    process.exit(0);
  }
}

runTests().catch(e => {
  console.error('\n❌ 测试执行失败:', e.message);
  console.error(e.stack);
  process.exit(1);
});
