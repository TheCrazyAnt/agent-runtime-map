import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "docs/assets/launch");

const C = {
  navy: "#0b1739",
  blue: "#1768ff",
  blue2: "#3d7eff",
  pale: "#eaf2ff",
  border: "#c8d8f2",
  muted: "#5d6f91",
  teal: "#0aa88f",
  purple: "#7047eb",
  amber: "#f59e0b",
  red: "#ef4444",
  white: "#ffffff",
};

const esc = (value) => String(value)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;");

function base(width, height, title) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(title)}">
  <defs>
    <pattern id="grid" width="24" height="24" patternUnits="userSpaceOnUse">
      <path d="M 24 0 L 0 0 0 24" fill="none" stroke="#dbe7f8" stroke-width="1" opacity="0.7"/>
    </pattern>
    <pattern id="dots" width="24" height="24" patternUnits="userSpaceOnUse">
      <circle cx="2" cy="2" r="1.2" fill="#bfd3f2"/>
    </pattern>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="160%">
      <feDropShadow dx="0" dy="8" stdDeviation="10" flood-color="#31558e" flood-opacity="0.14"/>
    </filter>
    <marker id="arrow-blue" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto">
      <path d="M0,0 L9,4.5 L0,9 z" fill="${C.blue}"/>
    </marker>
    <marker id="arrow-teal" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto">
      <path d="M0,0 L9,4.5 L0,9 z" fill="${C.teal}"/>
    </marker>
    <marker id="arrow-purple" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto">
      <path d="M0,0 L9,4.5 L0,9 z" fill="${C.purple}"/>
    </marker>
  </defs>
  <rect width="${width}" height="${height}" fill="#f8fbff"/>
  <rect width="${width}" height="${height}" fill="url(#grid)" opacity="0.76"/>`;
}

const close = "</svg>";

function logo(x, y, size = 48) {
  const p = size / 48;
  return `<g transform="translate(${x} ${y}) scale(${p})">
    <rect width="48" height="48" rx="13" fill="${C.blue}"/>
    <path d="M14 31 L24 17 L35 31" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="14" cy="31" r="4" fill="white"/><circle cx="24" cy="17" r="4" fill="white"/><circle cx="35" cy="31" r="4" fill="white"/>
  </g>`;
}

function text(x, y, value, size = 24, weight = 500, fill = C.navy, anchor = "start") {
  return `<text x="${x}" y="${y}" font-family="Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}">${esc(value)}</text>`;
}

function multiText(x, y, lines, size = 20, weight = 600, fill = C.navy, gap = 25, anchor = "middle") {
  return `<text x="${x}" y="${y}" font-family="Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}">${lines.map((line, index) => `<tspan x="${x}" dy="${index ? gap : 0}">${esc(line)}</tspan>`).join("")}</text>`;
}

function roundRect(x, y, width, height, { fill = C.white, stroke = C.border, radius = 18, shadow = false, strokeWidth = 2 } = {}) {
  return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${radius}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"${shadow ? ' filter="url(#shadow)"' : ""}/>`;
}

function node(x, y, label, icon, accent = C.blue, width = 142, height = 104) {
  const lines = Array.isArray(label) ? label : [label];
  return `<g>
    ${roundRect(x, y, width, height, { fill: C.white, stroke: accent, radius: 20, shadow: true, strokeWidth: 2.5 })}
    ${text(x + width / 2, y + 38, icon, 26, 700, accent, "middle")}
    ${multiText(x + width / 2, y + 70, lines, 16, 700, C.navy, 19)}
  </g>`;
}

function edge(x1, y1, x2, y2, color = C.blue, dashed = false, marker = "arrow-blue") {
  const mid = Math.round((x1 + x2) / 2);
  return `<path d="M${x1} ${y1} H${mid} V${y2} H${x2}" fill="none" stroke="${color}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"${dashed ? ' stroke-dasharray="10 10"' : ""} marker-end="url(#${marker})"/>`;
}

