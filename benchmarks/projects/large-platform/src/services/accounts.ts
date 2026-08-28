declare const db: {
  account: { findUnique(a: object): Promise<object>; findMany(a: object): Promise<object[]>; update(a: object): Promise<object>; create(a: object): Promise<object> };
};

export class AccountService {
  async readAccount(id: string) { return db.account.findUnique({ where: { id } }); }
  async listAccounts(team: string) { return db.account.findMany({ where: { team } }); }
  async renameAccount(id: string, name: string) { return db.account.update({ where: { id }, data: { name } }); }
  async suspendAccount(id: string) { return db.account.update({ where: { id }, data: { suspended: true } }); }
  async restoreAccount(id: string) { return db.account.update({ where: { id }, data: { suspended: false } }); }
  async createAccount(email: string) { return db.account.create({ data: { email } }); }
  async setQuota(id: string, quota: number) { return db.account.update({ where: { id }, data: { quota } }); }
  async setPlan(id: string, plan: string) { return db.account.update({ where: { id }, data: { plan } }); }
}

export const accounts = new AccountService();
