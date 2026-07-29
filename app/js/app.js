const APP_KEY = "xlx_ops_mvp_v1";
const SESSION_KEY = "xlx_ops_session_v1";
const SERVER_MODE = location.protocol.startsWith("http");
const PUBLIC_PRODUCTION = true;

const today = new Date().toISOString().slice(0, 10);

const roles = {
  admin: {
    name: "系统管理员",
    scope: "全部",
    modules: ["dashboard", "leads", "salesOrders", "purchases", "inventory", "deliveries", "trainings", "aftersales", "products", "suppliers", "notices", "users"],
    actions: ["view", "create", "edit", "delete", "export", "config"],
  },
  leader: {
    name: "公司领导",
    scope: "全部",
    modules: ["dashboard", "leads", "salesOrders", "purchases", "inventory", "deliveries", "trainings", "aftersales", "products", "suppliers", "notices"],
    actions: ["view", "export"],
  },
  coordinator: {
    name: "业务统筹",
    scope: "全部",
    modules: ["dashboard", "leads", "salesOrders", "purchases", "inventory", "deliveries", "trainings", "aftersales", "products", "suppliers", "notices"],
    actions: ["view", "create", "edit", "export"],
  },
  sales: {
    name: "销售/业务",
    scope: "本人",
    modules: ["dashboard", "leads", "salesOrders", "deliveries", "trainings", "aftersales", "notices"],
    actions: ["view", "create", "edit"],
  },
  purchase: {
    name: "采购",
    scope: "本部门",
    modules: ["dashboard", "salesOrders", "purchases", "inventory", "products", "suppliers", "notices"],
    actions: ["view", "create", "edit", "export"],
  },
  warehouse: {
    name: "仓库/行政",
    scope: "本部门",
    modules: ["dashboard", "salesOrders", "inventory", "deliveries", "purchases", "products", "notices"],
    actions: ["view", "create", "edit", "export"],
  },
  technician: {
    name: "技术",
    scope: "本部门",
    modules: ["dashboard", "salesOrders", "purchases", "deliveries", "trainings", "aftersales", "products", "notices"],
    actions: ["view", "edit"],
  },
  aftersales: {
    name: "售后",
    scope: "本部门",
    modules: ["dashboard", "salesOrders", "aftersales", "deliveries", "trainings", "inventory", "products", "notices"],
    actions: ["view", "create", "edit"],
  },
  finance: {
    name: "财务",
    scope: "本部门",
    modules: ["dashboard", "salesOrders", "purchases", "inventory", "products", "suppliers", "notices"],
    actions: ["view", "export"],
  },
  trainer: {
    name: "技术/培训",
    scope: "本部门",
    modules: ["dashboard", "salesOrders", "deliveries", "trainings", "aftersales", "products", "notices"],
    actions: ["view", "create", "edit"],
  },
};

// 流程动作与角色分开定义。后续权限后台只需给员工写入 workflowActions，
// 就可覆盖这里的默认角色规则，而不需要改动库存和单据流转代码。
const workflowActionRoles = {
  sales_submit: ["admin", "sales", "coordinator"],
  sales_approve: ["admin", "leader", "coordinator"],
  inventory_check: ["admin", "sales", "coordinator", "warehouse"],
  purchase_technical_confirm: ["admin", "technician", "trainer"],
  purchase_approve: ["admin", "purchase"],
  purchase_mark_transit: ["admin", "purchase"],
  purchase_receive: ["admin", "purchase", "warehouse"],
  delivery_create: ["admin", "sales", "coordinator", "warehouse"],
  delivery_outbound: ["admin", "warehouse"],
  delivery_dispatch: ["admin", "warehouse", "sales", "coordinator"],
  delivery_sign: ["admin", "warehouse", "sales", "coordinator"],
  delivery_accept: ["admin", "warehouse", "sales", "coordinator", "technician", "trainer"],
};

const modules = [
  { id: "dashboard", name: "工作台", icon: "▦", desc: "领导看板、风险预警和待办汇总" },
  { id: "leads", name: "线索台账", icon: "◎", desc: "客户线索、合作意向、项目机会" },
  { id: "salesOrders", name: "销售订单", icon: "▣", desc: "由成交线索生成，连接库存、采购、出库和交付" },
  { id: "purchases", name: "采购需求", icon: "□", desc: "大宗、项目、临时、补库、售后换货采购" },
  { id: "inventory", name: "库存台账", icon: "▤", desc: "当前库存、可用库存、安全库存和在途" },
  { id: "deliveries", name: "出库交付", icon: "⇄", desc: "送样、交付、培训、签收与验收" },
  { id: "trainings", name: "培训验收", icon: "✓", desc: "出库后的客户培训、验收和问题闭环" },
  { id: "aftersales", name: "售后工单", icon: "◇", desc: "故障、换货、配置、平台和客户反馈" },
  { id: "products", name: "产品字典", icon: "◆", desc: "统一维护产品名称、类别、规格、默认供应商和安全库存" },
  { id: "suppliers", name: "供应商交期", icon: "⌁", desc: "供应商、MOQ、付款、交期和换货周期" },
  { id: "notices", name: "业务通报", icon: "!", desc: "投标、合同、库存、流程变化同步" },
  { id: "users", name: "员工权限", icon: "☷", desc: "员工账号、角色、状态和权限矩阵" },
];

const moduleFields = {
  leads: [
    ["code", "线索编号", "text", true],
    ["receivedAt", "接收日期", "date", true],
    ["source", "线索来源", "select", true, ["电话咨询", "销售跟进", "老板转介", "合作伙伴", "老客户", "展会/活动", "其他"]],
    ["customer", "客户名称", "text", true],
    ["contact", "联系人", "text", true],
    ["phone", "联系电话", "text", true],
    ["product", "需求产品", "product", true],
    ["quantity", "预计数量", "number", false],
    ["projectType", "项目类型", "select", true, ["投标", "直采", "送样", "零售", "合作洽谈", "售后带单"]],
    ["stage", "商机阶段", "select", true, ["初步咨询", "需求确认", "方案/报价", "投标中", "合同推进", "已成交", "暂停/丢单"]],
    ["owner", "跟进人", "user", true],
    ["nextAction", "下一步动作", "textarea", false],
    ["dueDate", "截止日期", "date", false],
    ["status", "状态", "select", true, ["待分派", "跟进中", "待客户反馈", "待报价", "待投标", "已成交", "已关闭"]],
    ["remark", "备注", "textarea", false],
  ],
  salesOrders: [
    ["code", "销售订单号", "text", true],
    ["leadId", "来源线索", "lead", false],
    ["customer", "客户名称", "text", true],
    ["contact", "联系人", "text", false],
    ["phone", "联系电话", "text", false],
    ["product", "产品名称", "product", true],
    ["model", "型号/规格", "text", false],
    ["quantity", "数量", "number", true],
    ["unitPrice", "单价", "number", false],
    ["totalAmount", "订单金额", "number", false],
    ["contractNo", "合同编号", "text", false],
    ["contractFile", "合同附件说明", "text", false],
    ["deliveryDate", "预计交付日期", "date", false],
    ["owner", "业务负责人", "user", true],
    ["status", "订单状态", "select", true, ["草稿", "待销售审批", "待库存确认", "待采购审批", "待采购到货", "待出库", "已出库", "已完成", "已取消"]],
    ["remark", "备注", "textarea", false],
  ],
  purchases: [
    ["code", "需求单号", "text", true],
    ["submittedAt", "提交日期", "date", true],
    ["requester", "提交人", "user", true],
    ["type", "需求类型", "select", true, ["大宗采购", "项目采购", "临时采购", "补库采购", "售后换货"]],
    ["product", "产品名称", "product", true],
    ["model", "型号/规格", "text", false],
    ["quantity", "数量", "number", true],
    ["contractSigned", "合同已签", "select", true, ["是", "否", "不适用"]],
    ["project", "对应客户/项目", "text", false],
    ["requiredDate", "要求到货日期", "date", false],
    ["estimatedDate", "预估交期", "date", false],
    ["lockedDate", "锁定交期", "date", false],
    ["supplierId", "供应商", "supplier", false],
    ["owner", "采购负责人", "user", true],
    ["techOwner", "技术确认人", "user", false],
    ["payment", "付款方式", "select", false, ["公对公", "个人垫付报销", "月结", "预付", "货到付款"]],
    ["status", "状态", "select", true, ["待采购审批", "待技术确认", "待采购确认", "已下单", "在途", "已到货", "已取消", "异常"]],
    ["remark", "备注", "textarea", false],
  ],
  inventory: [
    ["sku", "SKU", "text", true],
    ["name", "产品名称", "text", true],
    ["model", "型号/规格", "text", false],
    ["category", "类别", "select", true, ["手表", "表带/配件", "智能套装", "床垫", "样机", "其他"]],
    ["safeStock", "安全库存", "number", true],
    ["stock", "当前库存", "number", true],
    ["locked", "已锁定", "number", true],
    ["inTransit", "在途数量", "number", false],
    ["eta", "预计到货", "date", false],
    ["location", "存放位置", "text", false],
    ["checkedAt", "最近盘点日期", "date", false],
    ["owner", "负责人", "user", false],
    ["remark", "备注", "textarea", false],
  ],
  products: [
    ["code", "产品编码", "text", true],
    ["name", "产品名称", "text", true],
    ["category", "类别", "select", true, ["手表", "表带/配件", "智能套装", "床垫", "样机", "平台服务", "组合方案", "其他"]],
    ["model", "默认型号/规格", "text", false],
    ["unit", "单位", "text", false],
    ["safeStock", "默认安全库存", "number", false],
    ["supplierId", "默认供应商", "supplier", false],
    ["status", "状态", "select", true, ["启用", "停用"]],
    ["remark", "备注", "textarea", false],
  ],
  deliveries: [
    ["code", "出库单号", "text", true],
    ["date", "日期", "date", true],
    ["project", "客户/项目", "text", true],
    ["type", "出库类型", "select", true, ["送样", "销售交付", "老板赠送", "售后换货", "培训演示", "其他"]],
    ["inventoryId", "产品", "inventory", true],
    ["quantity", "数量", "number", true],
    ["receiver", "领用/收货人", "text", false],
    ["owner", "业务负责人", "user", true],
    ["tested", "硬件测试", "select", true, ["是", "否", "不适用"]],
    ["systemReady", "系统录入", "select", true, ["是", "否", "不适用"]],
    ["thirdPartyBound", "第三方绑定", "select", true, ["是", "否", "不适用"]],
    ["shipMethod", "发货方式", "select", false, ["快递", "自送", "客户自提", "上门安装", "其他"]],
    ["trackingNo", "快递单号", "text", false],
    ["training", "培训需求", "select", false, ["需要", "不需要", "待确认"]],
    ["trainingAt", "培训时间", "datetime-local", false],
    ["status", "签收/验收状态", "select", true, ["待出库", "已出库", "配送中", "已签收", "已验收", "异常", "已取消"]],
    ["remark", "备注", "textarea", false],
  ],
  trainings: [
    ["code", "培训验收单号", "text", true],
    ["salesOrderId", "关联销售订单", "salesorder", false],
    ["deliveryId", "关联出库单", "delivery", true],
    ["customer", "客户", "text", true],
    ["product", "产品", "product", true],
    ["quantity", "数量", "number", false],
    ["trainingAt", "培训日期", "datetime-local", false],
    ["trainer", "培训人员", "user", true],
    ["customerAttendees", "客户参与人员", "text", false],
    ["content", "培训内容", "textarea", false],
    ["acceptanceResult", "验收结果", "select", true, ["待培训", "培训完成待验收", "验收通过", "验收不通过"]],
    ["attachment", "验收附件说明", "text", false],
    ["issue", "问题记录", "textarea", false],
    ["status", "状态", "select", true, ["待培训", "进行中", "待验收", "已完成", "异常"]],
    ["remark", "备注", "textarea", false],
  ],
  aftersales: [
    ["code", "工单号", "text", true],
    ["date", "受理日期", "date", true],
    ["customer", "客户", "text", true],
    ["phone", "联系方式", "text", false],
    ["product", "产品", "product", true],
    ["deviceNo", "SN/IMEI", "text", false],
    ["type", "问题类型", "select", true, ["咨询", "故障", "换货", "退货", "配置", "平台", "物流", "其他"]],
    ["priority", "紧急程度", "select", true, ["紧急", "高", "中", "低"]],
    ["description", "问题描述", "textarea", true],
    ["owner", "一级处理人", "user", true],
    ["techOwner", "二级技术人", "user", false],
    ["supplierId", "厂家联系人", "supplier", false],
    ["status", "当前状态", "select", true, ["待受理", "处理中", "待技术判断", "待厂家反馈", "待客户反馈", "已解决", "已关闭"]],
    ["nextAction", "下一步", "textarea", false],
    ["promiseAt", "承诺反馈时间", "datetime-local", false],
    ["closedAt", "关闭日期", "date", false],
    ["result", "处理结果", "textarea", false],
  ],
  suppliers: [
    ["product", "产品", "product", true],
    ["name", "供应商", "text", true],
    ["contact", "对接人", "text", false],
    ["phone", "联系方式", "text", false],
    ["moq", "常规MOQ", "number", false],
    ["leadTime", "常规交期", "text", false],
    ["urgentLeadTime", "加急交期", "text", false],
    ["payment", "付款方式", "select", false, ["公对公", "个人垫付报销", "月结", "预付", "货到付款"]],
    ["invoice", "开票方式", "select", false, ["专票", "普票", "不开票", "待确认"]],
    ["replacementCycle", "售后换货周期", "text", false],
    ["techOwner", "技术确认人", "user", false],
    ["status", "合作状态", "select", true, ["合作中", "备选", "暂停", "淘汰"]],
    ["remark", "备注", "textarea", false],
  ],
  notices: [
    ["date", "日期", "date", true],
    ["title", "变化事项", "text", true],
    ["scope", "影响范围", "select", true, ["线索", "合同", "采购", "库存", "交付", "售后", "财务", "多部门"]],
    ["publisher", "提出人", "user", true],
    ["targetRoles", "需同步角色", "multirole", false],
    ["decision", "决策/指示", "textarea", true],
    ["owner", "责任人", "user", false],
    ["dueDate", "截止日期", "date", false],
    ["status", "状态", "select", true, ["待同步", "已同步", "执行中", "已完成", "暂停"]],
    ["remark", "备注", "textarea", false],
  ],
  users: [
    ["name", "姓名", "text", true],
    ["phone", "手机号", "text", false],
    ["department", "部门", "select", true, ["管理层", "业务部", "采购部", "技术部", "仓库/行政", "售后部", "财务部"]],
    ["role", "角色", "role", true],
    ["status", "账号状态", "select", true, ["启用", "禁用"]],
    ["scope", "数据范围", "select", true, ["本人", "本部门", "全部"]],
    ["password", "登录密码（新增必填，编辑留空不变）", "password", false],
  ],
};

