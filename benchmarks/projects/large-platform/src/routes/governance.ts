import express from "express";
import { createPolicyHandler, listAuditsHandler, listHoldsHandler, listPoliciesHandler, recordAuditHandler, releaseHoldHandler, retirePolicyHandler, updatePolicyHandler } from "../handlers/governance";

export const governanceRouter = express.Router();

// v1 surface. Both versions are live; the v1 paths are still in use by the mobile client.
governanceRouter.get("/api/v1/policies", async (req, res) => {
  res.json(await listPoliciesHandler(String(req.query.scope)));
});

governanceRouter.post("/api/v1/policies", async (req, res) => {
  res.json(await createPolicyHandler(req.body.scope, req.body.rule));
});

governanceRouter.patch("/api/v1/policies/:id", async (req, res) => {
  res.json(await updatePolicyHandler(req.params.id, req.body.rule));
});

governanceRouter.delete("/api/v1/policies/:id", async (req, res) => {
  res.json(await retirePolicyHandler(req.params.id));
});

governanceRouter.get("/api/v1/audits", async (req, res) => {
  res.json(await listAuditsHandler(String(req.query.scope)));
});

governanceRouter.post("/api/v1/audits", async (req, res) => {
  res.json(await recordAuditHandler(req.body.scope, req.body.action));
});

governanceRouter.get("/api/v1/holds", async (req, res) => {
  res.json(await listHoldsHandler(String(req.query.scope)));
});

governanceRouter.post("/api/v1/holds/:id/release", async (req, res) => {
  res.json(await releaseHoldHandler(req.params.id));
});

// v2 surface. Both versions are live; the v1 paths are still in use by the mobile client.
governanceRouter.get("/api/v2/policies", async (req, res) => {
  res.json(await listPoliciesHandler(String(req.query.scope)));
});

governanceRouter.post("/api/v2/policies", async (req, res) => {
  res.json(await createPolicyHandler(req.body.scope, req.body.rule));
});

governanceRouter.patch("/api/v2/policies/:id", async (req, res) => {
  res.json(await updatePolicyHandler(req.params.id, req.body.rule));
});

governanceRouter.delete("/api/v2/policies/:id", async (req, res) => {
  res.json(await retirePolicyHandler(req.params.id));
});

governanceRouter.get("/api/v2/audits", async (req, res) => {
  res.json(await listAuditsHandler(String(req.query.scope)));
});

governanceRouter.post("/api/v2/audits", async (req, res) => {
  res.json(await recordAuditHandler(req.body.scope, req.body.action));
});

governanceRouter.get("/api/v2/holds", async (req, res) => {
  res.json(await listHoldsHandler(String(req.query.scope)));
});

governanceRouter.post("/api/v2/holds/:id/release", async (req, res) => {
  res.json(await releaseHoldHandler(req.params.id));
});

