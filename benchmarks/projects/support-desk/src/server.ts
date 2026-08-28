import express from "express";
import { handleFaq, handleTicket, handleToolProbe, isTicketBody } from "./handlers";

const app = express();

app.post("/api/tickets", async (req, res) => {
  if (!isTicketBody(req.body)) return res.status(400).end();
  res.json(await handleTicket(req.body));
});

app.get("/api/faq", async (req, res) => {
  res.json(await handleFaq(String(req.query.q)));
});

app.post("/api/tools/:name", async (req, res) => {
  res.json(await handleToolProbe(req.params.name, req.body.input));
});

app.listen(3000);
