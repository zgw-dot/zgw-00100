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

async function getViewCount() {
  const res = await makeRequest('GET', '/audit/views', null, '1');
  return res.status === 200 && res.data && res.data.views ? res.data.views.length : 0;
}

const README_CREATE_EXAMPLE = {
  name: '每周设备审计',
  description: '每周一导出的全量审计数据',
  equipment_id: 1,
  start_date: '2026-06-01',
  end_date: '2026-06-30',
  event_types: ['borrow_created', 'borrow_approved', 'borrow_conflict_blocked'],
  export_format: 'json'
};

const README_CONFLICT_EXAMPLE = {
  name: '冲突拦截审计',
  description: '每周审计所有被拦截的借用和维修申请',
  equipment_id: 1,
  start_date: '2026-06-01',
  end_date: '2026-06-30',
  event_types: ['borrow_conflict_blocked', 'maintenance_conflict_blocked'],
  export_format: 'json'
};

const README_OLD_BAD_EXAMPLE = {
  name: '冲突拦截审计',
  event_types: ['borrow_conflict_blocked', 'maintenance_conflict_blocked'],
  export_format: 'json'
};

async function runTests() {
  console.log('='.repeat(80));
  console.log('📊 README 审计视图文档一致性 - 回归测试');
  console.log('='.repeat(80));
  console.log('验证: README 文档中的示例与实际接口行为一致');
  console.log('='.repeat(80));

  await waitForServer();

  await test('0. 初始化 - 确保测试设备存在', async () => {
    const equipmentRes = await makeRequest('GET', '/equipment/1', null, '1');
    if (equipmentRes.status === 404) {
      const createRes = await makeRequest('POST', '/equipment', {
        device_code: `README-TEST-${Date.now()}`,
        name: 'README文档测试设备',
        model: 'README-TEST-MODEL',
        category: '测试设备',
        location: '测试实验室'
      }, '1');
      testEquipmentId = createRes.data.equipment.id;
    } else {
      testEquipmentId = 1;
    }
    console.log(`   使用设备ID: ${testEquipmentId}`);
  });

  const viewCountBefore = await getViewCount();
  console.log(`\n📊 测试前视图数量: ${viewCountBefore}`);

  await test('1. README创建视图示例 - 应该成功 (完整字段)', async () => {
    const testData = { ...README_CREATE_EXAMPLE, equipment_id: testEquipmentId };
    testData.name = `${testData.name}_${Date.now()}`;
    
    const createRes = await makeRequest('POST', '/audit/views', testData, '1');

    assertEqual(createRes.status, 201, 
      `README创建视图示例应该返回 201，实际: ${createRes.status}, 响应: ${JSON.stringify(createRes.data)}`);
    assertNotNull(createRes.data.view, '应该返回 view 对象');
    assertEqual(createRes.data.view.name, testData.name, '视图名称应该匹配');
    assertEqual(createRes.data.view.equipment_id, testEquipmentId, '设备ID应该匹配');
    assertEqual(createRes.data.view.export_format, 'json', '导出格式应该匹配');
    assertEqual(createRes.data.view.version, 1, '版本应该是 1');
    
    console.log(`   ✅ README创建视图示例可正常创建视图`);
    console.log(`   视图ID: ${createRes.data.view.id}`);
    
    const viewCountAfter = await getViewCount();
    assertEqual(viewCountAfter, viewCountBefore + 1, '视图应该成功创建');
    
    await makeRequest('DELETE', `/audit/views/${createRes.data.view.id}`, null, '1');
  }, ['testEquipmentId']);

  await test('2. README冲突拦截视图示例 - 应该成功 (完整字段)', async () => {
    const testData = { ...README_CONFLICT_EXAMPLE, equipment_id: testEquipmentId };
    testData.name = `${testData.name}_${Date.now()}`;
    
    const createRes = await makeRequest('POST', '/audit/views', testData, '1');

    assertEqual(createRes.status, 201, 
      `README冲突拦截视图示例应该返回 201，实际: ${createRes.status}, 响应: ${JSON.stringify(createRes.data)}`);
    assertNotNull(createRes.data.view, '应该返回 view 对象');
    assertEqual(createRes.data.view.name, testData.name, '视图名称应该匹配');
    assertEqual(createRes.data.view.event_types.length, 2, '事件类型数量应该是 2');
    assertTrue(createRes.data.view.event_types.includes('borrow_conflict_blocked'), 
      '应该包含 borrow_conflict_blocked');
    assertTrue(createRes.data.view.event_types.includes('maintenance_conflict_blocked'), 
      '应该包含 maintenance_conflict_blocked');
    
    console.log(`   ✅ README冲突拦截视图示例可正常创建视图`);
    console.log(`   视图ID: ${createRes.data.view.id}`);
    
    await makeRequest('DELETE', `/audit/views/${createRes.data.view.id}`, null, '1');
  }, ['testEquipmentId']);

  await test('3. 修复前的冲突拦截示例(缺设备和时间) - 应该返回 400 且不落库', async () => {
    const testData = { ...README_OLD_BAD_EXAMPLE };
    testData.name = `${testData.name}_old_${Date.now()}`;
    
    const createRes = await makeRequest('POST', '/audit/views', testData, '1');

    assertEqual(createRes.status, 400, 
      `缺少字段的示例应该返回 400，实际: ${createRes.status}`);
    assertEqual(createRes.data.code, 'INVALID_VIEW_PARAMS', '错误码应该是 INVALID_VIEW_PARAMS');
    assertNotNull(createRes.data.details, '应该返回 details 数组');
    
    const expectedErrors = ['设备ID不能为空', '开始日期不能为空', '结束日期不能为空'];
    for (const expected of expectedErrors) {
      assertTrue(createRes.data.details.some(e => e.includes(expected)), 
        `错误信息应该包含"${expected}"，实际错误: ${JSON.stringify(createRes.data.details)}`);
    }
    
    console.log(`   ✅ 缺字段的旧示例被正确拦截，返回 ${expectedErrors.length} 个错误`);
    console.log(`   错误信息: ${createRes.data.details.join('; ')}`);
    
    const viewCountAfter = await getViewCount();
    assertEqual(viewCountAfter, viewCountBefore, 
      `视图不应该被创建，测试前: ${viewCountBefore}, 测试后: ${viewCountAfter}`);
  }, ['testEquipmentId']);

  await test('4. 只传name和export_format - 应该返回400且清晰指出缺什么', async () => {
    const createRes = await makeRequest('POST', '/audit/views', {
      name: `测试缺字段_${Date.now()}`,
      export_format: 'json'
    }, '1');

    assertEqual(createRes.status, 400, `只传name和export_format应该返回 400`);
    assertEqual(createRes.data.code, 'INVALID_VIEW_PARAMS', '错误码应该是 INVALID_VIEW_PARAMS');
    
    const expectedErrors = ['设备ID不能为空', '开始日期不能为空', '结束日期不能为空', '事件类型不能为空'];
    for (const expected of expectedErrors) {
      assertTrue(createRes.data.details.some(e => e.includes(expected)), 
        `错误信息应该包含"${expected}"，实际错误: ${JSON.stringify(createRes.data.details)}`);
    }
    
    console.log(`   ✅ 返回 ${createRes.data.details.length} 个清晰的错误提示`);
    for (const err of createRes.data.details) {
      console.log(`      • ${err}`);
    }
    
    const viewCountAfter = await getViewCount();
    assertEqual(viewCountAfter, viewCountBefore, '视图不应该被创建');
  }, ['testEquipmentId']);

  let createdViewId = null;
  let createdViewName = null;

  await test('5. 完整流程: 创建视图 -> 导出JSON -> 导出CSV -> 删除', async () => {
    createdViewName = `README完整测试_${Date.now()}`;
    const createData = {
      name: createdViewName,
      description: 'README完整流程测试',
      equipment_id: testEquipmentId,
      start_date: '2026-01-01',
      end_date: '2026-12-31',
      event_types: ['borrow_created', 'borrow_approved', 'borrow_conflict_blocked'],
      export_format: 'json'
    };
    
    const createRes = await makeRequest('POST', '/audit/views', createData, '1');
    assertEqual(createRes.status, 201, '创建视图应该成功');
    createdViewId = createRes.data.view.id;
    console.log(`   步骤1: 视图创建成功，ID=${createdViewId}, 版本=${createRes.data.view.version}`);

    const jsonExportRes = await makeRequest('GET', `/audit/export/timeline?view_id=${createdViewId}`, null, '1');
    assertEqual(jsonExportRes.status, 200, 'JSON导出应该成功');
    const jsonData = typeof jsonExportRes.data === 'string' ? JSON.parse(jsonExportRes.data) : jsonExportRes.data;
    assertNotNull(jsonData.meta, 'JSON应该包含meta');
    assertEqual(jsonData.meta.view_name, createdViewName, 'meta应该包含view_name');
    assertEqual(jsonData.meta.view_id, createdViewId, 'meta应该包含view_id');
    assertEqual(jsonData.meta.view_version, 1, 'meta应该包含view_version=1');
    assertNotNull(jsonData.meta.exported_by, 'meta应该包含exported_by');
    console.log(`   步骤2: JSON导出成功，元数据包含视图信息`);

    const updateRes = await makeRequest('PUT', `/audit/views/${createdViewId}`, {
      export_format: 'csv'
    }, '1');
    assertEqual(updateRes.status, 200, '更新导出格式应该成功');
    assertEqual(updateRes.data.view.version, 2, '版本应该递增到2');
    console.log(`   步骤3: 更新导出格式为CSV，版本递增到2`);

    const csvExportRes = await makeRequest('GET', `/audit/export/timeline?view_id=${createdViewId}`, null, '1');
    assertEqual(csvExportRes.status, 200, 'CSV导出应该成功');
    assertTrue(csvExportRes.headers['content-type'].includes('text/csv'), 'Content-Type应该是text/csv');
    assertTrue(csvExportRes.headers['content-disposition'].includes('timeline_view_'), '文件名应该包含视图标识');
    assertTrue(csvExportRes.rawBody.startsWith('\uFEFF'), 'CSV应该包含UTF-8 BOM');
    console.log(`   步骤4: CSV导出成功，文件名包含视图标识`);

    const deleteRes = await makeRequest('DELETE', `/audit/views/${createdViewId}`, null, '1');
    assertEqual(deleteRes.status, 200, '删除视图应该成功');
    console.log(`   步骤5: 视图删除成功`);

    const exportAfterDelete = await makeRequest('GET', `/audit/export/timeline?view_id=${createdViewId}`, null, '1');
    assertEqual(exportAfterDelete.status, 404, '删除后导出应该返回404');
    assertEqual(exportAfterDelete.data.code, 'VIEW_NOT_FOUND', '错误码应该是VIEW_NOT_FOUND');
    console.log(`   步骤6: 删除后无法使用该视图导出`);

    console.log(`   ✅ 完整流程测试通过`);
  }, ['testEquipmentId']);

  await test('6. 管理员按README错误示例操作时，错误响应能指出缺失字段', async () => {
    const createRes = await makeRequest('POST', '/audit/views', {
      name: `管理员测试_${Date.now()}`,
      description: '管理员按照旧文档操作',
      event_types: ['borrow_conflict_blocked'],
      export_format: 'json'
    }, '1');

    assertEqual(createRes.status, 400, '缺设备和时间应该返回400');
    
    const missingEquipment = createRes.data.details.some(e => e.includes('设备ID') && e.includes('不能为空'));
    const missingStartDate = createRes.data.details.some(e => e.includes('开始日期') && e.includes('不能为空'));
    const missingEndDate = createRes.data.details.some(e => e.includes('结束日期') && e.includes('不能为空'));
    
    assertTrue(missingEquipment, '应该指出缺设备ID');
    assertTrue(missingStartDate, '应该指出缺开始日期');
    assertTrue(missingEndDate, '应该指出缺结束日期');
    
    console.log(`   ✅ 管理员能从错误响应中清楚知道缺了什么:`);
    for (const err of createRes.data.details) {
      console.log(`      • ${err}`);
    }
    
    const viewCountAfter = await getViewCount();
    assertEqual(viewCountAfter, viewCountBefore, '视图不应该被创建');
  }, ['testEquipmentId']);

  await test('7. 更新视图时部分字段可选 - 符合README说明', async () => {
    const viewName = `更新测试_${Date.now()}`;
    const createRes = await makeRequest('POST', '/audit/views', {
      name: viewName,
      equipment_id: testEquipmentId,
      start_date: '2026-01-01',
      end_date: '2026-12-31',
      event_types: ['borrow_created'],
      export_format: 'json'
    }, '1');
    
    const viewId = createRes.data.view.id;
    
    const updateRes = await makeRequest('PUT', `/audit/views/${viewId}`, {
      description: '只更新描述，其他字段不变'
    }, '1');
    
    assertEqual(updateRes.status, 200, '只更新描述应该成功');
    assertEqual(updateRes.data.view.equipment_id, testEquipmentId, '设备ID应该保持不变');
    assertEqual(updateRes.data.view.start_date, '2026-01-01', '开始日期应该保持不变');
    assertEqual(updateRes.data.view.end_date, '2026-12-31', '结束日期应该保持不变');
    assertEqual(updateRes.data.view.event_types.length, 1, '事件类型应该保持不变');
    assertEqual(updateRes.data.view.version, 2, '版本应该递增');
    
    console.log(`   ✅ 更新视图时部分字段可选，未提供的字段保持原值`);
    
    await makeRequest('DELETE', `/audit/views/${viewId}`, null, '1');
  }, ['testEquipmentId']);

  await test('8. 普通用户按README示例操作 - 权限拒绝并记录日志', async () => {
    const createRes = await makeRequest('POST', '/audit/views', {
      name: `普通用户测试_${Date.now()}`,
      equipment_id: testEquipmentId,
      start_date: '2026-01-01',
      end_date: '2026-12-31',
      event_types: ['borrow_created'],
      export_format: 'json'
    }, '2');

    assertEqual(createRes.status, 403, '普通用户创建应该被拒绝');
    assertEqual(createRes.data.code, 'ADMIN_REQUIRED', '错误码应该是ADMIN_REQUIRED');
    
    const logsRes = await makeRequest('GET', '/audit/logs?action=UNAUTHORIZED_ACCESS_ATTEMPT', null, '1');
    const unauthorizedLogs = logsRes.data.logs.filter(l => 
      l.action === 'UNAUTHORIZED_ACCESS_ATTEMPT' && l.resource_type === 'audit_view'
    );
    assertTrue(unauthorizedLogs.length > 0, '应该记录越权访问审计日志');
    
    console.log(`   ✅ 普通用户被拒绝，审计日志已记录`);
    
    const viewCountAfter = await getViewCount();
    assertEqual(viewCountAfter, viewCountBefore, '视图不应该被创建');
  }, ['testEquipmentId']);

  await test('9. README必填标记与实际校验一致 - 设备必填', async () => {
    const createRes = await makeRequest('POST', '/audit/views', {
      name: `测试设备必填_${Date.now()}`,
      start_date: '2026-01-01',
      end_date: '2026-12-31',
      event_types: ['borrow_created'],
      export_format: 'json'
    }, '1');

    assertEqual(createRes.status, 400, '缺设备应该返回400');
    assertTrue(createRes.data.details.some(e => e.includes('设备ID不能为空')), 
      '错误信息应该包含设备ID必填提示');
    console.log(`   ✅ 设备必填标记与实际校验一致`);
  }, ['testEquipmentId']);

  await test('10. README必填标记与实际校验一致 - 事件类型必填且不能为空数组', async () => {
    const emptyArrayRes = await makeRequest('POST', '/audit/views', {
      name: `测试空数组_${Date.now()}`,
      equipment_id: testEquipmentId,
      start_date: '2026-01-01',
      end_date: '2026-12-31',
      event_types: [],
      export_format: 'json'
    }, '1');

    assertEqual(emptyArrayRes.status, 400, '空数组应该返回400');
    assertTrue(emptyArrayRes.data.details.some(e => e.includes('事件类型数组不能为空')), 
      '错误信息应该包含事件类型数组不能为空提示');
    console.log(`   ✅ 事件类型必填且不能为空数组，与README说明一致`);
  }, ['testEquipmentId']);

  console.log('\n' + '='.repeat(80));
  console.log('📊 测试结果汇总');
  console.log('='.repeat(80));
  console.log(`   ✅ 通过: ${passed}`);
  console.log(`   ❌ 失败: ${failed}`);
  console.log(`   📈 总计: ${passed + failed}`);
  console.log('='.repeat(80));

  console.log('\n✅ README文档一致性验证完成:');
  console.log('   - README创建视图示例: 可成功创建');
  console.log('   - README冲突拦截示例: 可成功创建（已补全必填字段）');
  console.log('   - 修复前的缺字段示例: 返回400，清晰列出缺失字段');
  console.log('   - 完整流程: 创建→导出JSON→导出CSV→删除，全部正常');
  console.log('   - 管理员按错误示例操作: 错误响应能指出缺什么');
  console.log('   - 更新视图: 部分字段可选，符合README说明');
  console.log('   - 普通用户: 权限拒绝并记录审计日志');
  console.log('   - 必填标记: 设备/时间/事件类型均为必填，与README一致');

  if (failed > 0) {
    console.log('\n⚠️  有测试失败！');
    process.exit(1);
  } else {
    console.log('\n🎉 所有README文档一致性测试通过！');
    process.exit(0);
  }
}

runTests().catch(e => {
  console.error('\n❌ 测试执行失败:', e.message);
  console.error(e.stack);
  process.exit(1);
});
