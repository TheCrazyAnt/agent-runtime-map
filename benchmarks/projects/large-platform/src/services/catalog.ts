declare const db: {
  article: { findMany(a: object): Promise<object[]>; findUnique(a: object): Promise<object>; update(a: object): Promise<object>; create(a: object): Promise<object> };
  collection: { findMany(a: object): Promise<object[]>; create(a: object): Promise<object>; update(a: object): Promise<object> };
};

/**
 * Called from most of the CRUD routes. Its high flow degree is the point of this
 * sample: under a global top-N ranking it outranks every route that reaches it.
 */
export class CatalogService {
  async listArticles(tag: string) { return db.article.findMany({ where: { tag } }); }
  async readArticle(id: string) { return db.article.findUnique({ where: { id } }); }
  async renameArticle(id: string, title: string) { return db.article.update({ where: { id }, data: { title } }); }
  async retagArticle(id: string, tag: string) { return db.article.update({ where: { id }, data: { tag } }); }
  async archiveArticle(id: string) { return db.article.update({ where: { id }, data: { archived: true } }); }
  async listCollections(owner: string) { return db.collection.findMany({ where: { owner } }); }
  async createCollection(owner: string, name: string) { return db.collection.create({ data: { owner, name } }); }
  async renameCollection(id: string, name: string) { return db.collection.update({ where: { id }, data: { name } }); }
  async addToCollection(id: string, articleId: string) { return db.collection.update({ where: { id }, data: { articleId } }); }
  async storeArticle(title: string, body: string) { return db.article.create({ data: { title, body } }); }
}

export const catalog = new CatalogService();
