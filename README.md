# 设备借还与维保预约平台

一个基于 Node.js + Express + SQLite 的本地设备借还与维保预约管理平台。

## ✨ 功能特性

### 核心功能
- **📦 设备台账**：设备的增删改查、冻结/解冻、状态管理
- **📋 借用申请**：普通用户提交借用申请，选择设备和时间
- **⏰ 预约可用性**：实时检查时间段冲突，前端可用/不可用提示
- **✅ 管理员审批**：管理员批准或拒绝借用申请
- **📥 领用**：申请人或管理员确认领用设备
- **📤 归还验收**：归还时填写验收结果和损坏备注
- **🔩 维修冻结**：设备报修、开始维修、完成维修，自动冻结/解冻
- **📜 历史记录**：按设备查看完整时间线（借用、维修、操作日志）
- **📊 审计导出**：按设备或日期导出 CSV/JSON 格式的设备台账和借用记录

### 权限控制
- **管理员**：设备管理、审批申请、维修管理、审计日志、数据导出
- **普通用户**：申请借用、领用、归还、报修、查看自己的申请

## 🚀 快速开始

### 环境要求
- Node.js >= 16.0.0
- npm 或 yarn

### 安装与运行

```bash
# 1. 安装依赖
npm install

# 2. 初始化示例数据（可选，推荐首次运行）
npm run seed

# 3. 启动服务
npm start
```

服务启动后，访问：http://localhost:3000

### 默认用户

| 用户ID | 用户名 | 姓名 | 角色 |
|--------|--------|------|------|
| 1 | admin | 系统管理员 | 管理员 |
| 2 | user1 | 张三 | 普通用户 |
| 3 | user2 | 李四 | 普通用户 |
| 4 | user3 | 王五 | 普通用户 |

> 在页面右上角的下拉框中可以切换用户身份。

### 常用命令

```bash
# 重置数据库（删除数据库文件）
npm run reset

# 重新加载示例数据
npm run reset && npm run seed

# 运行预约可用性测试脚本
npm run test-availability

# 运行重启持久化验证脚本
npm run test-restart

# 运行所有测试
npm run test-all
```

## 📁 项目结构

```
zgw-00100/
├── data/                    # SQLite 数据库文件目录
│   └── equipment.db        # 数据库文件（自动创建）
├── middleware/              # Express 中间件
│   └── auth.js             # 身份认证中间件
├── public/                  # 前端静态文件
│   ├── index.html          # 主页面
│   ├── styles.css          # 样式文件
│   └── app.js              # 前端逻辑
├── routes/                  # API 路由
│   ├── users.js            # 用户接口
│   ├── equipment.js        # 设备管理接口
│   ├── borrow.js           # 借用管理接口
│   ├── maintenance.js      # 维修管理接口
│   └── audit.js            # 审计与导出接口
├── database.js             # 数据库初始化和操作
├── server.js               # 服务入口
├── seed.js                 # 示例数据脚本
├── package.json            # 项目配置
└── README.md               # 项目文档
```

## 🔄 主流程说明

### 完整借还流程

```
新增设备 (管理员)
    ↓
申请借用 (普通用户，选择可用设备、填写用途和时间)
    ↓
审批申请 (管理员，批准或拒绝)
    ↓
领用设备 (申请人或管理员，设备状态变为"已借出")
    ↓
使用设备
    ↓
归还验收 (填写验收结果、损坏备注，设备状态变为"可用")
```

### 维修流程

```
提交报修 (任何用户，描述问题)
    ↓
开始维修 (管理员，设备状态变为"维修中"并冻结)
    ↓
维修中...
    ↓
完成维修 (管理员，填写维修说明，设备状态恢复为"可用")
```

## 🛡️ 失败路径校验（后端拒绝）

本平台实现了完整的业务规则校验，以下操作会被后端拒绝并返回清晰的错误信息：

### 🔴 验证链路 1：设备编号重复

**场景**：添加设备时使用已存在的设备编号

**复现步骤**：
1. 以管理员身份登录（ID=1）
2. 进入「设备台账」页面，点击「+ 新增设备」
3. 设备编号填写 `NB-2024-001`（示例数据中已存在）
4. 填写其他必填项后提交