const tableColumns = {
  leads: ["code", "customer", "product", "quantity", "stage", "owner", "dueDate", "status"],
  salesOrders: ["code", "customer", "product", "quantity", "totalAmount", "deliveryDate", "owner", "status"],
  purchases: ["code", "type", "product", "quantity", "supplierId", "lockedDate", "owner", "status"],
  inventory: ["sku", "name", "category", "stock", "locked", "available", "safeStock", "inTransit", "statusText"],
  deliveries: ["code", "project", "type", "inventoryId", "quantity", "owner", "status"],
  trainings: ["code", "customer", "product", "quantity", "trainer", "trainingAt", "acceptanceResult", "status"],
  aftersales: ["code", "customer", "product", "type", "priority", "owner", "promiseAt", "status"],
  products: ["code", "name", "category", "model", "unit", "safeStock", "supplierId", "status"],
  suppliers: ["name", "product", "contact", "phone", "moq", "leadTime", "status"],
  notices: ["date", "title", "scope", "publisher", "owner", "dueDate", "status"],
  users: ["name", "department", "role", "scope", "status", "phone"],
};

const columnLabels = {
  code: "编号",
  leadId: "来源线索",
  salesOrderId: "销售订单",
  deliveryId: "出库单",
  customer: "客户",
  product: "产品",
  quantity: "数量",
  stage: "阶段",
  owner: "负责人",
  dueDate: "截止日期",
  status: "状态",
  type: "类型",
  supplierId: "供应商",
  lockedDate: "锁定交期",
  sku: "SKU",
  name: "名称",
  category: "类别",
  stock: "当前库存",
  locked: "已锁定",
  available: "可用库存",
  safeStock: "安全库存",
  inTransit: "在途",
  statusText: "库存状态",
  project: "客户/项目",
  inventoryId: "产品",
  priority: "紧急程度",
  promiseAt: "承诺反馈",
  contact: "对接人",
  phone: "电话",
  moq: "MOQ",
  leadTime: "常规交期",
  date: "日期",
  title: "事项",
  scope: "范围",
  publisher: "提出人",
  department: "部门",
  role: "角色",
  model: "型号/规格",
  unit: "单位",
  unitPrice: "单价",
  totalAmount: "订单金额",
  deliveryDate: "预计交付",
  trainer: "培训人员",
  trainingAt: "培训日期",
  acceptanceResult: "验收结果",
};

const state = {
  currentUser: null,
  serverUser: null,
  route: "dashboard",
  search: "",
  statusFilter: "全部",
  editing: null,
  confirmAction: null,
  activityOpen: false,
  activityLimit: 10,
};

