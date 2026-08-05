const ROLE_DEFAULTS = {
  admin: { scope: "全部", modules: ["dashboard", "leads", "salesOrders", "purchases", "inventory", "deliveries", "trainings", "aftersales", "products", "suppliers", "notices", "users"], actions: ["view", "create", "edit", "delete", "export", "config"] },
  leader: { scope: "全部", modules: ["dashboard", "leads", "salesOrders", "purchases", "inventory", "deliveries", "trainings", "aftersales", "products", "suppliers", "notices"], actions: ["view", "export"] },
  coordinator: { scope: "全部", modules: ["dashboard", "leads", "salesOrders", "purchases", "inventory", "deliveries", "trainings", "aftersales", "products", "suppliers", "notices"], actions: ["view", "create", "edit", "export"] },
  sales: { scope: "本人", modules: ["dashboard", "leads", "salesOrders", "deliveries", "trainings", "aftersales", "notices"], actions: ["view", "create", "edit"] },
  purchase: { scope: "全部", modules: ["dashboard", "purchases", "inventory", "deliveries", "trainings", "aftersales", "products", "suppliers", "notices"], actions: ["view", "create", "edit", "export"] },
  warehouse: { scope: "本部门", modules: ["dashboard", "salesOrders", "inventory", "deliveries", "purchases", "products", "notices"], actions: ["view", "create", "edit", "export"] },
  technician: { scope: "本部门", modules: ["dashboard", "salesOrders", "purchases", "deliveries", "trainings", "aftersales", "products", "notices"], actions: ["view", "edit"] },
  aftersales: { scope: "本部门", modules: ["dashboard", "salesOrders", "aftersales", "deliveries", "trainings", "inventory", "products", "notices"], actions: ["view", "create", "edit"] },
  finance: { scope: "本部门", modules: ["dashboard", "salesOrders", "purchases", "inventory", "products", "suppliers", "notices"], actions: ["view", "export"] },
  trainer: { scope: "本部门", modules: ["dashboard", "salesOrders", "deliveries", "trainings", "aftersales", "products", "notices"], actions: ["view", "create", "edit"] },
};

const COLLECTION_MODULES = {
  leads: "leads", salesOrders: "salesOrders", purchases: "purchases", inventory: "inventory",
  deliveries: "deliveries", trainings: "trainings", aftersales: "aftersales", products: "products",
  suppliers: "suppliers", notices: "notices", users: "users",
};
const OWNERSHIP_FIELDS = ["owner", "requester", "publisher", "techOwner", "createdBy"];

function stateUser(state, user) {
  return (state?.users || []).find((item) => item?.id === user?.id) || user || {};
}

function effectiveAccess(state, user) {
  const stored = stateUser(state, user);
  const role = ROLE_DEFAULTS[stored.role] || ROLE_DEFAULTS.sales;
  const custom = stored.modulePermissions;
  const modules = custom && typeof custom === "object" && !Array.isArray(custom)
    ? Object.fromEntries(Object.entries(custom).map(([key, value]) => [key, Array.isArray(value) ? value : []]))
    : Object.fromEntries(role.modules.map((module) => [module, role.actions]));
  return { scope: stored.scope || role.scope, modules, user: stored };
}

function canAccessModule(state, user, moduleId, action = "view") {
  if (user?.role === "admin") return true;
  return (effectiveAccess(state, user).modules[moduleId] || []).includes(action);
}

function ownerIds(record) {
  return OWNERSHIP_FIELDS.map((field) => record?.[field]).filter(Boolean);
}

function canSeeRecord(state, user, record) {
  if (user?.role === "admin") return true;
  const { scope, user: storedUser } = effectiveAccess(state, user);
  if (scope === "全部") return true;
  const ids = ownerIds(record);
  if (ids.includes(user.id)) return true;
  if (scope !== "本部门" || !ids.length) return false;
  const users = new Map((state?.users || []).filter((item) => item?.id).map((item) => [item.id, item]));
  return ids.some((id) => users.get(id)?.department === storedUser.department);
}

