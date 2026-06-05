const { get } = require('../database');

async function authenticate(req, res, next) {
  const userId = req.headers['x-user-id'];
  if (!userId) {
    return res.status(401).json({ error: '未提供用户ID', code: 'MISSING_USER_ID' });
  }

  try {
    const user = await get('SELECT * FROM users WHERE id = ?', [userId]);
    if (!user) {
      return res.status(401).json({ error: '用户不存在', code: 'USER_NOT_FOUND' });
    }
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: '需要管理员权限', code: 'ADMIN_REQUIRED' });
  }
  next();
}

module.exports = {
  authenticate,
  requireAdmin
};