function uid(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2, 7)}-${Date.now().toString(36).slice(-4)}`;
}

function nowIso() {
  return new Date().toISOString();
}

function formatDate(value) {
  if (!value) return "-";
  if (typeof value !== "string") return String(value);
  // 数据库存的是 UTC 时间；页面统一按中国时区展示，避免出现相差 8 小时的操作记录。
  if (/^\d{4}-\d{2}-\d{2}T/.test(value)) {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
      return new Intl.DateTimeFormat("sv-SE", {
        timeZone: "Asia/Shanghai",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(date);
    }
  }
  return value.replace("T", " ").slice(0, 16);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function defaultProducts() {
  return [
    { id: "prod-watch", code: "PROD-WATCH", name: "AI健康手表", category: "手表", model: "4G 养老版", unit: "只", safeStock: 20, supplierId: "s-watch", status: "启用", remark: "手表类主产品" },
    { id: "prod-strap", code: "PROD-STRAP", name: "表带/配件", category: "表带/配件", model: "黑色标准款", unit: "条", safeStock: 60, supplierId: "s-watch", status: "启用", remark: "常用耗材和替换配件" },
    { id: "prod-kit", code: "PROD-KIT", name: "智能养老套装", category: "智能套装", model: "标准套装", unit: "套", safeStock: 8, supplierId: "s-kit", status: "启用", remark: "居家养老项目组合设备" },
    { id: "prod-mattress", code: "PROD-BED", name: "智能床垫", category: "床垫", model: "WIFI 单人 PLUS", unit: "张", safeStock: 2, supplierId: "s-mattress", status: "启用", remark: "项目制采购为主" },
    { id: "prod-platform", code: "PROD-PLATFORM", name: "平台服务", category: "平台服务", model: "SaaS 服务", unit: "项", safeStock: 0, supplierId: "", status: "启用", remark: "平台开通、配置和服务项" },
    { id: "prod-combo", code: "PROD-COMBO", name: "组合方案", category: "组合方案", model: "项目组合", unit: "项", safeStock: 0, supplierId: "", status: "启用", remark: "投标、方案和组合报价使用" },
  ];
}

function normalizeData(data) {
  const normalized = data || {};
  if (!Array.isArray(normalized.products)) {
    normalized.products = defaultProducts();
  }
  for (const key of ["users", "suppliers", "inventory", "leads", "salesOrders", "purchases", "deliveries", "trainings", "aftersales", "notices", "inventoryLogs", "auditLogs"]) {
    if (!Array.isArray(normalized[key])) normalized[key] = [];
  }
  normalized.inventory.forEach((item) => {
    if (!item.productId) item.productId = findProductByLabel(normalized.products, item.name, item.model)?.id || "";
  });
  normalized.salesOrders.forEach((order) => {
    if (!order.productId) order.productId = findProductByLabel(normalized.products, order.product, order.model)?.id || "";
    order.totalAmount = Number(order.totalAmount || Number(order.quantity || 0) * Number(order.unitPrice || 0));
  });
  normalized.purchases.forEach((purchase) => {
    if (!purchase.productId) purchase.productId = findProductByLabel(normalized.products, purchase.product, purchase.model)?.id || "";
    // 旧版“待采购确认”不够明确，统一迁移为“已下单”。
    if (purchase.status === "待采购确认") purchase.status = "已下单";
  });
  normalized.purchases.forEach((purchase) => {
    if (!purchase.sourceSalesOrderId || purchase.status === "已取消") return;
    const order = normalized.salesOrders.find((item) => item.id === purchase.sourceSalesOrderId);
    if (!order || ["已出库", "已完成", "已取消"].includes(order.status)) return;
    if (["待采购审批", "待技术确认"].includes(purchase.status)) order.status = "待采购审批";
    if (["已下单", "在途"].includes(purchase.status)) order.status = "待采购到货";
    // 当前未提供“部分到货”流程；确认到货即代表该订单的缺货已补齐。
    if (purchase.status === "已到货") order.status = "待出库";
  });
  if (!normalized.meta) normalized.meta = { version: 1, createdAt: nowIso() };
  normalized.meta.version = Math.max(Number(normalized.meta.version || 1), 2);
  return normalized;
}

function normalizedProductName(value) {
  return String(value || "").replaceAll("居家", "").replaceAll("智能", "").replaceAll("/", "").replaceAll("配件", "").replaceAll(" ", "").toLowerCase();
}

function findProductByLabel(products, name, model = "") {
  const target = normalizedProductName(name);
  return (products || []).find((product) => {
    const candidate = normalizedProductName(product.name);
    return candidate === target || (candidate.length > 1 && (candidate.includes(target) || target.includes(candidate))) || (product.model && model && product.model === model);
  });
}

function getInitialData() {
  const users = [
    { id: "u-admin", name: "系统管理员", phone: "admin", department: "管理层", role: "admin", status: "启用", scope: "全部" },
    { id: "u-leader", name: "公司领导", phone: "leader", department: "管理层", role: "leader", status: "启用", scope: "全部" },
    { id: "u-mia", name: "Mia", phone: "mia", department: "业务部", role: "coordinator", status: "启用", scope: "全部" },
    { id: "u-emily", name: "Emily", phone: "emily", department: "采购部", role: "purchase", status: "启用", scope: "本部门" },
    { id: "u-sales", name: "销售A", phone: "sales", department: "业务部", role: "sales", status: "启用", scope: "本人" },
    { id: "u-tech", name: "技术负责人", phone: "tech", department: "技术部", role: "technician", status: "启用", scope: "本部门" },
    { id: "u-warehouse", name: "仓库行政", phone: "warehouse", department: "仓库/行政", role: "warehouse", status: "启用", scope: "本部门" },
    { id: "u-after", name: "售后专员", phone: "after", department: "售后部", role: "aftersales", status: "启用", scope: "本部门" },
    { id: "u-finance", name: "财务", phone: "finance", department: "财务部", role: "finance", status: "启用", scope: "本部门" },
  ];
  const suppliers = [
    { id: "s-watch", product: "AI健康手表", name: "手表核心供应商", contact: "王经理", phone: "13800000001", moq: 50, leadTime: "7-10 天", urgentLeadTime: "5 天", payment: "公对公", invoice: "专票", replacementCycle: "7 天", techOwner: "u-tech", status: "合作中", remark: "需提前确认固件版本" },
    { id: "s-kit", product: "智能养老套装", name: "居家套装供应商", contact: "刘经理", phone: "13800000002", moq: 10, leadTime: "10-15 天", urgentLeadTime: "7 天", payment: "月结", invoice: "普票", replacementCycle: "10 天", techOwner: "u-tech", status: "合作中", remark: "支持分批发货" },
    { id: "s-mattress", product: "智能床垫", name: "床垫设备供应商", contact: "陈经理", phone: "13800000003", moq: 5, leadTime: "15-20 天", urgentLeadTime: "12 天", payment: "预付", invoice: "专票", replacementCycle: "15 天", techOwner: "u-tech", status: "备选", remark: "项目制采购为主" },
  ];
  const inventory = [
    { id: "i-watch", sku: "WATCH-AI-001", name: "AI健康手表", model: "4G 养老版", category: "手表", safeStock: 20, stock: 35, locked: 12, inTransit: 40, eta: "2026-07-16", location: "公司样品柜 A1", checkedAt: "2026-07-09", owner: "u-warehouse", remark: "项目交付优先" },
    { id: "i-strap", sku: "STRAP-001", name: "手表表带", model: "黑色标准款", category: "表带/配件", safeStock: 60, stock: 45, locked: 8, inTransit: 0, eta: "", location: "配件柜 B2", checkedAt: "2026-07-09", owner: "u-warehouse", remark: "低于安全库存，建议补货" },
    { id: "i-kit", sku: "KIT-HOME-001", name: "居家智能养老套装", model: "标准套装", category: "智能套装", safeStock: 8, stock: 10, locked: 4, inTransit: 10, eta: "2026-07-18", location: "仓库 C1", checkedAt: "2026-07-09", owner: "u-warehouse", remark: "送样需求频繁" },
    { id: "i-mattress", sku: "BED-PLUS-001", name: "智能床垫", model: "WIFI 单人 PLUS", category: "床垫", safeStock: 2, stock: 1, locked: 1, inTransit: 5, eta: "2026-07-28", location: "仓库 D1", checkedAt: "2026-07-08", owner: "u-warehouse", remark: "不建议大量压货" },
  ];
  return {
    meta: { version: 1, createdAt: nowIso() },
    users,
    products: defaultProducts(),
    suppliers,
    inventory,
    leads: [
      { id: "l-001", code: "L202607-001", receivedAt: "2026-07-09", source: "电话咨询", customer: "汇川民政项目", contact: "周主任", phone: "13900000001", product: "组合方案", quantity: 80, projectType: "投标", stage: "需求确认", owner: "u-mia", nextAction: "整理投标交付周期和库存准备建议", dueDate: "2026-07-12", status: "跟进中", remark: "客户增加投标流程" },
      { id: "l-002", code: "L202607-002", receivedAt: "2026-07-09", source: "老板转介", customer: "养老社区样板间", contact: "李总", phone: "13900000002", product: "智能养老套装", quantity: 6, projectType: "送样", stage: "方案/报价", owner: "u-sales", nextAction: "确认送样时间和培训需求", dueDate: "2026-07-11", status: "待报价", remark: "需要快速凑样" },
      { id: "l-003", code: "L202607-003", receivedAt: "2026-07-08", source: "合作伙伴", customer: "天岛湖康养", contact: "赵经理", phone: "13900000003", product: "AI健康手表", quantity: 120, projectType: "合作洽谈", stage: "合同推进", owner: "u-mia", nextAction: "等待合同版式确认", dueDate: "2026-07-15", status: "待客户反馈", remark: "预计分两批交付" },
    ],
    purchases: [
      { id: "p-001", code: "P202607-001", submittedAt: "2026-07-09", requester: "u-mia", type: "补库采购", product: "表带/配件", model: "黑色标准款", quantity: 100, contractSigned: "不适用", project: "安全库存补货", requiredDate: "2026-07-15", estimatedDate: "2026-07-16", lockedDate: "2026-07-16", supplierId: "s-watch", owner: "u-emily", techOwner: "u-tech", payment: "公对公", status: "已下单", remark: "由库存低于安全库存触发" },
      { id: "p-002", code: "P202607-002", submittedAt: "2026-07-09", requester: "u-sales", type: "项目采购", product: "智能床垫", model: "WIFI 单人 PLUS", quantity: 5, contractSigned: "否", project: "养老社区样板间", requiredDate: "2026-07-20", estimatedDate: "2026-07-28", lockedDate: "2026-07-28", supplierId: "s-mattress", owner: "u-emily", techOwner: "u-tech", payment: "预付", status: "在途", remark: "要求先给预估交期" },
    ],
    deliveries: [
      { id: "d-001", code: "D202607-001", date: "2026-07-09", project: "养老社区样板间", type: "送样", inventoryId: "i-kit", quantity: 2, receiver: "李总", owner: "u-sales", tested: "是", systemReady: "是", thirdPartyBound: "否", shipMethod: "自送", trackingNo: "", training: "需要", trainingAt: "2026-07-12T10:00", status: "配送中", remark: "第三方绑定现场完成" },
    ],
    aftersales: [
      { id: "a-001", code: "A202607-001", date: "2026-07-09", customer: "天岛湖康养", phone: "13900000003", product: "AI健康手表", deviceNo: "IMEI-TEST-001", type: "配置", priority: "高", description: "部分手表定位刷新延迟", owner: "u-after", techOwner: "u-tech", supplierId: "s-watch", status: "待技术判断", nextAction: "技术确认平台配置和网络日志", promiseAt: "2026-07-10T18:00", closedAt: "", result: "" },
      { id: "a-002", code: "A202607-002", date: "2026-07-08", customer: "汇川民政项目", phone: "13900000001", product: "智能养老套装", deviceNo: "KIT-008", type: "故障", priority: "紧急", description: "网关离线，客户要求当天反馈", owner: "u-after", techOwner: "u-tech", supplierId: "s-kit", status: "处理中", nextAction: "等待厂家远程排查结果", promiseAt: "2026-07-10T12:00", closedAt: "", result: "" },
    ],
    notices: [
      { id: "n-001", date: "2026-07-09", title: "客户采购流程新增投标环节", scope: "合同", publisher: "u-mia", targetRoles: ["leader", "purchase", "warehouse", "technician"], decision: "涉及汇川民政项目的采购备货先按预估交期评估，不直接锁库存。", owner: "u-mia", dueDate: "2026-07-12", status: "已同步", remark: "影响采购和库存计划" },
      { id: "n-002", date: "2026-07-10", title: "表带库存低于安全库存", scope: "库存", publisher: "u-warehouse", targetRoles: ["leader", "purchase", "coordinator"], decision: "采购部确认补库 100 条，仓库保留样品出库记录。", owner: "u-emily", dueDate: "2026-07-15", status: "执行中", remark: "已生成采购需求 P202607-001" },
    ],
    inventoryLogs: [
      { id: "log-001", itemId: "i-kit", action: "出库", quantity: 2, beforeStock: 12, afterStock: 10, sourceType: "delivery", sourceId: "d-001", operatorId: "u-warehouse", createdAt: "2026-07-09T15:20:00", remark: "养老社区样板间送样" },
    ],
    auditLogs: [],
  };
}

async function loadData() {
  if (SERVER_MODE) {
    try {
      const response = await fetch("/api/db", { cache: "no-store", credentials: "same-origin" });
      if (response.ok) {
        const data = normalizeData(await response.json());
        localStorage.setItem(APP_KEY, JSON.stringify(data));
        return data;
      }
      if (PUBLIC_PRODUCTION && response.status === 401) {
        const data = normalizeData({ ...getInitialData(), users: state.serverUser ? [state.serverUser] : [] });
        localStorage.setItem(APP_KEY, JSON.stringify(data));
        return data;
      }
    } catch {
      // Fall through to local cache when the server is not available.
    }
  }
  try {
    const raw = localStorage.getItem(APP_KEY);
    if (!raw) {
      const data = getInitialData();
      localStorage.setItem(APP_KEY, JSON.stringify(data));
      return data;
    }
    const parsed = JSON.parse(raw);
    if (!parsed.meta || Number(parsed.meta.version || 0) < 1) throw new Error("version mismatch");
    return normalizeData(parsed);
  } catch {
    const data = getInitialData();
    localStorage.setItem(APP_KEY, JSON.stringify(data));
    return data;
  }
}

let db = null;

function saveData() {
  localStorage.setItem(APP_KEY, JSON.stringify(db));
  if (SERVER_MODE) {
    fetch("/api/db", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(db),
    }).then((response) => {
      if (PUBLIC_PRODUCTION && response.status === 401) {
        state.serverUser = null;
        toast("登录已过期，请重新登录");
        render();
      }
    }).catch(() => toast("服务器保存失败，请检查网络或联系管理员"));
  }
}

function logAction(action, moduleId, recordId, detail) {
  db.auditLogs = db.auditLogs || [];
  db.auditLogs.unshift({
    id: uid("audit"),
    action,
    moduleId,
    recordId,
    detail,
    operatorId: state.currentUser?.id || "",
    createdAt: nowIso(),
  });
  db.auditLogs = db.auditLogs.slice(0, 300);
}

function setSession(userId) {
  localStorage.setItem(SESSION_KEY, JSON.stringify({ userId, at: nowIso() }));
}

function getSessionUser() {
  if (PUBLIC_PRODUCTION && SERVER_MODE) {
    if (!state.serverUser) return null;
    return db.users.find((u) => u.id === state.serverUser.id && u.status === "启用") || state.serverUser;
  }
  try {
    const session = JSON.parse(localStorage.getItem(SESSION_KEY) || "{}");
    return db.users.find((u) => u.id === session.userId && u.status === "启用") || null;
  } catch {
    return null;
  }
}

function userName(id) {
  return db.users.find((u) => u.id === id)?.name || id || "-";
}

function moduleName(moduleId) {
  return modules.find((module) => module.id === moduleId)?.name || moduleId || "系统";
}

function actionName(action) {
  return ({ create: "新增", update: "编辑", delete: "删除", cancel: "作废", approve: "审批", inbound: "入库", outbound: "出库", purchase_received: "采购到货", rollback: "回撤", merge: "合并" })[action] || action || "操作";
}

function renderActivityPanel() {
  if (!state.activityOpen) return "";
  const allActivities = db.auditLogs || [];
  const activities = allActivities.slice(0, state.activityLimit);
  const hasMore = allActivities.length > activities.length;
  return `<section class="activity-panel" aria-label="流程动态">
    <div class="activity-panel-title"><strong>流程动态</strong><span>最近操作</span></div>
    <div class="activity-list">${activities.length ? activities.map((log) => `<article class="activity-item">
      <strong>${escapeHtml(userName(log.operatorId))} · ${escapeHtml(actionName(log.action))}${escapeHtml(moduleName(log.moduleId))}</strong>
      <p>${escapeHtml(log.detail || "")}</p>
      <time>${escapeHtml(formatDate(log.createdAt))}</time>
    </article>`).join("") : `<p class="compact-note">暂时没有流程动态</p>`}</div>
    ${hasMore ? `<button class="activity-more-btn" type="button" data-action="load-more-activity">加载更多</button>` : ""}
  </section>`;
}

function supplierName(id) {
  return db.suppliers.find((s) => s.id === id)?.name || id || "-";
}

function inventoryName(id) {
  return db.inventory.find((i) => i.id === id)?.name || id || "-";
}

function productOptions(currentValue = "") {
  const options = [];
  const add = (value) => {
    const text = String(value ?? "").trim();
    if (text && !options.includes(text)) options.push(text);
  };
  (db.products || [])
    .filter((product) => product.status !== "停用")
    .forEach((product) => add(product.name));
  for (const collection of ["leads", "purchases", "aftersales", "suppliers"]) {
    (db[collection] || []).forEach((record) => add(record.product));
  }
  (db.inventory || []).forEach((item) => add(item.name));
  add(currentValue);
  return options;
}

function productById(productId) {
  return db.products.find((product) => product.id === productId) || null;
}

function inventoryForProduct(productName, productId = "", model = "") {
  if (productId) {
    const byId = db.inventory.find((item) => item.productId === productId);
    if (byId) return byId;
  }
  const product = productById(productId) || findProductByLabel(db.products, productName, model);
  return db.inventory.find((item) => {
    if (product?.id && item.productId === product.id) return true;
    const itemName = normalizedProductName(item.name);
    const target = normalizedProductName(productName);
    return itemName === target || (itemName.length > 1 && (itemName.includes(target) || target.includes(itemName)));
  }) || null;
}

function roleName(id) {
  return roles[id]?.name || id || "-";
}

function currentRole() {
  return roles[state.currentUser?.role] || roles.sales;
}

function can(moduleId, action = "view") {
  const role = currentRole();
  return role.modules.includes(moduleId) && role.actions.includes(action);
}

function canWorkflow(action) {
  const user = state.currentUser;
  if (!user) return false;
  if (Array.isArray(user.workflowActions)) return user.workflowActions.includes("*") || user.workflowActions.includes(action);
  return (workflowActionRoles[action] || []).includes(user.role);
}

function canEditWorkflowRecord(moduleId, record) {
  if (!record) return true;
  if (moduleId === "salesOrders") return record.status === "草稿";
  if (moduleId === "purchases") return ["待采购审批", "待技术确认", "待采购确认", "异常"].includes(record.status);
  if (moduleId === "deliveries") return record.status === "待出库";
  return true;
}

function visibleModules() {
  return modules.filter((m) => currentRole().modules.includes(m.id));
}

function collectionFor(moduleId) {
  return moduleId === "users" ? "users" : moduleId;
}

function canSeeRecord(record) {
  if (!state.currentUser) return false;
  const role = currentRole();
  if (role.scope === "全部" || state.currentUser.scope === "全部") return true;
  const ids = [record.owner, record.requester, record.publisher, record.techOwner, record.createdBy].filter(Boolean);
  if (ids.includes(state.currentUser.id)) return true;
  if (state.currentUser.scope === "本部门" || role.scope === "本部门") {
    const owner = db.users.find((u) => ids.includes(u.id));
    return owner ? owner.department === state.currentUser.department : true;
  }
  return false;
}

function listRecords(moduleId) {
  const collection = collectionFor(moduleId);
  const source = db[collection] || [];
  if (moduleId === "users" && state.currentUser.role !== "admin") return [];
  // 库存数量是公司统一事实；有库存模块权限的员工应看到同一份库存。
  if (moduleId === "inventory") return source;
  return source.filter(canSeeRecord);
}

function isArchivedRecord(moduleId, record) {
  const status = record.status || "";
  if (moduleId === "leads") return status === "已关闭";
  if (moduleId === "salesOrders") return ["已完成", "已取消"].includes(status);
  if (moduleId === "purchases") return ["已到货", "已取消"].includes(status);
  if (moduleId === "deliveries") return ["已验收", "已取消"].includes(status);
  if (moduleId === "trainings") return status === "已完成";
  if (moduleId === "aftersales") return ["已解决", "已关闭"].includes(status);
  if (moduleId === "notices") return status === "已完成";
  return false;
}

function statusClass(value) {
  const risk = ["异常", "紧急", "缺货", "超领", "已取消", "暂停/丢单", "待受理"];
  const warn = ["低于安全库存", "待技术确认", "待采购确认", "在途", "待客户反馈", "待报价", "待投标", "待厂家反馈", "待技术判断", "处理中", "配送中", "执行中", "待同步"];
  const ok = ["正常", "已成交", "已到货", "已签收", "已验收", "已解决", "已关闭", "已完成", "已同步", "合作中", "启用"];
  if (risk.some((x) => String(value).includes(x))) return "risk";
  if (warn.some((x) => String(value).includes(x))) return "warn";
  if (ok.some((x) => String(value).includes(x))) return "ok";
  return "info";
}

function availableStock(item) {
  return Number(item.stock || 0) - Number(item.locked || 0);
}

function inventoryStatus(item) {
  const available = availableStock(item);
  if (available < 0) return "异常:超领";
  if (Number(item.stock || 0) <= 0) return "缺货";
  if (available < Number(item.safeStock || 0)) return "低于安全库存";
  return "正常";
}

function calcAlerts() {
  const alerts = [];
  db.inventory.forEach((item) => {
    const available = availableStock(item);
    const status = inventoryStatus(item);
    if (status !== "正常") {
      alerts.push({
        id: `inv-${item.id}`,
        level: status.includes("缺货") || status.includes("异常") ? "risk" : "warn",
        title: `${item.name} ${status}`,
        message: `当前库存 ${item.stock}，已锁定 ${item.locked}，可用 ${available}，安全库存 ${item.safeStock}`,
        refModule: "inventory",
        refId: item.id,
      });
    }
    if (item.eta && item.inTransit > 0 && item.eta < today) {
      alerts.push({
        id: `eta-${item.id}`,
        level: "warn",
        title: `${item.name} 在途到货逾期`,
        message: `在途数量 ${item.inTransit}，预计到货 ${item.eta}`,
        refModule: "inventory",
        refId: item.id,
      });
    }
  });
  db.purchases.forEach((p) => {
    if (!["已到货", "已取消"].includes(p.status) && p.lockedDate && p.lockedDate < today) {
      alerts.push({
        id: `purchase-${p.id}`,
        level: "warn",
        title: `${p.code} 采购交期逾期`,
        message: `${p.product} ${p.quantity} 件，锁定交期 ${p.lockedDate}，状态 ${p.status}`,
        refModule: "purchases",
        refId: p.id,
      });
    }
  });
  db.aftersales.forEach((a) => {
    if (!["已解决", "已关闭"].includes(a.status) && a.promiseAt && a.promiseAt.slice(0, 10) < today) {
      alerts.push({
        id: `after-${a.id}`,
        level: a.priority === "紧急" ? "risk" : "warn",
        title: `${a.code} 售后反馈超时`,
        message: `${a.customer} ${a.type}，承诺反馈 ${formatDate(a.promiseAt)}，当前 ${a.status}`,
        refModule: "aftersales",
        refId: a.id,
      });
    }
  });
  db.deliveries.forEach((d) => {
    if (d.status === "异常") {
      alerts.push({
        id: `delivery-${d.id}`,
        level: "risk",
        title: `${d.code} 交付异常`,
        message: `${d.project} ${inventoryName(d.inventoryId)} ${d.quantity} 件`,
        refModule: "deliveries",
        refId: d.id,
      });
    }
  });
  return alerts;
}

function dashboardStats() {
  const alerts = calcAlerts();
  return {
    leadsActive: db.leads.filter((x) => !["已成交", "已关闭"].includes(x.status)).length,
    purchasePending: db.purchases.filter((x) => !["已到货", "已取消"].includes(x.status)).length,
    inventoryRisk: alerts.filter((x) => x.refModule === "inventory").length,
    deliveryOpen: db.deliveries.filter((x) => !["已签收", "已验收", "已取消"].includes(x.status)).length,
    afterOpen: db.aftersales.filter((x) => !["已解决", "已关闭"].includes(x.status)).length,
    alerts,
  };
}

function fieldValue(moduleId, record, key) {
  if (moduleId === "inventory" && key === "available") return availableStock(record);
  if (moduleId === "inventory" && key === "statusText") return inventoryStatus(record);
  if (moduleId === "salesOrders" && key === "totalAmount") {
    if (record.totalAmount !== "" && record.totalAmount !== null && record.totalAmount !== undefined) return record.totalAmount;
    return Number(record.quantity || 0) * Number(record.unitPrice || 0);
  }
  if (["owner", "requester", "publisher", "techOwner"].includes(key)) return userName(record[key]);
  if (key === "supplierId") return supplierName(record[key]);
  if (key === "inventoryId") return inventoryName(record[key]);
  if (key === "leadId") return db.leads.find((lead) => lead.id === record[key])?.code || "-";
  if (key === "salesOrderId") return db.salesOrders.find((order) => order.id === record[key])?.code || "-";
  if (key === "deliveryId") return db.deliveries.find((delivery) => delivery.id === record[key])?.code || "-";
  if (key === "trainer") return userName(record[key]);
  if (key === "role") return roleName(record[key]);
  if (Array.isArray(record[key])) return record[key].map(roleName).join("、");
  return record[key] ?? "-";
}

function toast(message) {
  const old = document.querySelector(".toast");
  if (old) old.remove();
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = message;
  document.body.appendChild(el);
  // 业务流转的提示通常包含关联单据变化，保留更久方便核对。
  setTimeout(() => el.remove(), 8000);
}

function render() {
  state.currentUser = getSessionUser();
  if (!state.currentUser) {
    renderLogin();
    return;
  }
  if (!currentRole().modules.includes(state.route)) {
    state.route = visibleModules()[0]?.id || "dashboard";
  }
  renderApp();
}

function renderLogin() {
  document.getElementById("app").innerHTML = `
    <main class="login-shell">
      <section class="login-panel">
        <div class="brand-row">
          <img class="brand-logo" src="./assets/logo.jpg" alt="海魄科技 Logo" />
          <div>
            <div class="brand-title">上海海魄信息科技股份有限公司</div>
            <div class="brand-subtitle">心连心智能养老业务运营系统</div>
          </div>
        </div>
        <h1 class="login-title">业务协同，从入口开始</h1>
        <p class="login-note">电脑端用于查询、管理和看板；手机端用于一线录入、售后处理、库存盘点和交付反馈。公网访问已启用服务端账号验证。</p>
        <form id="loginForm" class="field-stack">
          <div class="field">
            <label for="loginUser">账号</label>
            <input id="loginUser" name="account" autocomplete="username" placeholder="请输入账号或手机号" />
          </div>
          <div class="field">
            <label for="loginPassword">密码</label>
            <input id="loginPassword" type="password" autocomplete="current-password" placeholder="请输入密码" />
          </div>
          <button class="primary-btn" type="submit">登录系统</button>
          <p class="compact-note">公网正式版使用 HTTPS、HttpOnly 登录 Cookie 和 PostgreSQL 数据库。忘记密码请联系系统管理员重置。</p>
        </form>
      </section>
      <section class="login-visual">
        <div>
          <h2>统一入口、统一主责、统一数据</h2>
          <p>线索、采购、库存、交付、售后和业务通报在同一套系统里流转，领导随时看风险，员工按权限录入。</p>
        </div>
      </section>
    </main>
  `;
  document.getElementById("loginForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const phone = document.getElementById("loginUser").value.trim();
    const password = document.getElementById("loginPassword").value.trim();
    if (PUBLIC_PRODUCTION && SERVER_MODE) {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ account: phone, password }),
      });
      if (!response.ok) {
        toast("账号或密码错误，或账号已禁用");
        return;
      }
      const payload = await response.json();
      state.serverUser = payload.user;
      db = await loadData();
      state.route = roles[payload.user.role].modules[0] || "dashboard";
      render();
      return;
    }
    const user = db.users.find((u) => u.phone === phone && u.password === password && u.status === "启用");
    if (!user) {
      toast("账号或密码错误，或账号已禁用");
      return;
    }
    setSession(user.id);
    state.route = roles[user.role].modules[0] || "dashboard";
    render();
  });
}

function renderApp() {
  const route = modules.find((m) => m.id === state.route);
  document.getElementById("app").innerHTML = `
    <main class="app-shell">
      <aside class="sidebar">
        <div class="brand-row">
          <img class="brand-logo" src="./assets/logo.jpg" alt="海魄科技 Logo" />
          <div>
            <div class="brand-title">心连心运营系统</div>
            <div class="brand-subtitle">智能养老业务公网生产版</div>
          </div>
        </div>
        <nav class="nav">
          ${visibleModules().map((m) => navButton(m)).join("")}
        </nav>
      </aside>
      <section class="main">
        <header class="topbar">
          <div class="topbar-left">
            <h1 class="page-title">${route?.name || ""}</h1>
            <p class="page-desc">${route?.desc || ""}</p>
          </div>
          <div class="topbar-actions">
            <div class="activity-wrap">
              <button class="bell-btn" type="button" data-action="toggle-activity" aria-label="查看流程动态" title="流程动态"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></svg><span class="bell-dot"></span></button>
              ${renderActivityPanel()}
            </div>
            <span class="role-pill">${state.currentUser.name} · ${roleName(state.currentUser.role)}</span>
            ${PUBLIC_PRODUCTION ? "" : `<button class="ghost-btn" data-action="reset-demo">重置演示数据</button>`}
            <button class="ghost-btn" data-action="logout">退出</button>
          </div>
        </header>
        <div class="content">${renderRoute()}</div>
      </section>
      <nav class="mobile-bottom-nav">
        ${visibleModules().slice(0, 5).map((m) => navButton(m, true)).join("")}
      </nav>
    </main>
  `;
  bindGlobalActions();
}

function navButton(module, mobile = false) {
  const active = state.route === module.id ? "active" : "";
  return `<button class="${active}" data-route="${module.id}"><span class="nav-icon">${module.icon}</span><span>${mobile ? module.name.slice(0, 4) : module.name}</span></button>`;
}

function bindGlobalActions() {
  document.querySelectorAll("[data-route]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.route = btn.dataset.route;
      state.search = "";
      state.statusFilter = "全部";
      render();
    });
  });
  document.querySelector('[data-action="logout"]')?.addEventListener("click", async () => {
    if (PUBLIC_PRODUCTION && SERVER_MODE) {
      await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" }).catch(() => {});
      state.serverUser = null;
    }
    localStorage.removeItem(SESSION_KEY);
    render();
  });
  document.querySelector('[data-action="reset-demo"]')?.addEventListener("click", () => {
    if (!confirm("确认重置演示数据？当前浏览器内的修改会被覆盖。")) return;
    db = getInitialData();
    saveData();
    toast("演示数据已重置");
    render();
  });
  document.querySelector('[data-action="toggle-activity"]')?.addEventListener("click", () => {
    state.activityOpen = !state.activityOpen;
    if (state.activityOpen) state.activityLimit = 10;
    render();
  });
  document.querySelector('[data-action="load-more-activity"]')?.addEventListener("click", () => {
    state.activityLimit += 10;
    render();
  });
  document.querySelectorAll("[data-create]").forEach((btn) => btn.addEventListener("click", () => openForm(btn.dataset.create)));
  document.querySelectorAll("[data-view]").forEach((btn) => btn.addEventListener("click", () => openDetail(btn.dataset.module, btn.dataset.view)));
  document.querySelectorAll("[data-edit]").forEach((btn) => btn.addEventListener("click", () => openForm(btn.dataset.module, btn.dataset.edit)));
  document.querySelectorAll("[data-delete]").forEach((btn) => btn.addEventListener("click", () => removeRecord(btn.dataset.module, btn.dataset.delete)));
  document.querySelectorAll("[data-drill]").forEach((btn) => btn.addEventListener("click", () => {
    state.route = btn.dataset.drill;
    state.statusFilter = btn.dataset.status || "全部";
    render();
  }));
  document.querySelectorAll("[data-alert-ref]").forEach((btn) => btn.addEventListener("click", () => {
    state.route = btn.dataset.module;
    state.search = btn.dataset.alertRef;
    render();
  }));
  document.querySelectorAll("[data-inbound]").forEach((btn) => btn.addEventListener("click", () => openManualStockAdjustment(btn.dataset.inbound, "入库")));
  document.querySelectorAll("[data-outbound]").forEach((btn) => btn.addEventListener("click", () => openManualStockAdjustment(btn.dataset.outbound, "出库")));
  document.querySelectorAll("[data-create-order]").forEach((btn) => btn.addEventListener("click", () => openSalesOrderFromLead(btn.dataset.createOrder)));
  document.querySelectorAll("[data-submit-order]").forEach((btn) => btn.addEventListener("click", () => submitSalesOrderForApproval(btn.dataset.submitOrder)));
  document.querySelectorAll("[data-approve-order]").forEach((btn) => btn.addEventListener("click", () => approveSalesOrder(btn.dataset.approveOrder)));
  document.querySelectorAll("[data-check-order]").forEach((btn) => btn.addEventListener("click", () => confirmAction("确认检查库存", "系统将根据当前可用库存决定是否可以出库或需要采购审批。", () => checkSalesOrderInventory(btn.dataset.checkOrder))));
  document.querySelectorAll("[data-create-delivery]").forEach((btn) => btn.addEventListener("click", () => confirmAction("确认生成出库单", "确认后将从该销售订单带入客户、产品和数量，生成待出库单。", () => createDeliveryFromSalesOrder(btn.dataset.createDelivery))));
  document.querySelectorAll("[data-confirm-outbound]").forEach((btn) => btn.addEventListener("click", () => confirmAction("确认出库", "确认后将正式扣减库存，操作会写入库存流水。", () => confirmDeliveryOutbound(btn.dataset.confirmOutbound))));
  document.querySelectorAll("[data-create-training]").forEach((btn) => btn.addEventListener("click", () => openTrainingFromDelivery(btn.dataset.createTraining)));
  document.querySelectorAll("[data-approve-purchase]").forEach((btn) => btn.addEventListener("click", () => openPurchaseApproval(btn.dataset.approvePurchase)));
  document.querySelectorAll("[data-confirm-tech-purchase]").forEach((btn) => btn.addEventListener("click", () => confirmAction("确认技术通过", "确认产品规格、技术条件已核对无误吗？确认后采购单进入待采购审批。", () => confirmPurchaseTechnical(btn.dataset.confirmTechPurchase))));
  document.querySelectorAll("[data-mark-purchase-transit]").forEach((btn) => btn.addEventListener("click", () => confirmAction("确认标记在途", "确认供应商已发货、采购单正在运输途中吗？", () => markPurchaseInTransit(btn.dataset.markPurchaseTransit))));
  document.querySelectorAll("[data-dispatch-delivery]").forEach((btn) => btn.addEventListener("click", () => confirmAction("确认配送中", "确认货物已交付物流或正在配送吗？", () => advanceDelivery(btn.dataset.dispatchDelivery, "已出库", "配送中", "delivery_dispatch", "已标记配送中"))));
  document.querySelectorAll("[data-sign-delivery]").forEach((btn) => btn.addEventListener("click", () => confirmAction("确认签收", "确认客户已签收本次交付吗？", () => advanceDelivery(btn.dataset.signDelivery, "配送中", "已签收", "delivery_sign", "已确认签收"))));
  document.querySelectorAll("[data-accept-delivery]").forEach((btn) => btn.addEventListener("click", () => confirmAction("确认验收", "确认本次交付已验收完成吗？", () => advanceDelivery(btn.dataset.acceptDelivery, "已签收", "已验收", "delivery_accept", "已确认验收"))));
  document.querySelector("[data-export]")?.addEventListener("click", () => exportCsv(state.route));
  const search = document.querySelector("[data-search]");
  if (search) {
    search.addEventListener("input", (event) => {
      const caret = event.target.selectionStart ?? event.target.value.length;
      state.search = event.target.value;
      render();
      // 搜索会刷新结果列表；刷新后把焦点与光标交回搜索框，支持连续输入和删除。
      const nextSearch = document.querySelector("[data-search]");
      nextSearch?.focus();
      nextSearch?.setSelectionRange(caret, caret);
    });
  }
  const filter = document.querySelector("[data-status-filter]");
  if (filter) {
    filter.addEventListener("change", (event) => {
      state.statusFilter = event.target.value;
      render();
    });
  }
}

function renderRoute() {
  if (state.route === "dashboard") return renderDashboard();
  if (state.route === "users") return renderUsers();
  return renderModule(state.route);
}

function renderDashboard() {
  const stats = dashboardStats();
  const riskAlerts = stats.alerts.filter((a) => a.level === "risk");
  return `
    <section class="metric-grid">
      ${metric("跟进中线索", stats.leadsActive, "点击查看线索明细", "leads")}
      ${metric("待处理采购", stats.purchasePending, "在途/待确认/异常", "purchases")}
      ${metric("库存预警", stats.inventoryRisk, "低库存、缺货、超领", "inventory")}
      ${metric("交付未闭环", stats.deliveryOpen, "待出库、配送中、异常", "deliveries")}
      ${metric("售后未关闭", stats.afterOpen, "待受理、处理中、超时", "aftersales")}
    </section>
    <section class="split-grid">
      <div class="panel">
        <div class="panel-header">
          <h2 class="panel-title">风险预警中心</h2>
          <span class="badge ${riskAlerts.length ? "risk" : "ok"}">${riskAlerts.length ? `${riskAlerts.length} 项严重` : "暂无严重风险"}</span>
        </div>
        <div class="list">
          ${stats.alerts.length ? stats.alerts.map(renderAlert).join("") : `<div class="empty">暂无预警。系统会根据库存阈值、采购交期、售后承诺反馈和交付异常自动计算。</div>`}
        </div>
      </div>
      <div class="panel">
        <div class="panel-header">
          <h2 class="panel-title">今日待办和业务流转</h2>
        </div>
        <div class="list">
          ${renderTodo("采购到货确认", db.purchases.filter((p) => p.status === "在途").length, "purchases")}
          ${renderTodo("库存盘点/补货", stats.inventoryRisk, "inventory")}
          ${renderTodo("交付培训安排", db.deliveries.filter((d) => d.training === "需要" && !["已验收", "已签收"].includes(d.status)).length, "deliveries")}
          ${renderTodo("售后技术判断", db.aftersales.filter((a) => ["待技术判断", "处理中"].includes(a.status)).length, "aftersales")}
          ${renderTodo("业务变化同步", db.notices.filter((n) => !["已完成", "暂停"].includes(n.status)).length, "notices")}
        </div>
      </div>
    </section>
    <section class="panel">
      <div class="panel-header">
        <h2 class="panel-title">项目概况</h2>
        <span class="compact-note">看板数字均来自系统真实记录，新增或修改数据后会即时变化。</span>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>客户/项目</th><th>线索阶段</th><th>采购状态</th><th>交付状态</th><th>售后风险</th><th>负责人</th></tr></thead>
          <tbody>
            ${projectRows().map((row) => `
              <tr>
                <td>${escapeHtml(row.project)}</td>
                <td><span class="status ${statusClass(row.stage)}">${escapeHtml(row.stage)}</span></td>
                <td>${escapeHtml(row.purchase)}</td>
                <td>${escapeHtml(row.delivery)}</td>
                <td><span class="status ${statusClass(row.after)}">${escapeHtml(row.after)}</span></td>
                <td>${escapeHtml(row.owner)}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
      <div class="record-cards">
        ${projectRows().map((row) => `<article class="record-card"><h3>${escapeHtml(row.project)}</h3><div class="record-meta"><span>线索：${escapeHtml(row.stage)}</span><span>采购：${escapeHtml(row.purchase)}</span><span>交付：${escapeHtml(row.delivery)}</span><span>售后：${escapeHtml(row.after)}</span></div></article>`).join("")}
      </div>
    </section>
  `;
}

function metric(label, value, foot, route) {
  return `<button class="metric-card" data-drill="${route}" style="text-align:left">
    <div class="metric-label">${label}</div>
    <div class="metric-value">${value}</div>
    <div class="metric-foot">${foot}</div>
  </button>`;
}

function renderAlert(alert) {
  return `<div class="alert-item ${alert.level}">
    <div class="alert-title">${escapeHtml(alert.title)}</div>
    <div class="alert-meta">${escapeHtml(alert.message)}</div>
    <div style="margin-top:9px">
      <button class="ghost-btn" data-module="${alert.refModule}" data-alert-ref="${alert.refId}">查看明细</button>
    </div>
  </div>`;
}

function renderTodo(label, count, route) {
  const klass = count > 0 ? "warn" : "ok";
  return `<div class="alert-item ${count > 0 ? "" : "ok"}">
    <div class="alert-title">${label} <span class="badge ${klass}">${count}</span></div>
    <div class="alert-meta">按权限查看相关记录和下一步处理动作</div>
    <div style="margin-top:9px"><button class="ghost-btn" data-drill="${route}">进入处理</button></div>
  </div>`;
}

function projectRows() {
  const names = Array.from(new Set([...db.leads.map((x) => x.customer), ...db.purchases.map((x) => x.project).filter(Boolean), ...db.deliveries.map((x) => x.project), ...db.aftersales.map((x) => x.customer)]));
  return names.slice(0, 8).map((name) => {
    const lead = db.leads.find((x) => x.customer === name);
    const purchase = db.purchases.find((x) => x.project === name && x.status !== "已取消");
    const delivery = db.deliveries.find((x) => x.project === name && x.status !== "已取消");
    const afters = db.aftersales.filter((x) => x.customer === name);
    const afterRisk = afters.find((x) => !["已解决", "已关闭"].includes(x.status));
    return {
      project: name,
      stage: lead?.stage || "-",
      purchase: purchase ? `${purchase.product} · ${purchase.status}` : "-",
      delivery: delivery ? `${inventoryName(delivery.inventoryId)} · ${delivery.status}` : "-",
      after: afterRisk ? `${afterRisk.priority} · ${afterRisk.status}` : "正常",
      owner: userName(lead?.owner || purchase?.owner || delivery?.owner || afterRisk?.owner),
    };
  });
}

function renderModule(moduleId) {
  const module = modules.find((m) => m.id === moduleId);
  const fields = moduleFields[moduleId] || [];
  let records = listRecords(moduleId);
  const allStatuses = Array.from(new Set(records.map((r) => moduleId === "inventory" ? inventoryStatus(r) : r.status).filter(Boolean)));
  if (state.statusFilter !== "全部") {
    records = records.filter((r) => String(r.status || inventoryStatus(r)).includes(state.statusFilter));
  }
  if (state.search) {
    const needle = state.search.toLowerCase();
    records = records.filter((r) => JSON.stringify(r).toLowerCase().includes(needle) || fields.some(([key]) => String(fieldValue(moduleId, r, key)).toLowerCase().includes(needle)));
  }
  return `
    <section class="panel">
      <div class="panel-header">
        <div>
          <h2 class="panel-title">${module.name}</h2>
          <p class="compact-note">${module.desc}</p>
        </div>
        <div class="panel-tools">
          <input class="search-input" data-search placeholder="搜索客户、产品、负责人、编号" value="${escapeHtml(state.search)}" />
          <select class="filter-select" data-status-filter>
            <option ${state.statusFilter === "全部" ? "selected" : ""}>全部</option>
            ${allStatuses.map((s) => `<option ${state.statusFilter === s ? "selected" : ""}>${escapeHtml(s)}</option>`).join("")}
          </select>
          ${can(moduleId, "create") ? `<button class="primary-btn" data-create="${moduleId}">新增</button>` : ""}
          ${can(moduleId, "export") ? `<button class="ghost-btn" data-export="${moduleId}">导出</button>` : ""}
        </div>
      </div>
      ${renderTable(moduleId, records)}
      ${renderCards(moduleId, records)}
    </section>
    ${moduleId === "inventory" ? renderInventoryLogs() : ""}
  `;
}

function renderTable(moduleId, records) {
  const columns = tableColumns[moduleId] || [];
  return `<div class="table-wrap">
    <table>
      <thead>
        <tr>${columns.map((key) => `<th>${columnLabels[key] || key}</th>`).join("")}<th>操作</th></tr>
      </thead>
      <tbody>
        ${records.length ? records.map((record) => `<tr class="${isArchivedRecord(moduleId, record) ? "is-archived" : ""}">
          ${columns.map((key) => renderCell(moduleId, record, key)).join("")}
          <td>${renderActions(moduleId, record)}</td>
        </tr>`).join("") : `<tr><td colspan="${columns.length + 1}" class="empty">暂无数据</td></tr>`}
      </tbody>
    </table>
  </div>`;
}

function renderCell(moduleId, record, key) {
  const raw = fieldValue(moduleId, record, key);
  if (key.toLowerCase().includes("status") || key === "priority" || key === "stage") {
    return `<td><span class="status ${statusClass(raw)}">${escapeHtml(raw)}</span></td>`;
  }
  if (key === "available" && Number(raw) < Number(record.safeStock || 0)) {
    return `<td><span class="status warn">${escapeHtml(raw)}</span></td>`;
  }
  return `<td>${escapeHtml(formatDate(raw))}</td>`;
}

function renderCards(moduleId, records) {
  return `<div class="record-cards">
    ${records.length ? records.map((record) => {
      const title = record.customer || record.name || record.product || record.title || record.code || record.sku;
      const status = moduleId === "inventory" ? inventoryStatus(record) : record.status;
      return `<article class="record-card ${isArchivedRecord(moduleId, record) ? "is-archived" : ""}">
        <h3>${escapeHtml(title)}</h3>
        <div class="record-meta">
          <span>编号：${escapeHtml(record.code || record.sku || record.id)}</span>
          <span>负责人：${escapeHtml(userName(record.owner || record.requester || record.publisher))}</span>
          <span>状态：<span class="status ${statusClass(status)}">${escapeHtml(status || "-")}</span></span>
        </div>
        <div class="record-actions">${renderActions(moduleId, record)}</div>
      </article>`;
    }).join("") : `<div class="empty">暂无数据</div>`}
  </div>`;
}

function renderActions(moduleId, record) {
  const buttons = [];
  if (moduleId === "leads" && can("salesOrders", "create") && record.status !== "已关闭" && (record.stage === "已成交" || record.status === "已成交")) {
    buttons.push(`<button class="primary-btn" data-create-order="${record.id}">生成销售订单</button>`);
  }
  if (moduleId === "salesOrders") {
    if (record.status === "草稿" && canWorkflow("sales_submit")) {
      buttons.push(`<button class="primary-btn" data-submit-order="${record.id}">提交审批</button>`);
    }
    if (record.status === "待销售审批" && canApproveSalesOrder()) {
      buttons.push(`<button class="primary-btn" data-approve-order="${record.id}">审批通过</button>`);
    }
    if (record.status === "待库存确认" && canWorkflow("inventory_check")) {
      buttons.push(`<button class="primary-btn" data-check-order="${record.id}">检查库存</button>`);
    }
    if (record.status === "待出库" && canWorkflow("delivery_create")) {
      buttons.push(`<button class="primary-btn" data-create-delivery="${record.id}">生成出库单</button>`);
    }
  }
  if (moduleId === "inventory" && can("inventory", "edit")) {
    buttons.push(`<button class="ghost-btn" data-inbound="${record.id}">入库</button>`);
    buttons.push(`<button class="ghost-btn" data-outbound="${record.id}">出库</button>`);
  }
  if (moduleId === "purchases" && canApprovePurchase() && record.status === "待采购审批") {
    buttons.push(`<button class="primary-btn" data-approve-purchase="${record.id}">审批通过并下单</button>`);
  }
  if (moduleId === "purchases" && record.status === "待技术确认" && canWorkflow("purchase_technical_confirm")) {
    buttons.push(`<button class="primary-btn" data-confirm-tech-purchase="${record.id}">技术确认通过</button>`);
  }
  if (moduleId === "purchases" && record.status === "已下单" && canWorkflow("purchase_mark_transit")) {
    buttons.push(`<button class="primary-btn" data-mark-purchase-transit="${record.id}">标记在途</button>`);
  }
  if (moduleId === "purchases" && record.status === "在途" && canWorkflow("purchase_receive")) {
    buttons.push(`<button class="primary-btn" data-arrive="${record.id}">确认到货入库</button>`);
  }
  if (moduleId === "deliveries" && record.status === "待出库" && canWorkflow("delivery_outbound")) {
    buttons.push(`<button class="primary-btn" data-confirm-outbound="${record.id}">确认出库</button>`);
  }
  if (moduleId === "deliveries" && record.status === "已出库" && canWorkflow("delivery_dispatch")) {
    buttons.push(`<button class="primary-btn" data-dispatch-delivery="${record.id}">标记配送中</button>`);
  }
  if (moduleId === "deliveries" && record.status === "配送中" && canWorkflow("delivery_sign")) {
    buttons.push(`<button class="primary-btn" data-sign-delivery="${record.id}">确认签收</button>`);
  }
  if (moduleId === "deliveries" && record.status === "已签收" && canWorkflow("delivery_accept")) {
    buttons.push(`<button class="primary-btn" data-accept-delivery="${record.id}">确认验收</button>`);
  }
  if (moduleId === "deliveries" && can("trainings", "create") && ["已出库", "配送中", "已签收", "已验收"].includes(record.status)) {
    buttons.push(`<button class="primary-btn" data-create-training="${record.id}">生成培训验收</button>`);
  }
  // 业务处理按钮在前，查看固定在编辑之前；库存台账不需要展开查看。
  if (moduleId !== "inventory" && can(moduleId, "view")) {
    buttons.push(`<button class="ghost-btn" data-module="${moduleId}" data-view="${record.id}">查看</button>`);
  }
  if (can(moduleId, "edit") && canEditWorkflowRecord(moduleId, record)) buttons.push(`<button class="ghost-btn" data-module="${moduleId}" data-edit="${record.id}">编辑</button>`);
  if (can(moduleId, "delete") && ["leads", "salesOrders", "purchases", "deliveries"].includes(moduleId)) {
    const label = moduleId === "leads" ? "关闭线索" : "作废";
    buttons.push(`<button class="danger-btn" data-module="${moduleId}" data-delete="${record.id}">${label}</button>`);
  }
  return buttons.join("");
}

function renderInventoryLogs() {
  const logs = (db.inventoryLogs || []).slice(0, 10);
  return `<section class="panel">
    <div class="panel-header"><h2 class="panel-title">库存流水</h2><span class="compact-note">库存变化必须可追溯到来源单据和操作人</span></div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>时间</th><th>产品</th><th>动作</th><th>数量</th><th>变化前</th><th>变化后</th><th>操作人</th><th>备注</th></tr></thead>
        <tbody>${logs.map((log) => `<tr><td>${formatDate(log.createdAt)}</td><td>${inventoryName(log.itemId)}</td><td>${log.action}</td><td>${log.quantity}</td><td>${log.beforeStock}</td><td>${log.afterStock}</td><td>${userName(log.operatorId)}</td><td>${escapeHtml(log.remark || "")}</td></tr>`).join("")}</tbody>
      </table>
    </div>
  </section>`;
}

function renderUsers() {
  const permissions = Object.entries(roles).map(([key, role]) => `<div class="permission-card"><strong>${role.name}</strong><ul><li>数据范围：${role.scope}</li><li>模块：${role.modules.map((m) => modules.find((x) => x.id === m)?.name).join("、")}</li><li>操作：${role.actions.join("、")}</li></ul></div>`).join("");
  return `${renderModule("users")}
    <section class="panel">
      <div class="panel-header">
        <h2 class="panel-title">角色权限矩阵</h2>
        <span class="compact-note">MVP 使用模块 + 操作 + 数据范围三层权限，正式版可接后端 RBAC。</span>
      </div>
      <div class="list permission-grid">${permissions}</div>
    </section>`;
}

function getDefaultRecord(moduleId) {
  const fields = moduleFields[moduleId] || [];
  const record = { id: uid(moduleId.slice(0, 3)), createdBy: state.currentUser.id, createdAt: nowIso(), updatedAt: nowIso() };
  fields.forEach(([key, , type, required, options]) => {
    if (key === "owner" || key === "requester" || key === "publisher" || key === "trainer") record[key] = state.currentUser.id;
    else if (key === "status" && options) record[key] = options[0];
    else if (type === "date") record[key] = today;
    else if (type === "number") record[key] = required ? 0 : "";
    else if (type === "multirole") record[key] = [];
    else record[key] = "";
  });
  if (moduleId === "leads") record.code = `L${Date.now().toString().slice(-8)}`;
  if (moduleId === "salesOrders") record.code = `SO${Date.now().toString().slice(-8)}`;
  if (moduleId === "purchases") record.code = `P${Date.now().toString().slice(-8)}`;
  if (moduleId === "deliveries") record.code = `D${Date.now().toString().slice(-8)}`;
  if (moduleId === "trainings") record.code = `T${Date.now().toString().slice(-8)}`;
  if (moduleId === "aftersales") record.code = `A${Date.now().toString().slice(-8)}`;
  return record;
}

function openForm(moduleId, id = null) {
  if (id && !can(moduleId, "edit")) return;
  if (!id && !can(moduleId, "create")) return;
  const collection = collectionFor(moduleId);
  const record = id ? { ...(db[collection].find((r) => r.id === id) || {}) } : getDefaultRecord(moduleId);
  if (id && !canEditWorkflowRecord(moduleId, record)) {
    toast("该单据已进入流程，不能直接编辑关键资料；请使用对应的流程动作或变更流程处理");
    return;
  }
  state.editing = { moduleId, id, record };
  document.body.insertAdjacentHTML("beforeend", renderModal(moduleId, record, Boolean(id)));
  bindModal();
}

function renderModal(moduleId, record, isEdit) {
  const module = modules.find((m) => m.id === moduleId);
  const approvalFields = ["code", "product", "model", "quantity", "supplierId", "estimatedDate", "lockedDate", "payment", "remark"];
  const fields = state.editing?.purchaseApprovalId
    ? (moduleFields[moduleId] || []).filter(([key]) => approvalFields.includes(key))
    : (moduleFields[moduleId] || []);
  const title = state.editing?.title || `${isEdit ? "编辑" : "新增"}${module.name}`;
  return `<div class="modal-backdrop">
    <form class="modal" id="recordForm">
      <div class="modal-header">
        <div><h2 class="panel-title">${title}</h2><p class="compact-note">${state.editing?.purchaseApprovalId ? "请核对采购数量、供应商和预计到货日期；确认后会自动增加库存台账的在途数量。" : "关键字段会进入看板、预警和权限数据范围。"}</p></div>
        <button class="icon-btn" type="button" data-close-modal>×</button>
      </div>
      <div class="modal-body">
        <div class="form-grid">
          ${fields.map((field) => renderField(moduleId, field, record)).join("")}
        </div>
      </div>
      <div class="modal-footer">
        <button class="ghost-btn" type="button" data-close-modal>取消</button>
        <button class="primary-btn" type="submit">${state.editing?.purchaseApprovalId ? "确认下单" : "保存"}</button>
      </div>
    </form>
  </div>`;
}

function allowedWorkflowStatusOptions(moduleId, currentStatus, options) {
  if (moduleId === "salesOrders") {
    const flow = ["草稿", "待销售审批", "待库存确认", "待采购审批", "待采购到货", "待出库", "已出库", "已完成"];
    const index = flow.indexOf(currentStatus);
    return index >= 0 ? [...flow.slice(0, index + 1), "已取消"] : options;
  }
  if (moduleId === "purchases") {
    const flow = ["待采购审批", "已下单", "在途", "已到货"];
    const index = flow.indexOf(currentStatus);
    if (index >= 0) return [...flow.slice(0, index + 1), "已取消"];
    if (currentStatus === "待技术确认") return ["待技术确认", "已取消"];
    if (currentStatus === "异常") return ["异常", "已取消"];
  }
  if (moduleId === "deliveries") {
    const flow = ["待出库", "已出库", "配送中", "已签收", "已验收"];
    const index = flow.indexOf(currentStatus);
    if (index >= 0) return [...flow.slice(0, index + 1), "异常", "已取消"];
  }
  return options;
}

function renderField(moduleId, [key, label, type, required, options], record) {
  const value = record[key] ?? "";
  const requiredAttr = required ? "required" : "";
  const common = `name="${key}" ${requiredAttr}`;
  const span = type === "textarea" ? "span-2" : "";
  let input = "";
  if (type === "select" && key === "status" && ["salesOrders", "purchases", "deliveries"].includes(moduleId)) {
    input = `<input type="hidden" name="${key}" value="${escapeHtml(value)}" /><div class="field-readonly"><span class="status ${statusClass(value)}">${escapeHtml(value || "-")}</span><small>状态由流程按钮自动推进</small></div>`;
  } else if (type === "select") {
    const allowedOptions = key === "status" ? allowedWorkflowStatusOptions(moduleId, value, options) : options;
    input = `<select ${common}>${allowedOptions.map((op) => `<option ${String(value) === op ? "selected" : ""}>${escapeHtml(op)}</option>`).join("")}</select>`;
  } else if (type === "product") {
    input = `<select ${common}>${productOptions(value).map((op) => `<option value="${escapeHtml(op)}" ${String(value) === op ? "selected" : ""}>${escapeHtml(op)}</option>`).join("")}</select>`;
  } else if (type === "lead") {
    input = `<select ${common}><option value="">无</option>${db.leads.map((lead) => `<option value="${lead.id}" ${value === lead.id ? "selected" : ""}>${escapeHtml(lead.code)} - ${escapeHtml(lead.customer)}</option>`).join("")}</select>`;
  } else if (type === "salesorder") {
    input = `<select ${common}><option value="">无</option>${db.salesOrders.map((order) => `<option value="${order.id}" ${value === order.id ? "selected" : ""}>${escapeHtml(order.code)} - ${escapeHtml(order.customer)}</option>`).join("")}</select>`;
  } else if (type === "delivery") {
    input = `<select ${common}>${db.deliveries.map((delivery) => `<option value="${delivery.id}" ${value === delivery.id ? "selected" : ""}>${escapeHtml(delivery.code)} - ${escapeHtml(delivery.project)}</option>`).join("")}</select>`;
  } else if (type === "user") {
    input = `<select ${common}>${db.users.filter((u) => u.status === "启用").map((u) => `<option value="${u.id}" ${value === u.id ? "selected" : ""}>${escapeHtml(u.name)} - ${roleName(u.role)}</option>`).join("")}</select>`;
  } else if (type === "supplier") {
    input = `<select ${common}><option value="">未指定</option>${db.suppliers.map((s) => `<option value="${s.id}" ${value === s.id ? "selected" : ""}>${escapeHtml(s.name)} - ${escapeHtml(s.product)}</option>`).join("")}</select>`;
  } else if (type === "inventory") {
    input = `<select ${common}>${db.inventory.map((i) => `<option value="${i.id}" ${value === i.id ? "selected" : ""}>${escapeHtml(i.name)}（可用 ${availableStock(i)}）</option>`).join("")}</select>`;
  } else if (type === "role") {
    input = `<select ${common}>${Object.entries(roles).map(([id, role]) => `<option value="${id}" ${value === id ? "selected" : ""}>${role.name}</option>`).join("")}</select>`;
  } else if (type === "multirole") {
    input = `<select ${common} multiple size="5">${Object.entries(roles).map(([id, role]) => `<option value="${id}" ${(value || []).includes(id) ? "selected" : ""}>${role.name}</option>`).join("")}</select>`;
  } else if (type === "textarea") {
    input = `<textarea ${common}>${escapeHtml(value)}</textarea>`;
  } else {
    input = `<input ${common} type="${type}" value="${escapeHtml(value)}" />`;
  }
  return `<div class="field ${span}"><label>${label}${required ? " *" : ""}</label>${input}</div>`;
}

function bindModal() {
  document.querySelectorAll("[data-close-modal]").forEach((btn) => btn.addEventListener("click", closeModal));
  bindSalesOrderAmountCalculation();
  document.getElementById("recordForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const { moduleId, id, record, sourceLeadId, sourceDeliveryId, purchaseApprovalId } = state.editing;
    const formData = new FormData(event.currentTarget);
    const next = { ...record };
    const approvalFields = ["code", "product", "model", "quantity", "supplierId", "estimatedDate", "lockedDate", "payment", "remark"];
    const editableFields = purchaseApprovalId
      ? moduleFields[moduleId].filter(([key]) => approvalFields.includes(key))
      : moduleFields[moduleId];
    editableFields.forEach(([key, , type]) => {
      if (type === "multirole") {
        next[key] = formData.getAll(key);
      } else if (type === "number") {
        const value = formData.get(key);
        next[key] = value === "" ? "" : Number(value);
      } else {
        next[key] = formData.get(key);
      }
    });
    if (["salesOrders", "purchases", "trainings"].includes(moduleId)) {
      next.productId = findProductByLabel(db.products, next.product, next.model)?.id || "";
    }
    if (moduleId === "salesOrders") next.totalAmountManual = Boolean(record.totalAmountManual);
    next.updatedAt = nowIso();
    const result = purchaseApprovalId ? confirmPurchaseOrder(next, record) : saveRecord(moduleId, id, next);
    if (!result.ok) {
      toast(result.message);
      return;
    }
    const linkedLeadId = sourceLeadId || (moduleId === "salesOrders" ? next.leadId : "");
    if (linkedLeadId && moduleId === "salesOrders") {
      const lead = db.leads.find((item) => item.id === linkedLeadId);
      if (lead) {
        const isCancelled = next.status === "已取消";
        lead.status = "已关闭";
        lead.stage = isCancelled ? "暂停/丢单" : "已成交";
        lead.closedAt = nowIso();
        lead.salesOrderIds = Array.from(new Set([...(lead.salesOrderIds || []), next.id]));
        lead.updatedAt = nowIso();
        logAction(isCancelled ? "cancel" : "close", "leads", lead.id, isCancelled ? `销售订单 ${next.code} 已取消，线索同步为暂停/丢单` : `销售订单 ${next.code} 已保存，线索同步为已成交`);
        saveData();
      }
    }
    if (sourceDeliveryId && moduleId === "trainings") {
      const delivery = db.deliveries.find((item) => item.id === sourceDeliveryId);
      if (delivery) {
        delivery.trainingId = next.id;
        delivery.training = "需要";
        delivery.updatedAt = nowIso();
        logAction("link", "deliveries", delivery.id, `已创建培训验收单 ${next.code}`);
        saveData();
      }
    }
    closeModal();
    toast(purchaseApprovalId ? `采购单 ${next.code} 已下单，已同步增加库存在途` : (moduleId === "salesOrders" && next.status === "已取消" && linkedLeadId ? `销售订单 ${next.code} 已取消，原线索已同步为暂停/丢单` : (sourceLeadId ? `销售订单 ${next.code} 创建成功，原线索已关闭` : (sourceDeliveryId ? `培训验收单 ${next.code} 创建成功` : (id ? "记录已更新" : "记录已新增")))));
    render();
  });
}

