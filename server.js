const express = require('express');
const cors = require('cors');
const path = require('path');
const { initDatabase } = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/users', require('./routes/users'));
app.use('/api/equipment', require('./routes/equipment'));
app.use('/api/borrow', require('./routes/borrow'));
app.use('/api/maintenance', require('./routes/maintenance'));
app.use('/api/audit', require('./routes/audit'));

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    error: err.message || '服务器内部错误',
    code: 'INTERNAL_SERVER_ERROR'
  });
});

app.use((req, res) => {
  res.status(404).json({
    error: 'API 路由不存在',
    code: 'ROUTE_NOT_FOUND'
  });
});

async function startServer() {
  try {
    await initDatabase();
    console.log('数据库初始化完成');

    app.listen(PORT, () => {
      console.log(`\n🚀 设备借还与维保预约平台已启动`);
      console.log(`📍 前端地址: http://localhost:${PORT}`);
      console.log(`🔌 API 地址: http://localhost:${PORT}/api`);
      console.log(`\n📖 使用说明:`);
      console.log(`  1. 首次运行请先执行: npm run seed  (创建示例数据)`);
      console.log(`  2. 重置数据库执行: npm run reset`);
      console.log(`  3. 在前端页面右上角选择用户身份进行测试`);
      console.log(`\n👤 默认用户:`);
      console.log(`  - ID 1: admin (管理员)`);
      console.log(`  - ID 2: 张三 (普通成员)`);
      console.log(`  - ID 3: 李四 (普通成员)`);
      console.log(`  - ID 4: 王五 (普通成员)`);
    });
  } catch (err) {
    console.error('启动失败:', err);
    process.exit(1);
  }
}

startServer();
