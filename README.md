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
- **📜 历史记录**：按设备查看完整时间线（借用、维修、操作日志），普通用户自动脱敏
- **📊 审计导出**：按设备或日期导出 CSV/JSON 格式的设备台账和借用记录
- **📅 设备使用与维保日历包**：管理员专属导出，整合借用、归还、取消、维修全生命周期事件及冲突拦截记录
- **📁 审计视图**：管理员可保存常用筛选条件为命名视图，一键重复导出，支持版本管理和权限控制

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

# 运行时间线导出功能验证脚本
npm run test-timeline-export

# 运行审计视图功能验证脚本
npm run test-audit-views

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

### 🚨 维修窗口冲突 - 用户可见影响说明

> ⚠️ **重要**：设备进入维修状态后，申请借用的返回结果分为两种情况，请勿混淆：

| 场景 | HTTP 状态码 | 错误码 | 说明 |
|------|------------|--------|------|
| **时间段与维修重叠** | 409 | `TIME_SLOT_CONFLICT` | 返回统一冲突格式，包含 `maintenance_no`、`overlap_start`、`overlap_end` |
| **时间段不重叠但设备仍在维修** | 400 | `EQUIPMENT_IN_MAINTENANCE` | 仅返回状态错误，不包含冲突详情 |

**权限字段差异（针对 409 TIME_SLOT_CONFLICT）：**

| 字段 | 管理员可见 | 普通用户可见（非本人报修） | 普通用户可见（本人报修） |
|------|-----------|---------------------------|-------------------------|
| `type` | ✅ | ✅ | ✅ |
| `maintenance_no` | ✅ | ✅ | ✅ |
| `status` | ✅ | ✅ | ✅ |
| `start_date` | ✅ | ✅ | ✅ |
| `end_date` | ✅ | ✅ | ✅ |
| `overlap_start` | ✅ | ✅ | ✅ |
| `overlap_end` | ✅ | ✅ | ✅ |
| `reporter_name` | ✅ 真实姓名 | ✅ "其他用户" | ✅ 真实姓名 |
| `reporter_id` | ✅ 真实 ID | ✅ `null` | ✅ 真实 ID |

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
- **管理员**：可见完整报修人信息（`reporter_id`、真实 `reporter_name`）
- **普通用户**：可见维修单号、重叠时间，报修人信息脱敏为 `reporter_name: "其他用户"`、`reporter_id: null`

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
- **管理员**：可以看到所有冲突的完整信息
  - 借用冲突：完整申请人信息（`applicant_id`、真实 `applicant_name`）
  - 维修冲突：完整报修人信息（`reporter_id`、真实 `reporter_name`）
- **普通用户**：只能看到冲突单号和时间，用户信息脱敏
  - 借用冲突：非本人申请显示 `applicant_name: "其他用户"`、`applicant_id: null`
  - 维修冲突：非本人报修显示 `reporter_name: "其他用户"`、`reporter_id: null`
  - 本人的申请/报修可见完整信息

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

> 💡 **字段权限说明**：
> - 以下示例为 **管理员视角**（可见完整信息）
> - **普通用户视角**：非本人的借用/报修会脱敏（`applicant_name: "其他用户"` / `reporter_name: "其他用户"`，`applicant_id: null` / `reporter_id: null`）

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
        "status": "in_progress",
        "reporter_name": "系统管理员",
        "reporter_id": 1
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

**场景 F：权限差异 - 普通用户 vs 管理员（借用冲突 + 维修冲突）**

**复现步骤：**
1. 用户 A（ID=2）创建一个借用申请
2. 用户 B（ID=3）尝试在同一时间段借用
3. 分别以普通用户和管理员身份查看借用冲突详情
4. 创建一条维修记录并启动维修
5. 分别以普通用户和管理员身份查看维修冲突详情

**预期结果：**
- **借用冲突**：
  - 普通用户看到申请人为"其他用户"，`applicant_id: null`
  - 管理员看到完整的申请人姓名和 ID
