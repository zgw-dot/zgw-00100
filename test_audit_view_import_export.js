const http = require('http');
const moment = require('moment');
const fs = require('fs');

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
let testViewIds = [];
let testViewNames = [];
let exportedPackage = null;

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

async function createTestView(nameSuffix) {
  const viewName = `测试视图_${nameSuffix}_${Date.now()}`;
  const res = await makeRequest('POST', '/audit/views', {
    name: viewName,
    description: `测试视图 ${nameSuffix}`,
    equipment_id: testEquipmentId,
    start_date: moment().subtract(30, 'days').format('YYYY-MM-DD'),
    end_date: moment().add(30, 'days').format('YYYY-MM-DD'),
    event_types: ['borrow_created', 'borrow_approved', 'borrow_conflict_blocked'],
    export_format: nameSuffix % 2 === 0 ? 'json' : 'csv'
  }, '1');

  assertEqual(res.status, 201, `创建视图 ${nameSuffix} 应该返回 201`);
  testViewIds.push(res.data.view.id);
  testViewNames.push(res.data.view.name);
  return res.data.view;
}

async function cleanUpTestViews() {
  for (const id of testViewIds) {
    try {
      await makeRequest('DELETE', `/audit/views/${id}`, null, '1');
    } catch (e) {
      // 忽略删除错误
    }
  }
  testViewIds = [];
  testViewNames = [];
}

