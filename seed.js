const moment = require('moment');
const { initDatabase, run, get, all, exec } = require('./database');

async function seed() {
  console.log('正在初始化数据库...');
  await initDatabase();

  console.log('正在创建示例数据...');

  const equipmentData = [
    { device_code: 'IT-001', name: 'ThinkPad X1 Carbon', category: '笔记本电脑', model: 'X1 Carbon Gen 11', location: '办公区A-101', description: '14英寸商务笔记本，i7-1365U/32GB/1TB SSD', status: 'available' },
    { device_code: 'IT-002', name: 'MacBook Pro 14', category: '笔记本电脑', model: 'M3 Pro', location: '办公区A-102', description: '14英寸苹果笔记本，M3 Pro/18GB/512GB', status: 'available' },
    { device_code: 'IT-003', name: 'Dell 27寸显示器', category: '显示器', model: 'U2723QE', location: '办公区B-201', description: '4K IPS显示器，USB-C供电', status: 'available' },
    { device_code: 'IT-004', name: '索尼A7M4相机', category: '摄影设备', model: 'Alpha 7 IV', location: '设备间C-301', description: '全画幅微单相机，机身+24-70镜头', status: 'maintenance' },
    { device_code: 'IT-005', name: '大疆Mavic 3 Pro', category: '无人机', model: 'Mavic 3 Pro', location: '设备间C-302', description: '三摄无人机，带RC遥控器', status: 'available' },
    { device_code: 'IT-006', name: '会议室投影仪', category: '会议设备', model: 'Epson CB-2265U', location: '大会议室', description: '5500流明激光投影仪，WUXGA分辨率', status: 'available' },
    { device_code: 'IT-007', name: '移动测试机-安卓', category: '测试设备', model: '小米14 Ultra', location: '测试区D-401', description: 'Android 14测试设备，16GB/512GB', status: 'available' },
    { device_code: 'IT-008', name: '移动测试机-iOS', category: '测试设备', model: 'iPhone 15 Pro Max', location: '测试区D-402', description: 'iOS 17测试设备，256GB', status: 'available' }
  ];

  const equipmentIds = [];
  for (const eq of equipmentData) {
    const result = await run(`
      INSERT INTO equipment (device_code, name, category, model, location, description, status)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [eq.device_code, eq.name, eq.category, eq.model, eq.location, eq.description, eq.status]);
    equipmentIds.push(result.lastID);
    console.log(`创建设备: ${eq.device_code} - ${eq.name}`);
  }

  const now = moment();

  const borrowData = [
    {
      request_no: 'BR' + moment().subtract(7, 'days').format('YYYYMMDD') + '0001',
      equipment_id: equipmentIds[0],
      applicant_id: 2,
      purpose: '外出参加客户会议',
      start_date: moment().subtract(7, 'days').format('YYYY-MM-DD HH:mm:ss'),
      end_date: moment().subtract(6, 'days').format('YYYY-MM-DD HH:mm:ss'),
      status: 'returned',
      approver_id: 1,
      approval_comment: '同意，请妥善保管',
      approval_at: moment().subtract(7, 'days').add(1, 'hour').format('YYYY-MM-DD HH:mm:ss'),
      collected_at: moment().subtract(7, 'days').add(2, 'hour').format('YYYY-MM-DD HH:mm:ss'),
      returned_at: moment().subtract(6, 'days').format('YYYY-MM-DD HH:mm:ss'),
      return_acceptance_result: '设备完好无损，功能正常',
      return_damage_note: null
    },
    {
      request_no: 'BR' + moment().subtract(3, 'days').format('YYYYMMDD') + '0002',
      equipment_id: equipmentIds[2],
      applicant_id: 3,
      purpose: '临时办公使用',
      start_date: moment().subtract(3, 'days').format('YYYY-MM-DD HH:mm:ss'),
      end_date: moment().subtract(1, 'days').format('YYYY-MM-DD HH:mm:ss'),
      status: 'returned',
      approver_id: 1,
      approval_comment: '同意',
      approval_at: moment().subtract(3, 'days').add(30, 'minute').format('YYYY-MM-DD HH:mm:ss'),
      collected_at: moment().subtract(3, 'days').add(1, 'hour').format('YYYY-MM-DD HH:mm:ss'),
      returned_at: moment().subtract(1, 'days').format('YYYY-MM-DD HH:mm:ss'),
      return_acceptance_result: '外观有轻微划痕，功能正常',
      return_damage_note: '底部有一处约2mm划痕，不影响使用'
    },
    {
      request_no: 'BR' + moment().format('YYYYMMDD') + '0001',
      equipment_id: equipmentIds[1],
      applicant_id: 2,
      purpose: '项目开发使用',
      start_date: moment().format('YYYY-MM-DD HH:mm:ss'),
      end_date: moment().add(7, 'days').format('YYYY-MM-DD HH:mm:ss'),
      status: 'approved',
      approver_id: 1,
      approval_comment: '同意，项目结束后请及时归还',
      approval_at: moment().add(1, 'hour').format('YYYY-MM-DD HH:mm:ss'),
      collected_at: null,
      returned_at: null,
      return_acceptance_result: null,
      return_damage_note: null
    },
    {
      request_no: 'BR' + moment().format('YYYYMMDD') + '0002',
      equipment_id: equipmentIds[5],
      applicant_id: 3,
      purpose: '产品发布会使用',
      start_date: moment().add(2, 'days').format('YYYY-MM-DD HH:mm:ss'),
      end_date: moment().add(3, 'days').format('YYYY-MM-DD HH:mm:ss'),
      status: 'pending',
      approver_id: null,
      approval_comment: null,
      approval_at: null,
      collected_at: null,
      returned_at: null,
      return_acceptance_result: null,
      return_damage_note: null
    }
  ];

  for (const br of borrowData) {
    await run(`
      INSERT INTO borrow_requests (request_no, equipment_id, applicant_id, purpose, start_date, end_date, status, approver_id, approval_comment, approval_at, collected_at, returned_at, return_acceptance_result, return_damage_note)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      br.request_no, br.equipment_id, br.applicant_id, br.purpose, br.start_date, br.end_date, br.status,
      br.approver_id, br.approval_comment, br.approval_at, br.collected_at, br.returned_at,
      br.return_acceptance_result, br.return_damage_note
    ]);
    console.log(`创建借用单: ${br.request_no} - 状态: ${br.status}`);
  }

  const maintenanceData = [
    {
      equipment_id: equipmentIds[3],
      reporter_id: 4,
      issue_description: '相机对焦马达异响，对焦速度明显变慢',
      priority: 'high',
      status: 'in_progress',
      technician_id: 1,
      estimated_completion_date: moment().add(5, 'days').format('YYYY-MM-DD HH:mm:ss'),
      started_at: moment().subtract(2, 'days').format('YYYY-MM-DD HH:mm:ss'),
      completed_at: null,
      repair_result: null,
      repair_cost: null,
      damage_note: null
    },
    {
      equipment_id: equipmentIds[4],
      reporter_id: 2,
      issue_description: '无人机电池鼓包，需更换电池',
      priority: 'normal',
      status: 'completed',
      technician_id: 1,
      estimated_completion_date: moment().subtract(1, 'days').format('YYYY-MM-DD HH:mm:ss'),
      started_at: moment().subtract(4, 'days').format('YYYY-MM-DD HH:mm:ss'),
      completed_at: moment().subtract(2, 'days').format('YYYY-MM-DD HH:mm:ss'),
      repair_result: '已更换原装电池，飞行测试正常',
      repair_cost: 1299,
      damage_note: '电池鼓包是由于长期高温环境存放导致'
    }
  ];

  for (const mr of maintenanceData) {
    await run(`
      INSERT INTO maintenance_records (equipment_id, reporter_id, issue_description, priority, status, technician_id, estimated_completion_date, started_at, completed_at, repair_result, repair_cost, damage_note)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      mr.equipment_id, mr.reporter_id, mr.issue_description, mr.priority, mr.status,
      mr.technician_id, mr.estimated_completion_date, mr.started_at, mr.completed_at,
      mr.repair_result, mr.repair_cost, mr.damage_note
    ]);
    console.log(`创建维修记录: 设备ID ${mr.equipment_id} - 状态: ${mr.status}`);
  }

  await run(`
    INSERT INTO audit_logs (user_id, action, resource_type, resource_id, details, ip_address)
    VALUES (1, 'CREATE_EQUIPMENT', 'equipment', 1, '初始化示例设备数据', '127.0.0.1')
  `);

  console.log('\n示例数据创建完成！');
  console.log('\n默认用户账号:');
  console.log('  ID: 1 - admin (管理员) - 用户名: admin');
  console.log('  ID: 2 - 张三 (普通成员) - 用户名: user1');
  console.log('  ID: 3 - 李四 (普通成员) - 用户名: user2');
  console.log('  ID: 4 - 王五 (普通成员) - 用户名: user3');
  console.log('\n使用说明: 在前端页面右上角的用户选择器中切换用户身份进行测试');

  process.exit(0);
}

seed().catch(err => {
  console.error('初始化失败:', err);
  process.exit(1);
});
