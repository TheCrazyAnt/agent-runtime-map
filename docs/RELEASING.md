# Releasing · 发布指南

English first; 中文在后半部分。

---

## How publishing works

npm releases go through **npm Trusted Publishing (OIDC)**. There is no
`NPM_TOKEN`, no long-lived credential in GitHub Secrets, and nothing to rotate
or leak: for each release run, npm exchanges the workflow's OIDC identity for a
short-lived publish credential that only works because the Trusted Publisher
configuration on npmjs.com names exactly this repository and workflow file.

The workflow is [.github/workflows/npm-publish.yml](../.github/workflows/npm-publish.yml):

- **Triggers:** a version tag (`vX.Y.Z`) or a manual `workflow_dispatch`.
  Ordinary pushes and pull requests can never publish.
- **Permissions:** `contents: read` and `id-token: write`, nothing else.
- **Gate:** `npm run release:check` (typecheck, all tests, builds, audit,
  package checks, repository-identity check) runs before any publish.
- **Order:** `@agent-runtime-map/react` → `@agent-runtime-map/mcp` →
  `agent-runtime-map` (the CLI last — it is what users install).
- **Idempotence:** versions the registry already has are skipped. Re-running a
  release is always safe; nothing is ever republished or overwritten.

### One-time npm configuration (per package)

On npmjs.com, for **each** of `agent-runtime-map`, `@agent-runtime-map/react`,
and `@agent-runtime-map/mcp`: *Package → Settings → Trusted Publisher →
GitHub Actions*, with:

| Field | Value |
|---|---|
| Organization or user | `TheCrazyAnt` |
| Repository | `agent-runtime-map` |
| Workflow filename | `npm-publish.yml` |
| Environment | *(leave empty)* |

After saving, the packages' publishing access can be set to *Require two-factor
authentication or a trusted publisher*, which disables token-based publishing
entirely.

## Cutting a release

1. Bump the version **in all three packages and the root** (`package.json`,
   `packages/cli`, `packages/react`, `packages/mcp`), plus the `VERSION`
   constants in `packages/cli/src/cli.ts` and `packages/mcp/src/server.ts`, and
   the default `cli-version` in `action.yml`. The three packages always share
   one version; the publish plan refuses a mismatch.
2. Open a PR, wait for all six checks, merge.
3. From the merge commit on `main`:

   ```bash
   git tag vX.Y.Z <merge-sha>
   git push origin vX.Y.Z
   ```

   The tag push runs `npm publish` for whatever the registry is missing.
4. Create the GitHub Release for the same tag with the three packed tarballs
   (`npm pack` in each package), so the direct-download install path stays
   alive alongside npm.
5. For a backward-compatible release, move the `v1` action tag to the same
   commit: `git tag -f v1 <merge-sha> && git push -f origin v1`. Breaking
   changes ship a `v2` instead — never move `v1` across a breaking change.

## When a release fails

- **The workflow failed before publishing anything** (tests, audit): fix the
  problem on `main`, then either re-run the workflow from the Actions page or
  delete and re-push the tag once it points at the fix.
- **Publishing failed partway** (say react published, cli did not): re-run the
  same workflow. Published versions are skipped; the rest completes.
- **A bad version reached npm:** never republish or mutate it — a version, once
  on the registry, is immutable history. `npm deprecate` the bad version with a
  message pointing at the fixed one, bump the patch version, and release again.

## What end users install

```bash
npm install --save-dev agent-runtime-map
npx agent-runtime-map init --github
```

or one-shot: `npx agent-runtime-map@latest .` — see the README for the full
paths (GitHub Actions map, local watch, embedding, MCP, skill).

---

## 发布机制（中文）

npm 发布走 **npm Trusted Publishing（OIDC）**：没有 `NPM_TOKEN`，GitHub
Secrets 里没有任何长期凭证，无须轮换、无从泄漏。每次发布运行时，npm 用
workflow 的 OIDC 身份换取一个短时发布凭证——它能成立，仅仅因为 npmjs.com 上的
Trusted Publisher 配置精确指向本仓库和本 workflow 文件。

workflow 为 [.github/workflows/npm-publish.yml](../.github/workflows/npm-publish.yml)：

- **触发**：版本标签（`vX.Y.Z`）或手动 `workflow_dispatch`。普通 push 和 PR
  永远不会发布。
- **权限**：仅 `contents: read` + `id-token: write`。
- **门禁**：发布前先跑完整 `npm run release:check`。
- **顺序**：react → mcp → cli（CLI 最后，它是用户直接安装的入口）。
- **幂等**：registry 已有的版本一律跳过。重跑发布永远安全，绝不重发或覆盖。

### npm 网页一次性配置（每个包）

在 npmjs.com 上，对 `agent-runtime-map`、`@agent-runtime-map/react`、
`@agent-runtime-map/mcp` **三个包分别**进入 *Settings → Trusted Publisher →
GitHub Actions*，填写：

| 字段 | 值 |
|---|---|
| Organization or user | `TheCrazyAnt` |
| Repository | `agent-runtime-map` |
| Workflow filename | `npm-publish.yml` |
| Environment | （留空） |

保存后可把包的发布权限设为 *Require two-factor authentication or a trusted
publisher*，彻底禁用 token 发布。

### 升版本发布

1. **三个包与根同步升版本**（外加 `packages/cli/src/cli.ts` 与
   `packages/mcp/src/server.ts` 的 `VERSION` 常量、`action.yml` 的默认
   `cli-version`）。三包版本必须一致，发布计划遇到不一致会直接拒绝。
2. 开 PR，六项 CI 全绿后合并。
3. 在 main 的 merge commit 上打 `vX.Y.Z` 标签并推送——标签推送即触发发布，
   registry 缺哪个补哪个。
4. 为同一标签创建 GitHub Release 并附三个 `npm pack` 出的 tarball，保持直链
   安装路径可用。
5. 向后兼容的版本把 `v1` action 标签移到同一 commit；破坏性变化发 `v2`，
   **永远不要**把 `v1` 移过破坏性变化。

### 失败恢复

- **发布前失败**（测试、audit）：在 main 修复后重跑 workflow，或删除标签、
  指向修复后的 commit 重新推送。
- **发布中途失败**：直接重跑同一 workflow——已发布的版本自动跳过，剩下的
  补齐。
- **坏版本已上 npm**：绝不重发或修改——registry 上的版本是不可变历史。用
  `npm deprecate` 标记并指向修复版，升 patch 号重新发布。