function filterStateForUser(state, user) {
  const next = { ...(state || {}) };
  // 类别需要供有产品/库存权限的员工选择，但只能由系统管理员维护。
  next.productCategories = [...(state?.productCategories || [])];
  for (const [collection, moduleId] of Object.entries(COLLECTION_MODULES)) {
    // 普通员工不能进入“员工权限”模块，但前端仍必须拿到“本人”的自定义模块/流程权限。
    // 其余员工只提供显示负责人所需的基础资料，避免泄露电话与权限配置。
    if (collection === "users") {
      next.users = (state.users || []).flatMap((account) => {
        if (account?.id === user?.id) {
          const { password, password_hash, ...safe } = account;
          return [safe];
        }
        if (user?.role === "admin") {
          const { password, password_hash, ...safe } = account;
          return [safe];
        }
        return account?.id ? [{
          id: account.id,
          name: account.name,
          department: account.department,
          role: account.role,
          status: account.status,
          scope: account.scope,
        }] : [];
      });
      continue;
    }
    if (!canAccessModule(state, user, moduleId, "view")) {
      next[collection] = [];
      continue;
    }
    if (collection === "inventory" || collection === "products" || collection === "suppliers") {
      next[collection] = [...(state[collection] || [])];
      continue;
    }
    next[collection] = (state[collection] || []).filter((record) => canSeeRecord(state, user, record));
  }
  if (!canAccessModule(state, user, "inventory", "view")) next.inventoryLogs = [];
  return next;
}

function sameRecord(left, right) {
  return JSON.stringify(left || {}) === JSON.stringify(right || {});
}

function mapById(records) {
  return new Map((records || []).filter((record) => record?.id).map((record) => [record.id, record]));
}

function assertStateWriteAccess(user, currentState, incomingState) {
  // 兼容旧数据库：首次由管理员保存前，它还没有 productCategories 字段。
  if (user?.role !== "admin" && Array.isArray(currentState?.productCategories)
    && !sameRecord(currentState.productCategories, incomingState?.productCategories)) {
    throw new Error("只有系统管理员可以维护产品类别");
  }
  for (const [collection, moduleId] of Object.entries(COLLECTION_MODULES)) {
    const current = mapById(currentState[collection]);
    const incoming = mapById(incomingState[collection]);
    if (collection === "users" && user?.role !== "admin") {
      const currentSelf = current.get(user.id);
      const incomingSelf = incoming.get(user.id);
      if (incomingSelf && !sameRecord(currentSelf, incomingSelf)) throw new Error("无权修改员工账号或权限配置");
      continue;
    }
    const canView = canAccessModule(currentState, user, moduleId, "view");
    // 客户端收到的是已按权限裁剪的状态；无查看权限的集合为空属于正常情况，
    // 不能把它当成用户在请求删除全部记录。
    if (!canView) {
      if (incoming.size) throw new Error(`无权在“${moduleId}”写入记录`);
      continue;
    }
    for (const [id, record] of incoming) {
      const existing = current.get(id);
      if (!existing) {
        if (!canAccessModule(currentState, user, moduleId, "create")) throw new Error(`无权在“${moduleId}”新建记录`);
        if (!["inventory", "products", "suppliers", "users"].includes(collection)
          && user?.role !== "admin" && !ownerIds(record).includes(user.id)) {
          throw new Error("新建业务记录必须指定本人为负责人或创建人");
        }
      } else if (!sameRecord(existing, record)) {
        if (!canSeeRecord(currentState, user, existing) && collection !== "inventory" && collection !== "products" && collection !== "suppliers") {
          throw new Error("无权修改不属于本人或本部门的记录");
        }
        if (!canAccessModule(currentState, user, moduleId, "edit")) throw new Error(`无权编辑“${moduleId}”记录`);
      }
    }
    for (const [id, existing] of current) {
      if (incoming.has(id)) continue;
      const visible = canSeeRecord(currentState, user, existing) || ["inventory", "products", "suppliers", "users"].includes(collection);
      if (visible && !canAccessModule(currentState, user, moduleId, "delete")) {
        // 可见记录从提交内容中消失时，只有拥有删除权限的管理员才可以删除。
        throw new Error("无权删除业务记录");
      }
    }
  }
}

function mergeStateForUser(currentState, incomingState, user) {
  if (user?.role === "admin") return incomingState;
  const next = { ...currentState, ...incomingState };
  next.productCategories = currentState.productCategories || [];
  for (const [collection, moduleId] of Object.entries(COLLECTION_MODULES)) {
    const current = mapById(currentState[collection]);
    const incoming = mapById(incomingState[collection]);
    if (!canAccessModule(currentState, user, moduleId, "view")) {
      next[collection] = currentState[collection] || [];
      continue;
    }
    const result = new Map(current);
    for (const [id, record] of incoming) result.set(id, record);
    for (const [id, record] of current) {
      if (!canSeeRecord(currentState, user, record) && !["inventory", "products", "suppliers"].includes(collection)) result.set(id, record);
    }
    next[collection] = [...result.values()];
  }
  return next;
}

module.exports = { canAccessModule, canSeeRecord, filterStateForUser, assertStateWriteAccess, mergeStateForUser };
