import { catalog } from "../services/catalog";
import { metrics } from "../services/metrics";

export async function listArticlesHandler(tag: string) { return catalog.listArticles(tag); }
export async function readArticleHandler(id: string) { await metrics.recordEvent(id, "view"); return catalog.readArticle(id); }
export async function renameArticleHandler(id: string, title: string) { return catalog.renameArticle(id, title); }
export async function retagArticleHandler(id: string, tag: string) { return catalog.retagArticle(id, tag); }
export async function archiveArticleHandler(id: string) { return catalog.archiveArticle(id); }
export async function listCollectionsHandler(owner: string) { return catalog.listCollections(owner); }
export async function createCollectionHandler(owner: string, name: string) { return catalog.createCollection(owner, name); }
export async function renameCollectionHandler(id: string, name: string) { return catalog.renameCollection(id, name); }
export async function addToCollectionHandler(id: string, articleId: string) { return catalog.addToCollection(id, articleId); }
