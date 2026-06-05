const http = require('http');

const BASE_URL = 'localhost';
const PORT = 3000;

function curl(method, path, headers, body) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: BASE_URL,
      port: PORT,
      path: '/api' + path,
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
            data: JSON.parse(data),
            headers: res.headers
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

async function verify() {
  console.log('======================================================================');
  console.log('  curl 验证 - 用户可见链路');
  console.log('======================================================================');
  console.log();

  let allPassed = true;

  // ========== 链路 1: 时间线请求（前端同款）
  console.log('  链路 1: 时间线 - 查询参数方式');
  console.log('    前端同款请求: GET /api/audit/timeline?equipment_id=1');
  const tlRes = await curl('GET', '/audit/timeline?equipment_id=1');
  console.log('    状态码: ' + tlRes.status);
  if (tlRes.status === 200 && tlRes.data.equipment) {
    console.log('    ✅ 通过 - 设备: ' + tlRes.data.equipment.name);
    console.log('           时间线事件: ' + tlRes.data.timeline.length + ' 条');
  } else {
    console.log('    ❌ 失败: ' + (tlRes.data.error || '未知错误'));
    allPassed = false;
  }
  console.log();

  // ========== 链路 2: 导出 CSV/JSON
  console.log('  链路 2: 导出 CSV/JSON');

  // 2.1 /export/equipment
  console.log('    2.1 GET /api/audit/export/equipment?format=csv');
  const eqCsvRes = await curl('GET', '/audit/export/equipment?format=csv');
  console.log('        状态码: ' + eqCsvRes.status);
  const isCsv = (eqCsvRes.headers['content-type'] || '').includes('csv');
  const hasContent = eqCsvRes.data && (eqCsvRes.data.includes('申请单号'));
  if (eqCsvRes.status === 200 && isCsv && hasContent) {
    console.log('        ✅ 通过 - CSV 导出正常');
  } else {
    console.log('        ❌ 失败');
    allPassed = false;
  }

  // 2.2 /export/borrow?format=json
  console.log('    2.2 GET /api/audit/export/borrow?format=json');
  const brJsonRes = await curl('GET', '/audit/export/borrow?format=json');
  console.log('        状态码: ' + brJsonRes.status);
  let jsonData = brJsonRes.data;
  if (typeof jsonData === 'string') {
    try { jsonData = JSON.parse(jsonData); } catch(e) {}
  }
  if (brJsonRes.status === 200 && jsonData.records) {
    console.log('        ✅ 通过 - JSON 导出正常，共 ' + jsonData.records.length + ' 条记录');
  } else {
    console.log('        ❌ 失败');
    allPassed = false;
  }

  // 2.3 验证导出与页面记录一致
  console.log('    2.3 验证导出数据与页面一致');
  const pageRes = await curl('GET', '/borrow');
  const exportRes = await curl('GET', '/audit/export?format=json');
  let exportData = exportRes.data;
  if (typeof exportData === 'string') {
    try { exportData = JSON.parse(exportData); } catch(e) {}
  }
  const pageCount = (pageRes.data.requests || []).length;
  const exportCount = (exportData.records || []).length;
  console.log('        页面记录: ' + pageCount + ' 条，导出记录: ' + exportCount + ' 条');
  if (pageCount === exportCount && pageCount > 0) {
    const pageFirst = pageRes.data.requests[0];
    const exportFirst = exportData.records[0];
    if (pageFirst.request_no === exportFirst.request_no) {
      console.log('        ✅ 通过 - 记录数一致，首条记录匹配 (' + pageFirst.request_no + ')');
    } else {
      console.log('        ❌ 失败 - 首条记录不匹配');
      allPassed = false;
    }
  } else if (pageCount === exportCount) {
    console.log('        ✅ 通过 - 记录数一致');
  } else {
    console.log('        ❌ 失败 - 记录数不一致');
    allPassed = false;
  }
  console.log();

  // ========== 链路 3: 维修完成后设备恢复可借
  console.log('  链路 3: 维修完成（repair_note 字段）');

  // 先创建一个维修记录并完成它
  console.log('    3.1 创建维修记录');
  const createRes = await curl('POST', '/maintenance', {}, {
    equipment_id: 3,
    issue_description: 'curl 测试维修流程验证'
  });
  if (createRes.status !== 201) {
    console.log('        ❌ 创建维修记录失败');
    allPassed = false;
    return;
  }
  const recordId = createRes.data.record.id;
  console.log('        维修记录 ID: ' + recordId);

  console.log('    3.2 开始维修');
  await curl('POST', '/maintenance/' + recordId + '/start');

  console.log('    3.3 完成维修（发送 repair_note 字段）');
  console.log('        Body: {"repair_note": "已修复屏幕更换主板，测试通过"}');
  const completeRes = await curl('POST', '/maintenance/' + recordId + '/complete', {},
    { repair_note: '已修复屏幕更换主板，测试通过' }
  );
  console.log('        状态码: ' + completeRes.status);
  if (completeRes.status === 200) {
    console.log('        ✅ 通过 - 维修完成成功');
    console.log('           消息: ' + completeRes.data.message);
  } else {
    console.log('        ❌ 失败: ' + completeRes.data.error);
    allPassed = false;
  }

  console.log('    3.4 验证设备状态恢复为 available');
  const eqRes = await curl('GET', '/equipment/3');
  const status = eqRes.data.equipment.status;
  console.log('        设备状态: ' + status);
  if (status === 'available') {
    console.log('        ✅ 通过 - 设备已恢复可用');
  } else {
    console.log('        ❌ 失败 - 设备状态未恢复');
    allPassed = false;
  }

  console.log('    3.5 验证设备可被申请借用');
  const borrowRes = await curl('POST', '/borrow', { 'x-user-id': '2' }, {
    equipment_id: 3,
    purpose: 'curl 验证维修后借用',
    start_date: '2026-06-10 09:00:00',
    end_date: '2026-06-11 18:00:00'
  });
  if (borrowRes.status === 201) {
    console.log('        ✅ 通过 - 可正常申请借用');
    console.log('           申请单号: ' + borrowRes.data.request.request_no);
  } else {
    console.log('        ❌ 失败: ' + borrowRes.data.error);
    allPassed = false;
  }

  console.log();
  console.log('======================================================================');
  if (allPassed) {
    console.log('  🎉 所有 curl 验证全部通过！');
  } else {
    console.log('  ⚠️  部分验证失败');
  }
  console.log('======================================================================');

  process.exit(allPassed ? 0 : 1);
}

verify().catch(err => {
  console.error('验证异常:', err);
  process.exit(1);
});
