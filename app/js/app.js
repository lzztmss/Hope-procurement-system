import { workflowActionRoles, workflowActions } from "./workflow-config.js";
import { adjustInventory as adjustInventoryRequest, ensureInventory as ensureInventoryRequest, getCurrentUser, loadDocuments, loadInventory, loadState, login, logout, outboundDelivery, receivePurchase as receivePurchaseRequest, saveState } from "./api-client.js";

const APP_KEY = "xlx_ops_mvp_v1";
const SESSION_KEY = "xlx_ops_session_v1";
const ACTIVITY_READ_KEY = "xlx_ops_activity_read_v1";
const SERVER_MODE = location.protocol.startsWith("http");
const PUBLIC_PRODUCTION = true;

const today = new Date().toISOString().slice(0, 10);
let documentCodeSequence = 0;

function nextDocumentCode(prefix) {
  documentCodeSequence = (documentCodeSequence + 1) % 1000;
  const timestamp = Date.now().toString().slice(-8);
  const sequence = String(documentCodeSequence).padStart(3, "0");
  const entropy = Math.random().toString(36).slice(2, 5).toUpperCase();
  return `${prefix}${timestamp}-${sequence}${entropy}`;
}

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
    // 采购需要处理跨部门推送来的采购、交付、培训和售后事项；可见模块内统一看全部记录。
    scope: "全部",
    // 已确认：采购不看线索、销售订单；其余业务模块均可编辑处理。
    modules: ["dashboard", "purchases", "inventory", "deliveries", "trainings", "aftersales", "products", "suppliers", "notices"],
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
    ["model", "设备型号/规格", "model", false],
    ["quantity", "预计数量", "number", false],
    ["projectType", "项目类型", "select", true, ["投标", "直采", "送样", "零售", "合作洽谈", "售后带单"]],
    ["stage", "商机阶段", "select", true, ["初步咨询", "需求确认", "方案/报价", "投标中", "商务谈判", "合同推进", "已成交", "暂停/丢单"]],
    ["owner", "跟进人", "user", true],
    ["nextAction", "下一步动作", "textarea", false],
    ["dueDate", "截止日期", "date", false],
    ["immediateDelivery", "是否需要即时出库", "select", true, ["不需要", "需要"]],
    ["deliveryReceiver", "送样收货人", "text", false],
    ["deliveryAddress", "送样地址/项目", "text", false],
    ["deliveryMethod", "送样发货方式", "select", false, ["快递", "自送", "客户自提", "上门安装", "其他"]],
    ["deliveryId", "关联送样出库单", "linkeddelivery", false],
    ["status", "状态", "select", true, ["待分派", "跟进中", "待客户反馈", "待报价", "待投标", "已成交", "已转销售订单", "已关闭"]],
    ["remark", "备注", "textarea", false],
  ],
  salesOrders: [
    ["code", "销售订单号", "text", true],
    ["leadId", "来源线索", "lead", false],
    ["customer", "客户名称", "text", true],
    ["contact", "联系人", "text", false],
    ["phone", "联系电话", "text", false],
    ["product", "产品名称", "product", true],
    ["model", "设备型号/规格", "model", false],
    ["quantity", "数量", "number", true],
    ["unitPrice", "单价", "number", false],
    ["totalAmount", "订单金额", "number", false],
    ["contractNo", "合同编号", "text", false],
    ["contractFile", "合同附件说明", "text", false],
    ["deliveryDate", "预计交付日期", "date", false],
    ["owner", "业务负责人", "user", true],
    ["status", "订单状态", "select", true, ["草稿", "待销售审批", "待采购审批", "待采购到货", "待出库", "已出库", "已完成", "已取消"]],
    ["remark", "备注", "textarea", false],
  ],
  purchases: [
    ["code", "需求单号", "text", true],
    ["submittedAt", "提交日期", "date", true],
    ["requester", "提交人", "user", true],
    ["type", "需求类型", "select", true, ["大宗采购", "项目采购", "临时采购", "补库采购", "售后换货"]],
    ["product", "产品名称", "product", true],
    ["model", "设备型号/规格", "model", false],
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
    ["sku", "SKU/货号", "inventorysku", true],
    ["name", "产品名称", "product", true],
    ["model", "设备型号/规格", "model", true],
    ["sortOrder", "同类规格排序（数字越小越靠前）", "number", false],
    ["category", "类别", "select", true, ["手表", "表带/配件", "智能套装", "床垫", "平台服务", "组合方案", "样机", "其他"]],
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
    ["sku", "SKU/货号（首次可修改）", "productsku", true],
    ["name", "产品名称（可选已有或输入新名称）", "productname", true],
    ["category", "类别", "select", true, ["手表", "表带/配件", "智能套装", "床垫", "样机", "平台服务", "组合方案", "其他"]],
    ["model", "设备型号/规格", "text", true],
    ["sortOrder", "库存大类排序（未填时取规格最小排序）", "number", false],
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
    ["address", "收货地址", "text", false],
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
    ["deliveryId", "关联出库单（可选）", "delivery", false],
    ["customer", "客户", "text", true],
    ["product", "产品", "product", true],
    ["model", "设备型号/规格", "model", false],
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
    ["model", "设备型号/规格", "model", false],
    ["deviceNo", "SN/IMEI", "text", false],
    ["type", "问题类型", "select", true, ["咨询", "故障", "换货", "退货", "配置", "平台", "物流", "其他"]],
    ["priority", "紧急程度", "select", true, ["紧急", "高", "中", "低"]],
    ["description", "问题描述", "textarea", true],
    ["owner", "一级处理人", "user", true],
    ["techOwner", "二级技术人", "user", false],
    ["supplierId", "厂家联系人", "supplier", false],
    ["quantity", "涉及数量", "number", false],
    ["status", "当前状态", "select", true, ["待受理", "处理中", "待技术判断", "待厂家反馈", "待客户反馈", "待收货", "待质检", "维修中", "待换货", "换货待出库", "已退库", "已报废", "已换货", "已解决", "已关闭"]],
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
    ["modulePermissions", "模块操作权限", "modulepermissions", false],
    ["workflowActions", "流程操作权限", "workflowactions", false],
    ["password", "登录密码（新增必填，编辑留空不变）", "password", false],
  ],
};