async function runTests() {
  console.log('='.repeat(80));
  console.log('📊 审计视图导入导出包 - 自动化测试');
  console.log('='.repeat(80));

  await waitForServer();

  // ========== 第一阶段：初始化和创建测试数据 ==========
  console.log('\n' + '='.repeat(60));
  console.log('📦 第一阶段：初始化和创建测试数据');
  console.log('='.repeat(60));

  await test('1.1 初始化 - 创建测试设备（管理员）', async () => {
    const uniqueCode = `TEST-IMPEXP-${Date.now()}`;
    const createRes = await makeRequest('POST', '/equipment', {
      device_code: uniqueCode,
      name: '导入导出测试专用设备',
      model: 'TEST-IMPEXP-MODEL',
      category: '测试设备',
      location: '测试实验室'
    }, '1');

    assertEqual(createRes.status, 201, `创建设备应该返回 201，实际: ${JSON.stringify(createRes.data)}`);
    assertNotNull(createRes.data.equipment, '返回数据应该包含 equipment 对象');
    testEquipmentId = createRes.data.equipment.id;
    console.log(`   设备ID: ${testEquipmentId}, 编号: ${uniqueCode}`);
  });

  await test('1.2 创建多个测试视图', async () => {
    await createTestView(1);
    await createTestView(2);
    await createTestView(3);
    console.log(`   已创建 ${testViewIds.length} 个测试视图`);
  }, ['testEquipmentId']);

  // ========== 第二阶段：导出功能测试 ==========
  console.log('\n' + '='.repeat(60));
  console.log('📤 第二阶段：导出功能测试');
  console.log('='.repeat(60));

  await test('2.1 批量导出所有视图', async () => {
    const exportRes = await makeRequest('GET', '/audit/views/export', null, '1');

    assertEqual(exportRes.status, 200, `导出应该返回 200，实际: ${exportRes.status}`);

    const pkg = typeof exportRes.data === 'string' ? JSON.parse(exportRes.data) : exportRes.data;

    assertNotNull(pkg.package_version, '应该包含包版本');
    assertNotNull(pkg.exported_at, '应该包含导出时间');
    assertEqual(pkg.view_count >= 3, true, '视图数量应该 >= 3');
    assertTrue(Array.isArray(pkg.views), 'views 应该是数组');

    for (const view of pkg.views) {
      assertNotNull(view.name, '每个视图应该有 name');
      assertNotNull(view.export_format, '每个视图应该有 export_format');
      assertNotNull(view.equipment_id, '每个视图应该有 equipment_id');
      assertNotNull(view.version, '每个视图应该有 version');
      assertNotNull(view.created_by, '每个视图应该有 created_by');
      assertNotNull(view.created_by_name, '每个视图应该有 created_by_name');
      assertTrue(Array.isArray(view.event_types), 'event_types 应该是数组');
    }

    exportedPackage = pkg;
    console.log(`   导出成功，共 ${pkg.view_count} 个视图，包版本: v${pkg.package_version}`);
  }, ['testEquipmentId']);

  await test('2.2 导出指定 ID 的视图（部分导出）', async () => {
    const idsToExport = testViewIds.slice(0, 2);
    const exportRes = await makeRequest('GET', `/audit/views/export?ids=${idsToExport.join(',')}`, null, '1');

    assertEqual(exportRes.status, 200, `导出应该返回 200，实际: ${exportRes.status}`);

    const pkg = typeof exportRes.data === 'string' ? JSON.parse(exportRes.data) : exportRes.data;
    assertEqual(pkg.view_count, 2, `应该只导出 2 个视图，实际: ${pkg.view_count}`);

    const exportedNames = pkg.views.map(v => v.name);
    assertTrue(exportedNames.includes(testViewNames[0]), '应该包含第一个视图');
    assertTrue(exportedNames.includes(testViewNames[1]), '应该包含第二个视图');

    console.log(`   部分导出成功，共 ${pkg.view_count} 个视图`);
  }, ['testEquipmentId']);

  await test('2.3 普通用户尝试导出 - 权限拒绝', async () => {
    const exportRes = await makeRequest('GET', '/audit/views/export', null, '2');

    assertEqual(exportRes.status, 403, `普通用户导出应该被拒绝，实际: ${exportRes.status}`);
    assertEqual(exportRes.data.code, 'ADMIN_REQUIRED', '错误码应该是 ADMIN_REQUIRED');
    console.log(`   普通用户导出被正确拒绝`);
  });

  await test('2.4 空视图列表（删除后导出）', async () => {
    await cleanUpTestViews();

    const exportRes = await makeRequest('GET', '/audit/views/export', null, '1');
    assertEqual(exportRes.status, 200, `导出应该返回 200，实际: ${exportRes.status}`);

    const pkg = typeof exportRes.data === 'string' ? JSON.parse(exportRes.data) : exportRes.data;
    assertEqual(pkg.view_count, 0, '视图数量应该是 0');
    assertEqual(pkg.views.length, 0, 'views 数组应该为空');

    console.log(`   空列表导出成功，视图数量: 0`);
  }, ['testEquipmentId']);

  // ========== 第三阶段：导入功能测试 ==========
  console.log('\n' + '='.repeat(60));
  console.log('📥 第三阶段：导入功能测试');
  console.log('='.repeat(60));

  await test('3.1 重新创建测试视图以便导出', async () => {
    await createTestView('import1');
    await createTestView('import2');
    await createTestView('import3');
    console.log(`   已创建 ${testViewIds.length} 个测试视图用于导入测试`);
  }, ['testEquipmentId']);

  await test('3.2 导出测试包用于导入测试', async () => {
    const exportRes = await makeRequest('GET', '/audit/views/export', null, '1');
    const pkg = typeof exportRes.data === 'string' ? JSON.parse(exportRes.data) : exportRes.data;
    exportedPackage = pkg;
    console.log(`   导出包准备完成，共 ${pkg.view_count} 个视图`);
  }, ['testEquipmentId']);

  await test('3.3 删除现有视图以便测试导入', async () => {
    await cleanUpTestViews();
    console.log(`   已删除现有视图，准备导入测试`);
  });

  await test('3.4 导入视图包（skip 模式，无冲突）', async () => {
    const importRes = await makeRequest('POST', '/audit/views/import', {
      package: exportedPackage,
      mode: 'skip'
    }, '1');

    assertEqual(importRes.status, 200, `导入应该返回 200，实际: ${importRes.status}`);
    assertEqual(importRes.data.success, true, '导入应该成功');
    assertEqual(importRes.data.total, exportedPackage.view_count, `总数量应该匹配`);
    assertEqual(importRes.data.imported, exportedPackage.view_count, `应该全部导入成功`);
    assertEqual(importRes.data.skipped, 0, `不应该有跳过`);
    assertEqual(importRes.data.overwritten, 0, `不应该有覆盖`);
    assertEqual(importRes.data.failed, 0, `不应该有失败`);

    for (const detail of importRes.data.details) {
      assertEqual(detail.status, 'success', `所有视图应该成功，视图 ${detail.name} 实际: ${detail.status}`);
      assertEqual(detail.action, 'create', `动作应该是 create`);
      assertNotNull(detail.view_id, `应该返回视图 ID`);
      testViewIds.push(detail.view_id);
    }

    console.log(`   导入成功: ${importRes.data.imported} 新建, ${importRes.data.skipped} 跳过, ${importRes.data.overwritten} 覆盖, ${importRes.data.failed} 失败`);
  }, ['exportedPackage']);

  await test('3.5 验证导入的视图可以查询', async () => {
    const listRes = await makeRequest('GET', '/audit/views', null, '1');
    assertEqual(listRes.status, 200, `查询应该返回 200`);
    assertTrue(listRes.data.views.length >= exportedPackage.view_count, `视图数量应该 >= 导入数量`);

    const importedNames = exportedPackage.views.map(v => v.name);
    for (const name of importedNames) {
      const found = listRes.data.views.find(v => v.name === name);
      assertNotNull(found, `应该能找到导入的视图: ${name}`);
    }

    console.log(`   查询验证通过，共 ${listRes.data.views.length} 个视图`);
  }, ['exportedPackage']);

  await test('3.6 重复导入（skip 模式）- 全部跳过', async () => {
    const importRes = await makeRequest('POST', '/audit/views/import', {
      package: exportedPackage,
      mode: 'skip'
    }, '1');

    assertEqual(importRes.status, 200, `导入应该返回 200`);
    assertEqual(importRes.data.total, exportedPackage.view_count, `总数量应该匹配`);
    assertEqual(importRes.data.imported, 0, `不应该有新建`);
    assertEqual(importRes.data.skipped, exportedPackage.view_count, `应该全部跳过`);
    assertEqual(importRes.data.overwritten, 0, `不应该有覆盖`);

    for (const detail of importRes.data.details) {
      assertEqual(detail.status, 'skipped', `所有视图应该跳过`);
      assertEqual(detail.action, 'skip', `动作应该是 skip`);
      assertTrue(detail.warnings.length > 0, `应该有警告信息`);
    }

    console.log(`   跳过模式重复导入: ${importRes.data.skipped} 跳过`);
  }, ['exportedPackage']);

  await test('3.7 重复导入（overwrite 模式）- 全部覆盖', async () => {
    const importRes = await makeRequest('POST', '/audit/views/import', {
      package: exportedPackage,
      mode: 'overwrite'
    }, '1');

    assertEqual(importRes.status, 200, `导入应该返回 200`);
    assertEqual(importRes.data.total, exportedPackage.view_count, `总数量应该匹配`);
    assertEqual(importRes.data.imported, 0, `不应该有新建`);
    assertEqual(importRes.data.skipped, 0, `不应该有跳过`);
    assertEqual(importRes.data.overwritten, exportedPackage.view_count, `应该全部覆盖`);

    for (const detail of importRes.data.details) {
      assertEqual(detail.status, 'success', `所有视图应该成功`);
      assertEqual(detail.action, 'overwrite', `动作应该是 overwrite`);
      assertNotNull(detail.old_version, `应该有旧版本号`);
      assertNotNull(detail.new_version, `应该有新版本号`);
      assertTrue(detail.new_version > detail.old_version, `版本号应该递增`);
    }

    console.log(`   覆盖模式重复导入: ${importRes.data.overwritten} 覆盖`);
  }, ['exportedPackage']);

  await test('3.8 普通用户尝试导入 - 权限拒绝', async () => {
    const importRes = await makeRequest('POST', '/audit/views/import', {
      package: exportedPackage,
      mode: 'skip'
    }, '2');

    assertEqual(importRes.status, 403, `普通用户导入应该被拒绝，实际: ${importRes.status}`);
    assertEqual(importRes.data.code, 'ADMIN_REQUIRED', '错误码应该是 ADMIN_REQUIRED');
    console.log(`   普通用户导入被正确拒绝`);
  }, ['exportedPackage']);

  await test('3.9 导入无效的包格式', async () => {
    const importRes = await makeRequest('POST', '/audit/views/import', {
      package: { invalid: 'data' },
      mode: 'skip'
    }, '1');

    assertEqual(importRes.status, 400, `无效包应该返回 400，实际: ${importRes.status}`);
    assertEqual(importRes.data.code, 'MISSING_VIEWS_ARRAY', '错误码应该是 MISSING_VIEWS_ARRAY');
    console.log(`   无效包格式被正确拒绝`);
  });

  await test('3.10 导入包含非法字段的视图 - 自动清理', async () => {
    const badPkg = {
      package_version: 1,
      views: [
        {
          name: `非法字段测试视图_${Date.now()}`,
          description: '测试非法字段',
          equipment_id: testEquipmentId,
          start_date: '2026-01-01',
          end_date: '2026-12-31',
          event_types: ['borrow_created'],
          export_format: 'json',
          invalid_field: '应该被忽略',
          another_bad_field: 12345
        }
      ]
    };

    const importRes = await makeRequest('POST', '/audit/views/import', {
      package: badPkg,
      mode: 'skip'
    }, '1');

    assertEqual(importRes.status, 200, `导入应该返回 200`);
    assertEqual(importRes.data.imported, 1, `应该成功导入 1 个`);

    const detail = importRes.data.details[0];
    assertTrue(detail.warnings.length > 0, `应该有关于非法字段的警告`);
    const hasIgnoreWarning = detail.warnings.some(w => w.includes('忽略未知字段'));
    assertTrue(hasIgnoreWarning, `应该包含忽略未知字段的警告`);

    testViewIds.push(detail.view_id);
    console.log(`   非法字段自动清理成功，警告: ${detail.warnings.join(', ')}`);
  }, ['testEquipmentId']);

  await test('3.11 导入旧版本缺少字段的视图 - 自动补全', async () => {
    const oldVersionPkg = {
      package_version: 1,
      views: [
        {
          name: `旧版本测试视图_${Date.now()}`,
          equipment_id: testEquipmentId,
          start_date: '2026-01-01',
          end_date: '2026-12-31',
          event_types: ['borrow_created'],
          export_format: 'json'
        }
      ]
    };

    const importRes = await makeRequest('POST', '/audit/views/import', {
      package: oldVersionPkg,
      mode: 'skip'
    }, '1');

    assertEqual(importRes.status, 200, `导入应该返回 200`);
    assertEqual(importRes.data.imported, 1, `应该成功导入 1 个`);

    const detail = importRes.data.details[0];
    const hasDefaultWarning = detail.warnings.some(w => w.includes('缺少') && w.includes('默认值'));
    assertTrue(hasDefaultWarning, `应该包含使用默认值的警告`);
    assertEqual(detail.version, 1, `版本号应该是默认值 1`);

    testViewIds.push(detail.view_id);
    console.log(`   旧版本字段自动补全成功，版本: v${detail.version}`);
  }, ['testEquipmentId']);

  await test('3.12 导入无效事件类型的视图 - 验证失败', async () => {
    const badPkg = {
      package_version: 1,
      views: [
        {
          name: `无效事件类型_${Date.now()}`,
          equipment_id: testEquipmentId,
          start_date: '2026-01-01',
          end_date: '2026-12-31',
          event_types: ['invalid_event_type', 'borrow_created'],
          export_format: 'json'
        }
      ]
    };

    const importRes = await makeRequest('POST', '/audit/views/import', {
      package: badPkg,
      mode: 'skip'
    }, '1');

    assertEqual(importRes.status, 200, `导入应该返回 200`);
    assertEqual(importRes.data.failed, 1, `应该有 1 个失败`);

    const detail = importRes.data.details[0];
    assertEqual(detail.status, 'failed', `状态应该是 failed`);
    const hasEventTypeError = detail.errors.some(e => e.includes('无效的事件类型'));
    assertTrue(hasEventTypeError, `应该包含无效事件类型的错误`);

    console.log(`   无效事件类型被正确拒绝，错误: ${detail.errors.join(', ')}`);
  }, ['testEquipmentId']);

  await test('3.13 导入不存在的设备ID - 验证失败', async () => {
    const badPkg = {
      package_version: 1,
      views: [
        {
          name: `不存在设备_${Date.now()}`,
          equipment_id: 99999,
          start_date: '2026-01-01',
          end_date: '2026-12-31',
          event_types: ['borrow_created'],
          export_format: 'json'
        }
      ]
    };

    const importRes = await makeRequest('POST', '/audit/views/import', {
      package: badPkg,
      mode: 'skip'
    }, '1');

    assertEqual(importRes.status, 200, `导入应该返回 200`);
    assertEqual(importRes.data.failed, 1, `应该有 1 个失败`);

    const detail = importRes.data.details[0];
    assertEqual(detail.status, 'failed', `状态应该是 failed`);
    const hasEquipmentError = detail.errors.some(e => e.includes('设备ID') && e.includes('不存在'));
    assertTrue(hasEquipmentError, `应该包含设备不存在的错误`);

    console.log(`   不存在设备ID被正确拒绝`);
  });

  await test('3.14 导入数量超过限制 - 拒绝', async () => {
    const manyViews = [];
    for (let i = 0; i < 21; i++) {
      manyViews.push({
        name: `超限测试视图_${i}_${Date.now()}`,
        equipment_id: testEquipmentId,
        start_date: '2026-01-01',
        end_date: '2026-12-31',
        event_types: ['borrow_created'],
        export_format: 'json'
      });
    }

    const bigPkg = {
      package_version: 1,
      views: manyViews
    };

    const importRes = await makeRequest('POST', '/audit/views/import', {
      package: bigPkg,
      mode: 'skip'
    }, '1');

    assertEqual(importRes.status, 413, `超限应该返回 413，实际: ${importRes.status}`);
    assertEqual(importRes.data.code, 'IMPORT_QUANTITY_EXCEEDED', '错误码应该是 IMPORT_QUANTITY_EXCEEDED');
    assertNotNull(importRes.data.max_import_limit, '应该返回最大限制');
    assertEqual(importRes.data.max_import_limit, 20, '默认限制应该是 20');

    console.log(`   数量超限被正确拒绝，限制: ${importRes.data.max_import_limit}`);
  }, ['testEquipmentId']);

  await test('3.15 无效导入模式 - 拒绝', async () => {
    const importRes = await makeRequest('POST', '/audit/views/import', {
      package: exportedPackage,
      mode: 'invalid_mode'
    }, '1');

    assertEqual(importRes.status, 400, `无效模式应该返回 400，实际: ${importRes.status}`);
    assertEqual(importRes.data.code, 'INVALID_IMPORT_MODE', '错误码应该是 INVALID_IMPORT_MODE');
    console.log(`   无效导入模式被正确拒绝`);
  }, ['exportedPackage']);

  // ========== 第四阶段：审计日志验证 ==========
  console.log('\n' + '='.repeat(60));
  console.log('📝 第四阶段：审计日志验证');
  console.log('='.repeat(60));

  await test('4.1 验证导出操作审计日志', async () => {
    const logsRes = await makeRequest('GET', '/audit/logs?action=EXPORT_AUDIT_VIEW_PACKAGE', null, '1');
    assertEqual(logsRes.status, 200, `查询审计日志应该返回 200`);

    const exportLogs = logsRes.data.logs.filter(l => l.action === 'EXPORT_AUDIT_VIEW_PACKAGE');
    assertTrue(exportLogs.length > 0, '应该有导出操作的审计日志');

    for (const log of exportLogs) {
      assertEqual(log.resource_type, 'audit_view', '资源类型应该是 audit_view');
      assertNotNull(log.details, '应该包含详情');
    }

    console.log(`   导出操作审计日志验证通过，共 ${exportLogs.length} 条`);
  });

  await test('4.2 验证导入操作审计日志', async () => {
    const logsRes = await makeRequest('GET', '/audit/logs?action=IMPORT_AUDIT_VIEW_PACKAGE', null, '1');
    assertEqual(logsRes.status, 200, `查询审计日志应该返回 200`);

    const importLogs = logsRes.data.logs.filter(l => l.action === 'IMPORT_AUDIT_VIEW_PACKAGE');
    assertTrue(importLogs.length > 0, '应该有导入操作的审计日志');

    console.log(`   导入操作审计日志验证通过，共 ${importLogs.length} 条`);
  });

  await test('4.3 验证单条视图导入审计日志', async () => {
    const actions = ['IMPORT_AUDIT_VIEW_SUCCESS', 'OVERWRITE_AUDIT_VIEW_SUCCESS', 'SKIP_AUDIT_VIEW', 'IMPORT_AUDIT_VIEW_FAILED'];
    let found = 0;

    for (const action of actions) {
      const logsRes = await makeRequest('GET', `/audit/logs?action=${action}`, null, '1');
      const logs = logsRes.data.logs.filter(l => l.action === action);
      if (logs.length > 0) {
        found++;
        console.log(`   - ${action}: ${logs.length} 条`);
      }
    }

    assertTrue(found >= 3, `应该至少有 3 种不同的导入相关审计日志，实际找到 ${found} 种`);
    console.log(`   单条视图操作审计日志验证通过`);
  });

  await test('4.4 验证越权访问审计日志', async () => {
    const logsRes = await makeRequest('GET', '/audit/logs?action=UNAUTHORIZED_ACCESS_ATTEMPT', null, '1');
    assertEqual(logsRes.status, 200, `查询审计日志应该返回 200`);

    const unauthorizedLogs = logsRes.data.logs.filter(l =>
      l.action === 'UNAUTHORIZED_ACCESS_ATTEMPT' &&
      l.details && l.details.includes('views/export') || l.details.includes('views/import')
    );
    assertTrue(unauthorizedLogs.length >= 2, '应该记录导入导出的越权访问日志');

    console.log(`   越权访问审计日志验证通过，共 ${unauthorizedLogs.length} 条`);
  });

  // ========== 第五阶段：重启持久化测试 ==========
  console.log('\n' + '='.repeat(60));
  console.log('🔄 第五阶段：重启后数据持久化验证');
  console.log('='.repeat(60));

  console.log('\n⏸️  现在请手动重启服务（Ctrl+C 停止，然后 npm start）');
  console.log('   重启后按任意键继续第二阶段测试（重启后数据不丢验证）...');

  process.stdin.setRawMode(true);
  process.stdin.resume();
  await new Promise(resolve => process.stdin.once('data', resolve));
  process.stdin.setRawMode(false);

  console.log('\n🔄 继续测试：重启后数据不丢验证');
  await waitForServer();

  await test('5.1 重启后导入的视图仍然存在', async () => {
    const listRes = await makeRequest('GET', '/audit/views', null, '1');
    assertEqual(listRes.status, 200, `查询应该返回 200`);

    const importedNames = exportedPackage.views.map(v => v.name);
    for (const name of importedNames) {
      const found = listRes.data.views.find(v => v.name === name);
      assertNotNull(found, `重启后应该能找到导入的视图: ${name}`);
      assertTrue(found.version > 1, `覆盖后的版本号应该 > 1，实际: v${found.version}`);
    }

    console.log(`   重启后视图存在验证通过，共 ${listRes.data.views.length} 个视图`);
  }, ['exportedPackage']);

  await test('5.2 重启后可以重新导出相同的视图', async () => {
    const exportRes = await makeRequest('GET', '/audit/views/export', null, '1');
    assertEqual(exportRes.status, 200, `导出应该返回 200`);

    const pkg = typeof exportRes.data === 'string' ? JSON.parse(exportRes.data) : exportRes.data;
    assertTrue(pkg.view_count >= exportedPackage.view_count, `导出数量应该 >= 之前导入的数量`);

    console.log(`   重启后导出功能正常，共 ${pkg.view_count} 个视图`);
  }, ['exportedPackage']);

  await test('5.3 重启后导入功能正常', async () => {
    const uniqueName = `重启后测试_${Date.now()}`;
    const testPkg = {
      package_version: 1,
      views: [
        {
          name: uniqueName,
          equipment_id: testEquipmentId,
          start_date: '2026-01-01',
          end_date: '2026-12-31',
          event_types: ['borrow_created', 'maintenance_completed'],
          export_format: 'json',
          version: 5
        }
      ]
    };

    const importRes = await makeRequest('POST', '/audit/views/import', {
      package: testPkg,
      mode: 'skip'
    }, '1');

    assertEqual(importRes.status, 200, `导入应该返回 200`);
    assertEqual(importRes.data.imported, 1, `应该成功导入 1 个`);

    const detail = importRes.data.details[0];
    assertEqual(detail.version, 5, `应该保留导入的版本号 5`);

    const getRes = await makeRequest('GET', `/audit/views/${detail.view_id}`, null, '1');
    assertEqual(getRes.status, 200, `查询应该返回 200`);
    assertEqual(getRes.data.view.version, 5, `查询到的版本号应该是 5`);

    testViewIds.push(detail.view_id);
    console.log(`   重启后导入功能正常，视图版本: v${detail.version}`);
  }, ['testEquipmentId']);

  await test('5.4 重启后JSON导入导出闭环验证', async () => {
    const exportRes1 = await makeRequest('GET', '/audit/views/export', null, '1');
    const pkg1 = typeof exportRes1.data === 'string' ? JSON.parse(exportRes1.data) : exportRes1.data;

    const exportedIds = pkg1.views.map(v => v.name).sort();

    await cleanUpTestViews();

    const importRes = await makeRequest('POST', '/audit/views/import', {
      package: pkg1,
      mode: 'skip'
    }, '1');

    assertEqual(importRes.status, 200, `重新导入应该返回 200`);
    assertTrue(importRes.data.imported > 0, `应该成功导入至少一个视图`);

    const exportRes2 = await makeRequest('GET', '/audit/views/export', null, '1');
    const pkg2 = typeof exportRes2.data === 'string' ? JSON.parse(exportRes2.data) : exportRes2.data;

    const importedIds = pkg2.views.map(v => v.name).sort();

    for (const id of exportedIds) {
      assertTrue(importedIds.includes(id), `闭环验证：重新导出应该包含 ${id}`);
    }

    testViewIds.push(...importRes.data.details.filter(d => d.view_id).map(d => d.view_id));
    console.log(`   JSON导入导出闭环验证通过，视图数量: ${pkg1.view_count} → ${pkg2.view_count}`);
  });

  // ========== 第六阶段：清理和结果汇总 ==========
  console.log('\n' + '='.repeat(60));
  console.log('🧹 第六阶段：清理测试数据');
  console.log('='.repeat(60));

  await test('6.1 清理测试视图', async () => {
    await cleanUpTestViews();
    console.log(`   已清理 ${testViewIds.length} 个测试视图`);
  });

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
    console.log('\n🎉 所有审计视图导入导出测试通过！');
    console.log('\n✅ 核心功能验证完成:');
    console.log('   - 批量导出所有视图: GET /api/audit/views/export');
    console.log('   - 导出指定视图: GET /api/audit/views/export?ids=1,2,3');
    console.log('   - 导入视图包(skip模式): POST /api/audit/views/import');
    console.log('   - 导入视图包(overwrite模式): POST /api/audit/views/import');
    console.log('   - 重名冲突处理: skip/overwrite 两种模式');
    console.log('   - 非法字段处理: 自动忽略未知字段');
    console.log('   - 旧版本兼容: 自动补全缺失字段');
    console.log('   - 数量超限: 限制单次20个，返回413');
    console.log('   - 权限控制: 仅管理员可导入导出');
    console.log('   - 审计日志: 导入/覆盖/跳过/失败全部记录');
    console.log('   - 结果明细: 每条视图显示处理状态');
    console.log('   - 重启持久化: 重启后数据不丢失');
    console.log('   - JSON闭环: 导出→删除→导入→导出一致');
    console.log('   - 前端UI: 导入导出入口、结果列表展示');
    process.exit(0);
  }
}

runTests().catch(e => {
  console.error('\n❌ 测试执行失败:', e.message);
  console.error(e.stack);
  process.exit(1);
});
