import { accounts } from "../services/accounts";
import { metrics } from "../services/metrics";

export async function readAccountHandler(id: string) { return accounts.readAccount(id); }
export async function listAccountsHandler(team: string) { return accounts.listAccounts(team); }
export async function renameAccountHandler(id: string, name: string) { return accounts.renameAccount(id, name); }
export async function suspendAccountHandler(id: string) { await metrics.recordEvent(id, "suspend"); return accounts.suspendAccount(id); }
export async function restoreAccountHandler(id: string) { return accounts.restoreAccount(id); }
export async function createAccountHandler(email: string) { return accounts.createAccount(email); }
export async function setQuotaHandler(id: string, quota: number) { return accounts.setQuota(id, quota); }
export async function setPlanHandler(id: string, plan: string) { return accounts.setPlan(id, plan); }