const tableColumns = {
  leads: ["code", "customer", "product", "model", "quantity", "stage", "owner", "dueDate", "status"],
  salesOrders: ["code", "customer", "product", "model", "quantity", "totalAmount", "deliveryDate", "owner", "status"],
  purchases: ["code", "type", "product", "model", "quantity", "supplierId", "lockedDate", "owner", "status"],
  inventory: ["sku", "model", "stock", "locked", "available", "safeStock", "inTransit", "statusText"],
  deliveries: ["code", "project", "type", "deliveryProduct", "model", "quantity", "owner", "status"],
  trainings: ["code", "customer", "product", "model", "quantity", "trainer", "trainingAt", "acceptanceResult", "status"],
  aftersales: ["code", "customer", "product", "model", "type", "priority", "owner", "promiseAt", "status"],
  products: ["sku", "name", "category", "model", "unit", "safeStock", "supplierId", "status"],
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
  deliveryProduct: "产品",
  quantity: "数量",
  stage: "阶段",
  owner: "负责人",
  dueDate: "截止日期",
  status: "状态",
  type: "类型",
  supplierId: "供应商",
  lockedDate: "锁定交期",
  sku: "SKU/货号",
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
  inventoryLogSearch: "",
  inventoryLogPage: 1,
  inventoryLogPageSize: 20,
  bulkDelete: { moduleId: null, ids: [], mode: null },
  forceDelete: null,
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

const skuCategoryPrefixes = {
  "手表": "WATCH",
  "表带/配件": "STRAP",
  "智能套装": "KIT",
  "床垫": "BED",
  "平台服务": "SERVICE",
  "组合方案": "SET",
  "样机": "DEMO",
  "其他": "ITEM",
};

function skuVariantToken(model = "") {
  const text = String(model).toUpperCase();
  if (text.includes("4G")) return "4G";
  if (text.includes("WIFI") || text.includes("WI-FI")) return "WIFI";
  if (text.includes("黑")) return "BLK";
  if (text.includes("红")) return "RED";
  if (text.includes("白")) return "WHT";
  if (text.includes("标准")) return "STD";
  const latin = text.replace(/[^A-Z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return latin.slice(0, 12) || "STD";
}

function nextSku(category, model, usedSkus = [], currentSku = "") {
  const prefix = skuCategoryPrefixes[category] || "ITEM";
  const base = `${prefix}-${skuVariantToken(model)}`;
  const occupied = new Set(usedSkus.filter((sku) => sku && sku !== currentSku));
  let sequence = 1;
  while (occupied.has(`${base}-${String(sequence).padStart(3, "0")}`)) sequence += 1;
  return `${base}-${String(sequence).padStart(3, "0")}`;
}

function suggestedProductSku(product = {}, currentSku = "") {
  return nextSku(product.category, product.model, (db?.products || []).map((item) => item.sku), currentSku);
}

function suggestedInventorySku(item = {}, currentSku = "") {
  const product = item.productId ? productById(item.productId) : findProductByLabel(db?.products || [], item.name, item.model);
  if (product?.sku) return product.sku;
  return nextSku(item.category, item.model, (db?.inventory || []).map((inventory) => inventory.sku), currentSku);
}

function migrateReadableSkus(normalized) {
  if (Number(normalized.meta?.skuVersion || 0) >= 1) return false;
  const usedProductSkus = [];
  normalized.products.forEach((product) => {
    // 迁移只补充旧数据中缺失的货号。人工维护过的货号是业务标识，绝不能在页面加载时被自动规则改写。
    product.sku = String(product.sku || "").trim() || nextSku(product.category, product.model, usedProductSkus);
    usedProductSkus.push(product.sku);
  });
  normalized.inventory.forEach((item) => {
    const product = normalized.products.find((candidate) => candidate.id === item.productId)
      || findProductByLabel(normalized.products, item.name, item.model);
    item.sku = String(item.sku || "").trim()
      || product?.sku
      || nextSku(item.category, item.model, normalized.inventory.map((inventory) => inventory.sku), item.sku);
  });
  normalized.meta.skuVersion = 1;
  return true;
}

function syncInventoryIdentityFromProduct(item, product) {
  if (!item || !product) return false;
  const before = [item.productId, item.sku, item.name, item.model, item.category].join("\u0001");
  item.productId = product.id;
  item.sku = product.sku || item.sku;
  item.name = product.name;
  item.model = product.model;
  item.category = product.category;
  return before !== [item.productId, item.sku, item.name, item.model, item.category].join("\u0001");
}

function syncLinkedInventoryIdentities(normalized) {
  let changed = false;
  normalized.inventory.forEach((item) => {
    const product = normalized.products.find((candidate) => candidate.id === item.productId)
      || findProductByLabel(normalized.products, item.name, item.model);
    if (product && syncInventoryIdentityFromProduct(item, product)) changed = true;
  });
  return changed;
}

function syncDocumentItemIdentities(normalized) {
  let changed = false;
  const inventoryById = new Map(normalized.inventory.map((item) => [item.id, item]));
  const productsById = new Map(normalized.products.map((item) => [item.id, item]));
  ["salesOrders", "purchases", "deliveries"].forEach((collection) => {
    normalized[collection].forEach((record) => {
      const items = documentItems(record);
      items.forEach((item) => {
        const inventory = inventoryById.get(item.inventoryId);
        const product = productsById.get(item.productId)
          || productsById.get(inventory?.productId)
          || findProductByLabel(normalized.products, item.product || inventory?.name, item.model || inventory?.model);
        if (!item.productId && (inventory?.productId || product?.id)) { item.productId = inventory?.productId || product.id; changed = true; }
        if (!item.product && (inventory?.name || product?.name)) { item.product = inventory?.name || product.name; changed = true; }
        if (!item.model && (inventory?.model || product?.model)) { item.model = inventory?.model || product.model; changed = true; }
      });
      const before = JSON.stringify(record.items || []);
      applyLegacyItemSummary(record);
      if (before !== JSON.stringify(record.items || [])) changed = true;
    });
  });
  return changed;
}

function normalizeData(data) {
  const normalized = data || {};
  if (!Array.isArray(normalized.products)) {
    normalized.products = defaultProducts();
  }
  for (const key of ["users", "suppliers", "inventory", "leads", "salesOrders", "purchases", "deliveries", "trainings", "aftersales", "notices", "inventoryLogs", "auditLogs"]) {
    if (!Array.isArray(normalized[key])) normalized[key] = [];
  }
  ["salesOrders", "purchases", "deliveries"].forEach((collection) => {
    normalized[collection].forEach((record) => applyLegacyItemSummary(record));
  });
  const inventoryIdentitySynced = syncLinkedInventoryIdentities(normalized);
  const findById = (productId) => normalized.products.find((product) => product.id === productId) || null;
  const normalizeProductReference = (record, nameKey) => {
    const linkedProduct = findById(record.productId);
    const product = linkedProduct && (!record.model || linkedProduct.model === record.model)
      ? linkedProduct
      : findProductByLabel(normalized.products, record[nameKey], record.model);
    if (!product) return;
    record.productId = product.id;
    if (!record.model) record.model = product.model || "";
    if (nameKey === "name" && normalizedProductName(record[nameKey]) !== normalizedProductName(product.name)) record[nameKey] = product.name;
  };
  normalized.inventory.forEach((item) => normalizeProductReference(item, "name"));
  syncDocumentItemIdentities(normalized);
  normalized.salesOrders.forEach((order) => {
    normalizeProductReference(order, "product");
    order.totalAmount = Number(order.totalAmount || Number(order.quantity || 0) * Number(order.unitPrice || 0));
  });
  normalized.purchases.forEach((purchase) => {
    normalizeProductReference(purchase, "product");
    // 旧版“待采购确认”不够明确，统一迁移为“已下单”。
    if (purchase.status === "待采购确认") purchase.status = "已下单";
  });
  ["leads", "trainings", "aftersales"].forEach((collection) => {
    normalized[collection].forEach((record) => normalizeProductReference(record, "product"));
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
  // 旧数据中“已成交 + 已关闭”常表示已转成订单；统一为可追溯的转单状态。
  const activeLeadOrderIds = new Set(normalized.salesOrders
    .filter((order) => order.leadId && order.status !== "已取消")
    .map((order) => order.leadId));
  normalized.leads.forEach((lead) => {
    // 旧线索默认不创建送样出库申请，避免升级后意外推送历史线索。
    if (!lead.immediateDelivery) lead.immediateDelivery = "不需要";
    if (activeLeadOrderIds.has(lead.id) && lead.stage === "已成交" && lead.status === "已关闭") {
      lead.status = "已转销售订单";
      lead.closedAt = "";
    }
  });
  if (!normalized.meta) normalized.meta = { version: 1, createdAt: nowIso() };
  // 采购岗位按已确认的岗位矩阵迁移一次：不看线索/销售订单，
  // 其余模块可编辑，并补齐出库交付的确认、配送、签收、验收按钮。
  if (Number(normalized.meta.permissionTemplateVersion || 0) < 1) {
    const purchaseRole = roles.purchase;
    const purchaseModules = Object.fromEntries(purchaseRole.modules.map((moduleId) => [moduleId, [...purchaseRole.actions]]));
    const purchaseWorkflows = workflowActions
      .filter((action) => action.defaultRoles.includes("purchase"))
      .map((action) => action.id);
    normalized.users.filter((user) => user.role === "purchase").forEach((user) => {
      user.scope = "全部";
      user.modulePermissions = purchaseModules;
      user.workflowActions = purchaseWorkflows;
    });
    normalized.meta.permissionTemplateVersion = 1;
  }
  const skuMigrated = migrateReadableSkus(normalized);
  normalized.meta.skuMigrated = Boolean(normalized.meta.skuMigrated || skuMigrated);
  normalized.meta.inventoryIdentitySynced = Boolean(normalized.meta.inventoryIdentitySynced || inventoryIdentitySynced);
  normalized.meta.version = Math.max(Number(normalized.meta.version || 1), 2);
  return normalized;
}

function normalizedProductName(value) {
  return String(value || "").replaceAll("居家", "").replaceAll("智能", "").replaceAll("/", "").replaceAll("配件", "").replaceAll(" ", "").toLowerCase();
}

function findProductByLabel(products, name, model = "") {
  const target = normalizedProductName(name);
  const candidates = (products || []).filter((product) => {
    const candidate = normalizedProductName(product.name);
    return candidate === target || (candidate.length > 1 && target.length > 1 && (candidate.includes(target) || target.includes(candidate)));
  });
  if (model) return candidates.find((product) => product.model === model) || (products || []).find((product) => product.model === model) || null;
  return candidates[0] || null;
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
      const { response, payload } = await loadState();
      if (response.ok) {
        const data = normalizeData(payload);
        const { response: inventoryResponse, payload: inventoryPayload } = await loadInventory();
        if (inventoryResponse.ok) {
          data.inventory = inventoryPayload.inventory || data.inventory;
        }
        const documentModules = ["salesOrders", "purchases", "deliveries", "trainings", "aftersales", "leads"];
        const documentResponses = await Promise.all(documentModules.map(async (moduleId) => {
          const { response: moduleResponse, payload: modulePayload } = await loadDocuments(moduleId);
          return moduleResponse.ok ? [moduleId, modulePayload[moduleId]] : null;
        }));
        documentResponses.filter(Boolean).forEach(([moduleId, records]) => { data[moduleId] = records || data[moduleId]; });
        localStorage.setItem(APP_KEY, JSON.stringify(data));
        return data;
      }
      // 公网/测试模式下，绝不能在登录失效时回退到演示数据；那会把真实页面伪装成旧数据。
      if (PUBLIC_PRODUCTION) return normalizeData({ products: [], users: [] });
    } catch {
      // 公网/测试模式下服务不可用时直接回到登录页，避免把本机缓存误当成真实业务数据。
      if (PUBLIC_PRODUCTION) return normalizeData({ products: [], users: [] });
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
    const payload = state.forceDelete
      ? { ...db, meta: { ...(db.meta || {}), forceDelete: state.forceDelete } }
      : db;
    state.forceDelete = null;
    saveState(payload).then(({ response, payload: result }) => {
      if (response.ok) {
        if (Number.isFinite(Number(result.revision))) {
          db.meta = { ...(db.meta || {}), revision: Number(result.revision) };
          localStorage.setItem(APP_KEY, JSON.stringify(db));
        }
        return;
      }
      if (PUBLIC_PRODUCTION && response.status === 401) {
        state.serverUser = null;
        toast("登录已过期，请重新登录");
        render();
      } else if (response.status === 409) {
        toast("数据已在其他页面更新。请刷新页面后再继续操作。");
      } else if (!response.ok) {
        toast(`保存失败：${result.message || result.error || "服务器拒绝了本次修改"}`);
      }
    }).catch(() => toast("服务器保存失败，请检查网络或联系管理员"));
  }
}

async function adjustInventoryOnServer(adjustments, sourceId, sourceModule) {
  const { response, payload } = await adjustInventoryRequest(adjustments, sourceId, sourceModule);
  if (!response.ok) throw new Error(payload.message || payload.error || "库存服务处理失败");
  return { results: payload.results || [], revision: Number(payload.revision) };
}

async function ensureInventoryOnServer(item) {
  const { response, payload } = await ensureInventoryRequest(item);
  if (!response.ok || !payload.ok) throw new Error(payload.message || payload.error || "建立库存记录失败");
  return payload;
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
  return ({
    create: "新增",
    update: "编辑",
    delete: "删除",
    cancel: "作废",
    approve: "审批",
    inbound: "入库",
    outbound: "出库",
    purchase_received: "采购到货",
    rollback: "回撤",
    merge: "合并",
    complete: "完成",
    submit: "提交审批",
    inventory_check: "检查库存",
    inventory_shortage: "库存不足",
    in_transit_clear: "清除在途",
    purchase_transit: "标记在途",
    technical_confirm: "技术确认",
    link: "关联",
    return_start: "发起退库",
    return_receive: "确认收货",
    return_stock: "退库入库",
    replacement_create: "生成换货出库单",
    replacement_outbound: "换货出库",
  })[action] || action || "操作";
}

function activityReadKey() {
  return `${ACTIVITY_READ_KEY}:${state.currentUser?.id || "anonymous"}`;
}

function hasUnreadActivity() {
  const lastReadAt = localStorage.getItem(activityReadKey());
  const lastReadTime = lastReadAt ? Date.parse(lastReadAt) : 0;
  return (db.auditLogs || []).some((log) => Date.parse(log.createdAt || 0) > lastReadTime);
}

function markActivitiesRead() {
  localStorage.setItem(activityReadKey(), nowIso());
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
  const item = db.inventory.find((inventory) => inventory.id === id);
  return item ? `${item.name}${item.model ? ` / ${item.model}` : ""}` : id || "-";
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

function productModelsForName(name, currentValue = "") {
  const target = normalizedProductName(name);
  const models = [];
  const add = (model) => {
    const value = String(model || "").trim();
    if (value && !models.includes(value)) models.push(value);
  };
  (db.products || []).filter((product) => {
    const candidate = normalizedProductName(product.name);
    return candidate === target || (candidate.length > 1 && target.length > 1 && (candidate.includes(target) || target.includes(candidate)));
  }).forEach((product) => add(product.model));
  if (!models.length) add(currentValue);
  return models;
}

function inventoryLabel(item) {
  return `${item.name}${item.model ? ` / ${item.model}` : ""}（可用 ${availableStock(item)}）`;
}

function inventoryOptionsForVariant(productName = "", model = "") {
  const product = findProductByLabel(db.products, productName, model);
  return (db.inventory || []).filter((item) => {
    if (product?.id) return item.productId === product.id;
    if (!productName) return true;
    if (normalizedProductName(item.name) !== normalizedProductName(productName)) return false;
    return !model || item.model === model;
  });
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
    const nameMatches = itemName === target || (itemName.length > 1 && target.length > 1 && (itemName.includes(target) || target.includes(itemName)));
    return nameMatches && (!model || item.model === model);
  }) || null;
}

function documentItems(record = []) {
  const source = Array.isArray(record.items) && record.items.length
    ? record.items
    : (record.product || record.inventoryId ? [{
      id: record.inventoryId || record.productId || uid("line"),
      productId: record.productId || "",
      // 初始化数据库时 db 尚未赋值；旧出库单只有库存 ID 也必须能先完成数据加载。
      product: record.product || "",
      model: record.model || "",
      inventoryId: record.inventoryId || "",
      quantity: Number(record.quantity || 0),
      unitPrice: Number(record.unitPrice || 0),
    }] : []);
  return source.map((item) => ({ ...item, quantity: Number(item.quantity || 0), unitPrice: Number(item.unitPrice || 0) }));
}

const multiItemModules = new Set(["salesOrders", "purchases", "deliveries"]);

function itemLabel(item = {}) {
  return [item.product || inventoryName(item.inventoryId), item.model].filter(Boolean).join(" / ") || "未选择产品";
}

function recordItemSummary(record = {}) {
  const items = documentItems(record);
  if (!items.length) return "-";
  return items.length === 1 ? itemLabel(items[0]) : `${itemLabel(items[0])} 等 ${items.length} 项`;
}

function deliveryItems(record = {}) {
  return documentItems(record).map((item) => ({
    ...item,
    inventoryId: item.inventoryId || inventoryForProduct(item.product, item.productId, item.model)?.id || "",
  }));
}

function validateDocumentItems(moduleId, record) {
  if (!multiItemModules.has(moduleId)) return { ok: true };
  const items = documentItems(record);
  if (!items.length) return { ok: false, message: "请至少添加一项产品明细" };
  for (const item of items) {
    if (!item.product && !item.inventoryId) return { ok: false, message: "每一项都要选择产品" };
    if (["salesOrders", "purchases"].includes(moduleId) && !item.model) return { ok: false, message: `“${item.product || "该产品"}”必须选择型号/规格，才能准确联动库存` };
    if (!Number.isFinite(Number(item.quantity)) || Number(item.quantity) <= 0) return { ok: false, message: `“${itemLabel(item)}”的数量必须大于 0` };
    if (moduleId === "deliveries" && !item.inventoryId) return { ok: false, message: `“${itemLabel(item)}”未找到对应库存，请先在库存台账建立该规格` };
  }
  return { ok: true };
}

function orderInventoryCheck(order) {
  const shortages = [];
  const readyItems = [];
  documentItems(order).forEach((line) => {
    const item = inventoryForProduct(line.product, line.productId, line.model);
    const quantity = Number(line.quantity || 0);
    if (!item || availableStock(item) < quantity) {
      shortages.push({ ...line, inventoryId: item?.id || "", available: item ? availableStock(item) : 0, shortage: Math.max(0, quantity - Number(item ? availableStock(item) : 0)) });
    } else {
      readyItems.push({ ...line, inventoryId: item.id });
    }
  });
  return { ready: shortages.length === 0, shortages, readyItems };
}

function applyLegacyItemSummary(record) {
  const items = documentItems(record);
  record.items = items;
  const first = items[0] || {};
  record.product = first.product || "";
  record.productId = first.productId || "";
  record.model = first.model || "";
  record.inventoryId = first.inventoryId || "";
  record.quantity = items.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  if (record.totalAmountManual) return;
  record.totalAmount = items.reduce((sum, item) => sum + Number(item.quantity || 0) * Number(item.unitPrice || 0), 0);
}

function roleName(id) {
  return roles[id]?.name || id || "-";
}

function currentRole() {
  return roles[state.currentUser?.role] || roles.sales;
}

function isSuperAdmin(user = state.currentUser) {
  return user?.role === "admin";
}

function effectiveModulePermissions(user = state.currentUser) {
  const role = roles[user?.role] || roles.sales;
  if (isSuperAdmin(user)) {
    return Object.fromEntries(modules.map((module) => [module.id, ["view", "create", "edit", "delete", "export", "config"]]));
  }
  if (user?.modulePermissions && typeof user.modulePermissions === "object" && !Array.isArray(user.modulePermissions)) {
    const permissions = { dashboard: ["view"], ...user.modulePermissions };
    return permissions;
  }
  return Object.fromEntries(role.modules.map((moduleId) => [moduleId, role.actions]));
}

function effectiveScope(user = state.currentUser) {
  return user?.scope || (roles[user?.role] || roles.sales).scope;
}

function can(moduleId, action = "view") {
  if (isSuperAdmin()) return true;
  const actions = effectiveModulePermissions()[moduleId] || [];
  return actions.includes(action);
}

function canWorkflow(action) {
  const user = state.currentUser;
  if (!user) return false;
  if (isSuperAdmin(user)) return true;
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
  return modules.filter((module) => can(module.id, "view"));
}

function collectionFor(moduleId) {
  return moduleId === "users" ? "users" : moduleId;
}

function canSeeRecord(record) {
  if (!state.currentUser) return false;
  const scope = effectiveScope();
  if (scope === "全部") return true;
  const ids = [record.owner, record.requester, record.publisher, record.techOwner, record.createdBy].filter(Boolean);
  if (ids.includes(state.currentUser.id)) return true;
  if (scope === "本部门") {
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

const closedStatusesByModule = {
  leads: ["已转销售订单", "已关闭"],
  salesOrders: ["已完成", "已取消"],
  purchases: ["已到货", "已取消"],
  deliveries: ["已验收", "已取消"],
  trainings: ["已完成"],
  aftersales: ["已退库", "已报废", "已换货", "已解决", "已关闭"],
  notices: ["已完成"],
};

function isArchivedRecord(moduleId, record) {
  return (closedStatusesByModule[moduleId] || []).includes(record.status || "");
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

function dueState(value) {
  const date = String(value || "").slice(0, 10);
  if (!date) return "";
  if (date < today) return "已逾期";
  if (date === today) return "今日到期";
  return "";
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
    const state = !isArchivedRecord("purchases", p) && dueState(p.lockedDate);
    if (state) {
      alerts.push({
        id: `purchase-${p.id}`,
        level: state === "已逾期" ? "risk" : "warn",
        title: `${p.code} 采购交期${state}`,
        message: `${p.product} ${p.quantity} 件，锁定交期 ${p.lockedDate}，状态 ${p.status}`,
        refModule: "purchases",
        refId: p.id,
      });
    }
  });
  db.aftersales.forEach((a) => {
    const state = !isArchivedRecord("aftersales", a) && dueState(a.promiseAt);
    if (state) {
      alerts.push({
        id: `after-${a.id}`,
        level: state === "已逾期" || a.priority === "紧急" ? "risk" : "warn",
        title: `${a.code} 售后反馈${state}`,
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
  db.leads.forEach((lead) => {
    const state = !isArchivedRecord("leads", lead) && dueState(lead.dueDate);
    if (!state) return;
    alerts.push({
      id: `lead-${lead.id}`,
      level: state === "已逾期" ? "risk" : "warn",
      title: `${lead.code} 跟进${state}`,
      message: `${lead.customer}，下一步：${lead.nextAction || "待安排"}`,
      refModule: "leads",
      refId: lead.id,
    });
  });
  db.notices.forEach((notice) => {
    const state = !isArchivedRecord("notices", notice) && notice.status !== "暂停" && dueState(notice.dueDate);
    if (!state) return;
    alerts.push({
      id: `notice-${notice.id}`,
      level: state === "已逾期" ? "risk" : "warn",
      title: `${notice.title} ${state}`,
      message: `业务通报截止 ${formatDate(notice.dueDate)}，当前 ${notice.status}`,
      refModule: "notices",
      refId: notice.id,
    });
  });
  return alerts;
}

function dashboardStats() {
  const alerts = calcAlerts();
  return {
    leadsActive: db.leads.filter((x) => !isArchivedRecord("leads", x)).length,
    purchasePending: db.purchases.filter((x) => !isArchivedRecord("purchases", x)).length,
    inventoryRisk: alerts.filter((x) => x.refModule === "inventory").length,
    deliveryOpen: db.deliveries.filter((x) => !isArchivedRecord("deliveries", x)).length,
    afterOpen: db.aftersales.filter((x) => !isArchivedRecord("aftersales", x)).length,
    alerts,
  };
}

function fieldValue(moduleId, record, key) {
  if (["salesOrders", "purchases", "deliveries"].includes(moduleId) && key === "product" && documentItems(record).length > 1) return recordItemSummary(record);
  if (moduleId === "inventory" && key === "available") return availableStock(record);
  if (moduleId === "inventory" && key === "statusText") return inventoryStatus(record);
  if (moduleId === "salesOrders" && key === "totalAmount") {
    if (record.totalAmount !== "" && record.totalAmount !== null && record.totalAmount !== undefined) return record.totalAmount;
    return Number(record.quantity || 0) * Number(record.unitPrice || 0);
  }
  if (["owner", "requester", "publisher", "techOwner"].includes(key)) return userName(record[key]);
  if (key === "supplierId") return supplierName(record[key]);
  if (key === "inventoryId") return inventoryName(record[key]);
  if (key === "deliveryProduct") return db.inventory.find((item) => item.id === record.inventoryId)?.name || record.product || "-";
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
  if (!can(state.route, "view")) {
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
      const { response, payload } = await login(phone, password);
      if (!response.ok) {
        toast("账号或密码错误，或账号已禁用");
        return;
      }
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
            <div class="brand-subtitle">智能养老业务重构测试版</div>
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
              <button class="bell-btn" type="button" data-action="toggle-activity" aria-label="查看流程动态${hasUnreadActivity() ? "（有未读）" : ""}" title="流程动态"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></svg>${hasUnreadActivity() ? '<span class="bell-dot"></span>' : ""}</button>
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
      await logout().catch(() => {});
      state.serverUser = null;
    }
    localStorage.removeItem(SESSION_KEY);
    render();
  });
  document.querySelector('[data-action="reset-demo"]')?.addEventListener("click", () => {
    confirmAction("确认重置演示数据", "当前浏览器内的修改会被覆盖，且不能恢复。", () => {
      db = getInitialData();
      saveData();
      toast("演示数据已重置");
      render();
    });
  });
  document.querySelector('[data-action="toggle-activity"]')?.addEventListener("click", () => {
    state.activityOpen = !state.activityOpen;
    if (state.activityOpen) {
      state.activityLimit = 10;
      markActivitiesRead();
    }
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
  document.querySelectorAll("[data-toggle-bulk-delete]").forEach((btn) => btn.addEventListener("click", () => {
    state.bulkDelete = state.bulkDelete.moduleId === btn.dataset.toggleBulkDelete
      ? { moduleId: null, ids: [], mode: null }
      : { moduleId: btn.dataset.toggleBulkDelete, ids: [], mode: "safe" };
    render();
  }));
  document.querySelectorAll("[data-toggle-force-delete]").forEach((btn) => btn.addEventListener("click", () => {
    state.bulkDelete = state.bulkDelete.moduleId === btn.dataset.toggleForceDelete
      ? { moduleId: null, ids: [], mode: null }
      : { moduleId: btn.dataset.toggleForceDelete, ids: [], mode: "force" };
    render();
  }));
  document.querySelectorAll("[data-bulk-select]").forEach((box) => box.addEventListener("change", () => {
    const ids = new Set(state.bulkDelete.ids);
    if (box.checked) ids.add(box.dataset.bulkSelect);
    else ids.delete(box.dataset.bulkSelect);
    state.bulkDelete.ids = [...ids];
    render();
  }));
  document.querySelectorAll("[data-confirm-bulk-delete]").forEach((btn) => btn.addEventListener("click", () => deleteSelectedRecords(btn.dataset.confirmBulkDelete)));
  document.querySelectorAll("[data-confirm-force-delete]").forEach((btn) => btn.addEventListener("click", () => forceDeleteSelectedRecords(btn.dataset.confirmForceDelete)));
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
  document.querySelectorAll("[data-check-order]").forEach((btn) => btn.addEventListener("click", () => confirmAction("重新核验库存", "系统将根据当前可用库存重新判断是否可出库；库存不足时会自动生成采购申请。", () => checkSalesOrderInventory(btn.dataset.checkOrder))));
  document.querySelectorAll("[data-create-delivery]").forEach((btn) => btn.addEventListener("click", () => confirmAction("确认生成出库单", "确认后将从该销售订单带入客户、产品和数量，生成待出库单。", () => createDeliveryFromSalesOrder(btn.dataset.createDelivery))));
  document.querySelectorAll("[data-confirm-outbound]").forEach((btn) => btn.addEventListener("click", () => confirmAction("仓库确认出库", "请确认实物、产品明细、数量及必要准备项均已核对。确认后将正式扣减库存，不能当作普通状态点击。", () => confirmDeliveryOutbound(btn.dataset.confirmOutbound))));
  document.querySelectorAll("[data-create-training]").forEach((btn) => btn.addEventListener("click", () => openTrainingFromDelivery(btn.dataset.createTraining)));
  document.querySelectorAll("[data-start-return]").forEach((btn) => btn.addEventListener("click", () => confirmAction("发起退库处理", "确认客户将设备退回仓库处理吗？下一步由仓库确认收货。", () => startAfterSalesReturn(btn.dataset.startReturn))));
  document.querySelectorAll("[data-receive-return]").forEach((btn) => btn.addEventListener("click", () => confirmAction("确认售后收货", "确认仓库已收到退回设备吗？确认后等待质检决定入库、维修或报废。", () => receiveAfterSalesReturn(btn.dataset.receiveReturn))));
  document.querySelectorAll("[data-return-to-stock]").forEach((btn) => btn.addEventListener("click", () => openAfterSalesInventoryDialog(btn.dataset.returnToStock, "return")));
  document.querySelectorAll("[data-return-repair]").forEach((btn) => btn.addEventListener("click", () => confirmAction("转维修", "确认该设备不能直接入库，需要进入维修处理吗？", () => setAfterSalesDisposition(btn.dataset.returnRepair, "维修中", "已转维修"))));
  document.querySelectorAll("[data-repair-to-stock]").forEach((btn) => btn.addEventListener("click", () => openAfterSalesInventoryDialog(btn.dataset.repairToStock, "repair-return")));
  document.querySelectorAll("[data-return-scrap]").forEach((btn) => btn.addEventListener("click", () => confirmAction("确认报废", "确认该设备无法修复，按报废处理吗？此操作不会增加库存。", () => setAfterSalesDisposition(btn.dataset.returnScrap, "已报废", "已确认报废"))));
  document.querySelectorAll("[data-create-replacement]").forEach((btn) => btn.addEventListener("click", () => openAfterSalesInventoryDialog(btn.dataset.createReplacement, "replacement")));
  document.querySelectorAll("[data-approve-purchase]").forEach((btn) => btn.addEventListener("click", () => openPurchaseApproval(btn.dataset.approvePurchase)));
  document.querySelectorAll("[data-confirm-tech-purchase]").forEach((btn) => btn.addEventListener("click", () => confirmAction("确认技术通过", "确认产品规格、技术条件已核对无误吗？确认后采购单进入待采购审批。", () => confirmPurchaseTechnical(btn.dataset.confirmTechPurchase))));
  document.querySelectorAll("[data-mark-purchase-transit]").forEach((btn) => btn.addEventListener("click", () => confirmAction("确认标记在途", "确认供应商已发货、采购单正在运输途中吗？", () => markPurchaseInTransit(btn.dataset.markPurchaseTransit))));
  document.querySelectorAll("[data-dispatch-delivery]").forEach((btn) => btn.addEventListener("click", () => confirmAction("确认配送中", "确认货物已交付物流或正在配送吗？", () => advanceDelivery(btn.dataset.dispatchDelivery, "已出库", "配送中", "delivery_dispatch", "已标记配送中"))));
  document.querySelectorAll("[data-sign-delivery]").forEach((btn) => btn.addEventListener("click", () => confirmAction("确认签收", "确认客户已签收本次交付吗？", () => advanceDelivery(btn.dataset.signDelivery, "配送中", "已签收", "delivery_sign", "已确认签收"))));
  document.querySelectorAll("[data-accept-delivery]").forEach((btn) => btn.addEventListener("click", () => confirmAction("确认验收", "确认本次交付已验收完成吗？", () => advanceDelivery(btn.dataset.acceptDelivery, "已签收", "已验收", "delivery_accept", "已确认验收"))));
  document.querySelector("[data-export]")?.addEventListener("click", () => state.route === "inventory" ? openInventoryExportDialog() : exportCsv(state.route));
  document.querySelector("[data-inventory-log-search]")?.addEventListener("input", (event) => {
    state.inventoryLogSearch = event.target.value;
    state.inventoryLogPage = 1;
    render();
  });
  document.querySelector("[data-inventory-log-size]")?.addEventListener("change", (event) => {
    state.inventoryLogPageSize = Number(event.target.value);
    state.inventoryLogPage = 1;
    render();
  });
  document.querySelectorAll("[data-inventory-log-page]").forEach((button) => button.addEventListener("click", () => {
    state.inventoryLogPage = Number(button.dataset.inventoryLogPage);
    render();
  }));
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
      <div class="panel">
        <div class="panel-header">
          <h2 class="panel-title">风险预警中心</h2>
          <span class="badge ${riskAlerts.length ? "risk" : "ok"}">${riskAlerts.length ? `${riskAlerts.length} 项严重` : "暂无严重风险"}</span>
        </div>
        <div class="list">
          ${stats.alerts.length ? stats.alerts.map(renderAlert).join("") : `<div class="empty">暂无预警。系统会根据库存阈值、在途到货、采购交期、售后反馈、线索跟进、业务通报和交付异常自动计算。</div>`}
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
    const afterRisk = afters.find((x) => !isArchivedRecord("aftersales", x));
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
  if (moduleId !== "products" && moduleId !== "inventory") {
    records = records.slice().sort((left, right) => recordLatestTime(right, moduleId) - recordLatestTime(left, moduleId)
      || String(right.code || right.id || "").localeCompare(String(left.code || left.id || ""), "zh-CN"));
  }
  if (moduleId === "products") {
    records = records.slice().sort((left, right) => recordSortOrder(left.sortOrder) - recordSortOrder(right.sortOrder)
      || String(left.name || "").localeCompare(String(right.name || ""), "zh-CN")
      || String(left.model || "").localeCompare(String(right.model || ""), "zh-CN"));
  }
  const bulkDeleteActive = state.bulkDelete.moduleId === moduleId;
  const canForceDelete = isSuperAdmin();
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
          ${can(moduleId, "create") ? `<button class="primary-btn" data-create="${moduleId}">${moduleId === "products" ? "新增产品/型号" : "新增"}</button>` : ""}
          ${canForceDelete ? `<button class="${bulkDeleteActive && state.bulkDelete.mode === "force" ? "ghost-btn" : "danger-btn"}" data-toggle-force-delete="${moduleId}">${bulkDeleteActive && state.bulkDelete.mode === "force" ? "取消强制删除" : "强制删除"}</button>` : ""}
          ${bulkDeleteActive && state.bulkDelete.mode === "force" ? `<button class="danger-btn" data-confirm-force-delete="${moduleId}" ${state.bulkDelete.ids.length ? "" : "disabled"}>强制删除选中（${state.bulkDelete.ids.length}）</button>` : ""}
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
  if (moduleId === "inventory") return renderGroupedInventoryTable(records);
  const columns = tableColumns[moduleId] || [];
  const selectionMode = state.bulkDelete.moduleId === moduleId;
  return `<div class="table-wrap">
    <table>
      <thead>
        <tr>${selectionMode ? "<th class=\"select-column\">选择</th>" : ""}${columns.map((key) => `<th>${columnLabels[key] || key}</th>`).join("")}<th>操作</th></tr>
      </thead>
      <tbody>
        ${records.length ? records.map((record) => `<tr class="${isArchivedRecord(moduleId, record) ? "is-archived" : ""}">
          ${selectionMode ? `<td class="select-column"><input type="checkbox" data-bulk-select="${record.id}" ${state.bulkDelete.ids.includes(record.id) ? "checked" : ""} /></td>` : ""}
          ${columns.map((key) => renderCell(moduleId, record, key)).join("")}
          <td>${renderActions(moduleId, record)}</td>
        </tr>`).join("") : `<tr><td colspan="${columns.length + 1 + (selectionMode ? 1 : 0)}" class="empty">暂无数据</td></tr>`}
      </tbody>
    </table>
  </div>`;
}

function renderGroupedInventoryTable(records) {
  const columns = tableColumns.inventory;
  const selectionMode = state.bulkDelete.moduleId === "inventory";
  const groups = new Map();
  records.forEach((item) => {
    const name = item.name || "未命名产品";
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(item);
  });
  const groupRows = [...groups.entries()]
    .sort(([leftName, leftItems], [rightName, rightItems]) => {
      const leftOrder = inventoryGroupSortOrder(leftItems);
      const rightOrder = inventoryGroupSortOrder(rightItems);
      return leftOrder - rightOrder || leftName.localeCompare(rightName, "zh-CN");
    })
    .map(([name, items]) => {
      const ordered = items.slice().sort((left, right) => recordSortOrder(left.sortOrder) - recordSortOrder(right.sortOrder)
        || String(left.model || "").localeCompare(String(right.model || ""), "zh-CN"));
      const totalStock = ordered.reduce((sum, item) => sum + Number(item.stock || 0), 0);
      const totalAvailable = ordered.reduce((sum, item) => sum + availableStock(item), 0);
      const totalTransit = ordered.reduce((sum, item) => sum + Number(item.inTransit || 0), 0);
      const category = ordered[0]?.category || "其他";
      return `<tr class="inventory-group-row"><td colspan="${columns.length + 1 + (selectionMode ? 1 : 0)}">
        <strong>${escapeHtml(name)}</strong><span class="inventory-group-category">${escapeHtml(category)}</span>
        <span>合计库存 ${totalStock}</span><span>可用 ${totalAvailable}</span><span>在途 ${totalTransit}</span>
      </td></tr>
      ${ordered.map((record) => `<tr class="inventory-variant-row">
        ${selectionMode ? `<td class="select-column"><input type="checkbox" data-bulk-select="${record.id}" ${state.bulkDelete.ids.includes(record.id) ? "checked" : ""} /></td>` : ""}
        ${columns.map((key) => renderCell("inventory", record, key)).join("")}
        <td>${renderActions("inventory", record)}</td>
      </tr>`).join("")}`;
    }).join("");
  return `<div class="table-wrap">
    <table class="inventory-grouped-table">
      <thead><tr>${selectionMode ? "<th class=\"select-column\">选择</th>" : ""}${columns.map((key) => `<th>${columnLabels[key] || key}</th>`).join("")}<th>操作</th></tr></thead>
      <tbody>${groupRows || `<tr><td colspan="${columns.length + 1 + (selectionMode ? 1 : 0)}" class="empty">暂无数据</td></tr>`}</tbody>
    </table>
  </div>`;
}

function recordSortOrder(value) {
  const number = Number(value);
  return value === "" || value === null || value === undefined || !Number.isFinite(number) ? Number.MAX_SAFE_INTEGER : number;
}

function recordLatestTime(record, moduleId) {
  const dateFields = {
    leads: ["updatedAt", "createdAt", "receivedAt", "dueDate"],
    salesOrders: ["updatedAt", "createdAt", "deliveryDate"],
    purchases: ["updatedAt", "createdAt", "submittedAt", "requiredDate"],
    deliveries: ["updatedAt", "createdAt", "date"],
    trainings: ["updatedAt", "createdAt", "trainingAt"],
    aftersales: ["updatedAt", "createdAt", "date", "promiseAt"],
    notices: ["updatedAt", "createdAt", "date", "dueDate"],
  }[moduleId] || ["updatedAt", "createdAt", "date"];
  for (const field of dateFields) {
    const value = record?.[field];
    if (!value) continue;
    const time = Date.parse(value);
    if (Number.isFinite(time)) return time;
  }
  return 0;
}

function inventoryGroupSortOrder(items) {
  return Math.min(...items.map((item) => {
    const product = productById(item.productId) || findProductByLabel(db.products, item.name, item.model);
    const productOrder = recordSortOrder(product?.sortOrder);
    return productOrder === Number.MAX_SAFE_INTEGER ? recordSortOrder(item.sortOrder) : productOrder;
  }));
}

function renderCell(moduleId, record, key) {
  const raw = fieldValue(moduleId, record, key);
  const cellClasses = [
    moduleId === "inventory" && key === "model" ? "inventory-model-cell" : "",
    key === "sku" ? "sku-cell" : "",
  ].filter(Boolean);
  const cellClass = cellClasses.length ? ` class="${cellClasses.join(" ")}"` : "";
  if (key.toLowerCase().includes("status") || key === "priority" || key === "stage") {
    return `<td${cellClass}><span class="status ${statusClass(raw)}">${escapeHtml(raw)}</span></td>`;
  }
  if (key === "available" && Number(raw) < Number(record.safeStock || 0)) {
    return `<td${cellClass}><span class="status warn">${escapeHtml(raw)}</span></td>`;
  }
  const value = escapeHtml(formatDate(raw));
  if (key === "product") return `<td class="${[...cellClasses, "product-cell"].join(" ")}" title="${value}">${value}</td>`;
  return `<td${cellClass}>${value}</td>`;
}

function renderCards(moduleId, records) {
  const selectionMode = state.bulkDelete.moduleId === moduleId;
  return `<div class="record-cards">
    ${records.length ? records.map((record) => {
      const title = record.customer || record.name || record.product || record.title || record.code || record.sku;
      const status = moduleId === "inventory" ? inventoryStatus(record) : record.status;
      return `<article class="record-card ${isArchivedRecord(moduleId, record) ? "is-archived" : ""}">
        ${selectionMode ? `<label class="record-select"><input type="checkbox" data-bulk-select="${record.id}" ${state.bulkDelete.ids.includes(record.id) ? "checked" : ""} /> 选择此记录</label>` : ""}
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
  if (moduleId === "leads" && can("salesOrders", "create") && !["已关闭", "已转销售订单"].includes(record.status) && (record.stage === "已成交" || record.status === "已成交")) {
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
      buttons.push(`<button class="primary-btn" data-check-order="${record.id}">重新核验库存</button>`);
    }
    if (record.status === "待出库") {
      const delivery = activeDeliveryForSalesOrder(record.id, record.deliveryId);
      if (delivery) {
        buttons.push(`<button class="ghost-btn" data-module="deliveries" data-view="${delivery.id}">查看出库单</button>`);
      } else if (canWorkflow("delivery_create")) {
        buttons.push(`<button class="primary-btn" data-create-delivery="${record.id}">生成出库单</button>`);
      }
    }
  }
  if (moduleId === "aftersales") {
    if (["退货", "故障", "换货"].includes(record.type) && ["待受理", "处理中", "待技术判断", "待厂家反馈"].includes(record.status) && canWorkflow("aftersales_start_return")) {
      buttons.push(`<button class="primary-btn" data-start-return="${record.id}">发起退库处理</button>`);
    }
    if (record.status === "待收货" && canWorkflow("aftersales_receive_return")) {
      buttons.push(`<button class="primary-btn" data-receive-return="${record.id}">确认收货</button>`);
    }
    if (record.status === "待质检") {
      if (canWorkflow("aftersales_quality_return")) buttons.push(`<button class="primary-btn" data-return-to-stock="${record.id}">质检合格入库</button>`);
      if (canWorkflow("aftersales_repair")) buttons.push(`<button class="ghost-btn" data-return-repair="${record.id}">转维修</button>`);
      if (canWorkflow("aftersales_scrap")) buttons.push(`<button class="danger-btn" data-return-scrap="${record.id}">确认报废</button>`);
    }
    if (record.status === "维修中") {
      if (canWorkflow("aftersales_repair")) buttons.push(`<button class="primary-btn" data-repair-to-stock="${record.id}">维修完成入库</button>`);
      if (canWorkflow("aftersales_scrap")) buttons.push(`<button class="danger-btn" data-return-scrap="${record.id}">确认报废</button>`);
    }
    if (record.status === "待换货" && canWorkflow("aftersales_replacement_delivery")) {
      buttons.push(`<button class="primary-btn" data-create-replacement="${record.id}">生成换货出库单</button>`);
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
  if (moduleId === "deliveries" && ["已出库", "配送中", "已签收", "已验收"].includes(record.status)) {
    const training = db.trainings.find((item) => item.id === record.trainingId || item.deliveryId === record.id);
    if (training) {
      buttons.push(`<button class="ghost-btn completed-action" type="button" disabled title="培训验收单 ${escapeHtml(training.code)} 已生成">已生成培训验收</button>`);
    } else if (can("trainings", "create")) {
      buttons.push(`<button class="primary-btn" data-create-training="${record.id}">生成培训验收</button>`);
    }
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
  return `<div class="table-actions">${buttons.join("")}</div>`;
}

function renderInventoryLogs() {
  const needle = state.inventoryLogSearch.trim().toLowerCase();
  const filtered = (db.inventoryLogs || []).filter((log) => !needle || [inventoryName(log.itemId), log.action, userName(log.operatorId), log.remark, log.sourceId].join(" ").toLowerCase().includes(needle));
  const pages = Math.max(1, Math.ceil(filtered.length / state.inventoryLogPageSize));
  const page = Math.min(state.inventoryLogPage, pages);
  const logs = filtered.slice((page - 1) * state.inventoryLogPageSize, page * state.inventoryLogPageSize);
  return `<section class="panel">
    <div class="panel-header"><div><h2 class="panel-title">库存流水</h2><span class="compact-note">库存变化必须可追溯到来源单据和操作人</span></div><div class="panel-tools"><input class="search-input" data-inventory-log-search placeholder="搜索产品、动作、操作人、单据号" value="${escapeHtml(state.inventoryLogSearch)}"><select class="filter-select" data-inventory-log-size><option value="20" ${state.inventoryLogPageSize === 20 ? "selected" : ""}>每页 20 条</option><option value="50" ${state.inventoryLogPageSize === 50 ? "selected" : ""}>每页 50 条</option><option value="100" ${state.inventoryLogPageSize === 100 ? "selected" : ""}>每页 100 条</option></select></div></div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>时间</th><th>产品</th><th>动作</th><th>数量</th><th>变化前</th><th>变化后</th><th>操作人</th><th>备注</th></tr></thead>
        <tbody>${logs.length ? logs.map((log) => `<tr><td>${formatDate(log.createdAt)}</td><td>${inventoryName(log.itemId)}</td><td>${log.action}</td><td>${log.quantity}</td><td>${log.beforeStock}</td><td>${log.afterStock}</td><td>${userName(log.operatorId)}</td><td>${escapeHtml(log.remark || "")}</td></tr>`).join("") : `<tr><td colspan="8" class="empty">没有符合条件的库存流水</td></tr>`}</tbody>
      </table>
    </div>
    <div class="pagination"><span>共 ${filtered.length} 条，第 ${page} / ${pages} 页</span><button class="ghost-btn" data-inventory-log-page="${page - 1}" ${page <= 1 ? "disabled" : ""}>上一页</button><button class="ghost-btn" data-inventory-log-page="${page + 1}" ${page >= pages ? "disabled" : ""}>下一页</button></div>
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
  if (moduleId === "leads") record.code = nextDocumentCode("L");
  if (moduleId === "salesOrders") record.code = nextDocumentCode("SO");
  if (moduleId === "purchases") record.code = nextDocumentCode("P");
  if (moduleId === "deliveries") record.code = nextDocumentCode("D");
  if (moduleId === "trainings") record.code = nextDocumentCode("T");
  if (moduleId === "aftersales") record.code = nextDocumentCode("A");
  if (moduleId === "products") record.code = `PROD-${Date.now().toString().slice(-8)}`;
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
  let fields = state.editing?.purchaseApprovalId
    ? (moduleFields[moduleId] || []).filter(([key]) => approvalFields.includes(key))
    : (moduleFields[moduleId] || []);
  if (multiItemModules.has(moduleId)) {
    const lineFields = moduleId === "deliveries"
      ? ["inventoryId", "quantity"]
      : ["product", "model", "quantity", "unitPrice", "totalAmount"];
    fields = fields.filter(([key]) => !lineFields.includes(key));
  }
  const defaultTitle = moduleId === "products"
    ? `${isEdit ? "编辑" : "新增"}产品/型号`
    : `${isEdit ? "编辑" : "新增"}${module.name}`;
  const title = state.editing?.title || defaultTitle;
  return `<div class="modal-backdrop">
    <form class="modal" id="recordForm" autocomplete="off" aria-autocomplete="none">
      <div class="modal-header">
        <div><h2 class="panel-title">${title}</h2><p class="compact-note">${state.editing?.purchaseApprovalId ? "请核对采购数量、供应商和预计到货日期；确认后会自动增加库存台账的在途数量。" : "关键字段会进入看板、预警和权限数据范围。"}</p></div>
        <button class="icon-btn" type="button" data-close-modal>×</button>
      </div>
      <div class="modal-body">
        <div class="form-grid">
          ${fields.map((field) => renderField(moduleId, field, record)).join("")}
        </div>
        ${multiItemModules.has(moduleId) ? renderDocumentItemEditor(moduleId, record) : ""}
      </div>
      <div class="modal-footer">
        <button class="ghost-btn" type="button" data-close-modal>取消</button>
        <button class="primary-btn" type="submit">${state.editing?.purchaseApprovalId ? "确认下单" : "保存"}</button>
      </div>
    </form>
  </div>`;
}

function renderDocumentItemEditor(moduleId, record) {
  const items = documentItems(record);
  const rows = items.length ? items : [{ id: uid("line"), product: "", productId: "", model: "", inventoryId: "", quantity: "", unitPrice: "" }];
  const productNames = productOptions();
  return `<section class="document-items span-2" data-document-items data-module="${moduleId}">
    <div class="document-items-header"><div><strong>产品明细</strong><small>可添加多个产品或规格；出库时必须全部货齐。</small></div><button type="button" class="ghost-btn" data-add-document-item>添加产品</button></div>
    <div class="document-item-list">${rows.map((item) => renderDocumentItemRow(moduleId, item, productNames)).join("")}</div>
  </section>`;
}

function renderDocumentItemRow(moduleId, item, productNames = productOptions()) {
  if (moduleId === "deliveries") {
    return `<div class="document-item-row delivery-item-row" data-document-item>
      <label>产品/规格<select data-item-inventory required autocomplete="off"><option value="">请选择库存产品</option>${db.inventory.map((inventory) => `<option value="${inventory.id}" ${item.inventoryId === inventory.id ? "selected" : ""}>${escapeHtml(inventoryLabel(inventory))}</option>`).join("")}</select></label>
      <label>数量<input data-item-quantity type="number" min="1" step="any" required autocomplete="off" value="${escapeHtml(item.quantity)}" /></label>
      <button type="button" class="icon-btn document-item-remove" data-remove-document-item aria-label="删除此产品">×</button>
    </div>`;
  }
  const models = productModelsForName(item.product, item.model);
  return `<div class="document-item-row ${moduleId === "salesOrders" ? "sales-item-row" : "purchase-item-row"}" data-document-item>
    <label>产品<select data-item-product required autocomplete="off"><option value="">请选择产品</option>${productNames.map((name) => `<option value="${escapeHtml(name)}" ${item.product === name ? "selected" : ""}>${escapeHtml(name)}</option>`).join("")}</select></label>
    <label>型号/规格<select data-item-model required autocomplete="off"><option value="">请选择型号/规格</option>${models.map((model) => `<option value="${escapeHtml(model)}" ${item.model === model ? "selected" : ""}>${escapeHtml(model)}</option>`).join("")}</select></label>
    <label>数量<input data-item-quantity type="number" min="1" step="any" required autocomplete="off" value="${escapeHtml(item.quantity)}" /></label>
    ${moduleId === "salesOrders" ? `<label>单价<input data-item-unit-price type="number" min="0" step="any" autocomplete="off" value="${escapeHtml(item.unitPrice)}" /></label>` : ""}
    <button type="button" class="icon-btn document-item-remove" data-remove-document-item aria-label="删除此产品">×</button>
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
  // Chromium 对普通 autocomplete="off" 仍可能弹出“保存的信息”。
  // 业务表单不应使用浏览器地址簿；登录页仍单独保留账号密码自动填充。
  const autofillMode = "off";
  const common = `name="${key}" ${requiredAttr} autocomplete="${autofillMode}" data-form-type="other" data-lpignore="true" data-1p-ignore="true"`;
  const span = ["textarea", "modulepermissions", "workflowactions"].includes(type) ? "span-2" : "";
  let input = "";
  if (type === "select" && key === "status" && ["salesOrders", "purchases", "deliveries"].includes(moduleId)) {
    input = `<input type="hidden" name="${key}" value="${escapeHtml(value)}" /><div class="field-readonly"><span class="status ${statusClass(value)}">${escapeHtml(value || "-")}</span><small>状态由流程按钮自动推进</small></div>`;
  } else if (type === "select") {
    const allowedOptions = key === "status" ? allowedWorkflowStatusOptions(moduleId, value, options) : options;
    input = `<select ${common}>${allowedOptions.map((op) => `<option ${String(value) === op ? "selected" : ""}>${escapeHtml(op)}</option>`).join("")}</select>`;
  } else if (type === "product") {
    input = `<select ${common}><option value="">请选择产品</option>${productOptions(value).map((op) => `<option value="${escapeHtml(op)}" ${String(value) === op ? "selected" : ""}>${escapeHtml(op)}</option>`).join("")}</select>`;
  } else if (type === "productname") {
    const names = productOptions(value);
    input = `<div class="product-name-picker" data-product-name-picker>
      <input ${common} class="product-name-input" type="text" role="combobox" aria-autocomplete="list" aria-expanded="false" value="${escapeHtml(value)}" placeholder="选择已有产品或输入新名称" />
      <button class="product-name-toggle" type="button" aria-label="展开产品名称选项">⌄</button>
      <div class="product-name-menu" role="listbox" hidden>
        ${names.map((name) => `<button type="button" class="product-name-option" role="option" data-product-name="${escapeHtml(name)}">${escapeHtml(name)}</button>`).join("")}
      </div>
    </div>`;
  } else if (type === "productsku") {
    const locked = Boolean(state.editing?.id && !isSuperAdmin());
    input = `<input ${common} class="sku-input" type="text" ${locked ? "readonly" : "data-sku-input"} value="${escapeHtml(value)}" placeholder="系统会自动建议，可首次修改" />${locked ? `<small class="field-hint">SKU 已被库存和历史流水引用，保存后不再直接修改。</small>` : `<small class="field-hint">系统会按类别和型号建议 SKU；首次保存前可自行调整。</small>`}`;
  } else if (type === "inventorysku") {
    const locked = Boolean(state.editing?.id && !isSuperAdmin());
    input = `<input ${common} class="sku-input" type="text" ${locked ? "readonly" : "data-inventory-sku-input"} value="${escapeHtml(value)}" placeholder="选择产品和型号后自动生成" />${locked ? `<small class="field-hint">已发生库存流水的 SKU 不可直接修改。</small>` : `<small class="field-hint">可在首次保存前修改；保存后将锁定。</small>`}`;
  } else if (type === "autocode") {
    input = `<input ${common} type="text" readonly value="${escapeHtml(value)}" title="由系统自动生成，创建后不可修改" />`;
  } else if (type === "model") {
    const productName = moduleId === "inventory" ? record.name : record.product;
    const models = productModelsForName(productName, value);
    input = `<select ${common} data-model-select><option value="">请选择型号/规格</option>${models.map((model) => `<option value="${escapeHtml(model)}" ${String(value) === model ? "selected" : ""}>${escapeHtml(model)}</option>`).join("")}</select>`;
  } else if (type === "lead") {
    // 来源线索只允许选择仍可转成订单的成交线索；编辑旧单时保留原关联以便追溯。
    const eligibleLeads = db.leads.filter((lead) => lead.id === value ||
      (!["已关闭", "已转销售订单"].includes(lead.status) && (lead.stage === "已成交" || lead.status === "已成交")));
    input = `<select ${common}><option value="">无</option>${eligibleLeads.map((lead) => `<option value="${lead.id}" ${value === lead.id ? "selected" : ""}>${escapeHtml(lead.code)} - ${escapeHtml(lead.customer)}</option>`).join("")}</select>`;
  } else if (type === "salesorder") {
    // 关联销售订单只展示未完成、未取消的订单；旧记录的既有关联保持可见。
    const eligibleOrders = db.salesOrders.filter((order) => order.id === value || !isArchivedRecord("salesOrders", order));
    input = `<select ${common}><option value="">无</option>${eligibleOrders.map((order) => `<option value="${order.id}" ${value === order.id ? "selected" : ""}>${escapeHtml(order.code)} - ${escapeHtml(order.customer)}</option>`).join("")}</select>`;
  } else if (type === "delivery") {
    const eligibleDeliveries = moduleId === "trainings"
      ? db.deliveries.filter((delivery) => {
        const deliveryAlreadyUsed = db.trainings.some((training) => training.deliveryId === delivery.id && training.id !== record.id);
        return (delivery.id === value || ["已出库", "配送中", "已签收"].includes(delivery.status)) && (!deliveryAlreadyUsed || delivery.id === value);
      })
      : db.deliveries;
    const emptyOption = moduleId === "trainings" ? `<option value="">不关联出库单（手工新增）</option>` : "";
    input = `<select ${common}>${emptyOption}${eligibleDeliveries.map((delivery) => `<option value="${delivery.id}" ${value === delivery.id ? "selected" : ""}>${escapeHtml(delivery.code)} · ${escapeHtml(delivery.project)} · ${escapeHtml(inventoryName(delivery.inventoryId))}</option>`).join("")}</select>`;
  } else if (type === "linkeddelivery") {
    const delivery = db.deliveries.find((item) => item.id === value);
    input = `<input type="hidden" name="${key}" value="${escapeHtml(value)}" /><div class="field-readonly">${delivery ? `<span class="status ${statusClass(delivery.status)}">${escapeHtml(delivery.code)}</span><small>${escapeHtml(delivery.status)} · ${escapeHtml(delivery.project)}</small>` : `<small>选择“需要”并保存后自动生成</small>`}</div>`;
  } else if (type === "user") {
    input = `<select ${common}>${db.users.filter((u) => u.status === "启用").map((u) => `<option value="${u.id}" ${value === u.id ? "selected" : ""}>${escapeHtml(u.name)} - ${roleName(u.role)}</option>`).join("")}</select>`;
  } else if (type === "supplier") {
    input = `<select ${common}><option value="">未指定</option>${db.suppliers.map((s) => `<option value="${s.id}" ${value === s.id ? "selected" : ""}>${escapeHtml(s.name)} - ${escapeHtml(s.product)}</option>`).join("")}</select>`;
  } else if (type === "inventory") {
    const productName = record.product || "";
    const items = productName ? inventoryOptionsForVariant(productName, record.model) : db.inventory;
    const emptyOption = required ? "" : `<option value="">未关联库存</option>`;
    input = `<select ${common} data-inventory-select>${emptyOption}${items.map((item) => `<option value="${item.id}" ${value === item.id ? "selected" : ""}>${escapeHtml(inventoryLabel(item))}</option>`).join("")}</select>`;
  } else if (type === "role") {
    input = `<select ${common}>${Object.entries(roles).map(([id, role]) => `<option value="${id}" ${value === id ? "selected" : ""}>${role.name}</option>`).join("")}</select>`;
  } else if (type === "multirole") {
    input = `<select ${common} multiple size="5">${Object.entries(roles).map(([id, role]) => `<option value="${id}" ${(value || []).includes(id) ? "selected" : ""}>${role.name}</option>`).join("")}</select>`;
  } else if (type === "modulepermissions") {
    input = renderModulePermissionEditor(record);
  } else if (type === "workflowactions") {
    input = renderWorkflowPermissionEditor(record);
  } else if (type === "textarea") {
    input = `<textarea ${common}>${escapeHtml(value)}</textarea>`;
  } else {
    const numberRules = type === "number" ? `min="${key === "quantity" ? 1 : 0}" step="any"` : "";
    input = `<input ${common} type="${type}" ${numberRules} value="${escapeHtml(value)}" />`;
  }
  const immediateField = moduleId === "leads" && ["deliveryReceiver", "deliveryAddress", "deliveryMethod", "deliveryId"].includes(key);
  return `<div class="field ${span}${immediateField ? " immediate-delivery-field" : ""}"><label>${label}${required ? " *" : ""}</label>${input}</div>`;
}

const configurableModules = () => modules.filter((module) => !["dashboard", "users"].includes(module.id));
const modulePermissionLevels = {
  none: { label: "不可见", actions: [] },
  view: { label: "仅查看", actions: ["view"] },
  edit: { label: "可编辑", actions: ["view", "create", "edit", "export"] },
};

function renderModulePermissionEditor(record) {
  if (record.role === "admin") {
    return `<div class="permission-readonly">系统管理员固定拥有全部模块和全部操作权限。</div>`;
  }
  const selected = effectiveModulePermissions(record);
  return `<div class="permission-editor module-permission-editor">
    <p>模块权限只分三档：不可见、仅查看、可编辑。删除/强制删除仍仅系统管理员可用。</p>
    <div class="permission-level-grid">${configurableModules().map((module) => {
      const actions = selected[module.id] || [];
      const level = actions.includes("edit") || actions.includes("create") ? "edit" : (actions.includes("view") ? "view" : "none");
      return `<label><span>${escapeHtml(module.name)}</span><select name="modulePermission:${module.id}">${Object.entries(modulePermissionLevels).map(([id, definition]) => `<option value="${id}" ${level === id ? "selected" : ""}>${definition.label}</option>`).join("")}</select></label>`;
    }).join("")}</div>
  </div>`;
}

function renderWorkflowPermissionEditor(record) {
  if (record.role === "admin") {
    return `<div class="permission-readonly">系统管理员固定拥有全部流程操作权限。</div>`;
  }
  const selected = Array.isArray(record.workflowActions)
    ? record.workflowActions
    : workflowActions.filter((action) => action.defaultRoles.includes(record.role)).map((action) => action.id);
  const groups = Array.from(new Set(workflowActions.map((action) => action.group)));
  return `<div class="permission-editor workflow-permission-editor">
    <p>这里决定“审批、确认出库、配送、签收”等实际流程按钮是否显示；与上方模块权限分开管理。</p>
    ${groups.map((group) => `<fieldset><legend>${escapeHtml(group)}</legend>${workflowActions.filter((action) => action.group === group).map((action) => `<label><input type="checkbox" name="workflowActions" value="${action.id}" ${selected.includes(action.id) ? "checked" : ""}>${escapeHtml(action.label)}</label>`).join("")}</fieldset>`).join("")}
  </div>`;
}

function collectModulePermissions(formData) {
  const permissions = {};
  configurableModules().forEach((module) => {
    const level = formData.get(`modulePermission:${module.id}`);
    const actions = modulePermissionLevels[level]?.actions || [];
    if (actions.length) permissions[module.id] = [...actions];
  });
  return permissions;
}

function bindModal() {
  document.querySelectorAll("[data-close-modal]").forEach((btn) => btn.addEventListener("click", closeModal));
  bindSalesOrderAmountCalculation();
  bindProductVariantLinkage();
  bindInventoryProductAutofill();
  bindProductDictionaryAutofill();
  bindProductNamePicker();
  bindSkuSuggestion();
  bindDocumentItemEditor();
  bindLeadImmediateDeliveryFields();
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
      if (type === "multirole" || type === "workflowactions") {
        next[key] = formData.getAll(key);
      } else if (type === "modulepermissions") {
        next[key] = collectModulePermissions(formData);
      } else if (type === "number") {
        const value = formData.get(key);
        next[key] = value === "" ? "" : Number(value);
      } else {
        next[key] = formData.get(key);
      }
    });
    if (multiItemModules.has(moduleId)) {
      const itemResult = collectDocumentItems(moduleId, event.currentTarget);
      if (!itemResult.ok) {
        toast(itemResult.message);
        return;
      }
      next.items = itemResult.items;
      applyLegacyItemSummary(next);
    }
    if (["leads", "salesOrders", "purchases", "trainings", "aftersales"].includes(moduleId)) {
      next.productId = findProductByLabel(db.products, next.product, next.model)?.id || "";
    }
    if (moduleId === "inventory") {
      next.productId = findProductByLabel(db.products, next.name, next.model)?.id || "";
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
      syncLeadWithSalesOrder(next);
      saveData();
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
    const linkedDelivery = moduleId === "leads" && next.deliveryId ? db.deliveries.find((delivery) => delivery.id === next.deliveryId) : null;
    toast(purchaseApprovalId ? `采购单 ${next.code} 已下单，已同步增加库存在途` : (moduleId === "salesOrders" && next.status === "已取消" && linkedLeadId ? `销售订单 ${next.code} 已取消，原线索已恢复跟进` : (sourceLeadId ? `销售订单 ${next.code} 创建成功，原线索已转销售订单` : (sourceDeliveryId ? `培训验收单 ${next.code} 创建成功` : (linkedDelivery ? `线索已保存，送样出库申请 ${linkedDelivery.code} 已推送至出库交付` : (id ? "记录已更新" : "记录已新增"))))));
    render();
  });
}

function bindLeadImmediateDeliveryFields() {
  const form = document.getElementById("recordForm");
  if (!form || state.editing?.moduleId !== "leads") return;
  const selector = form.elements.namedItem("immediateDelivery");
  const fields = [...form.querySelectorAll(".immediate-delivery-field")];
  if (!selector || !fields.length) return;
  const sync = () => fields.forEach((field) => field.classList.toggle("is-hidden", selector.value !== "需要"));
  selector.addEventListener("change", sync);
  sync();
}

function bindDocumentItemEditor() {
  const editor = document.querySelector("[data-document-items]");
  if (!editor) return;
  const moduleId = editor.dataset.module;
  const list = editor.querySelector(".document-item-list");
  const bindRow = (row) => {
    const product = row.querySelector("[data-item-product]");
    const model = row.querySelector("[data-item-model]");
    product?.addEventListener("change", () => {
      const selected = model?.value || "";
      const models = productModelsForName(product.value, selected);
      if (model) {
        model.innerHTML = `<option value="">不指定</option>${models.map((value) => `<option value="${escapeHtml(value)}" ${selected === value ? "selected" : ""}>${escapeHtml(value)}</option>`).join("")}`;
        if (!models.includes(selected) && models.length === 1) model.value = models[0];
      }
    });
    row.querySelector("[data-remove-document-item]")?.addEventListener("click", () => {
      const rows = list.querySelectorAll("[data-document-item]");
      if (rows.length === 1) {
        row.querySelectorAll("select, input").forEach((input) => { input.value = ""; });
      } else row.remove();
    });
  };
  list.querySelectorAll("[data-document-item]").forEach(bindRow);
  editor.querySelector("[data-add-document-item]")?.addEventListener("click", () => {
    list.insertAdjacentHTML("beforeend", renderDocumentItemRow(moduleId, { id: uid("line"), product: "", model: "", inventoryId: "", quantity: "", unitPrice: "" }));
    const rows = list.querySelectorAll("[data-document-item]");
    bindRow(rows[rows.length - 1]);
  });
}

function collectDocumentItems(moduleId, form) {
  const rows = [...form.querySelectorAll("[data-document-item]")];
  const items = rows.map((row) => {
    const quantity = Number(row.querySelector("[data-item-quantity]")?.value || 0);
    if (moduleId === "deliveries") {
      const inventory = db.inventory.find((item) => item.id === row.querySelector("[data-item-inventory]")?.value);
      return inventory ? { id: uid("line"), inventoryId: inventory.id, productId: inventory.productId || "", product: inventory.name, model: inventory.model, quantity, unitPrice: 0 } : { quantity };
    }
    const product = row.querySelector("[data-item-product]")?.value || "";
    const model = row.querySelector("[data-item-model]")?.value || "";
    const dictionary = findProductByLabel(db.products, product, model);
    return { id: uid("line"), productId: dictionary?.id || "", product, model, inventoryId: inventoryForProduct(product, dictionary?.id || "", model)?.id || "", quantity, unitPrice: Number(row.querySelector("[data-item-unit-price]")?.value || 0) };
  }).filter((item) => item.product || item.inventoryId || item.quantity);
  const candidate = { items };
  const validation = validateDocumentItems(moduleId, candidate);
  return validation.ok ? { ok: true, items } : validation;
}

function bindSkuSuggestion() {
  const form = document.getElementById("recordForm");
  if (!form || state.editing?.id) return;
  const sku = form.querySelector("[data-sku-input], [data-inventory-sku-input]");
  if (!sku) return;
  const update = () => {
    const isInventory = sku.hasAttribute("data-inventory-sku-input");
    const name = form.elements.namedItem(isInventory ? "name" : "name")?.value || "";
    const model = form.elements.namedItem("model")?.value || "";
    const category = form.elements.namedItem("category")?.value || "其他";
    const product = findProductByLabel(db.products, name, model);
    const suggestion = isInventory
      ? suggestedInventorySku({ name, model, category, productId: product?.id || "" }, sku.dataset.autoValue || "")
      : suggestedProductSku({ name, model, category }, sku.dataset.autoValue || "");
    if (!sku.value || sku.value === sku.dataset.autoValue) {
      sku.value = suggestion;
      sku.dataset.autoValue = suggestion;
    }
  };
  ["name", "model", "category"].forEach((fieldName) => {
    const field = form.elements.namedItem(fieldName);
    field?.addEventListener("input", update);
    field?.addEventListener("change", update);
  });
  sku.addEventListener("input", () => {
    if (sku.value !== sku.dataset.autoValue) delete sku.dataset.autoValue;
  });
  update();
}

function bindProductNamePicker() {
  const picker = document.querySelector("[data-product-name-picker]");
  if (!picker) return;
  const input = picker.querySelector(".product-name-input");
  const toggle = picker.querySelector(".product-name-toggle");
  const menu = picker.querySelector(".product-name-menu");
  const options = [...picker.querySelectorAll(".product-name-option")];
  const close = () => {
    menu.hidden = true;
    input.setAttribute("aria-expanded", "false");
  };
  const open = () => {
    const keyword = input.value.trim().toLowerCase();
    options.forEach((option) => {
      option.hidden = Boolean(keyword) && !option.dataset.productName.toLowerCase().includes(keyword);
    });
    menu.hidden = false;
    input.setAttribute("aria-expanded", "true");
  };
  input.addEventListener("focus", open);
  input.addEventListener("input", open);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Escape") close();
    if (event.key === "ArrowDown") {
      event.preventDefault();
      open();
      options.find((option) => !option.hidden)?.focus();
    }
  });
  toggle.addEventListener("click", () => (menu.hidden ? open() : close()));
  options.forEach((option) => option.addEventListener("click", () => {
    input.value = option.dataset.productName;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    close();
  }));
  document.querySelector(".modal-backdrop")?.addEventListener("pointerdown", (event) => {
    if (!picker.contains(event.target)) close();
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

function bindProductVariantLinkage() {
  const moduleId = state.editing?.moduleId;
  if (!moduleId || moduleId === "products") return;
  const form = document.getElementById("recordForm");
  const productField = form?.elements.namedItem(moduleId === "inventory" ? "name" : "product");
  const modelField = form?.elements.namedItem("model");
  if (!form || !productField || !modelField || modelField.tagName !== "SELECT") return;
  const inventoryField = form.elements.namedItem("inventoryId");

  const refreshInventory = () => {
    if (!inventoryField || inventoryField.tagName !== "SELECT") return;
    const selectedId = inventoryField.value;
    const items = inventoryOptionsForVariant(productField.value, modelField.value);
    const optional = !inventoryField.required;
    inventoryField.innerHTML = `${optional ? '<option value="">未关联库存</option>' : ""}${items.map((item) => `<option value="${item.id}">${escapeHtml(inventoryLabel(item))}</option>`).join("")}`;
    if (items.some((item) => item.id === selectedId)) inventoryField.value = selectedId;
    else if (!optional && items[0]) inventoryField.value = items[0].id;
  };
  const refreshModels = () => {
    const selectedModel = modelField.value;
    const models = productModelsForName(productField.value, selectedModel);
    modelField.innerHTML = `<option value="">请选择型号/规格</option>${models.map((model) => `<option value="${escapeHtml(model)}">${escapeHtml(model)}</option>`).join("")}`;
    if (models.includes(selectedModel)) modelField.value = selectedModel;
    else if (models[0]) modelField.value = models[0];
    refreshInventory();
  };
  productField.addEventListener("change", refreshModels);
  modelField.addEventListener("change", refreshInventory);
  refreshModels();
}

function bindInventoryProductAutofill() {
  if (state.editing?.moduleId !== "inventory") return;
  const form = document.getElementById("recordForm");
  const name = form?.elements.namedItem("name");
  if (!form || !name) return;

  const fillProductDefaults = (replaceSku = false) => {
    const product = findProductByLabel(db.products, name.value);
    if (!product) return;
    const sku = form.elements.namedItem("sku");
    const model = form.elements.namedItem("model");
    const category = form.elements.namedItem("category");
    const safeStock = form.elements.namedItem("safeStock");
    if (sku && (replaceSku || !sku.value) && product.sku) {
      sku.value = product.sku;
      sku.dataset.autoValue = product.sku;
    }
    if (model) model.value = product.model || "";
    if (category && Array.from(category.options).some((option) => option.value === product.category)) category.value = product.category;
    if (safeStock) safeStock.value = String(Number(product.safeStock || 0));
  };

  // 新增时直接按产品字典带入；编辑时只在主动换产品后更新，避免覆盖原库存资料。
  if (!state.editing.id) fillProductDefaults();
  name.addEventListener("change", () => fillProductDefaults(true));
}

function bindProductDictionaryAutofill() {
  if (state.editing?.moduleId !== "products") return;
  const form = document.getElementById("recordForm");
  const name = form?.elements.namedItem("name");
  if (!form || !name) return;
  name.addEventListener("change", () => {
    const existing = (db.products || []).find((product) => normalizedProductName(product.name) === normalizedProductName(name.value));
    if (!existing) return;
    const category = form.elements.namedItem("category");
    const unit = form.elements.namedItem("unit");
    const safeStock = form.elements.namedItem("safeStock");
    const supplier = form.elements.namedItem("supplierId");
    if (category && Array.from(category.options).some((option) => option.value === existing.category)) category.value = existing.category;
    if (unit) unit.value = existing.unit || "";
    if (safeStock) safeStock.value = String(Number(existing.safeStock || 0));
    if (supplier && Array.from(supplier.options).some((option) => option.value === existing.supplierId)) supplier.value = existing.supplierId || "";
  });
}

function closeModal() {
  document.querySelector(".modal-backdrop")?.remove();
  state.editing = null;
}

let activeModalDrag = null;

document.addEventListener("pointerdown", (event) => {
  if (window.innerWidth <= 760 || event.target.closest("button, input, select, textarea, label, a")) return;
  const header = event.target.closest(".modal-header");
  const modal = header?.closest(".modal");
  if (!modal) return;
  const rect = modal.getBoundingClientRect();
  modal.style.position = "fixed";
  modal.style.left = `${rect.left}px`;
  modal.style.top = `${rect.top}px`;
  modal.style.margin = "0";
  activeModalDrag = { modal, offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top };
  header.setPointerCapture?.(event.pointerId);
  event.preventDefault();
});

document.addEventListener("pointermove", (event) => {
  if (!activeModalDrag) return;
  const { modal, offsetX, offsetY } = activeModalDrag;
  const rect = modal.getBoundingClientRect();
  const left = Math.max(8, Math.min(event.clientX - offsetX, window.innerWidth - rect.width - 8));
  const top = Math.max(8, Math.min(event.clientY - offsetY, window.innerHeight - rect.height - 8));
  modal.style.left = `${left}px`;
  modal.style.top = `${top}px`;
});

document.addEventListener("pointerup", () => {
  activeModalDrag = null;
});

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

function syncLeadWithSalesOrder(order) {
  const lead = db.leads.find((item) => item.id === order.leadId);
  if (!lead) return;
  lead.salesOrderIds = Array.from(new Set([...(lead.salesOrderIds || []), order.id]));
  if (order.status === "已取消") {
    lead.status = "跟进中";
    lead.stage = "商务谈判";
    lead.closedAt = "";
    logAction("reopen", "leads", lead.id, `销售订单 ${order.code} 已作废，线索恢复为商务谈判`);
  } else {
    lead.status = "已转销售订单";
    lead.stage = "已成交";
    lead.transferredAt = nowIso();
    logAction("transfer", "leads", lead.id, `已生成销售订单 ${order.code}`);
  }
  lead.updatedAt = nowIso();
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

function createImmediateDeliveryFromLead(lead) {
  if (!lead || lead.immediateDelivery !== "需要") return null;
  const existing = db.deliveries.find((delivery) => delivery.sourceLeadId === lead.id && delivery.status !== "已取消");
  if (existing) {
    lead.deliveryId = existing.id;
    return existing;
  }
  const product = findProductByLabel(db.products, lead.product, lead.model);
  const inventory = inventoryForProduct(lead.product, product?.id || "", lead.model);
  const delivery = getDefaultRecord("deliveries");
  Object.assign(delivery, {
    date: today,
    project: lead.customer,
    address: lead.deliveryAddress || "",
    type: "送样",
    items: [{
      id: uid("line"),
      productId: product?.id || "",
      product: lead.product,
      model: lead.model,
      inventoryId: inventory?.id || "",
      quantity: Number(lead.quantity || 0),
      unitPrice: 0,
    }],
    receiver: lead.deliveryReceiver || lead.contact || "",
    owner: lead.owner,
    shipMethod: lead.deliveryMethod || "快递",
    training: "待确认",
    status: "待出库",
    sourceLeadId: lead.id,
    remark: `由线索 ${lead.code} 的即时送样申请自动生成`,
  });
  applyLegacyItemSummary(delivery);
  db.deliveries.unshift(delivery);
  lead.deliveryId = delivery.id;
  logAction("create", "deliveries", delivery.id, `由线索 ${lead.code} 自动生成送样出库申请`);
  logAction("link", "leads", lead.id, `已关联送样出库单 ${delivery.code}`);
  return delivery;
}

function saveRecord(moduleId, id, record) {
  const documentValidation = validateDocumentItems(moduleId, record);
  if (!documentValidation.ok) return documentValidation;
  const dataValidation = validateRecordData(moduleId, record);
  if (!dataValidation.ok) return dataValidation;
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
  const skuChanged = Boolean(oldRecord && ["products", "inventory"].includes(moduleId) && oldRecord.sku !== record.sku);
  if (skuChanged && !isSuperAdmin()) {
    return { ok: false, message: "只有系统管理员可以修改已建立产品或库存的 SKU/货号。" };
  }
  if (moduleId === "users" && oldRecord?.role === "admin" && oldRecord.status === "启用" && (record.role !== "admin" || record.status !== "启用")) {
    const remainingAdmins = db.users.filter((user) => user.id !== oldRecord.id && user.role === "admin" && user.status === "启用");
    if (!remainingAdmins.length) return { ok: false, message: "系统至少需要保留一名启用的系统管理员，不能降级或禁用最后一名管理员。" };
  }
  if (moduleId === "salesOrders" && oldRecord) {
    const validation = validateSalesOrderRollback(record, oldRecord);
    if (!validation.ok) return validation;
  }
  if (moduleId === "purchases" && oldRecord && oldRecord.status !== "已到货" && record.status === "已到货") {
    return { ok: false, message: "采购到货必须使用“确认到货入库”按钮，确保库存和流水在服务器事务中同步。" };
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
    const productIdentityChanged = moduleId === "products" && ["sku", "name", "model", "category"].some((key) => oldRecord[key] !== record[key]);
    if (productIdentityChanged || skuChanged) syncSkuChange(moduleId, oldRecord, record);
    const index = db[collection].findIndex((r) => r.id === id);
    db[collection][index] = record;
    logAction("update", moduleId, id, moduleId === "users" ? "更新员工账号或权限配置" : "编辑记录");
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
  if (moduleId === "leads") createImmediateDeliveryFromLead(record);
  if (moduleId === "salesOrders" && oldRecord) reconcileSalesOrderWorkflow(record, oldRecord);
  if (moduleId === "purchases" && oldRecord) reconcilePurchaseWorkflow(record, oldRecord);
  if (moduleId === "deliveries" && oldRecord) reconcileDeliveryWorkflow(record, oldRecord);
  saveData();
  return { ok: true };
}

function addSkuHistory(record, oldSku) {
  if (!oldSku || oldSku === record.sku) return;
  record.skuHistory = [...(record.skuHistory || []), { sku: oldSku, changedAt: nowIso(), changedBy: state.currentUser?.id || "" }];
}

function syncSkuChange(moduleId, oldRecord, record) {
  if (moduleId === "products") {
    const changedFields = [];
    if (oldRecord.sku !== record.sku) {
      addSkuHistory(record, oldRecord.sku);
      changedFields.push("货号");
    }
    if (oldRecord.name !== record.name) changedFields.push("产品名称");
    if (oldRecord.model !== record.model) changedFields.push("规格");
    if (oldRecord.category !== record.category) changedFields.push("类别");
    db.inventory.forEach((item) => {
      const belongsToProduct = item.productId === oldRecord.id
        || (normalizedProductName(item.name) === normalizedProductName(oldRecord.name) && item.model === oldRecord.model);
      if (!belongsToProduct) return;
      if (item.sku !== record.sku) addSkuHistory(item, item.sku);
      syncInventoryIdentityFromProduct(item, record);
      item.updatedAt = nowIso();
    });
    logAction("update", "products", oldRecord.id, `产品字典已更新${changedFields.length ? `（${changedFields.join("、")}）` : ""}，关联库存已同步`);
    return;
  }
  addSkuHistory(record, oldRecord.sku);
  const product = productById(record.productId)
    || findProductByLabel(db.products, oldRecord.name, oldRecord.model);
  if (product) {
    addSkuHistory(product, product.sku);
    product.sku = record.sku;
    product.updatedAt = nowIso();
  }
  logAction("update", "inventory", oldRecord.id, `管理员将 SKU 从 ${oldRecord.sku} 修改为 ${record.sku}，产品字典已同步`);
}

function validateRecordData(moduleId, record) {
  const positiveKeys = new Set(["quantity"]);
  for (const [key, label, type, required] of (moduleFields[moduleId] || [])) {
    const value = record[key];
    if (required && (value === "" || value === null || value === undefined || (typeof value === "string" && !value.trim()))) {
      return { ok: false, message: `请填写“${label}”` };
    }
    if (type === "number" && value !== "" && value !== null && value !== undefined) {
      const number = Number(value);
      if (!Number.isFinite(number) || number < 0) return { ok: false, message: `“${label}”不能填写负数或无效数字` };
      if (positiveKeys.has(key) && number <= 0 && (required || value !== "")) return { ok: false, message: `“${label}”必须大于 0` };
    }
  }
  if (moduleId === "leads" && record.immediateDelivery === "需要") {
    if (!String(record.model || "").trim()) return { ok: false, message: "即时出库必须选择“设备型号/规格”，才能准确匹配库存" };
    if (!Number.isFinite(Number(record.quantity)) || Number(record.quantity) <= 0) return { ok: false, message: "即时出库必须填写大于 0 的预计数量" };
  }
  if (moduleId === "products") {
    const duplicateVariant = (db.products || []).find((product) => product.id !== record.id
      && normalizedProductName(product.name) === normalizedProductName(record.name)
      && String(product.model || "").trim() === String(record.model || "").trim());
    if (duplicateVariant) return { ok: false, message: `产品字典中已有“${record.name} / ${record.model}”，请不要重复新增` };
    const duplicateSku = (db.products || []).find((product) => product.id !== record.id && product.sku === record.sku);
    if (duplicateSku) return { ok: false, message: `SKU/货号“${record.sku}”已存在，请使用新的 SKU` };
  }
  if (moduleId === "inventory") {
    const duplicateSku = (db.inventory || []).find((item) => item.id !== record.id && item.sku === record.sku);
    if (duplicateSku) return { ok: false, message: `SKU/货号“${record.sku}”已被其他库存占用` };
  }
  if (moduleId === "trainings") {
    const duplicatedDelivery = record.deliveryId && (db.trainings || []).find((training) => training.id !== record.id && training.deliveryId === record.deliveryId);
    if (duplicatedDelivery) return { ok: false, message: `出库单已关联培训验收单 ${duplicatedDelivery.code}，不能重复创建` };
  }
  return { ok: true };
}

function removeRecord(moduleId, id) {
  const collection = collectionFor(moduleId);
  const record = (db[collection] || []).find((item) => item.id === id);
  if (!record) return;
  const actionName = moduleId === "leads" ? "关闭线索" : "作废";
  confirmAction(`确认${actionName}`, `确认${actionName}这条记录？操作会保留业务追溯，不能恢复为彻底删除。`, () => voidRecord(moduleId, id));
}

function deleteBlockReason(moduleId, record) {
  if (moduleId === "products") {
    const usedByInventory = db.inventory.some((item) => item.productId === record.id || (normalizedProductName(item.name) === normalizedProductName(record.name) && item.model === record.model));
    const usedByBusiness = ["leads", "salesOrders", "purchases", "trainings", "aftersales"].some((collection) =>
      db[collection].some((item) => item.productId === record.id || (normalizedProductName(item.product) === normalizedProductName(record.name) && item.model === record.model)));
    if (usedByInventory || usedByBusiness) return "产品已关联库存或业务单据，不能删除；请改为停用。";
  }
  if (moduleId === "inventory") {
    if (Number(record.stock || 0) || Number(record.locked || 0) || Number(record.inTransit || 0)) return "库存数量、锁定数量或在途数量不为 0，不能删除。";
    const hasHistory = db.inventoryLogs.some((log) => log.itemId === record.id)
      || db.deliveries.some((item) => item.inventoryId === record.id)
      || db.aftersales.some((item) => item.inventoryId === record.id);
    if (hasHistory) return "该库存已有出入库或售后记录，不能删除。";
  }
  return "";
}

function deleteSelectedRecords(moduleId) {
  if (!isSuperAdmin()) {
    toast("只有系统管理员可以删除产品或库存。");
    return;
  }
  const ids = state.bulkDelete.ids;
  const collection = collectionFor(moduleId);
  const records = (db[collection] || []).filter((record) => ids.includes(record.id));
  if (!records.length) return;
  const blocked = records.map((record) => ({ record, reason: deleteBlockReason(moduleId, record) })).filter((item) => item.reason);
  if (blocked.length) {
    toast(`无法删除：${blocked[0].record.name || blocked[0].record.sku}，${blocked[0].reason}`);
    return;
  }
  confirmAction(`删除${moduleId === "products" ? "产品/型号" : "库存"}`, `确认删除选中的 ${records.length} 条记录吗？删除后不能恢复。已有业务关联的记录不会允许删除。`, () => {
    db[collection] = db[collection].filter((record) => !ids.includes(record.id));
    records.forEach((record) => logAction("delete", moduleId, record.id, "管理员删除未关联记录"));
    state.bulkDelete = { moduleId: null, ids: [], mode: null };
    saveData();
    toast(`已删除 ${records.length} 条记录`);
    render();
  });
}

function forceDeleteSelectedRecords(moduleId) {
  if (!isSuperAdmin()) {
    toast("只有系统管理员可以强制删除记录。");
    return;
  }
  const collection = collectionFor(moduleId);
  const ids = state.bulkDelete.ids;
  const records = (db[collection] || []).filter((record) => ids.includes(record.id));
  if (!records.length) return;
  if (moduleId === "users" && records.some((record) => record.id === state.currentUser?.id)) {
    toast("不能强制删除当前登录的系统管理员账号。");
    return;
  }
  if (moduleId === "users") {
    const deleted = new Set(ids);
    const remainingAdmins = db.users.filter((user) => !deleted.has(user.id) && user.role === "admin" && user.status === "启用");
    if (!remainingAdmins.length) {
      toast("系统至少需要保留一名启用的系统管理员。");
      return;
    }
  }
  confirmAction("强制删除记录", `确认永久删除选中的 ${records.length} 条记录吗？该操作会绕过关联检查，历史单据将保留原内容但不再能打开对应资料，不能恢复。`, () => {
    db[collection] = db[collection].filter((item) => !ids.includes(item.id));
    records.forEach((record) => {
      const label = record.code || record.sku || record.name || record.customer || record.title || record.id;
      logAction("delete", moduleId, record.id, `管理员强制删除：${label}`);
    });
    state.bulkDelete = { moduleId: null, ids: [], mode: null };
    state.forceDelete = { moduleId, ids, requestedBy: state.currentUser.id };
    saveData();
    toast(`已强制删除 ${records.length} 条；历史流水和单据内容保持不变。`);
    render();
  });
}

function voidRecord(moduleId, id) {
  const collection = collectionFor(moduleId);
  const record = (db[collection] || []).find((item) => item.id === id);
  if (!record) return;
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
    syncLeadWithSalesOrder(cancelled);
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
  const amount = Number(quantity);
  if (!item || !Number.isFinite(amount) || amount <= 0) return false;
  const before = Number(item.stock || 0);
  if (action === "出库" && before < amount) return false;
  const after = action === "入库" ? before + amount : before - amount;
  item.stock = after;
  item.updatedAt = nowIso();
  db.inventoryLogs.unshift({
    id: uid("log"),
    itemId,
    action,
    quantity: amount,
    beforeStock: before,
    afterStock: after,
    sourceType: sourceType || (action === "入库" ? "purchase" : "delivery"),
    sourceId,
    operatorId: state.currentUser.id,
    createdAt: nowIso(),
    remark,
  });
  logAction(action, "inventory", itemId, remark);
  return true;
}

async function receivePurchase(purchase) {
  if (SERVER_MODE) {
    try {
      const { response, payload } = await receivePurchaseRequest(purchase.id);
      if (!response.ok || !payload.ok) throw new Error(payload.message || payload.error || "采购到货入库失败");
      db = await loadData();
      return true;
    } catch (error) {
      toast(error.message || "采购到货入库失败，请刷新后重试");
      return false;
    }
  }
  const itemValidation = validateDocumentItems("purchases", purchase);
  if (!itemValidation.ok) {
    toast(`${itemValidation.message}，不能确认到货入库`);
    return false;
  }
  const items = documentItems(purchase);
  const inventoryLines = [];
  for (const line of items) {
    let item = inventoryForProduct(line.product, line.productId, line.model);
    if (!item) {
      const proposed = ensureInventoryForProduct(line.product, line.productId, line.model);
      try {
        const ensured = await ensureInventoryOnServer(proposed);
        item = ensured.item;
        const localIndex = db.inventory.findIndex((candidate) => candidate.id === proposed.id);
        if (localIndex >= 0) db.inventory[localIndex] = item;
        else db.inventory.unshift(item);
        if (Number.isFinite(ensured.revision)) db.meta = { ...(db.meta || {}), revision: ensured.revision };
      } catch (error) {
        toast(error.message || "建立采购库存记录失败");
        return false;
      }
    }
    inventoryLines.push({ line, item });
  }
  let results;
  if (!purchase.receivedApplied) {
    try {
      const payload = await adjustInventoryOnServer(inventoryLines.map(({ line, item }) => ({ inventoryId: item.id, delta: Number(line.quantity || 0), action: "入库", remark: `采购到货 ${purchase.code}` })), purchase.id, "purchase");
      results = payload.results;
      if (Number.isFinite(payload.revision)) db.meta = { ...(db.meta || {}), revision: payload.revision };
    } catch (error) {
      toast(error.message || "采购到货入库失败，请刷新后重试");
      return false;
    }
    results.forEach((result) => {
      const item = db.inventory.find((candidate) => candidate.id === result.inventoryId);
      if (item) { item.stock = result.afterStock; item.updatedAt = nowIso(); }
      db.inventoryLogs.unshift({ id: result.movementId, itemId: result.inventoryId, action: result.action, quantity: result.quantity, beforeStock: result.beforeStock, afterStock: result.afterStock, sourceId: purchase.id, sourceType: "purchase", operatorId: state.currentUser.id, createdAt: nowIso(), remark: result.remark });
    });
    purchase.receivedApplied = true;
  }
  if (purchase.inTransitApplied && !purchase.inTransitCleared) {
    items.forEach((line) => {
      const item = ensureInventoryForProduct(line.product, line.productId, line.model);
      item.inTransit = Math.max(0, Number(item.inTransit || 0) - Number(line.quantity || 0));
      if (Number(item.inTransit || 0) === 0) item.eta = "";
      item.updatedAt = nowIso();
    });
    purchase.inTransitCleared = true;
    logAction("in_transit_clear", "inventory", purchase.id, `采购单 ${purchase.code} 到货，关联库存在途已减少`);
  }
  if (purchase.sourceSalesOrderId) {
    const order = db.salesOrders.find((candidate) => candidate.id === purchase.sourceSalesOrderId);
    if (order && order.status !== "已取消") {
      order.status = orderInventoryCheck(order).ready ? "待出库" : "待采购到货";
      order.updatedAt = nowIso();
      logAction("purchase_received", "salesOrders", order.id, order.status === "待出库" ? `关联采购单 ${purchase.code} 已到货，订单全部货齐进入待出库` : `关联采购单 ${purchase.code} 已到货，订单仍有产品待到货`);
    }
  }
  return true;
}

function ensureInventoryForProduct(productName, productId = "", model = "") {
  const existing = inventoryForProduct(productName, productId, model);
  if (existing) return existing;
  const product = productById(productId) || findProductByLabel(db.products, productName, model) || {};
  const item = {
    id: uid("inv"),
    productId: product.id || productId || "",
    sku: product.sku || suggestedInventorySku({ productId: product.id || productId, name: product.name || productName, model: product.model || model, category: product.category || "其他" }),
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
    model: lead.model || product?.model || "",
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
  logAction("approve", "salesOrders", order.id, "销售订单审批通过，系统开始核验库存");
  // 库存核验是系统规则，不要求销售、仓库再重复点一次。
  // 库存不足自动转采购，货齐则进入待出库；待库存确认仅保留给历史异常单据重新核验。
  checkSalesOrderInventory(order.id, { automatic: true });
}

function checkSalesOrderInventory(orderId, { automatic = false } = {}) {
  const order = db.salesOrders.find((item) => item.id === orderId);
  if (!order || order.status !== "待库存确认" || (!automatic && !canWorkflow("inventory_check"))) return;
  const itemValidation = validateDocumentItems("salesOrders", order);
  if (!itemValidation.ok) return toast(itemValidation.message);
  const inventoryCheck = orderInventoryCheck(order);
  if (inventoryCheck.ready) {
    linkedToSalesOrder("purchases", order.id)
      .filter((purchase) => reversiblePurchaseStatuses.includes(purchase.status))
      .forEach((purchase) => {
        cancelRecord(purchase, `销售订单 ${order.code} 重新检查库存后已满足，无需采购`);
        logAction("cancel", "purchases", purchase.id, "库存已满足，自动作废待处理采购申请");
      });
    order.status = "待出库";
    order.items = inventoryCheck.readyItems;
    applyLegacyItemSummary(order);
    order.updatedAt = nowIso();
    logAction("inventory_check", "salesOrders", order.id, `订单 ${documentItems(order).length} 项产品库存均充足，可一次性出库`);
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
      items: inventoryCheck.shortages.map((line) => ({ ...line, quantity: Number(line.shortage || line.quantity || 0) })),
      project: order.customer,
      requiredDate: order.deliveryDate,
      sourceSalesOrderId: order.id,
      status: "待采购审批",
      remark: `销售订单 ${order.code} 库存不足自动生成，等待有采购权限的人员审批`,
    });
    applyLegacyItemSummary(purchase);
    db.purchases.unshift(purchase);
    logAction("create", "purchases", purchase.id, `销售订单 ${order.code} 缺货自动生成采购申请`);
  }
  logAction("inventory_shortage", "salesOrders", order.id, `有 ${inventoryCheck.shortages.length} 项产品库存不足，已生成采购申请`);
  saveData();
  toast(automatic ? "审批通过，库存不足，已生成采购申请" : "库存不足，已生成采购申请");
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
  const itemValidation = validateDocumentItems("purchases", purchase);
  if (!itemValidation.ok) return itemValidation;
  purchase.status = "已下单";
  purchase.approvedBy = state.currentUser.id;
  purchase.approvedAt = nowIso();
  purchase.updatedAt = nowIso();
  purchase.inTransitApplied = true;
  const index = db.purchases.findIndex((item) => item.id === oldPurchase.id);
  if (index < 0) return { ok: false, message: "采购单不存在或已被修改，请刷新后重试" };
  db.purchases[index] = purchase;
  documentItems(purchase).forEach((line) => {
    const inventory = ensureInventoryForProduct(line.product, line.productId, line.model);
    inventory.inTransit = Number(inventory.inTransit || 0) + Number(line.quantity || 0);
    inventory.eta = purchase.estimatedDate;
    inventory.updatedAt = nowIso();
  });
  const order = db.salesOrders.find((item) => item.id === purchase.sourceSalesOrderId);
  if (order) {
    order.status = "待采购到货";
    order.updatedAt = nowIso();
  }
  logAction("approve", "purchases", purchase.id, `采购审批通过并下单，${documentItems(purchase).length} 项产品已增加在途，预计到货 ${purchase.estimatedDate}`);
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
  const itemValidation = validateDocumentItems("purchases", purchase);
  if (!itemValidation.ok) return toast(itemValidation.message);
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
  if (!order) return;
  if (order.status !== "待出库") {
    toast(`当前订单状态为“${order.status}”，暂不能生成出库单`);
    return;
  }
  if (!canWorkflow("delivery_create")) {
    toast("你没有生成出库单的权限，请联系仓库或管理员");
    return;
  }
  const existing = activeDeliveryForSalesOrder(order.id, order.deliveryId);
  if (existing) {
    order.deliveryId = existing.id;
    toast(`该订单已有出库单 ${existing.code}，请从“查看出库单”进入处理`);
    render();
    return;
  }
  const itemValidation = validateDocumentItems("salesOrders", order);
  if (!itemValidation.ok) return toast(itemValidation.message);
  const inventoryCheck = orderInventoryCheck(order);
  if (!inventoryCheck.ready) {
    toast(`仍有 ${inventoryCheck.shortages.length} 项产品库存不足，暂不能出库；本订单必须全部货齐后一次性发货。`);
    return;
  }
  const delivery = getDefaultRecord("deliveries");
  Object.assign(delivery, {
    date: today,
    project: order.customer,
    type: "销售交付",
    items: inventoryCheck.readyItems,
    receiver: order.contact,
    owner: order.owner,
    sourceSalesOrderId: order.id,
    training: "待确认",
    status: "待出库",
    remark: `由销售订单 ${order.code} 自动生成`,
  });
  applyLegacyItemSummary(delivery);
  db.deliveries.unshift(delivery);
  order.deliveryId = delivery.id;
  order.updatedAt = nowIso();
  logAction("create", "deliveries", delivery.id, `由销售订单 ${order.code} 生成出库单`);
  saveData();
  toast(`已生成出库单 ${delivery.code}`);
  render();
}

function activeDeliveryForSalesOrder(orderId, deliveryId = "") {
  const byId = deliveryId ? db.deliveries.find((delivery) => delivery.id === deliveryId) : null;
  if (byId && !["异常", "已取消"].includes(byId.status)) return byId;
  return db.deliveries.find((delivery) => delivery.sourceSalesOrderId === orderId && !["异常", "已取消"].includes(delivery.status)) || null;
}

async function confirmDeliveryOutbound(deliveryId) {
  const delivery = db.deliveries.find((item) => item.id === deliveryId);
  if (!delivery || delivery.status !== "待出库" || !canWorkflow("delivery_outbound")) return;
  if (SERVER_MODE) {
    try {
      const { response, payload } = await outboundDelivery(delivery.id);
      if (!response.ok || !payload.ok) throw new Error(payload.message || payload.error || "库存扣减失败");
      db = await loadData();
      toast("已出库，库存已自动扣减");
      render();
    } catch (error) { toast(error.message || "库存扣减失败，请刷新后重试"); }
    return;
  }
  const itemValidation = validateDocumentItems("deliveries", delivery);
  if (!itemValidation.ok) return toast(itemValidation.message);
  const items = deliveryItems(delivery);
  const insufficient = items.find((line) => {
    const inventory = db.inventory.find((item) => item.id === line.inventoryId);
    return !inventory || availableStock(inventory) < Number(line.quantity || 0);
  });
  if (insufficient) return toast(`库存不足：${itemLabel(insufficient)}，本出库单必须全部货齐后一次性发货。`);
  let results;
  try {
    const payload = await adjustInventoryOnServer(items.map((line) => ({ inventoryId: line.inventoryId, delta: -Number(line.quantity || 0), action: "出库", remark: `出库单 ${delivery.code}` })), delivery.id, "delivery");
    results = payload.results;
    if (Number.isFinite(payload.revision)) db.meta = { ...(db.meta || {}), revision: payload.revision };
  } catch (error) {
    toast(error.message || "库存扣减失败，请刷新后重试");
    return;
  }
  results.forEach((result) => {
    const item = db.inventory.find((candidate) => candidate.id === result.inventoryId);
    if (item) { item.stock = result.afterStock; item.updatedAt = nowIso(); }
    db.inventoryLogs.unshift({ id: result.movementId, itemId: result.inventoryId, action: result.action, quantity: result.quantity, beforeStock: result.beforeStock, afterStock: result.afterStock, sourceId: delivery.id, sourceType: "delivery", operatorId: state.currentUser.id, createdAt: nowIso(), remark: result.remark });
  });
  delivery.items = items;
  applyLegacyItemSummary(delivery);
  delivery.status = "已出库";
  delivery.outboundAt = nowIso();
  delivery.updatedAt = nowIso();
  const order = db.salesOrders.find((candidate) => candidate.id === delivery.sourceSalesOrderId);
  if (order) {
    order.status = "已出库";
    order.updatedAt = nowIso();
  }
  const afterSales = db.aftersales.find((candidate) => candidate.id === delivery.sourceAfterSalesId);
  if (afterSales) {
    afterSales.status = "已换货";
    afterSales.result = `换货设备已出库，出库单 ${delivery.code}`;
    afterSales.updatedAt = nowIso();
    logAction("replacement_outbound", "aftersales", afterSales.id, `换货出库单 ${delivery.code} 已确认出库`);
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
  const item = db.inventory.find((inventory) => inventory.id === delivery.inventoryId);
  const training = getDefaultRecord("trainings");
  Object.assign(training, {
    deliveryId: delivery.id,
    customer: delivery.project,
    product: item?.name || "",
    productId: item?.productId || "",
    model: item?.model || "",
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

function getAfterSalesReturnRecord(id) {
  return db.aftersales.find((record) => record.id === id) || null;
}

function openAfterSalesInventoryDialog(id, action) {
  const record = getAfterSalesReturnRecord(id);
  if (!record) return toast("售后工单不存在");
  if (!db.inventory.length) return toast("当前没有可选择的库存产品，请先建立库存台账。");
  const actionName = action === "replacement" ? "生成换货出库单" : (action === "repair-return" ? "维修完成入库" : "质检合格入库");
  const preferred = db.inventory.filter((item) => item.name === record.product && (!record.model || item.model === record.model));
  const options = [...preferred, ...db.inventory.filter((item) => !preferred.some((preferredItem) => preferredItem.id === item.id))]
    .map((item) => `<option value="${item.id}" ${item.id === record.inventoryId ? "selected" : ""}>${escapeHtml(inventoryLabel(item))}</option>`).join("");
  document.body.insertAdjacentHTML("beforeend", `<div class="modal-backdrop" data-aftersales-inventory-dialog>
    <section class="modal confirm-modal">
      <div class="modal-header"><div><h2 class="panel-title">${actionName}</h2><p class="compact-note">仅本次实际入库或换货时选择产品和数量；售后工单本身无需关联库存。</p></div><button class="icon-btn" type="button" data-close-aftersales-inventory>×</button></div>
      <form data-aftersales-inventory-form><div class="modal-body"><div class="form-grid">
        <label>实际处理产品/规格 *<select name="inventoryId" required>${options}</select></label>
        <label>实际处理数量 *<input name="quantity" type="number" min="1" step="1" required value="${escapeHtml(record.quantity || 1)}"></label>
      </div></div><div class="modal-footer"><button class="ghost-btn" type="button" data-close-aftersales-inventory>取消</button><button class="primary-btn" type="submit">确认${actionName}</button></div></form>
    </section>
  </div>`);
  const close = () => document.querySelector("[data-aftersales-inventory-dialog]")?.remove();
  document.querySelectorAll("[data-close-aftersales-inventory]").forEach((button) => button.addEventListener("click", close));
  document.querySelector("[data-aftersales-inventory-form]")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const selection = { inventoryId: form.inventoryId.value, quantity: Number(form.quantity.value) };
    close();
    confirmAction(actionName, `确认本次按所选产品处理 ${selection.quantity} 件吗？`, () => {
      if (action === "replacement") createReplacementDelivery(id, selection);
      else returnAfterSalesToStock(id, selection);
    });
  });
}

function validateAfterSalesInventory(record, selection = {}) {
  const quantity = Number((selection.quantity ?? record.quantity) || 0);
  const inventoryId = selection.inventoryId || record.inventoryId;
  const item = db.inventory.find((inventory) => inventory.id === inventoryId);
  if (!item || quantity <= 0) return { ok: false, message: "请选择实际处理的产品/规格，并填写大于 0 的数量。" };
  return { ok: true, item, quantity };
}

function startAfterSalesReturn(id) {
  const record = getAfterSalesReturnRecord(id);
  if (!record) return toast("售后工单不存在");
  record.status = "待收货";
  record.returnStartedAt = nowIso();
  record.updatedAt = nowIso();
  logAction("return_start", "aftersales", record.id, `售后单 ${record.code} 已发起退库，等待仓库收货`);
  saveData();
  toast("已发起退库处理，等待仓库确认收货");
  render();
}

function receiveAfterSalesReturn(id) {
  const record = getAfterSalesReturnRecord(id);
  if (!record || record.status !== "待收货") return;
  record.status = "待质检";
  record.receivedAt = nowIso();
  record.updatedAt = nowIso();
  logAction("return_receive", "aftersales", record.id, `售后单 ${record.code} 已收货，等待质检决定`);
  saveData();
  toast("已确认收货，请进行质检处理");
  render();
}

function setAfterSalesDisposition(id, status, message) {
  const record = getAfterSalesReturnRecord(id);
  if (!record) return;
  record.status = status;
  record.result = message;
  record.updatedAt = nowIso();
  logAction(status === "已报废" ? "scrap" : "repair", "aftersales", record.id, `售后单 ${record.code}${message}`);
  saveData();
  toast(message);
  render();
}

async function returnAfterSalesToStock(id, selection = {}) {
  const record = getAfterSalesReturnRecord(id);
  const validation = record ? validateAfterSalesInventory(record, selection) : { ok: false, message: "售后工单不存在" };
  if (!validation.ok) return toast(validation.message);
  if (record.returnStockApplied) return toast("该售后单已完成退库，不能重复增加库存");
  let results;
  try {
    const payload = await adjustInventoryOnServer([{ inventoryId: validation.item.id, delta: validation.quantity, action: "入库", remark: `售后退库 ${record.code}` }], record.id, "aftersales");
    results = payload.results;
    if (Number.isFinite(payload.revision)) db.meta = { ...(db.meta || {}), revision: payload.revision };
  } catch (error) {
    toast(error.message || "售后退库失败，请刷新后重试");
    return;
  }
  const result = results[0];
  validation.item.stock = result.afterStock;
  validation.item.updatedAt = nowIso();
  db.inventoryLogs.unshift({ id: result.movementId, itemId: validation.item.id, action: result.action, quantity: result.quantity, beforeStock: result.beforeStock, afterStock: result.afterStock, sourceId: record.id, sourceType: "aftersales", operatorId: state.currentUser.id, createdAt: nowIso(), remark: result.remark });
  record.inventoryId = validation.item.id;
  record.quantity = validation.quantity;
  record.returnStockApplied = true;
  record.returnedAt = nowIso();
  record.status = record.type === "换货" ? "待换货" : "已退库";
  record.result = record.type === "换货" ? "旧设备已退库，等待生成换货出库单" : "质检合格，已退回库存";
  record.updatedAt = nowIso();
  logAction("return_stock", "aftersales", record.id, `售后单 ${record.code} 已入库 ${validation.quantity} 件`);
  saveData();
  toast(record.type === "换货" ? "旧设备已退库，可生成换货出库单" : "质检合格，已退回库存");
  render();
}

function createReplacementDelivery(id, selection = {}) {
  const record = getAfterSalesReturnRecord(id);
  const validation = record ? validateAfterSalesInventory(record, selection) : { ok: false, message: "售后工单不存在" };
  if (!validation.ok) return toast(validation.message);
  if (db.deliveries.some((delivery) => delivery.sourceAfterSalesId === record.id && delivery.status !== "已取消")) return toast("该售后单已生成换货出库单");
  if (availableStock(validation.item) < validation.quantity) return toast(`库存不足：${validation.item.name} 可用 ${availableStock(validation.item)}，无法换货出库 ${validation.quantity}`);
  record.replacementInventoryId = validation.item.id;
  record.replacementQuantity = validation.quantity;
  const delivery = getDefaultRecord("deliveries");
  Object.assign(delivery, {
    project: record.customer,
    type: "售后换货",
    inventoryId: validation.item.id,
    quantity: validation.quantity,
    receiver: record.customer,
    owner: record.owner,
    tested: "是",
    systemReady: "不适用",
    training: "不需要",
    status: "待出库",
    sourceAfterSalesId: record.id,
    remark: `由售后工单 ${record.code} 生成换货出库`,
  });
  db.deliveries.unshift(delivery);
  record.replacementDeliveryId = delivery.id;
  record.status = "换货待出库";
  record.updatedAt = nowIso();
  logAction("replacement_create", "aftersales", record.id, `已生成换货出库单 ${delivery.code}`);
  logAction("create", "deliveries", delivery.id, `由售后工单 ${record.code} 生成换货出库单`);
  saveData();
  toast(`换货出库单 ${delivery.code} 已生成，等待仓库确认出库`);
  render();
}

function adjustStock(itemId, action, amount) {
  const item = db.inventory.find((i) => i.id === itemId);
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
  const limit = action === "出库" ? `max="${available}"` : "";
  const note = action === "出库"
    ? `当前库存 ${item.stock}，已锁定 ${item.locked}，本次最多可出 ${available}。`
    : `当前库存 ${item.stock}，请填写本次实际入库数量。`;
  document.body.insertAdjacentHTML("beforeend", `<div class="modal-backdrop" data-stock-adjustment><section class="modal confirm-modal"><div class="modal-header"><div><h2 class="panel-title">手动${escapeHtml(action)}</h2><p class="compact-note">${escapeHtml(item.name)}：${escapeHtml(note)}</p></div><button class="icon-btn" type="button" data-close-stock-adjustment>×</button></div><form id="stockAdjustmentForm"><div class="modal-body"><div class="field"><label>${escapeHtml(action)}数量 *</label><input name="quantity" type="number" min="1" step="1" ${limit} required autofocus value="1"></div></div><div class="modal-footer"><button class="ghost-btn" type="button" data-close-stock-adjustment>取消</button><button class="primary-btn" type="submit">确认${escapeHtml(action)}</button></div></form></section></div>`);
  const close = () => document.querySelector("[data-stock-adjustment]")?.remove();
  document.querySelectorAll("[data-close-stock-adjustment]").forEach((button) => button.addEventListener("click", close));
  document.getElementById("stockAdjustmentForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const amount = Number(new FormData(event.currentTarget).get("quantity"));
    if (!Number.isFinite(amount) || amount <= 0 || (action === "出库" && amount > available)) return;
    close();
    adjustStock(itemId, action, amount);
  });
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

function downloadCsv(filename, headers, rows) {
  const csv = [headers, ...rows].map((row) => row.map((value) => `"${String(value ?? "").replaceAll('"', '""')}"`).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function exportInventoryLogsCsv() {
  const headers = ["时间", "产品", "动作", "数量", "变化前", "变化后", "操作人", "来源单据", "备注"];
  const rows = (db.inventoryLogs || []).map((log) => [formatDate(log.createdAt), inventoryName(log.itemId), log.action, log.quantity, log.beforeStock, log.afterStock, userName(log.operatorId), log.sourceId || "-", log.remark || ""]);
  downloadCsv(`库存流水_${today}.csv`, headers, rows);
}

function openInventoryExportDialog() {
  document.body.insertAdjacentHTML("beforeend", `<div class="modal-backdrop"><section class="modal confirm-modal"><div class="modal-header"><div><h2 class="panel-title">选择导出内容</h2><p class="compact-note">库存台账和库存流水将分别导出为 CSV 文件，便于打开和核对。</p></div><button class="icon-btn" type="button" data-close-modal>×</button></div><div class="modal-body"><div class="export-choice"><button class="ghost-btn" data-inventory-export="ledger">仅导出台账</button><button class="ghost-btn" data-inventory-export="logs">仅导出流水</button><button class="primary-btn" data-inventory-export="both">台账和流水都导出</button></div></div></section></div>`);
  document.querySelectorAll("[data-close-modal]").forEach((button) => button.addEventListener("click", closeModal));
  document.querySelectorAll("[data-inventory-export]").forEach((button) => button.addEventListener("click", () => {
    const choice = button.dataset.inventoryExport;
    if (choice === "ledger" || choice === "both") exportCsv("inventory");
    if (choice === "logs" || choice === "both") exportInventoryLogsCsv();
    closeModal();
    toast(choice === "both" ? "库存台账和库存流水已分别导出" : "导出完成");
  }));
}

document.addEventListener("click", (event) => {
  const arrive = event.target.closest("[data-arrive]");
  if (arrive) {
    const purchase = db.purchases.find((p) => p.id === arrive.dataset.arrive);
    if (!purchase || purchase.status !== "在途" || !canWorkflow("purchase_receive")) return;
    confirmAction("确认到货入库", `确认 ${purchase.code} 已到货并入库吗？确认后库存会自动增加并写入库存流水。`, async () => {
      if (!await receivePurchase(purchase)) return;
      purchase.status = "已到货";
      purchase.updatedAt = nowIso();
      saveData();
      toast("采购已到货并同步入库");
      render();
    });
  }
});

async function restoreServerSession() {
  if (!PUBLIC_PRODUCTION || !SERVER_MODE) return;
  try {
    const { response, payload } = await getCurrentUser();
    if (response.ok) {
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
