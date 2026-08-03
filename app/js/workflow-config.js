// 流程动作是独立于基础岗位的第二层权限。
// 后续超级管理员在“员工权限”中勾选的，就是这里定义的动作。
export const workflowActions = [
  { id: "sales_submit", group: "销售订单", label: "提交销售审批", defaultRoles: ["admin", "sales", "coordinator"] },
  { id: "sales_approve", group: "销售订单", label: "审批销售订单", defaultRoles: ["admin", "leader", "coordinator"] },
  { id: "inventory_check", group: "销售订单", label: "重新核验库存（异常处理）", defaultRoles: ["admin", "sales", "coordinator", "warehouse"] },
  { id: "purchase_technical_confirm", group: "采购需求", label: "技术确认采购", defaultRoles: ["admin", "technician", "trainer"] },
  { id: "purchase_approve", group: "采购需求", label: "采购审批并下单", defaultRoles: ["admin", "purchase"] },
  { id: "purchase_mark_transit", group: "采购需求", label: "标记采购在途", defaultRoles: ["admin", "purchase"] },
  { id: "purchase_receive", group: "采购需求", label: "确认到货入库", defaultRoles: ["admin", "purchase", "warehouse"] },
  { id: "delivery_create", group: "出库交付", label: "生成出库单", defaultRoles: ["admin", "sales", "coordinator", "warehouse"] },
  { id: "delivery_outbound", group: "出库交付", label: "确认出库", defaultRoles: ["admin", "warehouse", "purchase"] },
  { id: "delivery_dispatch", group: "出库交付", label: "标记配送中", defaultRoles: ["admin", "warehouse", "sales", "coordinator", "purchase"] },
  { id: "delivery_sign", group: "出库交付", label: "确认客户签收", defaultRoles: ["admin", "warehouse", "sales", "coordinator", "purchase"] },
  { id: "delivery_accept", group: "出库交付", label: "确认交付验收", defaultRoles: ["admin", "warehouse", "sales", "coordinator", "technician", "trainer", "purchase"] },
  { id: "aftersales_start_return", group: "售后退库", label: "发起退库处理", defaultRoles: ["admin", "aftersales", "technician", "coordinator"] },
  { id: "aftersales_receive_return", group: "售后退库", label: "确认售后收货", defaultRoles: ["admin", "warehouse", "aftersales"] },
  { id: "aftersales_quality_return", group: "售后退库", label: "质检合格并入库", defaultRoles: ["admin", "warehouse", "technician"] },
  { id: "aftersales_repair", group: "售后退库", label: "转维修或维修完成", defaultRoles: ["admin", "technician", "aftersales"] },
  { id: "aftersales_scrap", group: "售后退库", label: "确认报废", defaultRoles: ["admin", "warehouse", "technician"] },
  { id: "aftersales_replacement_delivery", group: "售后换货", label: "生成换货出库单", defaultRoles: ["admin", "aftersales", "warehouse", "sales", "coordinator"] },
];

export const workflowActionRoles = Object.fromEntries(
  workflowActions.map((action) => [action.id, action.defaultRoles]),
);
