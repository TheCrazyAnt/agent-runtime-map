declare const db: { event: { findMany(a: object): Promise<object[]>; create(a: object): Promise<object> } };

export class MetricsService {
  async readViews(id: string) { return db.event.findMany({ where: { id, kind: "view" } }); }
  async readClicks(id: string) { return db.event.findMany({ where: { id, kind: "click" } }); }
  async readRetention(team: string) { return db.event.findMany({ where: { team } }); }
  async recordEvent(id: string, kind: string) { return db.event.create({ data: { id, kind } }); }
  async exportReport(team: string) {
    await fetch("https://reports.internal.example.com/v1/export", { method: "POST", body: team });
    return db.event.findMany({ where: { team } });
  }
}

export const metrics = new MetricsService();
