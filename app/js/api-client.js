async function request(path, options = {}) {
  const response = await fetch(path, { credentials: "same-origin", ...options });
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

export async function login(account, password) {
  return request("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ account, password }),
  });
}

export async function logout() {
  return request("/api/auth/logout", { method: "POST" });
}

export async function getCurrentUser() {
  return request("/api/me", { cache: "no-store" });
}

export const loadState = () => request("/api/db", { cache: "no-store" });
export const loadInventory = () => request("/api/inventory", { cache: "no-store" });
export const loadDocuments = (kind) => request(`/api/${kind}`, { cache: "no-store" });

export function saveState(state) {
  return request("/api/db", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(state) });
}

export function adjustInventory(adjustments, sourceId, sourceModule, workflowAction) {
  return request("/api/inventory/adjustments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ adjustments, sourceId, sourceModule, workflowAction }) });
}

export function ensureInventory(item) {
  return request("/api/inventory/ensure", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ item }) });
}

export const receivePurchase = (id) => request(`/api/purchases/${encodeURIComponent(id)}/receive`, { method: "POST" });
export const outboundDelivery = (id) => request(`/api/deliveries/${encodeURIComponent(id)}/outbound`, { method: "POST" });
export const approveSalesOrder = (id) => request(`/api/sales-orders/${encodeURIComponent(id)}/approve`, { method: "POST" });
export const checkSalesOrderInventory = (id) => request(`/api/sales-orders/${encodeURIComponent(id)}/check-inventory`, { method: "POST" });
export const createPurchaseRequest = (id, payload) => request(`/api/sales-orders/${encodeURIComponent(id)}/create-purchase-request`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(payload),
});
export const createDelivery = (id) => request(`/api/sales-orders/${encodeURIComponent(id)}/create-delivery`, { method: "POST" });
export const createReplacementDelivery = (id, payload) => request(`/api/aftersales/${encodeURIComponent(id)}/create-replacement-delivery`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(payload),
});

export { request };
