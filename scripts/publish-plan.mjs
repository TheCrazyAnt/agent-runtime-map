/**
 * Decides what a release run publishes, as a pure function the test suite can
 * exercise without a registry. The executable wrapper (publish-npm.mjs) only
 * gathers inputs and carries out the returned plan — every rule lives here:
 *
 * - The three packages ship as one version. A mismatch between them, or between
 *   them and the release tag, is a refusal, not a warning.
 * - A version that already exists on the registry is skipped, never republished
 *   and never "fixed" by mutating the version number.
 * - Publish order is fixed (react, mcp, cli) so a partial failure always leaves
 *   a prefix published, which a re-run of the same tag completes idempotently.
 */

/** In dependency order. The CLI ships last: it is the entry point users install. */
export const PUBLISH_ORDER = [
  { name: "@agent-runtime-map/react", directory: "packages/react" },
  { name: "@agent-runtime-map/mcp", directory: "packages/mcp" },
  { name: "agent-runtime-map", directory: "packages/cli" },
];

/**
 * @param {Object} input
 * @param {Record<string, {version: string, private?: boolean}>} input.manifests
 *   package.json contents keyed by package name; must cover PUBLISH_ORDER.
 * @param {string | undefined} input.tag
 *   The git tag that triggered the run (e.g. "v0.8.0"), or undefined for a
 *   manual dispatch. When present it must match the package version exactly.
 * @param {Record<string, string[]>} input.publishedVersions
 *   Versions the registry already has, keyed by package name ([] for a package
 *   that has never been published).
 * @returns {{ ok: boolean, version?: string, errors: string[], steps: Array<{name: string, directory: string, action: "publish"|"skip", reason: string}> }}
 */
export function planPublish({ manifests, tag, publishedVersions }) {
  const errors = [];

  for (const { name } of PUBLISH_ORDER) {
    const manifest = manifests[name];
    if (!manifest) errors.push(`missing manifest for ${name}`);
    else if (manifest.private) errors.push(`${name} is marked private and cannot be published`);
    else if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) errors.push(`${name} has a non-release version: ${manifest.version}`);
  }
  if (errors.length) return { ok: false, errors, steps: [] };

  const versions = new Set(PUBLISH_ORDER.map(({ name }) => manifests[name].version));
  if (versions.size > 1) {
    return {
      ok: false,
      errors: [`packages disagree on the release version: ${PUBLISH_ORDER.map(({ name }) => `${name}@${manifests[name].version}`).join(", ")}`],
      steps: [],
    };
  }
  const [version] = versions;

  if (tag !== undefined && tag !== `v${version}`) {
    return {
      ok: false,
      errors: [`tag ${tag} does not match the package version ${version}; refusing to publish under a mismatched identity`],
      steps: [],
    };
  }

  const steps = PUBLISH_ORDER.map(({ name, directory }) => {
    const existing = publishedVersions[name] ?? [];
    return existing.includes(version)
      ? { name, directory, action: "skip", reason: `${name}@${version} already exists on the registry` }
      : { name, directory, action: "publish", reason: `${name}@${version} is not on the registry yet` };
  });

  return { ok: true, version, errors: [], steps };
}