- **维修冲突**：
  - 普通用户看到报修人为"其他用户"，`reporter_id: null`
  - 管理员看到完整的报修人姓名和 ID
- 双方都能看到冲突单号、重叠时间等关键信息

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
| `audit_views` | 审计视图表（管理员保存的命名筛选条件） |

### 数据完整性保证

- ✅ **设备状态**：重启后所有设备状态（可用/已借出/维修中/冻结）不丢失
- ✅ **借用单**：所有借用单及其状态流转完整保存
- ✅ **损坏备注**：归还时填写的损坏备注持久化存储
- ✅ **时间线**：每个设备的完整操作时间线可追溯
- ✅ **事务保证**：领用和归还操作使用数据库事务，确保设备状态和借用单状态一致

## 📊 导出功能

### 支持的导出格式

| 导出类型 | 格式 | 说明 | 权限 |
|---------|------|------|------|
| 设备台账 | CSV / JSON | 包含设备基本信息、借用次数、维修次数 | 管理员 |
| 借用记录 | CSV / JSON | 包含完整的借用申请、审批、领用、归还信息 | 管理员 |
| **设备使用与维保日历包** | **CSV / JSON** | **整合借用、维修、冲突拦截全生命周期事件** | **仅管理员** |

### 📅 设备使用与维保日历包导出

管理员专属的完整时间线导出功能，串联设备从借用申请到维修完成的所有关键事件。

#### 功能特点

- **全事件覆盖**：包含借用申请、批准、拒绝、领用、归还、取消，以及维修申请、开始、完成
- **冲突可追溯**：导出中包含借用和维修冲突拦截记录，可完整复核被拦截的申请
- **稳定字段**：每条事件包含稳定的 `event_id`，跨服务重启保持一致
- **标准排序**：按时间升序排列，时间相同时按 `event_id` 字典序稳定排序
- **导出元数据**：包含导出时间、导出人、筛选条件等审计信息

#### 导出筛选条件

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `format` | string | 否 | 导出格式，`csv`（默认）或 `json` |
| `equipment_id` | number | 否 | 指定设备ID，不填则导出所有设备 |
| `start_date` | string | 否 | 开始日期（含），格式 `YYYY-MM-DD` 或 `YYYY-MM-DD HH:mm:ss` |
| `end_date` | string | 否 | 结束日期（含），格式 `YYYY-MM-DD` 或 `YYYY-MM-DD HH:mm:ss` |

#### 导出事件类型

| 事件类型 | 说明 | 来源 |
|---------|------|------|
| `borrow_created` | 提交借用申请 | 借用表 |
| `borrow_approved` | 批准借用申请 | 借用表 |
| `borrow_rejected` | 拒绝借用申请 | 借用表 |
| `borrow_collected` | 领用设备 | 借用表 |
| `borrow_returned` | 归还设备 | 借用表 |
| `borrow_cancelled` | 取消借用申请 | 借用表 |
| `maintenance_created` | 提交维修申请 | 维修表 |
| `maintenance_started` | 开始维修 | 维修表 |
| `maintenance_completed` | 完成维修 | 维修表 |
| `borrow_conflict_blocked` | 借用申请因冲突被拦截 | 审计日志 |
| `maintenance_conflict_blocked` | 维修因冲突被拦截 | 审计日志 |

#### 标准导出字段

| 字段 | 说明 |
|------|------|
| `event_id` | 稳定事件唯一标识，格式：`{来源}_{来源ID}_{动作}` |
| `event_time` | 事件发生时间 |
| `event_type` | 事件类型编码 |
| `event_text` | 事件类型中文描述 |
| `source_type` | 来源类型：`borrow` / `maintenance` / `audit` |
| `source_id` | 来源记录ID |
| `status` | 事件状态编码 |
| `status_text` | 事件状态中文描述 |
| `operator_id` | 操作者用户ID |
| `operator_name` | 操作者姓名 |
| `equipment_id` | 设备ID |
| `device_code` | 设备编号 |
| `equipment_name` | 设备名称 |
| `details` | 事件扩展详情（JSON 格式） |

