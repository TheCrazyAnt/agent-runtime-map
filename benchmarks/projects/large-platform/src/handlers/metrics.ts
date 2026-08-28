import { metrics } from "../services/metrics";

export async function viewsHandler(id: string) { return metrics.readViews(id); }
export async function clicksHandler(id: string) { return metrics.readClicks(id); }
export async function retentionHandler(team: string) { return metrics.readRetention(team); }
export async function exportHandler(team: string) { return metrics.exportReport(team); }