function bindSalesOrderAmountCalculation() {
  if (state.editing?.moduleId !== "salesOrders") return;
  const form = document.getElementById("recordForm");
  const quantity = form?.elements.namedItem("quantity");
  const unitPrice = form?.elements.namedItem("unitPrice");
  const totalAmount = form?.elements.namedItem("totalAmount");
  if (!quantity || !unitPrice || !totalAmount) return;
  const calculate = () => Number(quantity.value || 0) * Number(unitPrice.value || 0);
  const updateAutomaticAmount = () => {
    if (!state.editing.record.totalAmountManual) totalAmount.value = String(calculate());
  };
  updateAutomaticAmount();
  quantity.addEventListener("input", updateAutomaticAmount);
  unitPrice.addEventListener("input", updateAutomaticAmount);
  totalAmount.addEventListener("input", () => {
    state.editing.record.totalAmountManual = true;
  });
}

function closeModal() {
  document.querySelector(".modal-backdrop")?.remove();
  state.editing = null;
}

function openDetail(moduleId, id) {
  if (!can(moduleId, "view")) return;
  const record = (db[collectionFor(moduleId)] || []).find((item) => item.id === id);
  const module = modules.find((item) => item.id === moduleId);
  if (!record || !module) return;
  const rows = (moduleFields[moduleId] || []).map(([key, label]) => `
    <div class="field"><label>${escapeHtml(label)}</label><div class="detail-value">${escapeHtml(formatDate(fieldValue(moduleId, record, key)))}</div></div>
  `).join("");
  document.body.insertAdjacentHTML("beforeend", `<div class="modal-backdrop">
    <section class="modal">
      <div class="modal-header"><div><h2 class="panel-title">查看${escapeHtml(module.name)}</h2><p class="compact-note">只读查看，不会修改任何数据。</p></div><button class="icon-btn" type="button" data-close-modal>×</button></div>
      <div class="modal-body"><div class="form-grid">${rows}</div></div>
      <div class="modal-footer"><button class="primary-btn" type="button" data-close-modal>关闭</button></div>
    </section>
  </div>`);
  document.querySelectorAll("[data-close-modal]").forEach((button) => button.addEventListener("click", closeModal));
}