#### JSON 导出示例

```json
{
  "meta": {
    "exported_at": "2026-06-05T10:30:00.000Z",
    "exported_by": "系统管理员",
    "exported_by_id": 1,
    "filters": {
      "equipment_id": 1,
      "start_date": "2026-06-01",
      "end_date": "2026-06-30",
      "format": "json"
    },
    "event_count": 12,
    "equipment_info": {
      "id": 1,
      "device_code": "NB-2024-001",
      "name": "笔记本电脑"
    }
  },
  "events": [
    {
      "event_id": "borrow_5_created",
      "event_time": "2026-06-05 09:00:00",
      "event_type": "borrow_created",
      "event_text": "提交借用申请",
      "source_type": "borrow",
      "source_id": 5,
      "status": "pending",
      "status_text": "待审批",
      "operator_id": 2,
      "operator_name": "张三",
      "equipment_id": 1,
      "device_code": "NB-2024-001",
      "equipment_name": "笔记本电脑",
      "details": {
        "request_no": "BR202606050001",
        "purpose": "项目开发使用",
        "period_start": "2026-06-10 09:00:00",
        "period_end": "2026-06-15 18:00:00"
      }
    }
  ]
}
```

#### 冲突拦截事件复核示例

```json
{
  "event_id": "conflict_102_0",
  "event_time": "2026-06-05 10:00:00",
  "event_type": "borrow_conflict_blocked",
  "event_text": "借用申请因冲突被拦截",
  "source_type": "audit",
  "source_id": 102,
  "status": "blocked",
  "status_text": "已拦截",
  "operator_id": 2,
  "operator_name": "张三",
  "equipment_id": 1,
  "device_code": "NB-2024-001",
  "equipment_name": "笔记本电脑",
  "details": {
    "conflict_count": 1,
    "start_date": "2026-06-12 09:00:00",
    "end_date": "2026-06-14 18:00:00",
    "conflicts": [
      {
        "type": "maintenance",
        "maintenance_no": "MR000003",
        "status": "in_progress",
        "overlap_start": "2026-06-12 09:00:00",
        "overlap_end": "2026-06-14 18:00:00",
        "reporter_name": "系统管理员",
        "reporter_id": 1
      }
    ]
  }
}
```

---

### 📁 审计视图（可保存的审计导出视图）

管理员可以将常用的导出筛选条件保存为命名视图，以后一键导出，无需重复设置条件。

#### 功能特点

- **一键导出**：保存筛选条件后，通过视图 ID 或名称即可直接导出
- **版本管理**：每次修改视图条件自动递增版本号，便于追溯
- **持久化存储**：视图存储在 SQLite 中，服务重启后仍然可用
- **权限隔离**：仅管理员可创建、查看、修改、删除审计视图
- **审计追踪**：所有视图操作（创建、修改、删除、使用导出）都记录审计日志
- **元数据注入**：使用视图导出时，导出元数据自动包含视图名称、版本、操作者

#### 视图保存的筛选条件

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `name` | string | 是 | 视图名称，唯一，最多 100 字符 |
| `description` | string | 否 | 视图描述说明 |
| `equipment_id` | number | 否 | 指定设备ID |
| `start_date` | string | 否 | 开始日期，格式 `YYYY-MM-DD` 或 `YYYY-MM-DD HH:mm:ss` |
| `end_date` | string | 否 | 结束日期，格式 `YYYY-MM-DD` 或 `YYYY-MM-DD HH:mm:ss` |
| `event_types` | array | 否 | 事件类型数组，如 `["borrow_created", "borrow_conflict_blocked"]` |
| `export_format` | string | 是 | 导出格式：`json` 或 `csv` |

