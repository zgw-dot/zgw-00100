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
  console.log('  链路 1: 时间线 - 查询参数方式（字段对齐验证）');
  console.log('    前端同款请求: GET /api/audit/timeline?equipment_id=1');
  const tlRes = await curl('GET', '/audit/timeline?equipment_id=1');
  console.log('    状态码: ' + tlRes.status);
  if (tlRes.status === 200 && tlRes.data.equipment && tlRes.data.timeline.length > 0) {
    console.log('    ✅ 通过 - 设备: ' + tlRes.data.equipment.name);
    console.log('           时间线事件: ' + tlRes.data.timeline.length + ' 条');

    // 验证关键字段不为 undefined
    const firstEvent = tlRes.data.timeline[0];
    console.log('    字段验证:');
    console.log('      event_time: ' + (firstEvent.event_time ? '✅ ' + firstEvent.event_time : '❌ undefined'));
    console.log('      user_name: ' + (firstEvent.user_name ? '✅ ' + firstEvent.user_name : '❌ undefined'));
    console.log('      type: ' + firstEvent.type);

    const hasEventTime = tlRes.data.timeline.every(e => e.event_time);
    const hasUserName = tlRes.data.timeline.every(e => e.user_name);
    if (hasEventTime && hasUserName) {
      console.log('    ✅ 通过 - 所有事件字段完整（event_time, user_name）');
    } else {
      console.log('    ❌ 失败 - 存在字段为 undefined');
      allPassed = false;
    }

    // 检查维修事件的 repair_note 字段
    const maintenanceEvent = tlRes.data.timeline.find(e => e.type === 'maintenance');
    if (maintenanceEvent) {
      console.log('      维修事件 repair_note: ' + (maintenanceEvent.repair_note ? '✅ ' + maintenanceEvent.repair_note : '❌ undefined'));
    }
  } else {
    console.log('    ❌ 失败: ' + (tlRes.data.error || '未知错误'));
    allPassed = false;
  }
  console.log();

  // ========== 链路 2: 导出 CSV/JSON（区分设备台账和借用记录）
  console.log('  链路 2: 导出 CSV/JSON（设备台账 vs 借用记录）');

  // 2.1 /export/equipment - 设备台账导出
  console.log('    2.1 GET /api/audit/export/equipment?format=csv');
  console.log('        验证: 设备台账 CSV 不应包含"申请单号"，应包含"设备编号"');
  const eqCsvRes = await curl('GET', '/audit/export/equipment?format=csv');
  console.log('        状态码: ' + eqCsvRes.status);
  const eqIsCsv = (eqCsvRes.headers['content-type'] || '').includes('csv');
  const eqHasDeviceCode = eqCsvRes.data && eqCsvRes.data.includes('设备编号');
  const eqHasNoRequestNo = eqCsvRes.data && !eqCsvRes.data.includes('申请单号');
  if (eqCsvRes.status === 200 && eqIsCsv && eqHasDeviceCode && eqHasNoRequestNo) {
    console.log('        ✅ 通过 - 设备台账 CSV 正确（无"申请单号"，有"设备编号"）');
  } else {
    console.log('        ❌ 失败');
    console.log('          包含"设备编号": ' + eqHasDeviceCode);
    console.log('          不包含"申请单号": ' + eqHasNoRequestNo);
    allPassed = false;
  }

  // 2.2 设备台账 JSON 导出 - 验证与设备列表对齐
  console.log('    2.2 GET /api/audit/export/equipment?format=json');
  console.log('        验证: 导出记录与 GET /equipment 返回的设备列表一致');
  const eqListRes = await curl('GET', '/equipment');
  const eqJsonRes = await curl('GET', '/audit/export/equipment?format=json');
  console.log('        状态码: ' + eqJsonRes.status);
  let eqJsonData = eqJsonRes.data;
  if (typeof eqJsonData === 'string') {
    try { eqJsonData = JSON.parse(eqJsonData); } catch(e) {}
  }
  const eqListCount = (eqListRes.data.equipment || []).length;
  const eqExportCount = (eqJsonData.records || []).length;
  console.log('        设备列表: ' + eqListCount + ' 台，导出记录: ' + eqExportCount + ' 条');
  if (eqJsonRes.status === 200 && eqListCount === eqExportCount && eqListCount > 0) {
    const listFirst = eqListRes.data.equipment[0];
    const exportFirst = eqJsonData.records[0];
    const firstMatch = listFirst.device_code === exportFirst.device_code &&
                       listFirst.name === exportFirst.name &&
                       listFirst.status_text === exportFirst.status_text;
    if (firstMatch) {
      console.log('        ✅ 通过 - 记录数一致，首条记录匹配 (' + listFirst.device_code + ')');
    } else {
      console.log('        ❌ 失败 - 首条记录不匹配');
      console.log('          列表: ' + JSON.stringify(listFirst));
      console.log('          导出: ' + JSON.stringify(exportFirst));
      allPassed = false;
    }
  } else if (eqListCount === eqExportCount) {
    console.log('        ✅ 通过 - 记录数一致');
  } else {
    console.log('        ❌ 失败 - 记录数不一致');
    allPassed = false;
  }

  // 2.3 /export/borrow - 借用记录导出
  console.log('    2.3 GET /api/audit/export/borrow?format=csv');
  console.log('        验证: 借用记录 CSV 应包含"申请单号"');
  const brCsvRes = await curl('GET', '/audit/export/borrow?format=csv');
  console.log('        状态码: ' + brCsvRes.status);
  const brIsCsv = (brCsvRes.headers['content-type'] || '').includes('csv');
  const brHasRequestNo = brCsvRes.data && brCsvRes.data.includes('申请单号');
  if (brCsvRes.status === 200 && brIsCsv && brHasRequestNo) {
    console.log('        ✅ 通过 - 借用记录 CSV 正确（有"申请单号"）');
  } else {
    console.log('        ❌ 失败');
    allPassed = false;
  }

  // 2.4 /export/borrow JSON - 验证与借用列表一致
  console.log('    2.4 GET /api/audit/export/borrow?format=json');
  const brListRes = await curl('GET', '/borrow');
  const brJsonRes = await curl('GET', '/audit/export/borrow?format=json');
  console.log('        状态码: ' + brJsonRes.status);
  let brJsonData = brJsonRes.data;
  if (typeof brJsonData === 'string') {
    try { brJsonData = JSON.parse(brJsonData); } catch(e) {}
  }
  const brListCount = (brListRes.data.requests || []).length;
  const brExportCount = (brJsonData.records || []).length;
  console.log('        借用列表: ' + brListCount + ' 条，导出记录: ' + brExportCount + ' 条');
  if (brJsonRes.status === 200 && brListCount === brExportCount && brListCount > 0) {
    const listFirst = brListRes.data.requests[0];
    const exportFirst = brJsonData.records[0];
    if (listFirst.request_no === exportFirst.request_no) {
      console.log('        ✅ 通过 - 记录数一致，首条记录匹配 (' + listFirst.request_no + ')');
    } else {
      console.log('        ❌ 失败 - 首条记录不匹配');
      allPassed = false;
    }
  } else if (brListCount === brExportCount) {
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
  // 先获取设备 3 的所有 pending 借用申请并取消
  const allBorrows = await curl('GET', '/borrow');
  const pendingForEq3 = allBorrows.data.requests?.filter(r => r.equipment_id === 3 && r.status === 'pending');
  for (const p of pendingForEq3) {
    console.log('        取消设备 3 的未完成申请: ' + p.request_no);
    await curl('POST', '/borrow/' + p.id + '/cancel', { 'x-user-id': p.applicant_id });
  }
  const borrowRes = await curl('POST', '/borrow', { 'x-user-id': '2' }, {
    equipment_id: 3,
    purpose: 'curl 验证维修后借用',
    start_date: '2026-06-10 09:00:00',
    end_date: '2026-06-11 18:00:00'
  });
  if (borrowRes.status === 201) {
    console.log('        ✅ 通过 - 设备 3 可正常申请借用');
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