**预期结果**：
- 后端返回 HTTP 400
- 错误码：`DUPLICATE_DEVICE_CODE`
- 错误信息：`设备编号 "NB-2024-001" 已存在，请勿重复添加`
- 页面显示错误提示 Toast

**代码位置**：[equipment.js](file:///d:/workSpace/AI__SPACE/02-label/zgw-00100/routes/equipment.js#L75-L82)

---

### 🔴 验证链路 2：维修中设备申请借用 + 时间倒挂

**场景 A**：申请时间段与维修时间段重叠 → 返回统一的时间段冲突

**复现步骤**：
1. 以普通用户身份登录（如 ID=2 张三）
2. 打开浏览器开发者工具（F12）-> 控制台
3. 执行以下 API 调用（尝试借用处于维修中的设备 ID=4，时间段与维修重叠）：
```javascript
fetch('/api/borrow', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-user-id': '2'
  },
  body: JSON.stringify({
    equipment_id: 4,
    purpose: '测试维修中借用',
    start_date: '2026-06-10 09:00:00',
    end_date: '2026-06-12 18:00:00'
  })
}).then(r => r.json()).then(console.log)
```

**预期结果**：
- 后端返回 HTTP 409
- 错误码：`TIME_SLOT_CONFLICT`
- 包含 `maintenance_no`（维修单号）、`overlap_start`、`overlap_end`（重叠时间）
- 普通用户可看到完整的维修冲突信息

**场景 A2**：申请时间段与维修时间段不重叠，但设备仍在维修中 → 返回状态错误

**复现步骤**：
1. 以普通用户身份登录
2. 尝试借用处于维修中的设备，但申请时间段在维修完成之后很久
3. 此时设备状态仍为 `maintenance`，但时间段不冲突

**预期结果**：
- 后端返回 HTTP 400
- 错误码：`EQUIPMENT_IN_MAINTENANCE`
- （这种情况较少见，因为维修完成后设备状态会自动更新）

**场景 B**：借用时间倒挂（结束时间早于开始时间）

**复现步骤**：
1. 以普通用户身份登录
2. 点击「+ 申请借用」
3. 选择一个可用设备
4. 开始时间选择 `2026-06-15 18:00`，结束时间选择 `2026-06-15 09:00`
5. 提交申请

**预期结果**：
- 后端返回 HTTP 400
- 错误码：`DATE_INVERSION`
- 错误信息：`结束时间不能早于开始时间（时间倒挂）`
- details 字段包含具体的起止时间

**代码位置**：
- 维修中校验：[borrow.js](file:///d:/workSpace/AI__SPACE/02-label/zgw-00100/routes/borrow.js#L109-L115)
- 时间倒挂校验：[borrow.js](file:///d:/workSpace/AI__SPACE/02-label/zgw-00100/routes/borrow.js#L143-L149)

---

### 🔴 验证链路 3：借用人自审 + 重复归还

**场景 A**：管理员审批自己提交的借用申请

**复现步骤**：
1. 以管理员身份登录（ID=1）
2. 先以管理员身份提交一个借用申请（通过控制台）：
```javascript
// 先提交申请
fetch('/api/borrow', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-user-id': '1'
  },
  body: JSON.stringify({
    equipment_id: 5,
    purpose: '管理员自审测试',
    start_date: '2026-06-10 09:00:00',
    end_date: '2026-06-12 18:00:00'
  })
}).then(r => r.json()).then(data => console.log('申请ID:', data.request.id))
```
3. 记录返回的申请 ID，然后尝试批准：
```javascript
// 将下面的 5 替换为实际返回的申请 ID
fetch('/api/borrow/5/approve', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-user-id': '1'
  }
}).then(r => r.json()).then(console.log)
```

**预期结果**：
- 后端返回 HTTP 400
- 错误码：`SELF_APPROVAL_NOT_ALLOWED`
- 错误信息：`审批人不能审批自己提交的借用申请（借用人自审）`
- details 字段包含申请人和审批人 ID

**场景 B**：重复归还同一借用单

**复现步骤**：
1. 以任意用户身份登录
2. 找到一个状态为「已归还」的借用单（示例数据中有已归还的记录）
3. 记录其 ID（如 ID=1）
4. 在控制台执行：
```javascript
fetch('/api/borrow/1/return', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-user-id': '2'
  },
  body: JSON.stringify({
    return_acceptance_result: '完好无损'
  })
}).then(r => r.json()).then(console.log)
```

**预期结果**：
- 后端返回 HTTP 400
- 错误码：`DUPLICATE_RETURN`
- 错误信息：`该借用单已完成归还，请勿重复归还（重复归还）`
- details 字段包含原始归还时间

**代码位置**：
- 自审校验：[borrow.js](file:///d:/workSpace/AI__SPACE/02-label/zgw-00100/routes/borrow.js#L221-L227)
- 重复归还校验：[borrow.js](file:///d:/workSpace/AI__SPACE/02-label/zgw-00100/routes/borrow.js#L386-L393)

## ⏰ 预约可用性（时间段冲突检测）

### 功能说明

用户在提交借用申请时，系统会自动检测同一设备在请求时间段内是否存在冲突：

**冲突状态包括：**
- **借用申请**：`pending`（待审批）、`approved`（已批准）、`collected`（已领用）
- **维修记录**：`in_progress`（维修中）

**时间段释放条件：**
- 借用申请被 `cancel`（取消）或 `reject`（拒绝）时释放
- 借用设备 `return`（归还）时释放
- 维修 `complete`（完成）时释放

**权限控制：**
- **管理员**：可以看到冲突的完整信息（申请人姓名、ID等）
- **普通用户**：只能看到冲突单号和时间，申请人信息显示为"其他用户"

### 冲突检测算法

使用标准的时间段重叠检测：
```
A.start < B.end AND A.end > B.start
```

### 新增接口

#### 1. 检查时间段可用性

**POST** `/api/borrow/check-availability`

**请求参数：**
```json
{
  "equipment_id": 1,
  "start_date": "2026-06-10 09:00:00",
  "end_date": "2026-06-12 18:00:00"
}
```

**响应 - 可用（HTTP 200）：**
```json
{
  "available": true,
  "requested_start": "2026-06-10 09:00:00",
  "requested_end": "2026-06-12 18:00:00"
}
```

**响应 - 冲突（HTTP 409）：**
```json
{
  "error": "该时间段与现有记录存在冲突",
  "code": "TIME_SLOT_CONFLICT",
  "details": {
    "conflicts": [
      {
        "type": "borrow",
        "request_no": "BR202606050001",
        "overlap_start": "2026-06-10 09:00:00",
        "overlap_end": "2026-06-12 18:00:00",
        "start_date": "2026-06-08 09:00:00",
        "end_date": "2026-06-15 18:00:00",
        "status": "approved",
        "applicant_name": "张三",
        "applicant_id": 2
      },
      {
        "type": "maintenance",
        "maintenance_no": "MR000001",
        "overlap_start": "2026-06-10 09:00:00",
        "overlap_end": "2026-06-12 18:00:00",
        "start_date": "2026-06-11 09:00:00",
        "end_date": "2026-06-20 18:00:00",
        "status": "in_progress"
      }
    ],
    "requested_start": "2026-06-10 09:00:00",
    "requested_end": "2026-06-12 18:00:00"
  }
}
```

### 前端功能

在借用申请模态框中：
- 选择设备和起止时间后，自动检查可用性（300ms 防抖）
- 显示三种状态：✅ 可用、❌ 不可用、⏳ 检查中
- 提交前做最终检查，防止并发冲突
- 冲突时显示详细的冲突信息

### 审计日志

所有可用性相关操作都会记录到审计日志：
- `CHECK_AVAILABILITY`：检查时间段可用性
- `BORROW_REQUEST_AVAILABILITY_PASSED`：可用性检查通过
- `BORROW_REQUEST_BLOCKED_BY_CONFLICT`：申请因冲突被拦截
- `MAINTENANCE_AVAILABILITY_PASSED`：维修开始前检查通过
- `MAINTENANCE_BLOCKED_BY_CONFLICT`：维修因冲突被拦截

---

### 🔴 验证链路 4：时间段冲突检测

**场景 A：无冲突申请**

**复现步骤：**
1. 以普通用户身份登录（ID=2）
2. 点击「+ 申请借用」
3. 选择一个可用设备
4. 选择未来一个没有占用的时间段
5. 观察可用性状态

**预期结果：**
- 前端显示 ✅ 时间段可用
- 提交申请成功，返回 HTTP 201

---

**场景 B：时间重叠冲突**

**复现步骤：**
1. 先创建一个借用申请（时间段：2026-06-10 ~ 2026-06-15）
2. 另一个用户尝试借用同一设备，时间段：2026-06-12 ~ 2026-06-18

**预期结果：**
- 前端显示 ❌ 时间段不可用
- 提交时返回 HTTP 409
- 错误码：`TIME_SLOT_CONFLICT`
- 包含冲突单号、重叠时间等详细信息

---

**场景 C：边界相邻不冲突**

**复现步骤：**
1. 创建借用申请 A：2026-06-10 09:00 ~ 2026-06-15 18:00
2. 创建借用申请 B：2026-06-15 18:00 ~ 2026-06-20 18:00

**预期结果：**
- 两个时间段边界相邻（A.end == B.start）
- 不视为冲突，申请 B 可以成功创建

---

**场景 D：维修窗口冲突**

**复现步骤：**
1. 管理员将设备标记为维修中（时间段：2026-06-10 ~ 2026-06-20）
2. 用户尝试借用该设备，时间段：2026-06-15 ~ 2026-06-18

**预期结果：**
- 返回 HTTP 409，错误码 `TIME_SLOT_CONFLICT`
- 冲突类型显示为 `maintenance`

---

**场景 E：服务重启后冲突规则仍然生效**

**复现步骤：**
1. 创建一个借用申请占用某个时间段
2. 重启服务（Ctrl+C 停止，然后 `npm start`）
3. 尝试在同一时间段创建另一个申请

**预期结果：**
- 重启后仍然检测到冲突
- 数据持久化正常，规则生效

---

**场景 F：权限差异 - 普通用户 vs 管理员**

**复现步骤：**
1. 用户 A（ID=2）创建一个借用申请
2. 用户 B（ID=3）尝试在同一时间段借用
3. 分别以普通用户和管理员身份查看冲突详情

**预期结果：**
- 普通用户看到申请人为"其他用户"
- 管理员看到完整的申请人姓名和 ID

---

## 📦 数据持久化

所有数据使用 SQLite 持久化存储在 `./data/equipment.db` 文件中：

### 数据表结构

| 表名 | 说明 |
|------|------|
| `users` | 用户表（管理员和普通用户） |
| `equipment` | 设备台账表 |
| `borrow_requests` | 借用申请表（包含审批、领用、归还信息） |
| `maintenance_records` | 维修记录表 |
| `audit_logs` | 审计日志表（记录所有操作） |

### 数据完整性保证

- ✅ **设备状态**：重启后所有设备状态（可用/已借出/维修中/冻结）不丢失
- ✅ **借用单**：所有借用单及其状态流转完整保存
- ✅ **损坏备注**：归还时填写的损坏备注持久化存储
- ✅ **时间线**：每个设备的完整操作时间线可追溯
- ✅ **事务保证**：领用和归还操作使用数据库事务，确保设备状态和借用单状态一致

## 📊 导出功能

### 支持的导出格式

| 导出类型 | 格式 | 说明 |
|---------|------|------|
| 设备台账 | CSV / JSON | 包含设备基本信息、借用次数、维修次数 |
| 借用记录 | CSV / JSON | 包含完整的借用申请、审批、领用、归还信息 |

### 导出筛选条件

- **按设备**：选择特定设备导出相关记录
- **按日期**：指定开始和结束日期筛选
- **格式选择**：CSV（适合 Excel 打开）或 JSON（适合程序处理）

### 导出一致性保证

导出的数据与页面显示的记录完全一致：
- 导出字段与页面表格列对应
- 状态文本使用中文描述
- 日期格式统一
- CSV 文件包含 UTF-8 BOM，确保中文在 Excel 中正常显示

## 🔌 API 接口文档

### 基础信息
- Base URL: `http://localhost:3000/api`
- 认证方式：请求头 `x-user-id: <用户ID>`

### 设备管理

| 方法 | 路径 | 说明 | 权限 |
|------|------|------|------|
| GET | `/equipment` | 获取设备列表 | 所有用户 |
| GET | `/equipment/:id` | 获取设备详情 | 所有用户 |
| POST | `/equipment` | 新增设备 | 管理员 |
| PUT | `/equipment/:id` | 更新设备 | 管理员 |
| DELETE | `/equipment/:id` | 删除设备 | 管理员 |
| POST | `/equipment/:id/freeze` | 冻结设备 | 管理员 |
| POST | `/equipment/:id/unfreeze` | 解冻设备 | 管理员 |

### 借用管理

| 方法 | 路径 | 说明 | 权限 |
|------|------|------|------|
| GET | `/borrow` | 获取借用申请列表 | 所有用户（仅看自己的） |
| GET | `/borrow/:id` | 获取申请详情 | 相关人员 |
| POST | `/borrow` | 提交借用申请 | 所有用户 |
| POST | `/borrow/check-availability` | 检查时间段可用性 | 所有用户 |
| POST | `/borrow/:id/approve` | 批准申请 | 管理员 |
| POST | `/borrow/:id/reject` | 拒绝申请 | 管理员 |
| POST | `/borrow/:id/collect` | 领用设备 | 申请人/管理员 |
| POST | `/borrow/:id/return` | 归还设备 | 申请人/管理员 |
| POST | `/borrow/:id/cancel` | 取消申请 | 申请人/管理员 |

### 维修管理

| 方法 | 路径 | 说明 | 权限 |
|------|------|------|------|
| GET | `/maintenance` | 获取维修记录 | 所有用户 |
| POST | `/maintenance` | 提交报修 | 所有用户 |
| POST | `/maintenance/:id/start` | 开始维修 | 管理员 |
| POST | `/maintenance/:id/complete` | 完成维修 | 管理员 |

### 审计与导出

| 方法 | 路径 | 说明 | 权限 |
|------|------|------|------|
| GET | `/audit/logs` | 获取审计日志 | 管理员 |
| GET | `/audit/export/equipment` | 导出设备台账（CSV/JSON） | 管理员 |
| GET | `/audit/export/borrow` | 导出借用记录（CSV/JSON） | 管理员 |
| GET | `/audit/export` | 导出借用记录（兼容旧版） | 管理员 |
| GET | `/audit/timeline` | 获取设备时间线 | 所有用户 |
| GET | `/audit/timeline?equipment_id=:id` | 按设备查询时间线（查询参数） | 所有用户 |
| GET | `/audit/timeline/:equipment_id` | 按设备查询时间线（路径参数） | 所有用户 |

**导出参数**：
- `format`: `csv`（默认）或 `json`
- `equipment_id`: 可选，按设备筛选
- `start_date`: 可选，开始日期（含）
- `end_date`: 可选，结束日期（含）

**设备台账导出字段**：
设备编号、设备名称、设备分类、规格型号、存放位置、状态、描述、创建时间、更新时间

**借用记录导出字段**：
申请单号、设备编号、设备名称、设备分类、申请人、审批人、借用用途、开始时间、结束时间、状态、领用时间、归还时间、验收结果、损坏备注、审批意见、创建时间

## 🛠️ 技术栈

- **后端框架**：Express.js
- **数据库**：SQLite (sqlite3)
- **日期处理**：Moment.js
- **前端**：原生 HTML/CSS/JavaScript（无框架依赖）
- **跨域**：CORS

## 📝 错误码说明

| 错误码 | 说明 |
|--------|------|
| `DUPLICATE_DEVICE_CODE` | 设备编号重复 |
| `EQUIPMENT_IN_MAINTENANCE` | 设备处于维修中 |
| `EQUIPMENT_FROZEN` | 设备已冻结 |
| `EQUIPMENT_BORROWED` | 设备已借出 |
| `DATE_INVERSION` | 时间倒挂（结束早于开始） |
| `SELF_APPROVAL_NOT_ALLOWED` | 借用人自审 |
| `DUPLICATE_RETURN` | 重复归还 |
| `TIME_SLOT_CONFLICT` | 时间段冲突 |
| `PENDING_REQUEST_EXISTS` | 存在未完成的借用申请 |
| `ACTIVE_BORROW_EXISTS` | 设备有活跃借用 |
| `INVALID_STATUS_FOR_APPROVAL` | 状态不允许审批 |
| `INVALID_STATUS_FOR_COLLECT` | 状态不允许领用 |
| `INVALID_STATUS_FOR_RETURN` | 状态不允许归还 |
| `ADMIN_REQUIRED` | 需要管理员权限 |
| `ACCESS_DENIED` | 无访问权限 |

## 📄 License

MIT License