#### 按视图导出的元数据

使用视图导出时，JSON 格式的 `meta` 字段会额外包含：

```json
{
  "meta": {
    "view_name": "每周设备审计",
    "view_version": 3,
    "view_id": 5,
    "exported_at": "2026-06-05T10:30:00.000Z",
    "exported_by": "系统管理员",
    "exported_by_id": 1,
    "...": "其他字段..."
  }
}
```

#### 冲突拦截事件筛选

审计视图支持专门筛选冲突拦截事件，用于定期审计被拒绝的申请：

```javascript
// 示例：只筛选冲突拦截事件的视图
{
  "name": "冲突拦截审计",
  "event_types": ["borrow_conflict_blocked", "maintenance_conflict_blocked"],
  "export_format": "json"
}
```

#### 权限控制说明

| 操作 | 管理员 | 普通用户 |
|------|--------|----------|
| 创建视图 | ✅ | ❌ 返回 403，记录审计日志 |
| 查询视图列表 | ✅ | ❌ 返回 403，记录审计日志 |
| 查询视图详情 | ✅ | ❌ 返回 403，记录审计日志 |
| 修改视图（含重命名） | ✅ | ❌ 返回 403，记录审计日志 |
| 删除视图 | ✅ | ❌ 返回 403，记录审计日志 |
| 按视图导出 | ✅ | ❌ 返回 403，记录审计日志 |

> **安全说明**：普通用户的所有越权尝试都会被记录到审计日志，action 为 `UNAUTHORIZED_ACCESS_ATTEMPT`，包含尝试的路径、方法和用户角色。

---

### 通用导出筛选条件

- **按设备**：选择特定设备导出相关记录
- **按日期**：指定开始和结束日期筛选
- **按事件类型**：指定事件类型数组筛选（支持冲突拦截事件）
- **格式选择**：CSV（适合 Excel 打开）或 JSON（适合程序处理）
- **按视图导出**：使用保存的审计视图 ID 或名称导出

### 导出一致性保证

导出的数据与页面显示的记录完全一致：
- 导出字段与页面表格列对应
- 状态文本使用中文描述
- 日期格式统一
- CSV 文件包含 UTF-8 BOM，确保中文在 Excel 中正常显示
- 事件顺序跨服务重启保持一致（按时间升序 + event_id 字典序）

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
| **GET** | **`/audit/export/timeline`** | **导出设备使用与维保日历包（CSV/JSON）** | **仅管理员** |
| GET | `/audit/timeline` | 获取设备时间线 | 所有用户 |
| GET | `/audit/timeline?equipment_id=:id` | 按设备查询时间线（查询参数） | 所有用户 |
| GET | `/audit/timeline/:equipment_id` | 按设备查询时间线（路径参数） | 所有用户 |
| **GET** | **`/audit/event-types`** | **获取可用事件类型列表** | **所有用户** |
| **POST** | **`/audit/views`** | **创建审计视图** | **仅管理员** |
| **GET** | **`/audit/views`** | **获取所有审计视图列表** | **仅管理员** |
| **GET** | **`/audit/views/:id`** | **获取单个审计视图详情** | **仅管理员** |
| **PUT** | **`/audit/views/:id`** | **更新审计视图（含重命名）** | **仅管理员** |
| **DELETE** | **`/audit/views/:id`** | **删除审计视图** | **仅管理员** |

#### 设备使用与维保日历包导出接口说明

**接口**：`GET /api/audit/export/timeline`

**请求参数**（Query String）：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `format` | string | 否 | 导出格式：`csv`（默认）或 `json` |
| `equipment_id` | number | 否 | 设备ID，不指定则导出所有设备 |
| `start_date` | string | 否 | 开始时间（含），格式：`YYYY-MM-DD` 或 `YYYY-MM-DD HH:mm:ss` |
| `end_date` | string | 否 | 结束时间（含），格式：`YYYY-MM-DD` 或 `YYYY-MM-DD HH:mm:ss` |