function chip(x, y, value, color = C.blue, width) {
  const w = width ?? Math.max(108, value.length * 9 + 34);
  return `<g>${roundRect(x, y, w, 38, { fill: C.white, stroke: color, radius: 19, strokeWidth: 1.5 })}${text(x + w / 2, y + 25, value, 15, 700, color, "middle")}</g>`;
}

function footer(width, y, left, right) {
  return `<line x1="44" y1="${y}" x2="${width - 44}" y2="${y}" stroke="${C.border}"/>
    ${text(48, y + 38, left, 17, 700, C.teal)}
    ${text(width - 48, y + 38, right, 17, 600, C.muted, "end")}`;
}

function graphPanel(x, y, width, height, labels) {
  const [a, b, c, d, e] = labels;
  const ny = y + 88;
  const start = x + 36;
  const gap = (width - 72 - 5 * 132) / 4;
  const xs = Array.from({ length: 5 }, (_, index) => start + index * (132 + gap));
  return `<g>
    ${roundRect(x, y, width, height, { fill: "#fbfdff", stroke: C.border, radius: 22 })}
    <rect x="${x + 1}" y="${y + 1}" width="${width - 2}" height="${height - 2}" rx="21" fill="url(#dots)" opacity="0.65"/>
    ${edge(xs[0] + 132, ny + 52, xs[1] - 8, ny + 52)}
    ${edge(xs[1] + 132, ny + 52, xs[2] - 8, ny + 52)}
    ${edge(xs[2] + 132, ny + 52, xs[3] - 8, ny + 52)}
    ${edge(xs[3] + 132, ny + 52, xs[4] - 8, ny + 52)}
    ${node(xs[0], ny, a, "◎", C.blue, 132, 104)}
    ${node(xs[1], ny, b, "⌘", C.blue, 132, 104)}
    ${node(xs[2], ny, c, "✦", C.blue, 132, 104)}
    ${node(xs[3], ny, d, "↯", C.blue, 132, 104)}
    ${node(xs[4], ny, e, "↗", C.blue, 132, 104)}
    ${node(xs[2] - 6, y + 250, labels[5] ?? "Retrieve context", "⌕", C.teal, 144, 104)}
    ${edge(xs[2] + 66, y + 250, xs[2] + 66, ny + 112, C.teal, true, "arrow-teal")}
  </g>`;
}

function social(locale = "en") {
  const zh = locale === "zh";
  const width = 1280;
  const height = 640;
  const title = zh ? "看清 Agent 到底怎么运行" : "See how your Agent actually runs";
  const sub = zh ? "把代码库变成可逐步播放、有源码证据的执行地图" : "Turn a codebase into an evidence-backed, step-through execution map.";
  const labels = zh
    ? [["接收任务"], ["判断意图"], ["Agent 规划"], ["调用工具"], ["返回结果"], ["检索上下文"]]
    : [["Receive task"], ["Understand", "intent"], ["Agent plan"], ["Call tools"], ["Return result"], ["Retrieve context"]];
  return `${base(width, height, title)}
    ${logo(62, 60, 58)}
    ${text(137, 101, "Agent Runtime Map", 31, 800)}
    ${multiText(64, 184, zh ? ["看清 Agent", "到底怎么运行"] : ["See your Agent", "actually run"], 44, 850, C.navy, 52, "start")}
    ${multiText(64, 306, zh ? ["代码决定拓扑，", "每一步都有 file:line 证据。"] : ["Code decides the topology.", "Every step keeps file:line evidence."], 22, 500, C.muted, 31, "start")}
    ${chip(64, 406, zh ? "静态分析" : "Static analysis", C.blue, 142)}
    ${chip(216, 406, zh ? "逐步播放" : "Step-through", C.teal, 142)}
    ${chip(64, 454, zh ? "中英双语" : "Bilingual", C.purple, 142)}
    ${chip(216, 454, zh ? "开源" : "Open source", C.blue, 142)}
    ${text(64, 570, "github.com/TheCrazyAnt/agent-runtime-map", 18, 650, C.muted)}
    ${graphPanel(470, 55, 752, 512, labels)}
    ${close}`;
}

