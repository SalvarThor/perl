# Perler Studio

A browser app for creating, editing and using fuse bead (Hama / Perler / Artkal) patterns. It runs entirely in the browser (desktop or iPad). Nothing is uploaded anywhere: projects, owned colors and settings are kept in the browser's local storage.

## Features

**Generate a pattern from an image** (choose, drag-and-drop or paste an image)
- Sizing: automatic, fixed width, fixed height, fit within W x H, or exact W x H (crop, pad or stretch). Quick presets for 1x1 to 4x4 boards of 29 x 29 pegs.
- Automatic sizing detects upscaled pixel art and uses its native resolution. Other images get their longest side fitted to a bead count you choose (default 58 = two boards).
- Palettes: Hama Midi (default, 92 colors), Perler and Artkal S. You can import your own palette from CSV or JSON.
- Use only colors you own (set them on the **My colors** tab). Effect colors (neon, glow, translucent, metallic) are excluded unless you turn them on.
- Maximum number of colors: picks the best subset of the palette for the image.
- Color matching: CIEDE2000, CIE76 or weighted RGB.
- Dithering: Floyd-Steinberg, Atkinson, Jarvis-Judice-Ninke, Stucki, Burkes, Sierra, Sierra Lite and ordered Bayer 2/4/8, with a strength setting and serpentine scanning.
- Resampling: area average, dominant color (keeps edges crisp) or nearest.
- Brightness, contrast, saturation and gamma adjustments.
- Background removal, transparency threshold, dropping colors used fewer than N times, and removing stray single beads.
- Tap a color in the result to exclude it and regenerate.

**Pixel editor**
- Pencil, eraser, fill, replace color, color picker, line, rectangle, filled box, ellipse, pan.
- Mirror drawing (horizontal / vertical), undo/redo, resize canvas with an anchor, trim, flip, rotate.
- Touch support: one finger draws, two fingers pan and pinch-zoom. Mouse: wheel zooms, Shift+wheel or Alt+drag pans, right-click erases.
- Bead count per color, "highlight one color" mode, colors you don't own are flagged, board outlines, color codes on the beads.
- Keyboard: B pencil, E eraser, G fill, X replace, I picker, L line, R rect, F box, O ellipse, H pan, Ctrl/Cmd+Z undo, Ctrl/Cmd+Shift+Z redo, 0 fit.
- Export PNG or a `.perler.json` pattern file. Import pattern files on the **Patterns** tab.

**1:1 PDF export**
- Page presets match the physical screen size of iPad models. A page of exactly the screen's size, shown full screen, appears at real size, so you can lay a clear pegboard on top. A4, Letter, A3 and custom sizes are available for printing (print at 100% / "Actual size").
- Peg spacing: Mini 2.5 mm, Midi/Perler 5 mm, Maxi 10 mm, or a custom value. A scale correction percentage compensates for a viewer that doesn't show the page at exactly 100%.
- Pages are split by whole pegboards (default 29 x 29), with board outlines, a peg grid, a heavier line every 10 pegs, color codes on each bead and a color list on each page.
- An overview page shows a section map and the full bead count, and a scale check page has a 10 cm ruler and a row of pegs.

### Using the PDF on an iPad
1. Export with the page size matching your iPad model.
2. Open the PDF in the Files app (or Books). Tap once to hide the toolbars and keep it at the default "fit" zoom. Hold the iPad in the page's orientation.
3. On the scale check page, measure the ruler, or lay your pegboard over the row of pegs. If it's off, set **Scale correction** to `real length / shown length x 100` and export again.
4. Turn on Guided Access or Auto-Lock "Never" so the screen stays on while you work.

## Development

```bash
npm install
npm run dev      # start the dev server
npm test         # unit tests (vitest)
npm run build    # production build in dist/
```

The build uses relative paths, so `dist/` can be served from any static host. `.github/workflows/deploy.yml` deploys to GitHub Pages on pushes to `main`. To use it, enable Pages with source "GitHub Actions" in the repository settings.

### Structure
- `src/lib/color.ts`: color conversion and distance metrics
- `src/lib/image.ts`: image loading, pixel-art detection, sizing, resampling, adjustments, background removal
- `src/lib/quantize.ts`: palette subset selection, dithering, cleanup
- `src/lib/generate.ts`, `src/lib/worker.ts`: generation pipeline, run in a Web Worker
- `src/lib/pattern.ts`: pattern model, editing operations, serialization
- `src/lib/pdf.ts` (layout and page sizes), `src/lib/pdf-render.ts` (jsPDF rendering)
- `src/components/`: React UI

## Color data

- **Hama:** color numbers, names and availability follow Hama's official Midi colour palette (hama.dk, 2025 edition). That's 88 current colors: 67 solid and 21 effect. Seven older colors that are no longer on the chart (H25, H33, H39-H42, H57) stay in the palette but are marked discontinued. The generator only uses them if you mark them as owned.
- **RGB values:** community measurements of physical beads from [maxcleme/beadcolors](https://github.com/maxcleme/beadcolors) (MIT), via the [@meltbead/bead-colors](https://www.npmjs.com/package/@meltbead/bead-colors) package (MIT). See `src/palettes/LICENSE-*.txt`.
  - Hama doesn't publish RGB values. Its chart uses bead photos, and sampling them gives inconsistent results, so they are only used for the three colors missing from the community data (H120 Dusty Blue, H121 Fuchsia Pink, H122 Mustard). Those three are marked as approximate.
  - Screen colors never exactly match physical beads.
- **Pegboards:** Hama's large square boards have 29 x 29 pegs (Midi), 57 x 57 (Mini) and 16 x 16 (Maxi). Choosing a bead size in the PDF export sets the matching board size. Hama doesn't publish peg spacing; 5 mm for Midi is the common value. Check it against your board with the PDF's scale check page.