**权限控制**：
- 管理员（`role = 'admin'`）：完整导出所有事件和字段
- 普通用户：返回 HTTP 403，错误码 `ADMIN_REQUIRED`，错误信息：`需要管理员权限`

**越权访问响应示例**（HTTP 403）：
```json
{
  "error": "需要管理员权限",
  "code": "ADMIN_REQUIRED"
}
```

**用户可见影响**：
- 普通用户在页面上不会看到导出按钮
- 普通用户调用 API 会收到明确的权限拒绝错误
- 普通用户查看设备时间线时，非本人操作的事件会被自动脱敏（`operator_name` 显示为"其他用户"，`operator_id` 为 `null`，敏感详情字段被隐藏）
- 管理员导出的日历包包含完整信息，可用于审计和追溯

**导出参数**：
- `format`: `csv`（默认）或 `json`
- `equipment_id`: 可选，按设备筛选
- `start_date`: 可选，开始日期（含）
- `end_date`: 可选，结束日期（含）

**设备台账导出字段**：
设备编号、设备名称、设备分类、规格型号、存放位置、状态、描述、创建时间、更新时间

**借用记录导出字段**：
申请单号、设备编号、设备名称、设备分类、申请人、审批人、借用用途、开始时间、结束时间、状态、领用时间、归还时间、验收结果、损坏备注、审批意见、创建时间

---

#### 审计视图接口说明

##### 1. 创建审计视图

**接口**：`POST /api/audit/views`

**请求体**：
```json
{
  "name": "每周设备审计",
  "description": "每周一导出的全量审计数据",
  "equipment_id": 1,
  "start_date": "2026-06-01",
  "end_date": "2026-06-30",
  "event_types": ["borrow_created", "borrow_approved", "borrow_conflict_blocked"],
  "export_format": "json"
}
```

**成功响应**（HTTP 201）：
```json
{
  "view": {
    "id": 1,
    "name": "每周设备审计",
    "description": "每周一导出的全量审计数据",
    "equipment_id": 1,
    "start_date": "2026-06-01",
    "end_date": "2026-06-30",
    "event_types": ["borrow_created", "borrow_approved", "borrow_conflict_blocked"],
    "export_format": "json",
    "version": 1,
    "created_by": 1,
    "created_at": "2026-06-05T10:00:00.000Z",
    "updated_at": "2026-06-05T10:00:00.000Z"
  }
}
```

**失败响应**：
- HTTP 400 `INVALID_VIEW_PARAMS`：参数验证失败，包含详细错误列表
- HTTP 409 `VIEW_NAME_DUPLICATE`：视图名称已存在
- HTTP 404 `EQUIPMENT_NOT_FOUND`：指定的设备不存在

##### 2. 查询所有审计视图

**接口**：`GET /api/audit/views`

**成功响应**（HTTP 200）：
```json
{
  "views": [
    {
      "id": 1,
      "name": "每周设备审计",
      "description": "每周一导出的全量审计数据",
      "version": 2,
      "export_format": "json",
      "created_at": "2026-06-05T10:00:00.000Z",
      "updated_at": "2026-06-05T11:00:00.000Z"
    }
  ]
}
```

##### 3. 查询单个审计视图详情

**接口**：`GET /api/audit/views/:id`

**成功响应**（HTTP 200）：
```json
{
  "view": {
    "id": 1,
    "name": "每周设备审计",
    "description": "每周一导出的全量审计数据",
    "equipment_id": 1,
    "start_date": "2026-06-01",
    "end_date": "2026-06-30",
    "event_types": ["borrow_created", "borrow_approved"],
    "export_format": "json",
    "version": 2,
    "created_by": 1,
    "created_at": "2026-06-05T10:00:00.000Z",
    "updated_at": "2026-06-05T11:00:00.000Z"
  }
}
```

**失败响应**：
- HTTP 404 `VIEW_NOT_FOUND`：视图不存在

