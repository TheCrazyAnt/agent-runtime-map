import express from "express";
import { accountsRouter } from "./routes/accounts";
import { catalogRouter } from "./routes/catalog";
import { governanceRouter } from "./routes/governance";
import { metricsRouter } from "./routes/metrics";
import { pipelineRouter } from "./routes/pipeline";

const app = express();

app.use(pipelineRouter);
app.use(catalogRouter);
app.use(accountsRouter);
app.use(metricsRouter);
app.use(governanceRouter);

app.listen(3000);
