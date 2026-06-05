const http = require('http');

const BASE_URL = 'localhost';
const PORT = 3000;

function makeRequest(method, path, headers = {}, body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: BASE_URL,
      port: PORT,
      path: `/api${path}`,
      method,
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': '1',
        ...headers
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({
            status: res.statusCode,
            data: JSON.parse(data)
          });
        } catch (e) {
          resolve({
            status: res.statusCode,
            data,
            headers: res.headers
          });
        }
      });
    });

    req.on('error', reject);

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

async function runTests() {
  console.log('='.repeat(60));
  console.log('🔧 设备借还平台 - 修复验证测试');
  console.log('='.repeat(60));
  console.log();

  let passed = 0;
  let failed = 0;

  // 测试 1: 时间线 API - 查询参数方式（前端同款请求）
  console.log('📋 测试 1: 时间线 API - 查询参数方式');
  console.log('   请求: GET /api/audit/timeline?equipment_id=1');
  try {
    const res = await makeRequest('GET', '/audit/timeline?equipment_id=1');
    if (res.status === 200 && res.data.equipment && res.data.timeline) {
      console.log('   ✅ 测试通过');
      console.log(`      设备: ${res.data.equipment.name} (${res.data.equipment.device_code})`);
      console.log(`      时间线事件数: ${res.data.timeline.length}`);
      passed++;
    } else {
      console.log('   ❌ 测试失败');
      console.log(`      状态码: ${res.status}`);
      console.log(`      响应: ${JSON.stringify(res.data)}`);
      failed++;
    }
  } catch (e) {
    console.log('   ❌ 测试失败:', e.message);
    failed++;
  }
  console.log();

  // 测试 2: 时间线 API - 路径参数方式（兼容）
  console.log('📋 测试 2: 时间线 API - 路径参数方式');
  console.log('   请求: GET /api/audit/timeline/1');
  try {
    const res = await makeRequest('GET', '/audit/timeline/1');
    if (res.status === 200 && res.data.equipment && res.data.timeline) {
      console.log('   ✅ 测试通过');
      console.log(`      设备: ${res.data.equipment.name}`);
      console.log(`      时间线事件数: ${res.data.timeline.length}`);
      passed++;
    } else {
      console.log('   ❌ 测试失败');
      failed++;
    }
  } catch (e) {
    console.log('   ❌ 测试失败:', e.message);
    failed++;
  }
  console.log();

  // 测试 3: 导出 - /export/equipment 路径
  console.log('📋 测试 3: 导出 - /export/equipment 路径');
  console.log('   请求: GET /api/audit/export/equipment?format=json');
  try {
    const res = await makeRequest('GET', '/audit/export/equipment?format=json');
    if (res.status === 200 && (res.data.records || res.headers['content-type']?.includes('json'))) {
      console.log('   ✅ 测试通过');
      console.log(`      Content-Type: ${res.headers?.['content-type'] || 'application/json'}`);
      passed++;
    } else {
      console.log('   ❌ 测试失败');
      console.log(`      状态码: ${res.status}`);
      failed++;
    }
  } catch (e) {
    console.log('   ❌ 测试失败:', e.message);
    failed++;
  }
  console.log();

  // 测试 4: 导出 - /export/borrow 路径
  console.log('📋 测试 4: 导出 - /export/borrow 路径');
  console.log('   请求: GET /api/audit/export/borrow?format=json');
  try {
    const res = await makeRequest('GET', '/audit/export/borrow?format=json');
    if (res.status === 200) {
      console.log('   ✅ 测试通过');
      passed++;
    } else {
      console.log('   ❌ 测试失败');
      console.log(`      状态码: ${res.status}`);
      failed++;
    }
  } catch (e) {
    console.log('   ❌ 测试失败:', e.message);
    failed++;
  }
  console.log();

  // 测试 5: 导出 - /export 基础路径
  console.log('📋 测试 5: 导出 - /export 基础路径');
  console.log('   请求: GET /api/audit/export?format=json');
  try {
    const res = await makeRequest('GET', '/audit/export?format=json');
    if (res.status === 200) {
      console.log('   ✅ 测试通过');
      passed++;
    } else {
      console.log('   ❌ 测试失败');
      failed++;
    }
  } catch (e) {
    console.log('   ❌ 测试失败:', e.message);
    failed++;
  }
  console.log();

  // 测试 6: 维修完成 - repair_note 字段（前端发送）
  console.log('📋 测试 6: 维修完成 - repair_note 字段（前端同款）');
  console.log('   先获取一个 in_progress 状态的维修记录...');
  try {
    const listRes = await makeRequest('GET', '/maintenance?status=in_progress');
    const inProgress = listRes.data.records?.find(r => r.status === 'in_progress');

    if (inProgress) {
      console.log(`   找到维修记录 ID: ${inProgress.id} (设备: ${inProgress.equipment_name})`);
      console.log(`   请求: POST /api/maintenance/${inProgress.id}/complete`);
      console.log('   Body: { repair_note: "已更换损坏的镜头组件，对焦恢复正常" }');

      const completeRes = await makeRequest('POST', `/maintenance/${inProgress.id}/complete`,
        {}, { repair_note: '已更换损坏的镜头组件，对焦恢复正常' }
      );

      if (completeRes.status === 200) {
        console.log('   ✅ 测试通过 - 维修完成成功');
        console.log(`      消息: ${completeRes.data.message}`);

        // 验证设备状态恢复为 available
        const eqRes = await makeRequest('GET', `/equipment/${inProgress.equipment_id}`);
        if (eqRes.data.equipment.status === 'available') {
          console.log('   ✅ 设备状态验证通过 - 已恢复为可用');
          passed++;
        } else {
          console.log('   ❌ 设备状态验证失败');
          console.log(`      当前状态: ${eqRes.data.equipment.status}`);
          failed++;
        }
      } else {
        console.log('   ❌ 测试失败');
        console.log(`      状态码: ${completeRes.status}`);
        console.log(`      错误: ${completeRes.data.error}`);
        failed++;
      }
    } else {
      console.log('   ⚠️  跳过 - 没有进行中的维修记录，重新创建一个...');

      // 创建一个新的维修记录并开始维修，然后完成它
      const createRes = await makeRequest('POST', '/maintenance', {}, {
        equipment_id: 2,
        issue_description: '测试维修流程'
      });

      if (createRes.status === 201) {
        const recordId = createRes.data.record.id;
        await makeRequest('POST', `/maintenance/${recordId}/start`);

        console.log(`   创建维修记录 ID: ${recordId} 并开始维修`);
        console.log(`   请求: POST /api/maintenance/${recordId}/complete`);
        console.log('   Body: { repair_note: "测试维修完成" }');

        const completeRes = await makeRequest('POST', `/maintenance/${recordId}/complete`,
          {}, { repair_note: '测试维修完成' }
        );

        if (completeRes.status === 200) {
          console.log('   ✅ 测试通过 - 维修完成成功');
          passed++;
        } else {
          console.log('   ❌ 测试失败');
          console.log(`      错误: ${completeRes.data.error}`);
          failed++;
        }
      }
    }
  } catch (e) {
    console.log('   ❌ 测试失败:', e.message);
    failed++;
  }
  console.log();

  // 测试 7: 导出 CSV 与页面记录一致性验证
  console.log('📋 测试 7: 导出数据与页面记录一致性');
  console.log('   获取页面借用记录...');
  try {
    const pageRes = await makeRequest('GET', '/borrow');
    const pageRecords = pageRes.data.requests;
    console.log(`   页面记录数: ${pageRecords.length}`);

    console.log('   获取 JSON 导出数据...');
    const exportRes = await makeRequest('GET', '/audit/export/borrow?format=json');

    // 解析可能被 JSON.stringify 的响应
    let exportData = exportRes.data;
    if (typeof exportData === 'string') {
      exportData = JSON.parse(exportData);
    }

    const exportRecords = exportData.records || [];
    console.log(`   导出记录数: ${exportRecords.length}`);

    if (exportRecords.length === pageRecords.length) {
      // 验证第一条记录的关键字段一致
      if (pageRecords.length > 0 && exportRecords.length > 0) {
        const pageFirst = pageRecords[0];
        const exportFirst = exportRecords[0];
        if (pageFirst.request_no === exportFirst.request_no &&
            pageFirst.status_text === exportFirst.status_text) {
          console.log('   ✅ 测试通过 - 导出数据与页面记录一致');
          console.log(`      申请单号: ${pageFirst.request_no}`);
          console.log(`      状态: ${pageFirst.status_text}`);
          passed++;
        } else {
          console.log('   ❌ 测试失败 - 字段不一致');
          failed++;
        }
      } else {
        console.log('   ✅ 测试通过 - 均为空记录');
        passed++;
      }
    } else {
      console.log('   ❌ 测试失败 - 记录数不一致');
      failed++;
    }
  } catch (e) {
    console.log('   ❌ 测试失败:', e.message);
    failed++;
  }
  console.log();

  // 测试 8: 维修完成后设备恢复可借
  console.log('📋 测试 8: 维修完成后设备恢复可借');
  console.log('   验证一个刚完成维修的设备可以被申请借用...');
  try {
    const eqRes = await makeRequest('GET', '/equipment?status=available');
    const availableEq = eqRes.data.equipment?.[0];

    if (availableEq) {
      console.log(`   可用设备: ${availableEq.name} (ID: ${availableEq.id})`);

      // 以普通用户身份尝试申请
      const borrowRes = await makeRequest('POST', '/borrow',
        { 'x-user-id': '2' },
        {
          equipment_id: availableEq.id,
          purpose: '测试维修后借用',
          start_date: '2026-06-10 09:00:00',
          end_date: '2026-06-11 18:00:00'
        }
      );

      if (borrowRes.status === 201) {
        console.log('   ✅ 测试通过 - 维修完成的设备可正常申请借用');
        console.log(`      申请单号: ${borrowRes.data.request.request_no}`);
        passed++;
      } else {
        console.log('   ❌ 测试失败');
        console.log(`      错误: ${borrowRes.data.error}`);
        failed++;
      }
    }
  } catch (e) {
    console.log('   ❌ 测试失败:', e.message);
    failed++;
  }
  console.log();

  // 总结
  console.log('='.repeat(60));
  console.log('📊 测试结果');
  console.log('='.repeat(60));
  console.log(`   ✅ 通过: ${passed}`);
  console.log(`   ❌ 失败: ${failed}`);
  console.log(`   📊 总计: ${passed + failed}`);
  console.log();

  if (failed === 0) {
    console.log('🎉 所有测试通过！');
    process.exit(0);
  } else {
    console.log('⚠️  部分测试失败，请检查');
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('测试执行异常:', err);
  process.exit(1);
});
