# large-platform

A content platform with **66 Express routes**, four high-fan-out services, and
four business chains. It exists for one question the small samples cannot ask:

> When the code has more business nodes than the map is allowed to draw, **which
> ones survive?**

Every other sample fits under the default budget, so compression never runs on
them. This one does not fit, on purpose.

## Chains under test

| Chain | Route | Through |
|---|---|---|
| Publish | `POST /api/drafts/:id/publish` | `publishDraft` → `publishWorkflow` → Editorial Review agent + `moderationTool` → `approvePublication` (human gate) → article store |
| Ingest | `POST /api/ingest` | `ingestDocument` → `ingestWorkflow` (bounded retry) → `embedTool` → `api.openai.com` + chunk store |
| Search | `GET /api/search` | `searchArticles` → `catalog.listArticles` → `rankerModel` → `search.internal.example.com` |
| Digest | **none** | `runNightlyDigest` (cron) → `digestWorkflow` → Digest Writer agent → `api.sendgrid.com` |

Digest is the control for entry resolution: it is reachable only from the
scheduler. A map that cannot name its entry must **say so** —
`FEATURE_ENTRY_UNRESOLVED`, health not `healthy` — rather than present a chain
rooted at an arbitrary interior step as if that were where the work begins.

The other 62 routes are ordinary versioned CRUD over `CatalogService`,
`AccountService`, `MetricsService`, and `GovernanceService`. They are not
filler: their count and their shared services are the pressure this sample
applies. A route no feature needs must not vanish without trace either —
breadth belongs in a group, not in a gap.

## Why a bigger budget is not the answer

Measured against the 0.8.0 compressor, raising `maxNodes` moves the failure
without fixing it:

| `maxNodes` | Logic nodes | What survives |
|---|---|---|
| 44 | 44 nodes / 27 edges | 39 entrypoints, 2 workflows, 3 data — **zero** agents, tools, models, gates, external systems |
| 80 | 80 / 70 | all 66 routes, then 14 slots for everything else |
| 120 | 120 / 111 | chains finally complete — i.e. only once nearly every business node is drawn |

The budget is eaten by **breadth** (66 near-identical routes) before **depth**
(the six nodes each chain needs) is considered at all. A global top-N ranking
over `kind + degree` cannot express "this feature needs its whole chain", so no
value of `maxNodes` makes a 44-node map of this project correct.

The same root cause shows the opposite symptom on a project whose services carry
high fan-out: there the services win every slot and the routes vanish, leaving
features that cannot say where they begin. Both are one bug.