function confirmAction(title, message, onConfirm) {
  state.confirmAction = onConfirm;
  document.body.insertAdjacentHTML("beforeend", `<div class="modal-backdrop" data-confirm-modal>
    <section class="modal confirm-modal">
      <div class="modal-header"><div><h2 class="panel-title">${escapeHtml(title)}</h2><p class="compact-note">${escapeHtml(message)}</p></div></div>
      <div class="modal-footer"><button class="ghost-btn" type="button" data-cancel-confirm>取消</button><button class="primary-btn" type="button" data-confirm-action>确认</button></div>
    </section>
  </div>`);
  document.querySelector("[data-cancel-confirm]")?.addEventListener("click", closeConfirmAction);
  document.querySelector("[data-confirm-action]")?.addEventListener("click", () => {
    const action = state.confirmAction;
    closeConfirmAction();
    action?.();
  });
}

function closeConfirmAction() {
  document.querySelector("[data-confirm-modal]")?.remove();
  state.confirmAction = null;
}

const salesOrderStages = ["草稿", "待销售审批", "待库存确认", "待采购审批", "待采购到货", "待出库", "已出库", "已完成"];
const reversiblePurchaseStatuses = ["待采购审批", "待技术确认", "待采购确认", "异常"];
const placedPurchaseStatuses = ["已下单", "在途", "已到货"];
const completedDeliveryStatuses = ["已出库", "配送中", "已签收", "已验收"];

