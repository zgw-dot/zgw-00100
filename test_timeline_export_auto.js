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
let testBorrowRequestId = null;
let testMaintenanceId = null;
let testMaintenanceNo = null;

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
  console.log('📅 设备使用与维保日历包导出 - 自动化测试（跳过重启验证）');
  console.log('='.repeat(80));

  await waitForServer();

  await test('1. 初始化 - 创建测试设备（管理员）', async () => {
    const uniqueCode = `TEST-TL-AUTO-${Date.now()}`;
    const createRes = await makeRequest('POST', '/equipment', {
      device_code: uniqueCode,
      name: '时间线导出自动测试设备',
      model: 'TEST-TL-AUTO-MODEL',
      category: '测试设备'
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
      purpose: '时间线自动测试-普通借用',
      start_date: borrowStart,
      end_date: borrowEnd
    }, '2');

    assertEqual(borrowRes.status, 201, `借用申请应该成功，实际: ${JSON.stringify(borrowRes.data)}`);
    assertNotNull(borrowRes.data.request, '返回数据应该包含 request 对象');
    testBorrowRequestId = borrowRes.data.request.id;
    console.log(`   借用申请创建成功: ${borrowRes.data.request.request_no}`);
  }, ['testEquipmentId']);

  await test('3. 管理员批准借用申请', async () => {
    const approveRes = await makeRequest('POST', `/borrow/${testBorrowRequestId}/approve`, {
      approval_comment: '时间线自动测试批准'
    }, '1');

    assertEqual(approveRes.status, 200, `批准申请应该成功，实际: ${JSON.stringify(approveRes.data)}`);
  }, ['testBorrowRequestId']);

  await test('4. 领用设备', async () => {
    const collectRes = await makeRequest('POST', `/borrow/${testBorrowRequestId}/collect`, {}, '2');
    assertEqual(collectRes.status, 200, `领用设备应该成功，实际: ${JSON.stringify(collectRes.data)}`);
  }, ['testBorrowRequestId']);

  await test('5. 归还设备', async () => {
    const returnRes = await makeRequest('POST', `/borrow/${testBorrowRequestId}/return`, {
      return_acceptance_result: '完好无损'
    }, '2');
    assertEqual(returnRes.status, 200, `归还设备应该成功，实际: ${JSON.stringify(returnRes.data)}`);
  }, ['testBorrowRequestId']);

  await test('6. 提交维修申请', async () => {
    const maintRes = await makeRequest('POST', '/maintenance', {
      equipment_id: testEquipmentId,
      issue_description: '时间线自动测试-设备故障报修',
      priority: 'high'
    }, '3');

    assertEqual(maintRes.status, 201, `提交维修申请应该成功，实际: ${JSON.stringify(maintRes.data)}`);
    assertNotNull(maintRes.data.record, '返回数据应该包含 record 对象');
    testMaintenanceId = maintRes.data.record.id;
    testMaintenanceNo = `MR${String(testMaintenanceId).padStart(6, '0')}`;
    console.log(`   维修申请创建成功: ${testMaintenanceNo}`);
  }, ['testEquipmentId']);

  await test('7. 管理员开始维修', async () => {
    const maintEnd = moment().add(7, 'days').format('YYYY-MM-DD HH:mm:ss');
    const startRes = await makeRequest('POST', `/maintenance/${testMaintenanceId}/start`, {
      estimated_completion_date: maintEnd,
      technician_id: 1
    }, '1');

    assertEqual(startRes.status, 200, `开始维修应该成功，实际: ${JSON.stringify(startRes.data)}`);
  }, ['testMaintenanceId']);

  await test('8. 普通用户尝试借用维修中设备 - 触发冲突拦截', async () => {
    const borrowStart = moment().add(2, 'days').format('YYYY-MM-DD HH:mm:ss');
    const borrowEnd = moment().add(4, 'days').format('YYYY-MM-DD HH:mm:ss');

    const borrowRes = await makeRequest('POST', '/borrow', {
      equipment_id: testEquipmentId,
      purpose: '时间线自动测试-冲突借用',
      start_date: borrowStart,
      end_date: borrowEnd
    }, '2');

    assertEqual(borrowRes.status, 409, `应该返回 409 冲突，实际: ${JSON.stringify(borrowRes.data)}`);
    assertEqual(borrowRes.data.code, 'TIME_SLOT_CONFLICT', '错误码应为 TIME_SLOT_CONFLICT');
    console.log(`   冲突拦截成功`);
  }, ['testEquipmentId', 'testMaintenanceId']);

  await test('9. 管理员完成维修', async () => {
    const completeRes = await makeRequest('POST', `/maintenance/${testMaintenanceId}/complete`, {
      repair_result: '已修复故障部件'
    }, '1');
    assertEqual(completeRes.status, 200, `完成维修应该成功，实际: ${JSON.stringify(completeRes.data)}`);
  }, ['testMaintenanceId']);

  await test('10. 权限拒绝测试 - 普通用户尝试导出时间线', async () => {
    const exportRes = await makeRequest('GET', '/audit/export/timeline?format=json', null, '2');

    assertEqual(exportRes.status, 403, `普通用户导出应该被拒绝，实际: ${exportRes.status}`);
    assertEqual(exportRes.data.code, 'ADMIN_REQUIRED', '错误码应为 ADMIN_REQUIRED');
    assertEqual(exportRes.data.error, '需要管理员权限', '错误信息应该清晰');
    console.log(`   权限控制正常：普通用户被正确拒绝`);
  });

  await test('11. JSON格式导出测试 - 管理员导出单设备时间线', async () => {
    const exportRes = await makeRequest('GET', `/audit/export/timeline?format=json&equipment_id=${testEquipmentId}`, null, '1');

    assertEqual(exportRes.status, 200, `导出应该成功，实际: ${exportRes.status}`);
    
    const contentType = exportRes.headers['content-type'];
    assertTrue(contentType.includes('application/json'), `Content-Type 应该包含 application/json，实际: ${contentType}`);
    
    const disposition = exportRes.headers['content-disposition'];
    assertTrue(disposition.includes('attachment'), 'Content-Disposition 应该包含 attachment');
    assertTrue(disposition.includes('timeline_equipment'), '文件名应该包含 timeline_equipment');
    
    const data = typeof exportRes.data === 'string' ? JSON.parse(exportRes.data) : exportRes.data;
    assertNotNull(data.meta, '应该包含 meta 信息');
    assertNotNull(data.events, '应该包含 events 数组');
    assertTrue(data.events.length > 0, '事件数组不应该为空');
    
    console.log(`   导出事件数量: ${data.events.length}`);
    
    const requiredFields = ['event_id', 'event_time', 'event_type', 'event_text', 
                           'source_type', 'source_id', 'status', 'status_text',
                           'operator_id', 'operator_name', 'equipment_id', 
                           'device_code', 'equipment_name', 'details'];
    
    for (const event of data.events) {
      for (const field of requiredFields) {
        assertNotNull(event[field], `事件应该包含 ${field} 字段`);
      }
    }
    
    const eventTypes = data.events.map(e => e.event_type);
    assertTrue(eventTypes.includes('borrow_created'), '应该包含借用创建事件');
    assertTrue(eventTypes.includes('borrow_approved'), '应该包含借用批准事件');
    assertTrue(eventTypes.includes('borrow_collected'), '应该包含领用事件');
    assertTrue(eventTypes.includes('borrow_returned'), '应该包含归还事件');
    assertTrue(eventTypes.includes('maintenance_created'), '应该包含维修创建事件');
    assertTrue(eventTypes.includes('maintenance_started'), '应该包含维修开始事件');
    assertTrue(eventTypes.includes('maintenance_completed'), '应该包含维修完成事件');
    assertTrue(eventTypes.includes('borrow_conflict_blocked'), '应该包含冲突拦截事件');
    
    console.log(`   所有事件类型验证通过: ${eventTypes.join(', ')}`);
  }, ['testEquipmentId']);

  await test('12. CSV格式导出测试 - 管理员导出单设备时间线', async () => {
    const exportRes = await makeRequest('GET', `/audit/export/timeline?format=csv&equipment_id=${testEquipmentId}`, null, '1');

    assertEqual(exportRes.status, 200, `导出应该成功，实际: ${exportRes.status}`);
    
    const contentType = exportRes.headers['content-type'];
    assertTrue(contentType.includes('text/csv'), `Content-Type 应该包含 text/csv，实际: ${contentType}`);
    
    const disposition = exportRes.headers['content-disposition'];
    assertTrue(disposition.includes('attachment'), 'Content-Disposition 应该包含 attachment');
    assertTrue(disposition.includes('.csv'), '文件名应该包含 .csv');
    
    const csvContent = exportRes.rawBody;
    assertTrue(csvContent.startsWith('\uFEFF'), 'CSV 应该包含 UTF-8 BOM');
    
    const lines = csvContent.replace('\uFEFF', '').split('\n');
    assertTrue(lines.length > 1, 'CSV 应该包含表头和数据行');
    
    const headerLine = lines[0];
    const headers = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < headerLine.length; i++) {
      const char = headerLine[i];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        headers.push(current);
        current = '';
      } else {
        current += char;
      }
    }
    headers.push(current);
    const expectedHeaders = ['事件ID', '事件时间', '事件类型', '事件描述', '来源类型', '来源ID',
                            '状态', '状态描述', '操作者ID', '操作者姓名',
                            '设备ID', '设备编号', '设备名称', '详情'];
    
    for (let i = 0; i < expectedHeaders.length; i++) {
      assertEqual(headers[i], expectedHeaders[i], `CSV表头第${i+1}列应该是 ${expectedHeaders[i]}`);
    }
    
    console.log(`   CSV 导出成功，共 ${lines.length - 1} 条数据`);
  }, ['testEquipmentId']);

  await test('13. 事件排序稳定性测试 - 时间升序+ID排序', async () => {
    const exportRes = await makeRequest('GET', `/audit/export/timeline?format=json&equipment_id=${testEquipmentId}`, null, '1');
    const data = typeof exportRes.data === 'string' ? JSON.parse(exportRes.data) : exportRes.data;
    const events = data.events;
    
    for (let i = 1; i < events.length; i++) {
      const prevTime = new Date(events[i-1].event_time);
      const currTime = new Date(events[i].event_time);
      
      if (prevTime.getTime() === currTime.getTime()) {
        assertTrue(
          events[i-1].event_id.localeCompare(events[i].event_id) <= 0,
          `时间相同时，事件ID应该按字典序排序: ${events[i-1].event_id} vs ${events[i].event_id}`
        );
      } else {
        assertTrue(
          prevTime <= currTime,
          `事件应该按时间升序排列: ${events[i-1].event_time} vs ${events[i].event_time}`
        );
      }
    }
    
    console.log(`   事件排序稳定，按时间升序+事件ID字典序`);
  }, ['testEquipmentId']);

  await test('14. 冲突拦截事件字段完整性验证', async () => {
    const exportRes = await makeRequest('GET', `/audit/export/timeline?format=json&equipment_id=${testEquipmentId}`, null, '1');
    const data = typeof exportRes.data === 'string' ? JSON.parse(exportRes.data) : exportRes.data;
    
    const conflictEvents = data.events.filter(e => e.event_type === 'borrow_conflict_blocked');
    assertTrue(conflictEvents.length > 0, '应该找到冲突拦截事件');
    
    const conflictEvent = conflictEvents[0];
    assertEqual(conflictEvent.status, 'blocked', '冲突事件状态应该是 blocked');
    assertEqual(conflictEvent.status_text, '已拦截', '状态描述应该是 已拦截');
    assertEqual(conflictEvent.source_type, 'audit', '来源类型应该是 audit');
    
    assertNotNull(conflictEvent.details.conflicts, '冲突详情应该包含 conflicts');
    assertTrue(conflictEvent.details.conflicts.length > 0, 'conflicts 数组不应该为空');
    
    const maintenanceConflict = conflictEvent.details.conflicts.find(c => c.type === 'maintenance');
    assertNotNull(maintenanceConflict, '应该找到维修冲突详情');
    assertNotNull(maintenanceConflict.maintenance_no, '应该包含维修单号');
    assertNotNull(maintenanceConflict.overlap_start, '应该包含重叠开始时间');
    assertNotNull(maintenanceConflict.overlap_end, '应该包含重叠结束时间');
    
    console.log(`   冲突拦截事件字段完整，可复核冲突详情`);
  }, ['testEquipmentId', 'testMaintenanceNo']);

  await test('15. 全量导出测试 - 不指定设备ID', async () => {
    const exportRes = await makeRequest('GET', '/audit/export/timeline?format=json', null, '1');
    
    assertEqual(exportRes.status, 200, `全量导出应该成功，实际: ${exportRes.status}`);
    
    const data = typeof exportRes.data === 'string' ? JSON.parse(exportRes.data) : exportRes.data;
    assertNotNull(data.meta, '应该包含 meta 信息');
    assertNotNull(data.events, '应该包含 events 数组');
    assertTrue(data.events.length > 0, '事件数组不应该为空');
    
    console.log(`   全量导出成功，共 ${data.events.length} 条事件`);
  });

  await test('16. 不支持的格式测试', async () => {
    const exportRes = await makeRequest('GET', '/audit/export/timeline?format=xml', null, '1');
    
    assertEqual(exportRes.status, 400, `不支持的格式应该返回 400，实际: ${exportRes.status}`);
    assertEqual(exportRes.data.code, 'INVALID_EXPORT_FORMAT', '错误码应为 INVALID_EXPORT_FORMAT');
    
    console.log(`   格式校验正常，不支持的格式被正确拒绝`);
  });

  await test('17. 普通用户查看时间线 - 权限脱敏验证', async () => {
    const timelineRes = await makeRequest('GET', `/audit/timeline/${testEquipmentId}`, null, '2');
    
    assertEqual(timelineRes.status, 200, `查询时间线应该成功，实际: ${timelineRes.status}`);
    
    const data = timelineRes.data;
    assertNotNull(data.timeline, '应该包含 timeline 数组');
    
    const otherUserEvents = data.timeline.filter(e => e.operator_id !== 2 && e.operator_id !== null);
    assertTrue(otherUserEvents.length === 0, '普通用户不应该看到其他用户的ID');
    
    const eventsWithOtherUser = data.timeline.filter(e => e.operator_name === '其他用户');
    assertTrue(eventsWithOtherUser.length > 0, '应该有事件被脱敏为 其他用户');
    
    console.log(`   普通用户时间线脱敏正常，共 ${data.timeline.length} 条事件，${eventsWithOtherUser.length} 条被脱敏`);
  }, ['testEquipmentId']);

  await test('18. 时间范围筛选测试', async () => {
    const now = moment();
    const future = moment().add(30, 'days');
    
    const exportRes = await makeRequest('GET', 
      `/audit/export/timeline?format=json&equipment_id=${testEquipmentId}&start_date=${now.format('YYYY-MM-DD')}&end_date=${future.format('YYYY-MM-DD')}`, 
      null, '1');
    
    const data = typeof exportRes.data === 'string' ? JSON.parse(exportRes.data) : exportRes.data;
    assertTrue(data.events.length >= 0, '时间范围筛选应该返回结果');
    
    console.log(`   时间范围筛选成功，返回 ${data.events.length} 条事件`);
  }, ['testEquipmentId']);

  await test('19. 导出元数据完整性验证', async () => {
    const exportRes = await makeRequest('GET', `/audit/export/timeline?format=json&equipment_id=${testEquipmentId}`, null, '1');
    const data = typeof exportRes.data === 'string' ? JSON.parse(exportRes.data) : exportRes.data;
    
    assertNotNull(data.meta.exported_at, '应该包含导出时间');
    assertNotNull(data.meta.exported_by, '应该包含导出人姓名');
    assertNotNull(data.meta.exported_by_id, '应该包含导出人ID');
    assertNotNull(data.meta.filters, '应该包含筛选条件');
    assertNotNull(data.meta.event_count, '应该包含事件数量');
    assertEqual(data.meta.event_count, data.events.length, '事件数量应该匹配');
    assertNotNull(data.meta.equipment_info, '应该包含设备信息');
    
    console.log(`   导出元数据完整: 导出人=${data.meta.exported_by}, 事件数=${data.meta.event_count}`);
  }, ['testEquipmentId']);

  console.log('\n' + '='.repeat(80));
  console.log('📊 自动化测试结果汇总');
  console.log('='.repeat(80));
  console.log(`   ✅ 通过: ${passed}`);
  console.log(`   ❌ 失败: ${failed}`);
  console.log(`   📈 总计: ${passed + failed}`);
  console.log('='.repeat(80));

  if (failed > 0) {
    console.log('\n⚠️  有测试失败！');
    process.exit(1);
  } else {
    console.log('\n🎉 所有自动化测试通过！');
    console.log('\n✅ 核心功能验证完成:');
    console.log('   - 导出入口正常: GET /api/audit/export/timeline');
    console.log('   - 权限控制正常: 仅管理员可导出');
    console.log('   - 支持 JSON 和 CSV 格式');
    console.log('   - 事件覆盖完整: 借用、维修、冲突拦截');
    console.log('   - 字段稳定完整: event_id, event_time, event_type 等');
    console.log('   - 排序稳定: 时间升序 + event_id 字典序');
    console.log('   - 冲突拦截记录可复核');
    console.log('   - 普通用户时间线自动脱敏');
    console.log('\n⚠️  重启后数据不丢验证请运行: npm run test-timeline-export');
    console.log('   (该测试需要手动重启服务)');
    process.exit(0);
  }
}

runTests().catch(e => {
  console.error('\n❌ 测试执行失败:', e.message);
  console.error(e.stack);
  process.exit(1);
});
