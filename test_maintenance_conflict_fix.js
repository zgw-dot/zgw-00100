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
          const parsed = body ? JSON.parse(body) : {};
          resolve({ statusCode: res.statusCode, data: parsed });
        } catch (e) {
          resolve({ statusCode: res.statusCode, data: body });
        }
      });
    });

    req.on('error', reject);

    if (data && method !== 'GET') {
      req.write(JSON.stringify(data));
    }
    req.end();
  });
}

async function waitForServer() {
  console.log('⏳ 等待服务器启动...');
  for (let i = 0; i < 30; i++) {
    try {
      await makeRequest('GET', '/users/me');
      console.log('✅ 服务器已就绪\n');
      return;
    } catch (e) {
      await new Promise(r => setTimeout(r, 1000));
    }
  }
  throw new Error('服务器超时未启动');
}

async function runTests() {
  console.log('\n' + '='.repeat(80));
  console.log('🔧 维修窗口冲突修复 - 复现/回归测试');
  console.log('='.repeat(80) + '\n');

  await waitForServer();

  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    console.log(`🧪 测试: ${name}`);
    try {
      await fn();
      console.log(`   ✅ 通过\n`);
      passed++;
    } catch (e) {
      console.log(`   ❌ 失败: ${e.message}\n`);
      failed++;
    }
  }

  let testEquipmentId = null;
  let testMaintenanceId = null;

  await test('1. 初始化 - 创建测试设备', async () => {
    const createRes = await makeRequest('POST', '/equipment', {
      device_code: 'TEST-MAINT-FIX',
      name: '维修冲突测试设备',
      category: '测试设备',
      model: 'Test Model',
      location: '测试区',
      description: '用于测试维修窗口冲突修复',
      status: 'available'
    }, '1');

    if (createRes.statusCode !== 201) {
      throw new Error(`创建设备失败: ${JSON.stringify(createRes.data)}`);
    }
    testEquipmentId = createRes.data.equipment.id;
    console.log(`   设备ID: ${testEquipmentId}`);
  });

  await test('2. 普通借用（无冲突）- 验证已有链路正常', async () => {
    const baseDate = moment().add(10, 'days').startOf('hour');
    const start1 = baseDate.clone().format('YYYY-MM-DD HH:mm:ss');
    const end1 = baseDate.clone().add(2, 'days').format('YYYY-MM-DD HH:mm:ss');

    const createRes = await makeRequest('POST', '/borrow', {
      equipment_id: testEquipmentId,
      purpose: '普通借用测试',
      start_date: start1,
      end_date: end1
    }, '2');

    if (createRes.statusCode !== 201) {
      throw new Error(`普通借用失败: ${JSON.stringify(createRes.data)}`);
    }
    console.log(`   借用申请创建成功: ${createRes.data.request.request_no}`);
  });

  await test('3. 边界相邻不冲突 - 验证已有链路正常', async () => {
    const baseDate = moment().add(10, 'days').startOf('hour');
    const start2 = baseDate.clone().add(2, 'days').format('YYYY-MM-DD HH:mm:ss');
    const end2 = baseDate.clone().add(4, 'days').format('YYYY-MM-DD HH:mm:ss');

    const createRes = await makeRequest('POST', '/borrow', {
      equipment_id: testEquipmentId,
      purpose: '边界相邻测试',
      start_date: start2,
      end_date: end2
    }, '3');

    if (createRes.statusCode !== 201) {
      throw new Error(`边界相邻申请失败: ${JSON.stringify(createRes.data)}`);
    }
    console.log(`   相邻申请创建成功: ${createRes.data.request.request_no}`);
  });

  await test('4. 取消之前的申请以释放时间段', async () => {
    const requestsRes = await makeRequest('GET', `/borrow?equipment_id=${testEquipmentId}`, {}, '1');
    let requests = [];
    if (requestsRes.data && requestsRes.data.requests) {
      requests = requestsRes.data.requests;
    } else if (Array.isArray(requestsRes.data)) {
      requests = requestsRes.data;
    }
    
    const pendingRequests = requests.filter(r => r.status === 'pending');
    for (const req of pendingRequests) {
      const cancelRes = await makeRequest('POST', `/borrow/${req.id}/cancel`, {}, '1');
      if (cancelRes.statusCode !== 200) {
        throw new Error(`取消申请失败: ${JSON.stringify(cancelRes.data)}`);
      }
      console.log(`   已取消申请 ${req.id} (${req.request_no})`);
    }
  });

  await test('5. 创建维修记录并开始维修', async () => {
    const createRes = await makeRequest('POST', '/maintenance', {
      equipment_id: testEquipmentId,
      issue_description: '维修冲突测试 - 设备需要维修',
      priority: 'high'
    }, '1');

    if (createRes.statusCode !== 201) {
      throw new Error(`创建维修记录失败: ${JSON.stringify(createRes.data)}`);
    }
    testMaintenanceId = createRes.data.record.id;

    const maintenanceEnd = moment().add(10, 'days').format('YYYY-MM-DD HH:mm:ss');

    const startRes = await makeRequest('POST', `/maintenance/${testMaintenanceId}/start`, {
      technician_id: 1,
      estimated_completion_date: maintenanceEnd
    }, '1');

    if (startRes.statusCode !== 200) {
      throw new Error(`开始维修失败: ${JSON.stringify(startRes.data)}`);
    }
    console.log(`   维修记录 ${testMaintenanceId} 已开始，预计 ${maintenanceEnd} 完成`);
  });

  await test('6. 提交重叠借用 - 应返回 409 TIME_SLOT_CONFLICT', async () => {
    const borrowStart = moment().add(2, 'days').format('YYYY-MM-DD HH:mm:ss');
    const borrowEnd = moment().add(5, 'days').format('YYYY-MM-DD HH:mm:ss');

    const createRes = await makeRequest('POST', '/borrow', {
      equipment_id: testEquipmentId,
      purpose: '测试维修窗口冲突',
      start_date: borrowStart,
      end_date: borrowEnd
    }, '2');

    if (createRes.statusCode !== 409) {
      throw new Error(`应该返回 409，但返回了 ${createRes.statusCode}: ${JSON.stringify(createRes.data)}`);
    }

    if (createRes.data.code !== 'TIME_SLOT_CONFLICT') {
      throw new Error(`错误码应该是 TIME_SLOT_CONFLICT，实际是 ${createRes.data.code}`);
    }

    const conflict = createRes.data.details.conflicts[0];
    if (!conflict) {
      throw new Error('应该包含冲突详情');
    }

    if (conflict.type !== 'maintenance') {
      throw new Error(`冲突类型应该是 maintenance，实际是 ${conflict.type}`);
    }

    if (!conflict.maintenance_no) {
      throw new Error('应该包含 maintenance_no');
    }

    if (!conflict.overlap_start || !conflict.overlap_end) {
      throw new Error('应该包含 overlap_start 和 overlap_end');
    }

    console.log(`   正确返回 409 TIME_SLOT_CONFLICT`);
    console.log(`   维修单号: ${conflict.maintenance_no}`);
    console.log(`   重叠时间: ${conflict.overlap_start} ~ ${conflict.overlap_end}`);
    console.log(`   维修时间段: ${conflict.start_date} ~ ${conflict.end_date}`);
  });

  await test('7. 可用性检查接口也应返回统一格式', async () => {
    const borrowStart = moment().add(2, 'days').format('YYYY-MM-DD HH:mm:ss');
    const borrowEnd = moment().add(5, 'days').format('YYYY-MM-DD HH:mm:ss');

    const checkRes = await makeRequest('POST', '/borrow/check-availability', {
      equipment_id: testEquipmentId,
      start_date: borrowStart,
      end_date: borrowEnd
    }, '2');

    if (checkRes.statusCode !== 409 || checkRes.data.code !== 'TIME_SLOT_CONFLICT') {
      throw new Error(`可用性检查应该返回 TIME_SLOT_CONFLICT: ${JSON.stringify(checkRes.data)}`);
    }

    const conflict = checkRes.data.details.conflicts[0];
    if (!conflict.maintenance_no || !conflict.overlap_start || !conflict.overlap_end) {
      throw new Error('可用性检查也应该包含维修单号和重叠时间');
    }

    console.log(`   可用性检查接口也返回统一格式`);
    console.log(`   维修单号: ${conflict.maintenance_no}`);
    console.log(`   重叠时间: ${conflict.overlap_start} ~ ${conflict.overlap_end}`);
  });

  await test('8. 普通用户只能看到有权限的字段', async () => {
    const borrowStart = moment().add(2, 'days').format('YYYY-MM-DD HH:mm:ss');
    const borrowEnd = moment().add(5, 'days').format('YYYY-MM-DD HH:mm:ss');

    const checkRes = await makeRequest('POST', '/borrow/check-availability', {
      equipment_id: testEquipmentId,
      start_date: borrowStart,
      end_date: borrowEnd
    }, '3');

    const conflict = checkRes.data.details.conflicts[0];
    
    console.log(`   普通用户看到的冲突字段: ${Object.keys(conflict).join(', ')}`);
    console.log(`   reporter_id: ${conflict.reporter_id}, reporter_name: ${conflict.reporter_name}`);
    
    if (conflict.reporter_id !== null && conflict.reporter_id !== undefined) {
      throw new Error('普通用户不应该看到真实的维修申请人ID');
    }
    
    if (conflict.reporter_name !== '其他用户') {
      throw new Error('普通用户看到的报修人应该显示为"其他用户"');
    }

    if (!conflict.maintenance_no || !conflict.overlap_start || !conflict.overlap_end) {
      throw new Error('普通用户应该看到维修单号和重叠时间');
    }

    console.log(`   普通用户权限控制正确`);
  });

  await test('9. 管理员可以看到完整信息', async () => {
    const borrowStart = moment().add(2, 'days').format('YYYY-MM-DD HH:mm:ss');
    const borrowEnd = moment().add(5, 'days').format('YYYY-MM-DD HH:mm:ss');

    const checkRes = await makeRequest('POST', '/borrow/check-availability', {
      equipment_id: testEquipmentId,
      start_date: borrowStart,
      end_date: borrowEnd
    }, '1');

    const conflict = checkRes.data.details.conflicts[0];
    
    if (!conflict.reporter_id || conflict.reporter_id === null) {
      throw new Error('管理员应该看到维修申请人完整ID');
    }
    
    if (!conflict.reporter_name || conflict.reporter_name === '其他用户') {
      throw new Error('管理员应该看到维修申请人真实姓名');
    }

    console.log(`   管理员权限控制正确`);
    console.log(`   报修人: ${conflict.reporter_name} (ID: ${conflict.reporter_id})`);
  });

  await test('10. 维修完成后时间段释放', async () => {
    const completeRes = await makeRequest('POST', `/maintenance/${testMaintenanceId}/complete`, {
      repair_result: '测试维修完成',
      repair_cost: 100
    }, '1');

    if (completeRes.statusCode !== 200) {
      throw new Error(`完成维修失败: ${JSON.stringify(completeRes.data)}`);
    }

    const borrowStart = moment().add(2, 'days').format('YYYY-MM-DD HH:mm:ss');
    const borrowEnd = moment().add(5, 'days').format('YYYY-MM-DD HH:mm:ss');

    const checkRes = await makeRequest('POST', '/borrow/check-availability', {
      equipment_id: testEquipmentId,
      start_date: borrowStart,
      end_date: borrowEnd
    }, '2');

    if (checkRes.statusCode !== 200 || checkRes.data.available !== true) {
      throw new Error(`维修完成后时间段应该可用: ${JSON.stringify(checkRes.data)}`);
    }

    console.log(`   维修完成后时间段已释放`);
  });

  await test('11. 审计日志记录验证', async () => {
    const logsRes = await makeRequest('GET', '/audit/logs', {}, '1');
    if (logsRes.statusCode !== 200) {
      throw new Error(`获取审计日志失败: ${JSON.stringify(logsRes.data)}`);
    }

    const blockedLogs = logsRes.data.logs.filter(l => 
      l.action === 'BORROW_REQUEST_BLOCKED_BY_CONFLICT');
    const availabilityLogs = logsRes.data.logs.filter(l => 
      l.action === 'CHECK_AVAILABILITY');

    if (blockedLogs.length === 0) {
      throw new Error('应该有冲突拦截的审计日志');
    }

    if (availabilityLogs.length === 0) {
      throw new Error('应该有可用性检查的审计日志');
    }

    console.log(`   审计日志记录正常`);
    console.log(`   冲突拦截日志: ${blockedLogs.length} 条`);
    console.log(`   可用性检查日志: ${availabilityLogs.length} 条`);
  });

  console.log('='.repeat(80));
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
    console.log('\n✅ 结论: 维修窗口冲突已修复，返回统一的 TIME_SLOT_CONFLICT 格式');
    process.exit(0);
  }
}

runTests().catch(e => {
  console.error('\n❌ 测试执行失败:', e.message);
  process.exit(1);
});
