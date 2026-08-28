import express from "express";
import { clicksHandler, exportHandler, retentionHandler, viewsHandler } from "../handlers/metrics";

export const metricsRouter = express.Router();

// v1 surface. Both versions are live; the v1 paths are still in use by the mobile client.
metricsRouter.get("/api/v1/metrics/:id/views", async (req, res) => {
  res.json(await viewsHandler(req.params.id));
});

metricsRouter.get("/api/v1/metrics/:id/clicks", async (req, res) => {
  res.json(await clicksHandler(req.params.id));
});

metricsRouter.get("/api/v1/metrics/retention", async (req, res) => {
  res.json(await retentionHandler(String(req.query.team)));
});

metricsRouter.post("/api/v1/metrics/export", async (req, res) => {
  res.json(await exportHandler(req.body.team));
});

// v2 surface. Both versions are live; the v1 paths are still in use by the mobile client.
metricsRouter.get("/api/v2/metrics/:id/views", async (req, res) => {
  res.json(await viewsHandler(req.params.id));
});

metricsRouter.get("/api/v2/metrics/:id/clicks", async (req, res) => {
  res.json(await clicksHandler(req.params.id));
});

metricsRouter.get("/api/v2/metrics/retention", async (req, res) => {
  res.json(await retentionHandler(String(req.query.team)));
});

metricsRouter.post("/api/v2/metrics/export", async (req, res) => {
  res.json(await exportHandler(req.body.team));
});

// v3 surface. Both versions are live; the v1 paths are still in use by the mobile client.
metricsRouter.get("/api/v3/metrics/:id/views", async (req, res) => {
  res.json(await viewsHandler(req.params.id));
});

metricsRouter.get("/api/v3/metrics/:id/clicks", async (req, res) => {
  res.json(await clicksHandler(req.params.id));
});

metricsRouter.get("/api/v3/metrics/retention", async (req, res) => {
  res.json(await retentionHandler(String(req.query.team)));
});

metricsRouter.post("/api/v3/metrics/export", async (req, res) => {
  res.json(await exportHandler(req.body.team));
});