function linkedToSalesOrder(collection, salesOrderId) {
  return (db[collection] || []).filter((record) => record.sourceSalesOrderId === salesOrderId || record.salesOrderId === salesOrderId);
}

function isSalesOrderRollback(oldStatus, nextStatus) {
  if (nextStatus === "已取消") return oldStatus !== "已取消";
  const oldIndex = salesOrderStages.indexOf(oldStatus);
  const nextIndex = salesOrderStages.indexOf(nextStatus);
  return oldIndex >= 0 && nextIndex >= 0 && nextIndex < oldIndex;
}

function validateSalesOrderRollback(order, oldOrder) {
  if (!isSalesOrderRollback(oldOrder.status, order.status)) return { ok: true };
  const received = linkedToSalesOrder("purchases", order.id).find((purchase) => purchase.status === "已到货" || purchase.receivedApplied);
  if (received) return { ok: false, message: `不能退回：关联采购单 ${received.code} 已到货并已影响库存，请走退货/退库流程。` };
  const placed = linkedToSalesOrder("purchases", order.id).find((purchase) => placedPurchaseStatuses.includes(purchase.status));
  if (placed) return { ok: false, message: `不能退回：关联采购单 ${placed.code} 已下单或在途，请先由采购人员处理取消。` };
  const delivered = linkedToSalesOrder("deliveries", order.id).find((delivery) => completedDeliveryStatuses.includes(delivery.status));
  if (delivered) return { ok: false, message: `不能退回：关联出库单 ${delivered.code} 已出库，请走退库/红冲流程。` };
  const training = linkedToSalesOrder("trainings", order.id)[0];
  if (training) return { ok: false, message: `不能退回：已生成培训验收单 ${training.code}，请先按售后或退库流程处理。` };
  return { ok: true };
}

