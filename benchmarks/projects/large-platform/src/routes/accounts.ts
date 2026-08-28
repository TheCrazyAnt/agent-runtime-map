import express from "express";
import { createAccountHandler, listAccountsHandler, readAccountHandler, renameAccountHandler, restoreAccountHandler, setPlanHandler, setQuotaHandler, suspendAccountHandler } from "../handlers/accounts";

export const accountsRouter = express.Router();

// v1 surface. Both versions are live; the v1 paths are still in use by the mobile client.
accountsRouter.get("/api/v1/accounts/:id", async (req, res) => {
  res.json(await readAccountHandler(req.params.id));
});

accountsRouter.get("/api/v1/accounts", async (req, res) => {
  res.json(await listAccountsHandler(String(req.query.team)));
});

accountsRouter.patch("/api/v1/accounts/:id/name", async (req, res) => {
  res.json(await renameAccountHandler(req.params.id, req.body.name));
});

accountsRouter.post("/api/v1/accounts/:id/suspend", async (req, res) => {
  res.json(await suspendAccountHandler(req.params.id));
});

accountsRouter.post("/api/v1/accounts/:id/restore", async (req, res) => {
  res.json(await restoreAccountHandler(req.params.id));
});

accountsRouter.post("/api/v1/accounts", async (req, res) => {
  res.json(await createAccountHandler(req.body.email));
});

accountsRouter.patch("/api/v1/accounts/:id/quota", async (req, res) => {
  res.json(await setQuotaHandler(req.params.id, Number(req.body.quota)));
});

accountsRouter.patch("/api/v1/accounts/:id/plan", async (req, res) => {
  res.json(await setPlanHandler(req.params.id, req.body.plan));
});

// v2 surface. Both versions are live; the v1 paths are still in use by the mobile client.
accountsRouter.get("/api/v2/accounts/:id", async (req, res) => {
  res.json(await readAccountHandler(req.params.id));
});

accountsRouter.get("/api/v2/accounts", async (req, res) => {
  res.json(await listAccountsHandler(String(req.query.team)));
});

accountsRouter.patch("/api/v2/accounts/:id/name", async (req, res) => {
  res.json(await renameAccountHandler(req.params.id, req.body.name));
});

accountsRouter.post("/api/v2/accounts/:id/suspend", async (req, res) => {
  res.json(await suspendAccountHandler(req.params.id));
});

accountsRouter.post("/api/v2/accounts/:id/restore", async (req, res) => {
  res.json(await restoreAccountHandler(req.params.id));
});

accountsRouter.post("/api/v2/accounts", async (req, res) => {
  res.json(await createAccountHandler(req.body.email));
});

accountsRouter.patch("/api/v2/accounts/:id/quota", async (req, res) => {
  res.json(await setQuotaHandler(req.params.id, Number(req.body.quota)));
});

accountsRouter.patch("/api/v2/accounts/:id/plan", async (req, res) => {
  res.json(await setPlanHandler(req.params.id, req.body.plan));
});

