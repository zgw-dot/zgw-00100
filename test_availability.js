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

let testEquipmentId = null;
let testBorrowRequestId = null;
let testMaintenanceId = null;

async function runTests() {
  console.log('\n' + '='.repeat(80));
  console.log('📋 预约可用性能力 - 综合测试脚本');
  console.log('='.repeat(80) + '\n');

  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    console.log(`\n🧪 测试: ${name}`);
    try {
      await fn();
      console.log(`   ✅ 通过`);
      passed++;
    } catch (e) {
      console.log(`   ❌ 失败: ${e.message}`);
      failed++;
    }
  }

  await test('1. 初始化 - 创建测试设备', async () => {
    const res = await makeRequest('POST', '/equipment', {
      device_code: 'TEST-AVAIL-' + Date.now(),
      name: '可用性测试设备',
      category: '测试设备',
      model: 'TEST-MODEL',
      location: '测试区',
      description: '用于预约可用性测试的设备'
    }, '1');

    if (res.statusCode !== 201) {
      throw new Error(`创建设备失败: ${res.statusCode} - ${JSON.stringify(res.data)}`);
    }
    testEquipmentId = res.data.equipment.id;
    console.log(`   设备ID: ${testEquipmentId}`);
  });

  const baseDate = moment().add(1, 'days').startOf('hour');

  await test('2. 无冲突申请 - 应该成功', async () => {
    const startDate = baseDate.clone().format('YYYY-MM-DD HH:mm:ss');
    const endDate = baseDate.clone().add(2, 'hours').format('YYYY-MM-DD HH:mm:ss');

    const checkRes = await makeRequest('POST', '/borrow/check-availability', {
      equipment_id: testEquipmentId,
      start_date: startDate,
      end_date: endDate
    }, '2');

    if (checkRes.statusCode !== 200 || checkRes.data.available !== true) {
      throw new Error(`可用性检查失败: ${JSON.stringify(checkRes.data)}`);
    }

    const createRes = await makeRequest('POST', '/borrow', {
      equipment_id: testEquipmentId,
      purpose: '无冲突测试申请',
      start_date: startDate,
      end_date: endDate
    }, '2');

    if (createRes.statusCode !== 201) {
      throw new Error(`创建申请失败: ${createRes.statusCode} - ${JSON.stringify(createRes.data)}`);
    }

    testBorrowRequestId = createRes.data.request.id;
    console.log(`   申请ID: ${testBorrowRequestId}, 申请单号: ${createRes.data.request.request_no}`);
  });

  await test('3. 边界相邻不冲突 - 应该成功', async () => {
    const startDate = baseDate.clone().add(2, 'hours').format('YYYY-MM-DD HH:mm:ss');
    const endDate = baseDate.clone().add(4, 'hours').format('YYYY-MM-DD HH:mm:ss');

    const checkRes = await makeRequest('POST', '/borrow/check-availability', {
      equipment_id: testEquipmentId,
      start_date: startDate,
      end_date: endDate
    }, '3');

    if (checkRes.statusCode !== 200 || checkRes.data.available !== true) {
      throw new Error(`边界相邻时间应该可用: ${JSON.stringify(checkRes.data)}`);
    }

    const createRes = await makeRequest('POST', '/borrow', {
      equipment_id: testEquipmentId,
      purpose: '边界相邻测试申请',
      start_date: startDate,
      end_date: endDate
    }, '3');

    if (createRes.statusCode !== 201) {
      throw new Error(`边界相邻申请失败: ${JSON.stringify(createRes.data)}`);
    }
    console.log(`   相邻申请创建成功: ${createRes.data.request.request_no}`);
  });

  await test('4. 时间重叠被拒 - 应该返回冲突', async () => {
    const conflictStart = baseDate.clone().add(1, 'hours').format('YYYY-MM-DD HH:mm:ss');
    const conflictEnd = baseDate.clone().add(3, 'hours').format('YYYY-MM-DD HH:mm:ss');

    const checkRes = await makeRequest('POST', '/borrow/check-availability', {
      equipment_id: testEquipmentId,
      start_date: conflictStart,
      end_date: conflictEnd
    }, '4');

    if (checkRes.statusCode !== 409 || checkRes.data.code !== 'TIME_SLOT_CONFLICT') {
      throw new Error(`时间重叠应该返回冲突: ${JSON.stringify(checkRes.data)}`);
    }

    if (!checkRes.data.details?.conflicts || checkRes.data.details.conflicts.length === 0) {
      throw new Error('应该返回冲突详情');
    }

    const conflict = checkRes.data.details.conflicts[0];
    if (!conflict.overlap_start || !conflict.overlap_end) {
      throw new Error('冲突应该包含重叠时间段');
    }
    if (!conflict.request_no) {
      throw new Error('冲突应该包含申请单号');
    }

    console.log(`   正确检测到冲突: ${conflict.request_no}, 重叠: ${conflict.overlap_start} ~ ${conflict.overlap_end}`);

    const createRes = await makeRequest('POST', '/borrow', {
      equipment_id: testEquipmentId,
      purpose: '时间重叠测试申请',
      start_date: conflictStart,
      end_date: conflictEnd
    }, '4');

    if (createRes.statusCode !== 409 || createRes.data.code !== 'TIME_SLOT_CONFLICT') {
      throw new Error(`创建重叠申请应该被拒绝: ${JSON.stringify(createRes.data)}`);
    }
  });

  await test('5. 权限差异 - 普通用户看不到其他用户信息', async () => {
    const conflictStart = baseDate.clone().add(1, 'hours').format('YYYY-MM-DD HH:mm:ss');
    const conflictEnd = baseDate.clone().add(3, 'hours').format('YYYY-MM-DD HH:mm:ss');

    const userRes = await makeRequest('POST', '/borrow/check-availability', {
      equipment_id: testEquipmentId,
      start_date: conflictStart,
      end_date: conflictEnd
    }, '3');

    const userConflict = userRes.data.details.conflicts[0];
    if (userConflict.applicant_id !== null || userConflict.applicant_name !== '其他用户') {
      throw new Error(`普通用户不应该看到其他用户的身份信息: ${JSON.stringify(userConflict)}`);
    }
    console.log(`   普通用户看到: 申请人="${userConflict.applicant_name}"`);

    const adminRes = await makeRequest('POST', '/borrow/check-availability', {
      equipment_id: testEquipmentId,
      start_date: conflictStart,
      end_date: conflictEnd
    }, '1');

    const adminConflict = adminRes.data.details.conflicts[0];
    if (!adminConflict.applicant_id || adminConflict.applicant_name === '其他用户') {
      throw new Error(`管理员应该看到完整的用户信息: ${JSON.stringify(adminConflict)}`);
    }
    console.log(`   管理员看到: 申请人ID=${adminConflict.applicant_id}, 姓名="${adminConflict.applicant_name}"`);
  });

  await test('6. 取消申请后释放时间段', async () => {
    const cancelRes = await makeRequest('POST', `/borrow/${testBorrowRequestId}/cancel`, {}, '2');
    if (cancelRes.statusCode !== 200) {
      throw new Error(`取消申请失败: ${JSON.stringify(cancelRes.data)}`);
    }

    const startDate = baseDate.clone().format('YYYY-MM-DD HH:mm:ss');
    const endDate = baseDate.clone().add(2, 'hours').format('YYYY-MM-DD HH:mm:ss');

    const checkRes = await makeRequest('POST', '/borrow/check-availability', {
      equipment_id: testEquipmentId,
      start_date: startDate,
      end_date: endDate
    }, '2');

    if (checkRes.statusCode !== 200 || checkRes.data.available !== true) {
      throw new Error(`取消后时间段应该可用: ${JSON.stringify(checkRes.data)}`);
    }
    console.log(`   取消申请 ${testBorrowRequestId} 后，时间段已释放`);
  });

  let testRequest3Id = null;
  await test('6.5 取消测试3的申请以释放时间段', async () => {
    const requestsRes = await makeRequest('GET', '/borrow?equipment_id=' + testEquipmentId, {}, '1');
    let requests = [];
    if (requestsRes.data && requestsRes.data.requests) {
      requests = requestsRes.data.requests;
    } else if (Array.isArray(requestsRes.data)) {
      requests = requestsRes.data;
    }
    
    const pendingRequests = requests.filter(r => r.status === 'pending');
    for (const pendingRequest of pendingRequests) {
      testRequest3Id = pendingRequest.id;
      const cancelRes = await makeRequest('POST', `/borrow/${pendingRequest.id}/cancel`, {}, '1');
      if (cancelRes.statusCode !== 200) {
        throw new Error(`取消申请失败: ${JSON.stringify(cancelRes.data)}`);
      }
      console.log(`   已取消申请 ${pendingRequest.id} (${pendingRequest.request_no})`);
    }
  });

  await test('6.6 取消所有approved状态的申请', async () => {
    const requestsRes = await makeRequest('GET', '/borrow?equipment_id=' + testEquipmentId, {}, '1');
    let requests = [];
    if (requestsRes.data && requestsRes.data.requests) {
      requests = requestsRes.data.requests;
    } else if (Array.isArray(requestsRes.data)) {
      requests = requestsRes.data;
    }
    
    const approvedRequests = requests.filter(r => r.status === 'approved');
    for (const req of approvedRequests) {
      const cancelRes = await makeRequest('POST', `/borrow/${req.id}/cancel`, {}, '1');
      if (cancelRes.statusCode !== 200) {
        throw new Error(`取消申请失败: ${JSON.stringify(cancelRes.data)}`);
      }
      console.log(`   已取消approved申请 ${req.id} (${req.request_no})`);
    }
  });

  const farFutureDate = moment().add(20, 'days').startOf('hour');

  await test('7. 创建维修记录并开始维修', async () => {
    const createRes = await makeRequest('POST', '/maintenance', {
      equipment_id: testEquipmentId,
      issue_description: '可用性测试 - 设备需要维修',
      priority: 'high'
    }, '1');

    if (createRes.statusCode !== 201) {
      throw new Error(`创建维修记录失败: ${JSON.stringify(createRes.data)}`);
    }
    testMaintenanceId = createRes.data.record.id;

    const maintenanceEnd = farFutureDate.clone().add(10, 'days').format('YYYY-MM-DD HH:mm:ss');

    const startRes = await makeRequest('POST', `/maintenance/${testMaintenanceId}/start`, {
      technician_id: 1,
      estimated_completion_date: maintenanceEnd
    }, '1');

    if (startRes.statusCode !== 200) {
      throw new Error(`开始维修失败: ${JSON.stringify(startRes.data)}`);
    }
    console.log(`   维修记录 ${testMaintenanceId} 已开始，预计 ${maintenanceEnd} 完成`);
  });

  await test('8. 维修窗口冲突 - 维修中无法借用', async () => {
    const borrowStart = moment().add(1, 'days').format('YYYY-MM-DD HH:mm:ss');
    const borrowEnd = moment().add(5, 'days').format('YYYY-MM-DD HH:mm:ss');

    const checkRes = await makeRequest('POST', '/borrow/check-availability', {
      equipment_id: testEquipmentId,
      start_date: borrowStart,
      end_date: borrowEnd
    }, '2');

    if (checkRes.statusCode !== 409 || checkRes.data.code !== 'TIME_SLOT_CONFLICT') {
      throw new Error(`维修期间应该返回冲突: ${JSON.stringify(checkRes.data)}`);
    }

    const conflict = checkRes.data.details.conflicts.find(c => c.type === 'maintenance');
    if (!conflict) {
      throw new Error('应该检测到维修冲突');
    }
    if (!conflict.maintenance_no) {
      throw new Error('维修冲突应该包含维修单号');
    }

    console.log(`   正确检测到维修冲突: ${conflict.maintenance_no}, 重叠: ${conflict.overlap_start} ~ ${conflict.overlap_end}`);
  });

  await test('9. 维修完成后释放时间段', async () => {
    const completeRes = await makeRequest('POST', `/maintenance/${testMaintenanceId}/complete`, {
      repair_result: '测试维修完成，设备已修复',
      repair_cost: 100
    }, '1');

    if (completeRes.statusCode !== 200) {
      throw new Error(`完成维修失败: ${JSON.stringify(completeRes.data)}`);
    }

    const borrowStart = moment().add(1, 'days').format('YYYY-MM-DD HH:mm:ss');
    const borrowEnd = moment().add(5, 'days').format('YYYY-MM-DD HH:mm:ss');

    const checkRes = await makeRequest('POST', '/borrow/check-availability', {
      equipment_id: testEquipmentId,
      start_date: borrowStart,
      end_date: borrowEnd
    }, '2');

    if (checkRes.statusCode !== 200 || checkRes.data.available !== true) {
      throw new Error(`维修完成后时间段应该可用: ${JSON.stringify(checkRes.data)}`);
    }
    console.log(`   维修完成后，时间段已释放`);
  });

  let outerRequestId = null;
  await test('10. 完全包含的时间段冲突', async () => {
    const start1 = farFutureDate.clone().add(30, 'days').format('YYYY-MM-DD HH:mm:ss');
    const end1 = farFutureDate.clone().add(40, 'days').format('YYYY-MM-DD HH:mm:ss');

    const create1 = await makeRequest('POST', '/borrow', {
      equipment_id: testEquipmentId,
      purpose: '外层时间段申请',
      start_date: start1,
      end_date: end1
    }, '2');
    if (create1.statusCode !== 201) throw new Error('创建外层申请失败: ' + JSON.stringify(create1.data));
    outerRequestId = create1.data.request?.id || create1.data.id;

    const start2 = farFutureDate.clone().add(32, 'days').format('YYYY-MM-DD HH:mm:ss');
    const end2 = farFutureDate.clone().add(38, 'days').format('YYYY-MM-DD HH:mm:ss');

    const checkRes = await makeRequest('POST', '/borrow/check-availability', {
      equipment_id: testEquipmentId,
      start_date: start2,
      end_date: end2
    }, '3');

    if (checkRes.statusCode !== 409) {
      throw new Error('完全包含的时间段应该冲突: ' + JSON.stringify(checkRes.data));
    }
    console.log(`   正确检测到完全包含的时间段冲突`);
  });

  await test('11. 部分重叠的时间段冲突', async () => {
    const start = farFutureDate.clone().add(38, 'days').format('YYYY-MM-DD HH:mm:ss');
    const end = farFutureDate.clone().add(45, 'days').format('YYYY-MM-DD HH:mm:ss');

    const checkRes = await makeRequest('POST', '/borrow/check-availability', {
      equipment_id: testEquipmentId,
      start_date: start,
      end_date: end
    }, '3');

    if (checkRes.statusCode !== 409) {
      throw new Error('部分重叠的时间段应该冲突');
    }
    console.log(`   正确检测到部分重叠的时间段冲突`);
  });

  await test('12. 审计日志记录', async () => {
    await new Promise(r => setTimeout(r, 500));
    
    const logsRes = await makeRequest('GET', '/audit/logs', {}, '1');
    if (logsRes.statusCode !== 200) {
      throw new Error(`获取审计日志失败: status=${logsRes.statusCode}, data=${JSON.stringify(logsRes.data)}`);
    }

    if (!logsRes.data.logs || !Array.isArray(logsRes.data.logs)) {
      throw new Error(`审计日志格式错误: ${JSON.stringify(logsRes.data)}`);
    }

    const availabilityLogs = logsRes.data.logs.filter(l => l.action === 'CHECK_AVAILABILITY');
    const conflictLogs = logsRes.data.logs.filter(l => l.action === 'BORROW_REQUEST_BLOCKED_BY_CONFLICT');
    const passedLogs = logsRes.data.logs.filter(l => l.action === 'BORROW_REQUEST_AVAILABILITY_PASSED');

    console.log(`   可用性检查日志(CHECK_AVAILABILITY): ${availabilityLogs.length} 条`);
    console.log(`   通过检查日志(BORROW_REQUEST_AVAILABILITY_PASSED): ${passedLogs.length} 条`);
    console.log(`   冲突拦截日志(BORROW_REQUEST_BLOCKED_BY_CONFLICT): ${conflictLogs.length} 条`);

    if (availabilityLogs.length === 0 && passedLogs.length === 0 && conflictLogs.length === 0) {
      console.log(`   所有日志类型: ${[...new Set(logsRes.data.logs.map(l => l.action))].join(', ')}`);
      throw new Error('应该有可用性相关的审计日志');
    }

    if (conflictLogs.length > 0) {
      try {
        const logDetails = typeof conflictLogs[0].details === 'string' 
          ? JSON.parse(conflictLogs[0].details) 
          : conflictLogs[0].details;
        
        if (logDetails.conflict_count !== undefined || logDetails.conflicts) {
          console.log(`   冲突日志详情: ${logDetails.conflict_count || logDetails.conflicts?.length || 0} 个冲突`);
        }
      } catch (e) {
        console.log(`   冲突日志详情解析失败: ${conflictLogs[0].details}`);
      }
    }
  });

  console.log('\n' + '='.repeat(80));
  console.log('📊 测试结果汇总');
  console.log('='.repeat(80));
  console.log(`   ✅ 通过: ${passed}`);
  console.log(`   ❌ 失败: ${failed}`);
  console.log(`   📈 总计: ${passed + failed}`);
  console.log('='.repeat(80));

  if (failed > 0) {
    console.log('\n⚠️  有测试失败，请检查代码！');
    process.exit(1);
  } else {
    console.log('\n🎉 所有测试通过！');
    console.log('\n📝 人工验证步骤:');
    console.log('   1. 重启服务: Ctrl+C 停止，然后 npm start');
    console.log('   2. 运行测试脚本: node test_availability.js');
    console.log('   3. 验证重启后冲突检测仍然生效');
    console.log('   4. 在前端页面验证可用性实时提示功能');
    process.exit(0);
  }
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

async function main() {
  try {
    await waitForServer();
    await runTests();
  } catch (e) {
    console.error('\n❌ 测试执行失败:', e.message);
    process.exit(1);
  }
}

main();
