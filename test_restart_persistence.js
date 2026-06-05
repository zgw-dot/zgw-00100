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

async function runRestartTest() {
  console.log('\n' + '='.repeat(80));
  console.log('🔄 服务重启后冲突检测 - 验证脚本');
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

  const farFutureDate = moment().add(20, 'days').startOf('hour');
  const testEquipmentId = 10;

  await test('验证服务重启后，之前创建的借用申请仍然存在并产生冲突', async () => {
    const checkStart = farFutureDate.clone().add(32, 'days').format('YYYY-MM-DD HH:mm:ss');
    const checkEnd = farFutureDate.clone().add(38, 'days').format('YYYY-MM-DD HH:mm:ss');

    const checkRes = await makeRequest('POST', '/borrow/check-availability', {
      equipment_id: testEquipmentId,
      start_date: checkStart,
      end_date: checkEnd
    }, '3');

    if (checkRes.statusCode !== 409 || checkRes.data.code !== 'TIME_SLOT_CONFLICT') {
      throw new Error(`重启后应该仍然检测到冲突: ${JSON.stringify(checkRes.data)}`);
    }

    const conflict = checkRes.data.details.conflicts[0];
    console.log(`   重启后检测到冲突: ${conflict.request_no}`);
    console.log(`   冲突类型: ${conflict.type}, 状态: ${conflict.status}`);
    console.log(`   重叠时间: ${conflict.overlap_start} ~ ${conflict.overlap_end}`);
  });

  await test('验证服务重启后，可以创建新的无冲突申请', async () => {
    const newStart = farFutureDate.clone().add(50, 'days').format('YYYY-MM-DD HH:mm:ss');
    const newEnd = farFutureDate.clone().add(55, 'days').format('YYYY-MM-DD HH:mm:ss');

    const checkRes = await makeRequest('POST', '/borrow/check-availability', {
      equipment_id: testEquipmentId,
      start_date: newStart,
      end_date: newEnd
    }, '2');

    if (checkRes.statusCode !== 200 || checkRes.data.available !== true) {
      throw new Error(`新时间段应该可用: ${JSON.stringify(checkRes.data)}`);
    }

    const createRes = await makeRequest('POST', '/borrow', {
      equipment_id: testEquipmentId,
      purpose: '重启后创建的新申请',
      start_date: newStart,
      end_date: newEnd
    }, '2');

    if (createRes.statusCode !== 201) {
      throw new Error(`创建新申请失败: ${JSON.stringify(createRes.data)}`);
    }

    console.log(`   新申请创建成功: ${createRes.data.request.request_no}`);
  });

  await test('验证服务重启后，审计日志仍然完整', async () => {
    const logsRes = await makeRequest('GET', '/audit/logs', {}, '1');
    if (logsRes.statusCode !== 200) {
      throw new Error(`获取审计日志失败: ${JSON.stringify(logsRes.data)}`);
    }

    const availabilityLogs = logsRes.data.logs.filter(l => 
      l.action === 'CHECK_AVAILABILITY' || 
      l.action === 'BORROW_REQUEST_BLOCKED_BY_CONFLICT' ||
      l.action === 'BORROW_REQUEST_AVAILABILITY_PASSED'
    );

    if (availabilityLogs.length === 0) {
      throw new Error('重启后审计日志应该仍然存在');
    }

    console.log(`   审计日志完整，共 ${availabilityLogs.length} 条可用性相关记录`);
  });

  await test('验证服务重启后，维修记录的时间段冲突检测仍然生效', async () => {
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

    console.log(`   维修完成后的时间段冲突检测正常`);
  });

  console.log('='.repeat(80));
  console.log('📊 重启验证结果汇总');
  console.log('='.repeat(80));
  console.log(`   ✅ 通过: ${passed}`);
  console.log(`   ❌ 失败: ${failed}`);
  console.log(`   📈 总计: ${passed + failed}`);
  console.log('='.repeat(80));

  if (failed > 0) {
    console.log('\n⚠️  有测试失败，重启后数据可能未正确持久化！');
    process.exit(1);
  } else {
    console.log('\n🎉 所有重启验证通过！');
    console.log('\n✅ 结论: 冲突规则跨服务重启后仍然生效，数据持久化正常');
    process.exit(0);
  }
}

runRestartTest().catch(e => {
  console.error('\n❌ 测试执行失败:', e.message);
  process.exit(1);
});
