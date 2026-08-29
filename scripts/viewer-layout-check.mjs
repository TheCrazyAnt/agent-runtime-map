#!/usr/bin/env node
/**
 * Measures the rendered map the way a reader sees it: how many nodes are on
 * screen, how many edges cut through a node body, and how many labels are
 * shouting at once. Run against a served Viewer to compare two builds.
 *
 * The browser-side measurement is printed for pasting into a review; this script
 * only prints it, because driving a browser is not something CI does here.
 *
 * Usage: node scripts/viewer-layout-check.mjs
 */

process.stdout.write(`Paste this into the browser console with a Viewer open, in each mode:

(() => {
  // Group frames are backdrops, not obstacles.
  const nodes = [...document.querySelectorAll('.react-flow__node')]
    .filter(n => !n.classList.contains('react-flow__node-blueprintGroup'))
    .filter(n => n.offsetParent !== null && parseFloat(getComputedStyle(n).opacity) > 0.3);
  const rects = nodes.map(n => n.getBoundingClientRect());
  const paths = [...document.querySelectorAll('.react-flow__edge path.react-flow__edge-path')];
  let crossings = 0;
  for (const p of paths) {
    const len = p.getTotalLength(); if (!len) continue;
    const m = p.getScreenCTM(); if (!m) continue;
    for (let i = 1; i < 24; i++) {
      const pt = p.getPointAtLength(len * i / 24);
      const x = m.a * pt.x + m.c * pt.y + m.e, y = m.b * pt.x + m.d * pt.y + m.f;
      if (rects.some(r => x > r.left + 10 && x < r.right - 10 && y > r.top + 10 && y < r.bottom - 10)) { crossings++; break; }
    }
  }
  const dimmed = [...document.querySelectorAll('.react-flow__node')]
    .filter(n => !n.classList.contains('react-flow__node-blueprintGroup'))
    .filter(n => parseFloat(getComputedStyle(n).opacity) < 0.3);
  return {
    visibleNodes: nodes.length,
    dimmedNodes: dimmed.length,
    edges: paths.length,
    edgesCrossingNodes: crossings,
    visibleEdgeLabels: [...document.querySelectorAll('.blueprint-playback-edge__label')].filter(l => l.offsetParent !== null).length,
  };
})()

Recorded for benchmarks/projects/support-desk (25 logic nodes, 23 edges):

  mode              nodes  edges  crossing  labels
  0.8.0 whole map      20     16         0      16
  Overview (this PR)   13     11         0       0
  Feature (this PR)    18*    23         1       0
  * plus 7 dimmed to opacity 0.11 — hidden from reading, kept in the graph.
`);