function cancelRecord(record, reason) {
  record.status = "已取消";
  record.cancelledAt = nowIso();
  record.cancelledBy = state.currentUser?.id || "";
  record.cancelledReason = reason;
  record.updatedAt = nowIso();
}

function reconcileSalesOrderWorkflow(order, oldOrder) {
  if (!oldOrder || !isSalesOrderRollback(oldOrder.status, order.status)) return;
  const reason = `销售订单 ${order.code} 从“${oldOrder.status}”退回到“${order.status}”自动作废`;
  linkedToSalesOrder("purchases", order.id)
    .filter((purchase) => reversiblePurchaseStatuses.includes(purchase.status))
    .forEach((purchase) => {
      cancelRecord(purchase, reason);
      logAction("cancel", "purchases", purchase.id, reason);
    });
  linkedToSalesOrder("deliveries", order.id)
    .filter((delivery) => delivery.status === "待出库")
    .forEach((delivery) => {
      cancelRecord(delivery, reason);
      logAction("cancel", "deliveries", delivery.id, reason);
    });
  order.deliveryId = "";
  if (order.status !== "待出库") order.inventoryId = "";
  logAction("rollback", "salesOrders", order.id, reason);
}

function reconcilePurchaseWorkflow(purchase, oldPurchase) {
  if (!oldPurchase || purchase.status !== "已取消" || oldPurchase.status === "已取消" || !purchase.sourceSalesOrderId) return;
  const order = db.salesOrders.find((item) => item.id === purchase.sourceSalesOrderId);
  if (!order) return;
  const stillActive = linkedToSalesOrder("purchases", order.id).some((item) => item.id !== purchase.id && item.status !== "已取消");
  if (!stillActive && ["待采购审批", "待采购到货"].includes(order.status)) {
    order.status = "待库存确认";
    order.updatedAt = nowIso();
    logAction("rollback", "salesOrders", order.id, `采购单 ${purchase.code} 已取消，订单退回库存确认`);
  }
}

function reconcileDeliveryWorkflow(delivery, oldDelivery) {
  if (!oldDelivery || delivery.status !== "已取消" || oldDelivery.status === "已取消" || !delivery.sourceSalesOrderId) return;
  const order = db.salesOrders.find((item) => item.id === delivery.sourceSalesOrderId);
  if (order && order.status === "待出库") {
    order.deliveryId = "";
    order.updatedAt = nowIso();
    logAction("rollback", "salesOrders", order.id, `出库单 ${delivery.code} 已取消，可重新生成出库单`);
  }
}

function saveRecord(moduleId, id, record) {
  if (moduleId === "deliveries") {
    const item = db.inventory.find((i) => i.id === record.inventoryId);
    const old = id ? db.deliveries.find((d) => d.id === id) : null;
    const inventoryApplied = (delivery) => delivery && !["待出库", "已取消"].includes(delivery.status);
    const newlyOutbound = !old && inventoryApplied(record);
    const changedToOutbound = old && !inventoryApplied(old) && inventoryApplied(record);
    if (newlyOutbound && item && availableStock(item) < Number(record.quantity || 0)) {
      return { ok: false, message: `库存不足：${item.name} 当前可用 ${availableStock(item)}，无法出库 ${record.quantity}` };
    }
    if (changedToOutbound && item && availableStock(item) < Number(record.quantity || 0)) {
      return { ok: false, message: `库存不足：${item.name} 当前可用 ${availableStock(item)}，无法出库 ${record.quantity}` };
    }
  }
  const collection = collectionFor(moduleId);
  const oldRecord = id ? { ...(db[collection].find((r) => r.id === id) || {}) } : null;
  if (moduleId === "salesOrders" && oldRecord) {
    const validation = validateSalesOrderRollback(record, oldRecord);
    if (!validation.ok) return validation;
  }
  if (moduleId === "inventory" && !id) {
    const product = findProductByLabel(db.products, record.name, record.model);
    const existing = inventoryForProduct(record.name, product?.id || "", record.model);
    if (existing) {
      const amount = Number(record.stock || 0);
      if (amount > 0) applyInventoryChange(existing.id, "入库", amount, "新增库存时自动合并", record.id);
      existing.safeStock = Number(record.safeStock || existing.safeStock || 0);
      existing.location = record.location || existing.location;
      existing.remark = record.remark || existing.remark;
      existing.updatedAt = nowIso();
      logAction("merge", "inventory", existing.id, "同产品库存已自动合并");
      saveData();
      return { ok: true, message: "已合并到原库存" };
    }
    record.productId = product?.id || "";
  }
  if (id) {
    const index = db[collection].findIndex((r) => r.id === id);
    db[collection][index] = record;
    logAction("update", moduleId, id, "编辑记录");
    const inventoryApplied = (delivery) => delivery && !["待出库", "已取消"].includes(delivery.status);
    if (moduleId === "deliveries" && inventoryApplied(oldRecord) && !inventoryApplied(record)) {
      applyInventoryChange(oldRecord.inventoryId, "入库", Number(oldRecord.quantity || 0), `出库单 ${oldRecord.code} 回撤至待出库，库存自动回补`, oldRecord.id, "delivery");
      logAction("rollback", "deliveries", oldRecord.id, "出库状态回撤，库存已自动回补");
    }
    if (moduleId === "deliveries" && !inventoryApplied(oldRecord) && inventoryApplied(record)) {
      applyInventoryChange(record.inventoryId, "出库", Number(record.quantity || 0), `交付单 ${record.code}`, record.id);
    }
  } else {
    db[collection].unshift(record);
    logAction("create", moduleId, record.id, "新增记录");
    if (moduleId === "deliveries" && record.status !== "待出库") {
      applyInventoryChange(record.inventoryId, "出库", Number(record.quantity || 0), `交付单 ${record.code}`, record.id);
    }
  }
  if (moduleId === "purchases" && record.status === "已到货") {
    receivePurchase(record);
  }
  if (moduleId === "salesOrders" && oldRecord) reconcileSalesOrderWorkflow(record, oldRecord);
  if (moduleId === "purchases" && oldRecord) reconcilePurchaseWorkflow(record, oldRecord);
  if (moduleId === "deliveries" && oldRecord) reconcileDeliveryWorkflow(record, oldRecord);
  saveData();
  return { ok: true };
}

function removeRecord(moduleId, id) {
  const collection = collectionFor(moduleId);
  const record = (db[collection] || []).find((item) => item.id === id);
  if (!record) return;
  const actionName = moduleId === "leads" ? "关闭线索" : "作废";
  if (!confirm(`确认${actionName}这条记录？操作会保留业务追溯，不能恢复为彻底删除。`)) return;
  if (moduleId === "leads") {
    const linkedOrder = db.salesOrders.find((order) => order.leadId === record.id);
    if (linkedOrder) {
      toast(`不能关闭：线索已生成销售订单 ${linkedOrder.code}，请先在销售订单中按流程作废或继续处理`);
      return;
    }
    record.status = "已关闭";
    record.stage = "暂停/丢单";
    record.closedAt = nowIso();
    record.updatedAt = nowIso();
    logAction("cancel", "leads", id, "线索关闭，未关联销售订单");
    saveData();
    toast("线索已关闭，已移至筛选中的完成/关闭记录");
    render();
    return;
  }
  if (moduleId === "salesOrders") {
    const cancelled = { ...record, status: "已取消", updatedAt: nowIso() };
    const validation = validateSalesOrderRollback(cancelled, record);
    if (!validation.ok) {
      toast(validation.message);
      return;
    }
    const index = db.salesOrders.findIndex((item) => item.id === id);
    db.salesOrders[index] = cancelled;
    reconcileSalesOrderWorkflow(cancelled, record);
    logAction("cancel", "salesOrders", id, "删除操作改为作废，保留业务追溯");
    saveData();
    toast("销售订单已作废，未完成的关联单据已同步取消");
    render();
    return;
  }
  if (moduleId === "purchases") {
    if (!reversiblePurchaseStatuses.includes(record.status)) {
      toast("该采购单已下单、在途或到货，不能直接作废，请按采购取消或退货流程处理");
      return;
    }
    const oldRecord = { ...record };
    cancelRecord(record, "采购申请作废，保留业务追溯");
    reconcilePurchaseWorkflow(record, oldRecord);
    logAction("cancel", "purchases", id, "删除操作改为作废");
    saveData();
    toast("采购申请已作废，并同步更新关联销售订单");
    render();
    return;
  }
  if (moduleId === "deliveries") {
    if (record.status !== "待出库") {
      toast("该出库单已经影响交付或库存，不能直接作废，请走退库流程");
      return;
    }
    const oldRecord = { ...record };
    cancelRecord(record, "删除操作改为作废，保留业务追溯");
    reconcileDeliveryWorkflow(record, oldRecord);
    logAction("cancel", "deliveries", id, "删除操作改为作废");
    saveData();
    toast("出库单已作废，关联销售订单可重新生成出库单");
    render();
    return;
  }
  toast("该模块不提供彻底删除，避免破坏已有业务关联");
}

function applyInventoryChange(itemId, action, quantity, remark, sourceId = "", sourceType = "") {
  const item = db.inventory.find((i) => i.id === itemId);
  if (!item || !quantity) return;
  const before = Number(item.stock || 0);
  const after = action === "入库" ? before + quantity : before - quantity;
  item.stock = after;
  item.updatedAt = nowIso();
  db.inventoryLogs.unshift({
    id: uid("log"),
    itemId,
    action,
    quantity,
    beforeStock: before,
    afterStock: after,
    sourceType: sourceType || (action === "入库" ? "purchase" : "delivery"),
    sourceId,
    operatorId: state.currentUser.id,
    createdAt: nowIso(),
    remark,
  });
  logAction(action, "inventory", itemId, remark);
}

function receivePurchase(purchase) {
  const item = ensureInventoryForProduct(purchase.product, purchase.productId, purchase.model);
  if (purchase.inTransitApplied && !purchase.inTransitCleared) {
    item.inTransit = Math.max(0, Number(item.inTransit || 0) - Number(purchase.inTransitQuantity || purchase.quantity || 0));
    if (Number(item.inTransit || 0) === 0) item.eta = "";
    item.updatedAt = nowIso();
    purchase.inTransitCleared = true;
    logAction("in_transit_clear", "inventory", item.id, `采购单 ${purchase.code} 到货，库存在途减少 ${purchase.inTransitQuantity || purchase.quantity || 0}`);
  }
  if (!purchase.receivedApplied) {
    applyInventoryChange(item.id, "入库", Number(purchase.quantity || 0), `采购到货 ${purchase.code}`, purchase.id);
    purchase.receivedApplied = true;
  }
  if (purchase.sourceSalesOrderId) {
    const order = db.salesOrders.find((candidate) => candidate.id === purchase.sourceSalesOrderId);
    if (order && order.status !== "已取消") {
      order.status = "待出库";
      order.updatedAt = nowIso();
      logAction("purchase_received", "salesOrders", order.id, `关联采购单 ${purchase.code} 已到货入库，订单进入待出库`);
    }
  }
}

