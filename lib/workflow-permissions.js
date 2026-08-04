const defaultRoles = {
  purchase_receive: ["admin", "purchase", "warehouse"],
  delivery_outbound: ["admin", "warehouse", "purchase"],
};

function canPerformWorkflow(state, user, action) {
  if (!user) return false;
  if (user.role === "admin") return true;
  const configured = (state.users || []).find((candidate) => candidate.id === user.id);
  if (Array.isArray(configured?.workflowActions)) return configured.workflowActions.includes("*") || configured.workflowActions.includes(action);
  return (defaultRoles[action] || []).includes(user.role);
}

module.exports = { canPerformWorkflow };