##### 4. 更新审计视图（含重命名）

**接口**：`PUT /api/audit/views/:id`

**请求体**（可更新部分或全部字段）：
```json
{
  "name": "每周设备审计_v2",
  "description": "更新后的描述",
  "export_format": "csv",
  "event_types": ["borrow_conflict_blocked"]
}
```

**成功响应**（HTTP 200）：
```json
{
  "view": {
    "id": 1,
    "name": "每周设备审计_v2",
    "version": 3,
    "...": "其他字段..."
  }
}
```

> **注意**：每次成功更新都会自动递增 `version` 字段。

**失败响应**：
- HTTP 404 `VIEW_NOT_FOUND`：视图不存在
- HTTP 400 `INVALID_VIEW_PARAMS`：参数验证失败
- HTTP 409 `VIEW_NAME_DUPLICATE`：新名称已存在

##### 5. 删除审计视图

**接口**：`DELETE /api/audit/views/:id`

**成功响应**（HTTP 200）：
```json
{
  "message": "视图删除成功"
}
```

**失败响应**：
- HTTP 404 `VIEW_NOT_FOUND`：视图不存在

##### 6. 按视图导出

**接口**：`GET /api/audit/export/timeline?view_id=:id` 或 `?view_name=:name`

**参数**：
- `view_id`：视图 ID
- `view_name`：视图名称（URL 编码）

> **注意**：不能同时指定 `view_id` 和 `view_name`，如果同时指定，`view_id` 优先。

**成功响应**：
与即时导出格式相同，但 `meta` 字段额外包含 `view_name`、`view_version`、`view_id`。

**失败响应**：
- HTTP 404 `VIEW_NOT_FOUND`：视图不存在或已删除

##### 7. 获取事件类型列表

**接口**：`GET /api/audit/event-types`

**成功响应**（HTTP 200）：
```json
{
  "event_types": [
    {
      "type": "borrow_created",
      "text": "提交借用申请",
      "source_type": "borrow"
    },
    {
      "type": "borrow_conflict_blocked",
      "text": "借用申请因冲突被拦截",
      "source_type": "audit"
    }
  ]
}
```

#### 用户可见影响

- **管理员**：
  - 在审计导出页面可以看到「保存视图」和「我的视图」功能
  - 可以管理（创建、查看、修改、删除）自己创建的审计视图
  - 使用视图导出时，导出文件自动包含视图元数据
  - 可以在审计日志中查看所有视图操作记录

- **普通用户**：
  - 页面上不显示任何审计视图相关功能
  - 无法通过 API 访问任何视图接口（返回 403）
  - 越权访问尝试会被记录到审计日志
  - 仍然可以正常查看设备时间线（自动脱敏）
  - 仍然可以正常提交借用和维修申请

- **导出文件变化**：
  - 使用视图导出的 JSON 文件在 `meta` 中新增 `view_name`、`view_version`、`view_id` 字段
  - 导出文件名会包含视图名称（如 `timeline_view_每周设备审计_1234567890.json`）
  - 即时导出（不使用视图）的文件格式保持不变

#### 错误码新增

| 错误码 | 说明 |
|--------|------|
| `VIEW_NAME_DUPLICATE` | 视图名称已存在 |
| `VIEW_NOT_FOUND` | 视图不存在或已删除 |
| `INVALID_VIEW_PARAMS` | 视图参数验证失败 |
| `VIEW_DELETE_FAILED` | 视图删除失败 |

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
| `INVALID_EXPORT_FORMAT` | 不支持的导出格式 |
| `VIEW_NAME_DUPLICATE` | 审计视图名称已存在 |
| `VIEW_NOT_FOUND` | 审计视图不存在或已删除 |
| `INVALID_VIEW_PARAMS` | 审计视图参数验证失败 |
| `VIEW_DELETE_FAILED` | 审计视图删除失败 |

## 📄 License

MIT License
