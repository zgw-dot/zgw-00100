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
          resolve({ status: res.statusCode, data: parsed });
        } catch (e) {
          resolve({ status: res.statusCode, data: body });
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
let testMaintenanceId = null;
let testMaintenanceNo = null;
let borrowConflictRequestNo = null;

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

function assertNull(value, message) {
  if (value !== null && value !== undefined) {
    throw new Error(`${message}: 期望为空, 实际 ${value}`);
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
  console.log('🔧 维修窗口冲突权限修复 - 复现/回归测试');
  console.log('='.repeat(80));

  await waitForServer();

  await test('1. 初始化 - 创建测试设备（管理员）', async () => {
    const uniqueCode = `TEST-PERM-${Date.now()}`;
    const createRes = await makeRequest('POST', '/equipment', {
      device_code: uniqueCode,
      name: '权限测试专用设备',
      model: 'TEST-PERM-MODEL',
      category: '测试设备'
    }, '1');

    assertEqual(createRes.status, 201, `创建设备应该返回 201，实际: ${JSON.stringify(createRes.data)}`);
    assertNotNull(createRes.data.equipment, '返回数据应该包含 equipment 对象');
    assertNotNull(createRes.data.equipment.id, '设备ID不能为空');
    testEquipmentId = createRes.data.equipment.id;
    console.log(`   设备ID: ${testEquipmentId}, 编号: ${uniqueCode}`);
  });

  await test('2. 普通借用（无冲突）- 验证已有链路正常', async () => {
    const borrowStart = moment().add(1, 'days').format('YYYY-MM-DD HH:mm:ss');
    const borrowEnd = moment().add(3, 'days').format('YYYY-MM-DD HH:mm:ss');

    const borrowRes = await makeRequest('POST', '/borrow', {
      equipment_id: testEquipmentId,
      purpose: '权限测试-普通借用',
      start_date: borrowStart,
      end_date: borrowEnd
    }, '2');

    assertEqual(borrowRes.status, 201, `普通借用应该成功，实际: ${JSON.stringify(borrowRes.data)}`);
    assertNotNull(borrowRes.data.request, '返回数据应该包含 request 对象');
    assertNotNull(borrowRes.data.request.request_no, '申请单号不能为空');
    borrowConflictRequestNo = borrowRes.data.request.request_no;
    console.log(`   借用申请创建成功: ${borrowConflictRequestNo}`);
  }, ['testEquipmentId']);

  await test('3. 边界相邻不冲突 - 验证已有链路正常', async () => {
    const prevEnd = moment().add(3, 'days');
    const borrowStart = prevEnd.format('YYYY-MM-DD HH:mm:ss');
    const borrowEnd = prevEnd.add(2, 'days').format('YYYY-MM-DD HH:mm:ss');

    const borrowRes = await makeRequest('POST', '/borrow', {
      equipment_id: testEquipmentId,
      purpose: '权限测试-边界相邻',
      start_date: borrowStart,
      end_date: borrowEnd
    }, '2');

    assertEqual(borrowRes.status, 201, `边界相邻应该成功，实际: ${JSON.stringify(borrowRes.data)}`);
    assertNotNull(borrowRes.data.request, '返回数据应该包含 request 对象');
    console.log(`   相邻申请创建成功: ${borrowRes.data.request.request_no}`);

    await makeRequest('POST', `/borrow/${borrowRes.data.request.id}/cancel`, {}, '2');
  }, ['testEquipmentId']);

  await test('4. 取消测试2的借用申请，释放时间段用于后续测试', async () => {
    const listRes = await makeRequest('GET', `/borrow?equipment_id=${testEquipmentId}`);
    
    let requests = [];
    if (listRes.data && listRes.data.requests) {
      requests = listRes.data.requests;
    } else if (Array.isArray(listRes.data)) {
      requests = listRes.data;
    }
    
    const targetRequests = requests.filter(r => r.request_no === borrowConflictRequestNo);
    
    for (const req of targetRequests) {
      await makeRequest('POST', `/borrow/${req.id}/cancel`, {}, '2');
      console.log(`   已取消申请 ${req.id} (${req.request_no})`);
    }
  }, ['testEquipmentId', 'borrowConflictRequestNo']);

  await test('5. 创建维修记录并开始维修（管理员）', async () => {
    const createRes = await makeRequest('POST', '/maintenance', {
      equipment_id: testEquipmentId,
      issue_description: '权限测试-维修窗口冲突',
      priority: 'high'
    }, '1');

    assertEqual(createRes.status, 201, `创建维修记录应该成功，实际: ${JSON.stringify(createRes.data)}`);
    assertNotNull(createRes.data.record, '返回数据应该包含 record 对象');
    assertNotNull(createRes.data.record.id, '维修记录ID不能为空');
    testMaintenanceId = createRes.data.record.id;
    testMaintenanceNo = `MR${String(testMaintenanceId).padStart(6, '0')}`;

    const maintenanceStart = moment().add(1, 'days').format('YYYY-MM-DD HH:mm:ss');
    const maintenanceEnd = moment().add(10, 'days').format('YYYY-MM-DD HH:mm:ss');

    const startRes = await makeRequest('POST', `/maintenance/${testMaintenanceId}/start`, {
      estimated_completion_date: maintenanceEnd
    }, '1');
    assertEqual(startRes.status, 200, `开始维修应该成功，实际: ${JSON.stringify(startRes.data)}`);

    console.log(`   维修记录 ${testMaintenanceId} (${testMaintenanceNo}) 已开始，预计 ${maintenanceEnd} 完成`);
  }, ['testEquipmentId']);

  await test('6. 提交重叠借用 - 验证返回 409 TIME_SLOT_CONFLICT', async () => {
    const borrowStart = moment().add(3, 'days').format('YYYY-MM-DD HH:mm:ss');
    const borrowEnd = moment().add(7, 'days').format('YYYY-MM-DD HH:mm:ss');

    const borrowRes = await makeRequest('POST', '/borrow', {
      equipment_id: testEquipmentId,
      purpose: '权限测试-重叠借用',
      start_date: borrowStart,
      end_date: borrowEnd
    }, '2');

    assertEqual(borrowRes.status, 409, `重叠借用应该返回 409，实际: ${JSON.stringify(borrowRes.data)}`);
    assertEqual(borrowRes.data.code, 'TIME_SLOT_CONFLICT', '错误码应为 TIME_SLOT_CONFLICT');

    const maintenanceConflict = borrowRes.data.details.conflicts.find(c => c.type === 'maintenance');
    assertNotNull(maintenanceConflict, '应该找到维修冲突');
    assertEqual(maintenanceConflict.maintenance_no, testMaintenanceNo, '维修单号应该匹配');
    assertNotNull(maintenanceConflict.overlap_start, '重叠开始时间不能为空');
    assertNotNull(maintenanceConflict.overlap_end, '重叠结束时间不能为空');

    console.log(`   正确返回 409 TIME_SLOT_CONFLICT`);
    console.log(`   维修单号: ${maintenanceConflict.maintenance_no}`);
    console.log(`   重叠时间: ${maintenanceConflict.overlap_start} ~ ${maintenanceConflict.overlap_end}`);
  }, ['testEquipmentId', 'testMaintenanceId', 'testMaintenanceNo']);

  await test('7. 普通用户查看维修冲突 - 验证字段脱敏', async () => {
    const borrowStart = moment().add(3, 'days').format('YYYY-MM-DD HH:mm:ss');
    const borrowEnd = moment().add(7, 'days').format('YYYY-MM-DD HH:mm:ss');

    const checkRes = await makeRequest('POST', '/borrow/check-availability', {
      equipment_id: testEquipmentId,
      start_date: borrowStart,
      end_date: borrowEnd
    }, '3');

    assertEqual(checkRes.status, 409, `可用性检查应该返回 409，实际: ${JSON.stringify(checkRes.data)}`);
    assertEqual(checkRes.data.code, 'TIME_SLOT_CONFLICT', '错误码应为 TIME_SLOT_CONFLICT');

    const maintenanceConflict = checkRes.data.details.conflicts.find(c => c.type === 'maintenance');
    assertNotNull(maintenanceConflict, '应该找到维修冲突');

    console.log(`   普通用户看到的维修冲突字段: ${Object.keys(maintenanceConflict).join(', ')}`);
    console.log(`   reporter_id: ${maintenanceConflict.reporter_id}, reporter_name: ${maintenanceConflict.reporter_name}`);

    assertEqual(maintenanceConflict.maintenance_no, testMaintenanceNo, '应该看到维修单号');
    assertNotNull(maintenanceConflict.overlap_start, '应该看到重叠开始时间');
    assertNotNull(maintenanceConflict.overlap_end, '应该看到重叠结束时间');

    assertNull(maintenanceConflict.reporter_id, '普通用户不应该看到报修人ID');
    assertEqual(maintenanceConflict.reporter_name, '其他用户', '普通用户看到的报修人应该是"其他用户"');

    if (maintenanceConflict.maintenance_id !== undefined) {
      throw new Error('普通用户不应该看到 maintenance_id 内部字段');
    }
  }, ['testEquipmentId', 'testMaintenanceId', 'testMaintenanceNo']);

  await test('8. 管理员查看维修冲突 - 验证完整信息', async () => {
    const borrowStart = moment().add(3, 'days').format('YYYY-MM-DD HH:mm:ss');
    const borrowEnd = moment().add(7, 'days').format('YYYY-MM-DD HH:mm:ss');

    const checkRes = await makeRequest('POST', '/borrow/check-availability', {
      equipment_id: testEquipmentId,
      start_date: borrowStart,
      end_date: borrowEnd
    }, '1');

    assertEqual(checkRes.status, 409, `可用性检查应该返回 409，实际: ${JSON.stringify(checkRes.data)}`);
    assertEqual(checkRes.data.code, 'TIME_SLOT_CONFLICT', '错误码应为 TIME_SLOT_CONFLICT');

    const maintenanceConflict = checkRes.data.details.conflicts.find(c => c.type === 'maintenance');
    assertNotNull(maintenanceConflict, '应该找到维修冲突');

    console.log(`   管理员看到的维修冲突字段: ${Object.keys(maintenanceConflict).join(', ')}`);
    console.log(`   reporter_id: ${maintenanceConflict.reporter_id}, reporter_name: ${maintenanceConflict.reporter_name}`);

    assertEqual(maintenanceConflict.maintenance_no, testMaintenanceNo, '应该看到维修单号');
    assertNotNull(maintenanceConflict.overlap_start, '应该看到重叠开始时间');
    assertNotNull(maintenanceConflict.overlap_end, '应该看到重叠结束时间');

    assertNotNull(maintenanceConflict.reporter_id, '管理员应该看到报修人ID');
    assertEqual(maintenanceConflict.reporter_id, 1, '报修人ID应该是1（管理员）');
    assertNotNull(maintenanceConflict.reporter_name, '管理员应该看到报修人姓名');
    if (maintenanceConflict.reporter_name === '其他用户') {
      throw new Error('管理员看到的报修人不应该是"其他用户"');
    }
  }, ['testEquipmentId', 'testMaintenanceId', 'testMaintenanceNo']);

  await test('9. 本人报修 - 普通用户应看到自己的完整信息', async () => {
    const uniqueCode2 = `TEST-PERM-USER-${Date.now()}`;
    const equipRes = await makeRequest('POST', '/equipment', {
      device_code: uniqueCode2,
      name: '用户本人报修测试设备',
      model: 'TEST-USER-MODEL',
      category: '测试设备'
    }, '1');
    const userTestEquipmentId = equipRes.data.equipment.id;
    
    const createRes = await makeRequest('POST', '/maintenance', {
      equipment_id: userTestEquipmentId,
      issue_description: '权限测试-用户自己报修',
      priority: 'normal'
    }, '3');

    assertEqual(createRes.status, 201, `创建维修记录应该成功，实际: ${JSON.stringify(createRes.data)}`);
    const userMaintenanceId = createRes.data.record.id;
    const userMaintenanceNo = `MR${String(userMaintenanceId).padStart(6, '0')}`;

    const userMaintenanceStart = moment().add(12, 'days').format('YYYY-MM-DD HH:mm:ss');
    const userMaintenanceEnd = moment().add(20, 'days').format('YYYY-MM-DD HH:mm:ss');

    const startRes = await makeRequest('POST', `/maintenance/${userMaintenanceId}/start`, {
      estimated_completion_date: userMaintenanceEnd
    }, '1');
    assertEqual(startRes.status, 200, `开始维修应该成功，实际: ${JSON.stringify(startRes.data)}`);

    const borrowStart = moment().add(14, 'days').format('YYYY-MM-DD HH:mm:ss');
    const borrowEnd = moment().add(18, 'days').format('YYYY-MM-DD HH:mm:ss');

    const checkRes = await makeRequest('POST', '/borrow/check-availability', {
      equipment_id: userTestEquipmentId,
      start_date: borrowStart,
      end_date: borrowEnd
    }, '3');

    assertEqual(checkRes.status, 409, `可用性检查应该返回 409，实际: ${JSON.stringify(checkRes.data)}`);

    const maintenanceConflict = checkRes.data.details.conflicts.find(
      c => c.type === 'maintenance' && c.maintenance_no === userMaintenanceNo
    );
    assertNotNull(maintenanceConflict, '应该找到自己的维修冲突');

    console.log(`   本人报修看到的字段: reporter_id=${maintenanceConflict.reporter_id}, reporter_name=${maintenanceConflict.reporter_name}`);

    assertNotNull(maintenanceConflict.reporter_id, '本人应该看到自己的ID');
    assertEqual(maintenanceConflict.reporter_id, 3, 'ID应该是当前用户ID');
    assertNotNull(maintenanceConflict.reporter_name, '本人应该看到自己的姓名');
    if (maintenanceConflict.reporter_name === '其他用户') {
      throw new Error('本人看到的报修人不应该是"其他用户"');
    }

    await makeRequest('POST', `/maintenance/${userMaintenanceId}/complete`, {
      repair_result: '测试完成'
    }, '1');
  }, ['testEquipmentId']);

  await test('10. 可用性检查接口 - 普通用户和管理员返回格式一致', async () => {
    const borrowStart = moment().add(3, 'days').format('YYYY-MM-DD HH:mm:ss');
    const borrowEnd = moment().add(7, 'days').format('YYYY-MM-DD HH:mm:ss');

    const [userRes, adminRes] = await Promise.all([
      makeRequest('POST', '/borrow/check-availability', {
        equipment_id: testEquipmentId,
        start_date: borrowStart,
        end_date: borrowEnd
      }, '3'),
      makeRequest('POST', '/borrow/check-availability', {
        equipment_id: testEquipmentId,
        start_date: borrowStart,
        end_date: borrowEnd
      }, '1')
    ]);

    assertEqual(userRes.status, 409, `普通用户应该返回 409，实际: ${JSON.stringify(userRes.data)}`);
    assertEqual(adminRes.status, 409, `管理员应该返回 409，实际: ${JSON.stringify(adminRes.data)}`);
    assertEqual(userRes.data.code, 'TIME_SLOT_CONFLICT', '错误码一致');
    assertEqual(adminRes.data.code, 'TIME_SLOT_CONFLICT', '错误码一致');

    const userConflict = userRes.data.details.conflicts.find(c => c.type === 'maintenance');
    const adminConflict = adminRes.data.details.conflicts.find(c => c.type === 'maintenance');

    assertEqual(userConflict.maintenance_no, adminConflict.maintenance_no, '维修单号一致');
    assertEqual(userConflict.overlap_start, adminConflict.overlap_start, '重叠开始时间一致');
    assertEqual(userConflict.overlap_end, adminConflict.overlap_end, '重叠结束时间一致');
    assertEqual(userConflict.status, adminConflict.status, '状态一致');

    console.log(`   普通用户和管理员返回格式一致（仅权限字段有差异）`);
  }, ['testEquipmentId', 'testMaintenanceId', 'testMaintenanceNo']);

  await test('11. 维修完成后时间段释放 - 验证已有链路正常', async () => {
    const completeRes = await makeRequest('POST', `/maintenance/${testMaintenanceId}/complete`, {
      repair_result: '权限测试维修完成'
    }, '1');

    assertEqual(completeRes.status, 200, `维修完成应该成功，实际: ${JSON.stringify(completeRes.data)}`);

    const borrowStart = moment().add(3, 'days').format('YYYY-MM-DD HH:mm:ss');
    const borrowEnd = moment().add(7, 'days').format('YYYY-MM-DD HH:mm:ss');

    const checkRes = await makeRequest('POST', '/borrow/check-availability', {
      equipment_id: testEquipmentId,
      start_date: borrowStart,
      end_date: borrowEnd
    }, '2');

    assertEqual(checkRes.status, 200, `维修完成后时间段应该可用，实际: ${JSON.stringify(checkRes.data)}`);
    assertEqual(checkRes.data.available, true, 'available 应该为 true');

    console.log(`   维修完成后时间段已释放`);
  }, ['testEquipmentId', 'testMaintenanceId']);

  await test('12. 时间段不重叠但设备仍在维修 - 返回 400 EQUIPMENT_IN_MAINTENANCE', async () => {
    const createRes = await makeRequest('POST', '/maintenance', {
      equipment_id: testEquipmentId,
      issue_description: '权限测试-验证A2场景',
      priority: 'normal'
    }, '1');

    assertEqual(createRes.status, 201, `创建维修记录应该成功，实际: ${JSON.stringify(createRes.data)}`);
    const newMaintenanceId = createRes.data.record.id;
    
    const newMaintenanceStart = moment().add(1, 'days').format('YYYY-MM-DD HH:mm:ss');
    const newMaintenanceEnd = moment().add(5, 'days').format('YYYY-MM-DD HH:mm:ss');
    
    const startRes = await makeRequest('POST', `/maintenance/${newMaintenanceId}/start`, {
      estimated_completion_date: newMaintenanceEnd
    }, '1');
    assertEqual(startRes.status, 200, `开始维修应该成功，实际: ${JSON.stringify(startRes.data)}`);

    const borrowStart = moment().add(20, 'days').format('YYYY-MM-DD HH:mm:ss');
    const borrowEnd = moment().add(25, 'days').format('YYYY-MM-DD HH:mm:ss');

    const borrowRes = await makeRequest('POST', '/borrow', {
      equipment_id: testEquipmentId,
      purpose: '权限测试-A2场景',
      start_date: borrowStart,
      end_date: borrowEnd
    }, '2');

    assertEqual(borrowRes.status, 400, `时间段不重叠但设备在维修应该返回 400，实际: ${JSON.stringify(borrowRes.data)}`);
    assertEqual(borrowRes.data.code, 'EQUIPMENT_IN_MAINTENANCE', '错误码应为 EQUIPMENT_IN_MAINTENANCE');

    console.log(`   正确返回 400 EQUIPMENT_IN_MAINTENANCE（时间段不重叠场景）`);

    await makeRequest('POST', `/maintenance/${newMaintenanceId}/complete`, {
      repair_result: '测试完成'
    }, '1');
  }, ['testEquipmentId']);

  console.log('\n' + '='.repeat(80));
  console.log('📊 测试结果汇总');
  console.log('='.repeat(80));
  console.log(`   ✅ 通过: ${passed}`);
  console.log(`   ❌ 失败: ${failed}`);
  console.log(`   📈 总计: ${passed + failed}`);
  console.log('='.repeat(80));

  if (failed > 0) {
    console.log('\n⚠️  有测试失败！');
    process.exit(1);
  } else {
    console.log('\n🎉 所有测试通过！');
    console.log('\n✅ 结论: 维修窗口冲突权限说明已修复');
    console.log('   - 维修窗口冲突返回 409 TIME_SLOT_CONFLICT');
    console.log('   - 管理员可见完整报修人信息');
    console.log('   - 普通用户可见维修单号和重叠时间，报修人信息脱敏');
    console.log('   - 普通借用、边界相邻等已有链路正常');
    process.exit(0);
  }
}

runTests().catch(e => {
  console.error('\n❌ 测试执行失败:', e.message);
  process.exit(1);
});