function galleryOverview() {
  const width = 1270;
  const height = 760;
  const labels = [["Receive", "task"], ["Understand", "intent"], ["Agent", "planning"], ["Call", "tools"], ["Return", "result"], ["Retrieve context"]];
  return `${base(width, height, "Map an AI Agent codebase as an evidence-backed execution circuit")}
    ${logo(52, 44, 50)}
    ${text(122, 78, "Agent Runtime Map", 27, 800)}
    ${text(52, 155, "Map the system — then inspect one feature at a time", 38, 850)}
    ${text(52, 198, "A deterministic analyzer builds the topology. The Viewer makes every route explorable.", 20, 500, C.muted)}
    ${graphPanel(52, 236, 1166, 406, labels)}
    ${footer(width, 674, "● Code-backed routes · Source evidence · Confidence", "Open source · TypeScript · JavaScript · Python")}
    ${close}`;
}

function galleryEvidence() {
  const width = 1270;
  const height = 760;
  return `${base(width, height, "Every map node is backed by source evidence")}
    ${logo(52, 44, 50)}
    ${text(122, 78, "Agent Runtime Map", 27, 800)}
    ${text(52, 150, "Every edge must prove itself", 42, 850)}
    ${text(52, 194, "Select a node to see the exact file, line, inference method, and confidence behind it.", 20, 500, C.muted)}
    ${roundRect(52, 236, 694, 408, { fill: "#fbfdff", stroke: C.border, radius: 22 })}
    <rect x="53" y="237" width="692" height="406" rx="21" fill="url(#dots)" opacity="0.58"/>
    ${edge(204, 390, 300, 390)}${edge(428, 390, 524, 390)}
    ${node(76, 338, ["Score", "draft"], "✦", C.blue, 128, 106)}
    ${node(300, 338, ["Approve", "draft"], "✓", C.purple, 128, 106)}
    ${node(524, 338, ["Revise", "draft"], "↻", C.blue, 128, 106)}
    <circle cx="364" cy="326" r="11" fill="${C.red}"/><text x="364" y="331" font-family="sans-serif" font-size="15" font-weight="800" fill="white" text-anchor="middle">!</text>
    ${text(77, 508, "Feature route", 15, 700, C.muted)}
    ${text(77, 542, "Review draft → Approve → Revise if requested", 19, 700)}
    ${text(77, 580, "Solid: verified call   ·   Purple: human approval", 16, 600, C.muted)}
    ${roundRect(778, 236, 440, 408, { fill: C.white, stroke: C.border, radius: 22, shadow: true })}
    ${text(812, 282, "SOURCE EVIDENCE", 15, 800, C.blue)}
    ${text(812, 332, "Approve draft", 29, 850)}
    ${chip(812, 354, "human approval", C.purple, 158)}
    ${text(812, 430, "app/workflows/review.ts:42", 19, 750, C.blue)}
    <rect x="812" y="454" width="370" height="92" rx="12" fill="#0e1832"/>
    ${text(832, 486, "42  await approveDraft(review)", 16, 550, "#d8e7ff")}
    ${text(832, 518, "43  if (!approved) reviseDraft()", 16, 550, "#8fb6ff")}
    ${text(812, 590, "Method: resolved call · Confidence: 1.0", 16, 650, C.muted)}
    ${footer(width, 674, "● No invented nodes. No invented edges.", "Same commit → same graph")}
    ${close}`;
}

