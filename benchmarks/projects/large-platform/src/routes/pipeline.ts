import express from "express";
import { ingestDocument, publishDraft, searchArticles } from "../handlers/pipeline";

export const pipelineRouter = express.Router();

pipelineRouter.post("/api/drafts/:id/publish", async (req, res) => {
  res.json(await publishDraft(req.params.id, req.body.body));
});

pipelineRouter.post("/api/ingest", async (req, res) => {
  res.json(await ingestDocument(req.body.documentId, req.body.chunks));
});

pipelineRouter.get("/api/search", async (req, res) => {
  res.json(await searchArticles(String(req.query.q), String(req.query.tag)));
});

pipelineRouter.get("/api/health", (_req, res) => res.json({ ok: true }));
