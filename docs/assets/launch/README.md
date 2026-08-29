# Launch assets

These images use the same blueprint grid, colors, node shapes, and evidence
language as the product. The SVG files are the editable masters; the PNG files
are rendered at 2× for social platforms.

| Asset | Use | Native layout |
| --- | --- | --- |
| `social-preview-en.png` | GitHub, X, LinkedIn, Show HN link preview | 1280 × 640 |
| `social-preview-zh.png` | V2EX, 掘金, Chinese social posts | 1280 × 640 |
| `product-hunt-01-overview.png` | Product Hunt gallery — overview | 1270 × 760 |
| `product-hunt-02-evidence.png` | Product Hunt gallery — evidence | 1270 × 760 |
| `product-hunt-03-continuous.png` | Product Hunt gallery — GitHub workflow | 1270 × 760 |
| `product-hunt-04-views.png` | Product Hunt gallery — bilingual/technical views | 1270 × 760 |

Regenerate the SVG masters with:

```bash
node scripts/generate-promotion-assets.mjs
```

The PNG render is deliberately kept out of the product build and dependency
tree. Render each SVG with any SVG-capable design/export tool at 2×.
