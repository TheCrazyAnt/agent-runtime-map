import { governance } from "../services/governance";

export async function listPoliciesHandler(scope: string) { return governance.listPolicies(scope); }
export async function createPolicyHandler(scope: string, rule: string) { return governance.createPolicy(scope, rule); }
export async function updatePolicyHandler(id: string, rule: string) { return governance.updatePolicy(id, rule); }
export async function retirePolicyHandler(id: string) { return governance.retirePolicy(id); }
export async function listAuditsHandler(scope: string) { return governance.listAudits(scope); }
export async function recordAuditHandler(scope: string, action: string) { return governance.recordAudit(scope, action); }
export async function listHoldsHandler(scope: string) { return governance.listHolds(scope); }
export async function releaseHoldHandler(id: string) { return governance.releaseHold(id); }