function galleryContinuous() {
  const width = 1270;
  const height = 760;
  const stage = (x, y, index, title, sub, color = C.blue) => `<g>${roundRect(x, y, 250, 148, { fill: C.white, stroke: color, radius: 22, shadow: true, strokeWidth: 2.5 })}${text(x + 28, y + 40, `0${index}`, 17, 850, color)}${text(x + 28, y + 82, title, 22, 800)}${text(x + 28, y + 114, sub, 15, 550, C.muted)}</g>`;
  return `${base(width, height, "Install once and keep the Agent Map current from GitHub")}
    ${logo(52, 44, 50)}
    ${text(122, 78, "Agent Runtime Map", 27, 800)}
    ${text(52, 150, "Install once. Every code change updates the map.", 41, 850)}
    ${text(52, 194, "A read-only GitHub Action rebuilds, verifies, compares, and preserves the last good map.", 20, 500, C.muted)}
    ${stage(52, 274, 1, "Push or PR", "Source changes", C.blue)}
    ${edge(302, 348, 390, 348)}
    ${stage(394, 274, 2, "Analyze", "No project execution", C.blue)}
    ${edge(644, 348, 732, 348)}
    ${stage(736, 274, 3, "Verify", "Map-only artifact", C.teal)}
    ${edge(986, 348, 1002, 348, C.teal, false, "arrow-teal")}
    ${stage(1010, 274, 4, "Publish", "Private by default", C.purple)}
    ${roundRect(52, 472, 1166, 148, { fill: "#f3f7ff", stroke: C.border, radius: 20 })}
    ${text(78, 510, "WHAT CHANGED", 15, 800, C.blue)}
    ${chip(78, 538, "+3 nodes", C.teal, 120)}
    ${chip(212, 538, "+2 routes", C.blue, 120)}
    ${chip(346, 538, "1 diagnostic resolved", C.purple, 188)}
    ${text(574, 562, "Last successful map is preserved when analysis fails", 18, 700, C.navy)}
    ${footer(width, 674, "● contents: read · signed npm provenance", "Private artifact · Optional Pages demo")}
    ${close}`;
}

function galleryViews() {
  const width = 1270;
  const height = 760;
  const view = (x, y, label, title, body, accent) => `<g>
    ${roundRect(x, y, 356, 310, { fill: C.white, stroke: accent, radius: 22, shadow: true, strokeWidth: 2 })}
    ${text(x + 28, y + 42, label, 15, 850, accent)}
    ${text(x + 28, y + 92, title, 28, 850)}
    ${multiText(x + 28, y + 140, body, 17, 550, C.muted, 28, "start")}
  </g>`;
  return `${base(width, height, "Chinese, English, and technical evidence views of the same Agent node")}
    ${logo(52, 44, 50)}
    ${text(122, 78, "Agent Runtime Map", 27, 800)}
    ${text(52, 150, "One graph. Three honest views.", 42, 850)}
    ${text(52, 194, "Business readers get meaning. Engineers keep the original symbol and source location.", 20, 500, C.muted)}
    ${view(52, 256, "中文业务视图", "执行审核", ["调用「评分起草」、", "「批准起草」，按条件", "走向「修改草稿」。"], C.blue)}
    ${view(457, 256, "ENGLISH BUSINESS VIEW", "Execute review", ["Calls Score draft and", "Approve draft, then branches", "to Revise draft."], C.teal)}
    ${view(862, 256, "TECHNICAL EVIDENCE", "executeReview", ["app/workflows/review.ts:3", "resolved call · confidence 1.0", "Original code name preserved"], C.purple)}
    ${footer(width, 610, "● Unknown names are marked — never invented", "Chinese · English · Source evidence")}
    ${close}`;
}

const assets = new Map([
  ["social-preview-en.svg", social("en")],
  ["social-preview-zh.svg", social("zh")],
  ["product-hunt-01-overview.svg", galleryOverview()],
  ["product-hunt-02-evidence.svg", galleryEvidence()],
  ["product-hunt-03-continuous.svg", galleryContinuous()],
  ["product-hunt-04-views.svg", galleryViews()],
]);

await mkdir(OUT, { recursive: true });
await Promise.all([...assets].map(([name, body]) => writeFile(path.join(OUT, name), body, "utf8")));
console.log(`Generated ${assets.size} SVG assets in ${path.relative(ROOT, OUT)}`);
