import express from "express";
import { addToCollectionHandler, archiveArticleHandler, createCollectionHandler, listArticlesHandler, listCollectionsHandler, readArticleHandler, renameArticleHandler, renameCollectionHandler, retagArticleHandler } from "../handlers/catalog";

export const catalogRouter = express.Router();

// v1 surface. Both versions are live; the v1 paths are still in use by the mobile client.
catalogRouter.get("/api/v1/articles", async (req, res) => {
  res.json(await listArticlesHandler(String(req.query.tag)));
});

catalogRouter.get("/api/v1/articles/:id", async (req, res) => {
  res.json(await readArticleHandler(req.params.id));
});

catalogRouter.patch("/api/v1/articles/:id/title", async (req, res) => {
  res.json(await renameArticleHandler(req.params.id, req.body.title));
});

catalogRouter.patch("/api/v1/articles/:id/tag", async (req, res) => {
  res.json(await retagArticleHandler(req.params.id, req.body.tag));
});

catalogRouter.delete("/api/v1/articles/:id", async (req, res) => {
  res.json(await archiveArticleHandler(req.params.id));
});

catalogRouter.get("/api/v1/collections", async (req, res) => {
  res.json(await listCollectionsHandler(String(req.query.owner)));
});

catalogRouter.post("/api/v1/collections", async (req, res) => {
  res.json(await createCollectionHandler(req.body.owner, req.body.name));
});

catalogRouter.patch("/api/v1/collections/:id", async (req, res) => {
  res.json(await renameCollectionHandler(req.params.id, req.body.name));
});

catalogRouter.post("/api/v1/collections/:id/items", async (req, res) => {
  res.json(await addToCollectionHandler(req.params.id, req.body.articleId));
});

// v2 surface. Both versions are live; the v1 paths are still in use by the mobile client.
catalogRouter.get("/api/v2/articles", async (req, res) => {
  res.json(await listArticlesHandler(String(req.query.tag)));
});

catalogRouter.get("/api/v2/articles/:id", async (req, res) => {
  res.json(await readArticleHandler(req.params.id));
});

catalogRouter.patch("/api/v2/articles/:id/title", async (req, res) => {
  res.json(await renameArticleHandler(req.params.id, req.body.title));
});

catalogRouter.patch("/api/v2/articles/:id/tag", async (req, res) => {
  res.json(await retagArticleHandler(req.params.id, req.body.tag));
});

catalogRouter.delete("/api/v2/articles/:id", async (req, res) => {
  res.json(await archiveArticleHandler(req.params.id));
});

catalogRouter.get("/api/v2/collections", async (req, res) => {
  res.json(await listCollectionsHandler(String(req.query.owner)));
});

catalogRouter.post("/api/v2/collections", async (req, res) => {
  res.json(await createCollectionHandler(req.body.owner, req.body.name));
});

catalogRouter.patch("/api/v2/collections/:id", async (req, res) => {
  res.json(await renameCollectionHandler(req.params.id, req.body.name));
});

catalogRouter.post("/api/v2/collections/:id/items", async (req, res) => {
  res.json(await addToCollectionHandler(req.params.id, req.body.articleId));
});