function ensureInventoryForProduct(productName, productId = "", model = "") {
  const existing = inventoryForProduct(productName, productId, model);
  if (existing) return existing;
  const product = productById(productId) || findProductByLabel(db.products, productName, model) || {};
  const item = {
    id: uid("inv"),
    productId: product.id || productId || "",
    sku: product.code ? `SKU-${product.code}` : `SKU-${Date.now().toString().slice(-8)}`,
    name: product.name || productName,
    model: product.model || model || "",
    category: product.category || "其他",
    safeStock: Number(product.safeStock || 0),
    stock: 0,
    locked: 0,
    inTransit: 0,
    eta: "",
    location: "待分配",
    checkedAt: today,
    owner: state.currentUser?.id || "",
    remark: "由采购到货自动创建",
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  db.inventory.unshift(item);
  return item;
}

function canApprovePurchase() {
  return canWorkflow("purchase_approve");
}

function canApproveSalesOrder() {
  return canWorkflow("sales_approve");
}

function openSalesOrderFromLead(leadId) {
  const lead = db.leads.find((item) => item.id === leadId);
  if (!lead) return;
  const order = getDefaultRecord("salesOrders");
  const product = findProductByLabel(db.products, lead.product);
  Object.assign(order, {
    leadId: lead.id,
    customer: lead.customer,
    contact: lead.contact,
    phone: lead.phone,
    product: lead.product,
    productId: product?.id || "",
    model: product?.model || "",
    quantity: Number(lead.quantity || 0),
    unitPrice: 0,
    totalAmount: 0,
    owner: lead.owner || state.currentUser.id,
    deliveryDate: today,
    status: "草稿",
    remark: `由线索 ${lead.code} 一键生成`,
  });
  state.editing = {
    moduleId: "salesOrders",
    id: null,
    record: order,
    sourceLeadId: lead.id,
    title: "确认创建销售订单",
  };
  document.body.insertAdjacentHTML("beforeend", renderModal("salesOrders", order, false));
  bindModal();
}

function submitSalesOrderForApproval(orderId) {
  const order = db.salesOrders.find((item) => item.id === orderId);
  if (!order || order.status !== "草稿" || !canWorkflow("sales_submit")) return;
  order.status = "待销售审批";
  order.submittedBy = state.currentUser.id;
  order.submittedAt = nowIso();
  order.updatedAt = nowIso();
  logAction("submit", "salesOrders", order.id, "销售订单已提交审批");
  saveData();
  toast("订单已提交审批，审批通过后才会检查库存");
  render();
}

function approveSalesOrder(orderId) {
  const order = db.salesOrders.find((item) => item.id === orderId);
  if (!order || order.status !== "待销售审批" || !canApproveSalesOrder()) return;
  order.status = "待库存确认";
  order.approvedBy = state.currentUser.id;
  order.approvedAt = nowIso();
  order.updatedAt = nowIso();
  logAction("approve", "salesOrders", order.id, "销售订单审批通过，等待库存检查");
  saveData();
  toast("销售订单已审批通过，请进行库存检查");
  render();
}

function checkSalesOrderInventory(orderId) {
  const order = db.salesOrders.find((item) => item.id === orderId);
  if (!order || order.status !== "待库存确认" || !canWorkflow("inventory_check")) return;
  const item = inventoryForProduct(order.product, order.productId, order.model);
  if (item && availableStock(item) >= Number(order.quantity || 0)) {
    linkedToSalesOrder("purchases", order.id)
      .filter((purchase) => reversiblePurchaseStatuses.includes(purchase.status))
      .forEach((purchase) => {
        cancelRecord(purchase, `销售订单 ${order.code} 重新检查库存后已满足，无需采购`);
        logAction("cancel", "purchases", purchase.id, "库存已满足，自动作废待处理采购申请");
      });
    order.status = "待出库";
    order.inventoryId = item.id;
    order.updatedAt = nowIso();
    logAction("inventory_check", "salesOrders", order.id, `库存充足，可生成出库单：${item.name}`);
    saveData();
    toast("库存充足，销售订单已进入待出库");
    render();
    return;
  }
  order.status = "待采购审批";
  order.updatedAt = nowIso();
  const existing = db.purchases.find((purchase) => purchase.sourceSalesOrderId === order.id && purchase.status !== "已取消");
  if (!existing) {
    const purchase = getDefaultRecord("purchases");
    const buyer = db.users.find((user) => user.role === "purchase" && user.status === "启用");
    Object.assign(purchase, {
      requester: order.owner,
      owner: buyer?.id || state.currentUser.id,
      type: "项目采购",
      product: order.product,
      productId: order.productId,
      model: order.model,
      quantity: Number(order.quantity || 0),
      project: order.customer,
      requiredDate: order.deliveryDate,
      sourceSalesOrderId: order.id,
      status: "待采购审批",
      remark: `销售订单 ${order.code} 库存不足自动生成，等待有采购权限的人员审批`,
    });
    db.purchases.unshift(purchase);
    logAction("create", "purchases", purchase.id, `销售订单 ${order.code} 缺货自动生成采购申请`);
  }
  logAction("inventory_shortage", "salesOrders", order.id, "库存不足，已生成待采购审批申请");
  saveData();
  toast("库存不足，已通知采购人员审批");
  render();
}

function openPurchaseApproval(purchaseId) {
  const purchase = db.purchases.find((item) => item.id === purchaseId);
  if (!purchase || !canApprovePurchase()) return;
  state.editing = {
    moduleId: "purchases",
    id: purchase.id,
    record: { ...purchase },
    purchaseApprovalId: purchase.id,
    title: "确认采购下单",
  };
  document.body.insertAdjacentHTML("beforeend", renderModal("purchases", purchase, true));
  bindModal();
}

function confirmPurchaseOrder(purchase, oldPurchase) {
  if (!purchase.estimatedDate) return { ok: false, message: "请填写预计到货日期后再确认下单" };
  if (!Number(purchase.quantity || 0)) return { ok: false, message: "采购数量必须大于 0" };
  purchase.status = "已下单";
  purchase.approvedBy = state.currentUser.id;
  purchase.approvedAt = nowIso();
  purchase.updatedAt = nowIso();
  purchase.inTransitApplied = true;
  purchase.inTransitQuantity = Number(purchase.quantity || 0);
  const index = db.purchases.findIndex((item) => item.id === oldPurchase.id);
  if (index < 0) return { ok: false, message: "采购单不存在或已被修改，请刷新后重试" };
  db.purchases[index] = purchase;
  const inventory = ensureInventoryForProduct(purchase.product, purchase.productId, purchase.model);
  inventory.inTransit = Number(inventory.inTransit || 0) + purchase.inTransitQuantity;
  inventory.eta = purchase.estimatedDate;
  inventory.updatedAt = nowIso();
  const order = db.salesOrders.find((item) => item.id === purchase.sourceSalesOrderId);
  if (order) {
    order.status = "待采购到货";
    order.updatedAt = nowIso();
  }
  logAction("approve", "purchases", purchase.id, `采购审批通过并下单，在途增加 ${purchase.inTransitQuantity}，预计到货 ${purchase.estimatedDate}`);
  saveData();
  return { ok: true };
}

function confirmPurchaseTechnical(purchaseId) {
  const purchase = db.purchases.find((item) => item.id === purchaseId);
  if (!purchase || purchase.status !== "待技术确认" || !canWorkflow("purchase_technical_confirm")) return;
  purchase.status = "待采购审批";
  purchase.techConfirmedBy = state.currentUser.id;
  purchase.techConfirmedAt = nowIso();
  purchase.updatedAt = nowIso();
  logAction("technical_confirm", "purchases", purchase.id, "技术确认通过，等待采购审批");
  saveData();
  toast("技术确认通过，采购单已进入待采购审批");
  render();
}

function markPurchaseInTransit(purchaseId) {
  const purchase = db.purchases.find((item) => item.id === purchaseId);
  if (!purchase || purchase.status !== "已下单" || !canWorkflow("purchase_mark_transit")) return;
  purchase.status = "在途";
  purchase.shippedBy = state.currentUser.id;
  purchase.shippedAt = nowIso();
  purchase.updatedAt = nowIso();
  logAction("purchase_transit", "purchases", purchase.id, `已标记在途，预计到货 ${purchase.estimatedDate || purchase.lockedDate || "待确认"}`);
  saveData();
  toast("采购单已标记在途，等待确认到货入库");
  render();
}

function createDeliveryFromSalesOrder(orderId) {
  const order = db.salesOrders.find((item) => item.id === orderId);
  if (!order || order.status !== "待出库" || !canWorkflow("delivery_create")) return;
  const item = inventoryForProduct(order.product, order.productId, order.model);
  if (!item || availableStock(item) < Number(order.quantity || 0)) {
    toast("库存已变化，请重新检查库存");
    return;
  }
  const existing = db.deliveries.find((delivery) => delivery.sourceSalesOrderId === order.id && !["异常", "已取消"].includes(delivery.status));
  if (existing) {
    toast(`该订单已有出库单 ${existing.code}`);
    return;
  }
  const delivery = getDefaultRecord("deliveries");
  Object.assign(delivery, {
    date: today,
    project: order.customer,
    type: "销售交付",
    inventoryId: item.id,
    productId: order.productId,
    quantity: Number(order.quantity || 0),
    receiver: order.contact,
    owner: order.owner,
    sourceSalesOrderId: order.id,
    training: "待确认",
    status: "待出库",
    remark: `由销售订单 ${order.code} 自动生成`,
  });
  db.deliveries.unshift(delivery);
  order.deliveryId = delivery.id;
  order.updatedAt = nowIso();
  logAction("create", "deliveries", delivery.id, `由销售订单 ${order.code} 生成出库单`);
  saveData();
  toast(`已生成出库单 ${delivery.code}`);
  render();
}

function confirmDeliveryOutbound(deliveryId) {
  const delivery = db.deliveries.find((item) => item.id === deliveryId);
  if (!delivery || delivery.status !== "待出库" || !canWorkflow("delivery_outbound")) return;
  const item = db.inventory.find((inventory) => inventory.id === delivery.inventoryId);
  if (!item || availableStock(item) < Number(delivery.quantity || 0)) {
    toast("库存不足，无法确认出库");
    return;
  }
  applyInventoryChange(item.id, "出库", Number(delivery.quantity || 0), `出库单 ${delivery.code}`, delivery.id);
  delivery.status = "已出库";
  delivery.outboundAt = nowIso();
  delivery.updatedAt = nowIso();
  const order = db.salesOrders.find((candidate) => candidate.id === delivery.sourceSalesOrderId);
  if (order) {
    order.status = "已出库";
    order.updatedAt = nowIso();
  }
  logAction("outbound", "deliveries", delivery.id, "确认出库并扣减库存");
  saveData();
  toast("已出库，库存已自动扣减");
  render();
}

function advanceDelivery(deliveryId, expectedStatus, nextStatus, action, message) {
  const permission = ({ delivery_dispatch: "delivery_dispatch", delivery_sign: "delivery_sign", delivery_accept: "delivery_accept" })[action];
  const delivery = db.deliveries.find((item) => item.id === deliveryId);
  if (!delivery || delivery.status !== expectedStatus || !canWorkflow(permission)) return;
  delivery.status = nextStatus;
  delivery.updatedAt = nowIso();
  if (nextStatus === "已签收") delivery.signedAt = nowIso();
  if (nextStatus === "已验收") delivery.acceptedAt = nowIso();
  if (nextStatus === "已验收") {
    const order = db.salesOrders.find((item) => item.id === delivery.sourceSalesOrderId);
    if (order && order.status === "已出库") {
      order.status = "已完成";
      order.updatedAt = nowIso();
      logAction("complete", "salesOrders", order.id, `关联出库单 ${delivery.code} 已验收，订单完成`);
    }
  }
  logAction(action, "deliveries", delivery.id, message);
  saveData();
  toast(message);
  render();
}

function openTrainingFromDelivery(deliveryId) {
  const delivery = db.deliveries.find((item) => item.id === deliveryId);
  if (!delivery) return;
  const existing = db.trainings.find((training) => training.deliveryId === delivery.id);
  if (existing) {
    toast(`该出库单已有培训验收单 ${existing.code}`);
    return;
  }
  const order = db.salesOrders.find((item) => item.id === delivery.sourceSalesOrderId);
  const item = db.inventory.find((inventory) => inventory.id === delivery.inventoryId);
  const training = getDefaultRecord("trainings");
  Object.assign(training, {
    salesOrderId: order?.id || "",
    deliveryId: delivery.id,
    customer: delivery.project,
    product: item?.name || order?.product || "",
    productId: item?.productId || order?.productId || "",
    quantity: Number(delivery.quantity || 0),
    trainer: state.currentUser.id,
    status: "待培训",
    acceptanceResult: "待培训",
    remark: `由出库单 ${delivery.code} 自动生成`,
  });
  state.editing = {
    moduleId: "trainings",
    id: null,
    record: training,
    sourceDeliveryId: delivery.id,
    title: "确认创建培训验收单",
  };
  document.body.insertAdjacentHTML("beforeend", renderModal("trainings", training, false));
  bindModal();
}

function adjustStock(itemId, action) {
  const item = db.inventory.find((i) => i.id === itemId);
  const amount = Number(prompt(`${action}数量：${item?.name || ""}`, "1"));
  if (!Number.isFinite(amount) || amount <= 0) return;
  if (action === "出库" && availableStock(item) < amount) {
    toast(`库存不足：当前 ${item.stock}，已锁定 ${item.locked}，可用 ${availableStock(item)}；不能出库 ${amount}`);
    return;
  }
  applyInventoryChange(itemId, action, amount, `${action}手动调整`);
  saveData();
  toast(`${action}完成`);
  render();
}

function openManualStockAdjustment(itemId, action) {
  const item = db.inventory.find((inventory) => inventory.id === itemId);
  if (!item) return;
  const available = availableStock(item);
  if (action === "出库" && available <= 0) {
    toast(`无法手动出库：当前库存 ${item.stock}，其中 ${item.locked} 已被订单锁定，可用库存为 ${available}`);
    return;
  }
  const message = action === "出库"
    ? `当前库存 ${item.stock}，已锁定 ${item.locked}，本次最多可出 ${available}。确认后请输入出库数量。`
    : `当前库存 ${item.stock}，确认后请输入入库数量。`;
  confirmAction(`确认手动${action}`, message, () => adjustStock(itemId, action));
}

function exportCsv(moduleId) {
  const rows = listRecords(moduleId);
  const columns = tableColumns[moduleId] || [];
  const csv = [columns.map((c) => columnLabels[c] || c), ...rows.map((r) => columns.map((c) => fieldValue(moduleId, r, c)))].map((row) => row.map((v) => `"${String(v ?? "").replaceAll('"', '""')}"`).join(",")).join("\n");
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${modules.find((m) => m.id === moduleId)?.name || moduleId}_${today}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

document.addEventListener("click", (event) => {
  const arrive = event.target.closest("[data-arrive]");
  if (arrive) {
    const purchase = db.purchases.find((p) => p.id === arrive.dataset.arrive);
    if (!purchase || purchase.status !== "在途" || !canWorkflow("purchase_receive")) return;
    confirmAction("确认到货入库", `确认 ${purchase.code} 已到货并入库吗？确认后库存会自动增加并写入库存流水。`, () => {
      purchase.status = "已到货";
      purchase.updatedAt = nowIso();
      receivePurchase(purchase);
      saveData();
      toast("采购已到货并同步入库");
      render();
    });
  }
});

async function restoreServerSession() {
  if (!PUBLIC_PRODUCTION || !SERVER_MODE) return;
  try {
    const response = await fetch("/api/me", { cache: "no-store", credentials: "same-origin" });
    if (response.ok) {
      const payload = await response.json();
      state.serverUser = payload.user;
    }
  } catch {
    state.serverUser = null;
  }
}

async function bootstrap() {
  await restoreServerSession();
  db = await loadData();
  render();
}

bootstrap();
