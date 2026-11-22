// Canvas 2D geometry and painting. Pure helpers are DOM-free so they can be unit tested in Node.
// Centering geometry adapted from Shirley Creative Studio's drawImageCover.
// Source: shirley-creative-studio index.html at d8a8a554024f1f98c898720369b6a14d9e16b71b.
export function drawComponent(ctx, image, x, y, width, height) {
  const scale = Math.min(width / image.width, height / image.height);
  const drawnWidth = image.width * scale;
  const drawnHeight = image.height * scale;
  ctx.drawImage(image, x + (width - drawnWidth) / 2, y + (height - drawnHeight) / 2, drawnWidth, drawnHeight);
}

export const STAGE = { width: 640, height: 480 };
export const FONT_STACK = 'system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
export const LINE_HEIGHT = 1.25;

// Auto layout shared by painting, hit-testing and "grid" mode. Padding scales with the canvas (12px at 640×480).
export function gridLayout(count, width = STAGE.width, height = STAGE.height, pad = Math.round(Math.min(width, height) / 40)) {
  if (count < 1) return [];
  const columns = Math.min(4, Math.ceil(Math.sqrt(count)));
  const cellW = width / columns;
  const cellH = height / Math.ceil(count / columns);
  return Array.from({ length: count }, (_, i) => ({
    x: (i % columns) * cellW + pad, y: Math.floor(i / columns) * cellH + pad, w: cellW - pad * 2, h: cellH - pad * 2
  }));
}

export const fontOf = layer => `${layer.weight === 'bold' ? 'bold ' : ''}${layer.fontSize}px ${FONT_STACK}`;

// Unscaled text block size. `measure(font, line)` returns a width; injected so tests need no canvas.
export function textSize(layer, measure) {
  const lines = layer.text.split('\n');
  const font = fontOf(layer);
  return { w: Math.max(1, ...lines.map(line => measure(font, line))), h: lines.length * layer.fontSize * LINE_HEIGHT };
}

// Per-layer center and base size before scale/rotation. In grid mode component layers are auto-placed.
export function resolveGeometry(recipe, measure) {
  const { width, height } = recipe.canvas;
  const comps = recipe.layers.map((l, i) => l.type === 'component' ? i : -1).filter(i => i >= 0);
  const cells = recipe.layout === 'grid' ? gridLayout(comps.length, width, height) : [];
  return recipe.layers.map((layer, index) => {
    if (layer.type === 'text') { const size = textSize(layer, measure); return { cx: layer.x, cy: layer.y, w: size.w, h: size.h }; }
    if (recipe.layout === 'grid') { const r = cells[comps.indexOf(index)]; return { cx: r.x + r.w / 2, cy: r.y + r.h / 2, w: r.w, h: r.h }; }
    return { cx: layer.x, cy: layer.y, w: layer.w, h: layer.h };
  });
}

const rad = degrees => degrees * Math.PI / 180;
export function toLocal(box, x, y) {
  const dx = x - box.cx, dy = y - box.cy, a = -rad(box.rotation);
  return { x: dx * Math.cos(a) - dy * Math.sin(a), y: dx * Math.sin(a) + dy * Math.cos(a) };
}
export function fromLocal(box, x, y) {
  const a = rad(box.rotation);
  return { x: box.cx + x * Math.cos(a) - y * Math.sin(a), y: box.cy + x * Math.sin(a) + y * Math.cos(a) };
}

// Scaled, rotated box in canvas units.
export const layerBox = (layer, geom) => ({ cx: geom.cx, cy: geom.cy, w: geom.w * layer.scale, h: geom.h * layer.scale, rotation: layer.rotation });

// Topmost visible layer under a point; later layers are drawn on top.
export function hitLayers(layers, geoms, x, y) {
  for (let i = layers.length - 1; i >= 0; i--) {
    if (!layers[i].visible) continue;
    const box = layerBox(layers[i], geoms[i]);
    const p = toLocal(box, x, y);
    if (Math.abs(p.x) <= box.w / 2 && Math.abs(p.y) <= box.h / 2) return i;
  }
  return -1;
}

// Handles live outside the box so they stay reachable on small layers. `unit` converts CSS px to canvas units.
export function handlePoints(box, unit = 1) {
  const reach = 26 * unit;
  return {
    scale: fromLocal(box, box.w / 2, box.h / 2),
    rotate: fromLocal(box, 0, -box.h / 2 - reach)
  };
}
export function hitHandle(box, x, y, unit = 1, radius = 16) {
  const points = handlePoints(box, unit);
  for (const [name, point] of Object.entries(points)) if (Math.hypot(point.x - x, point.y - y) <= radius * unit) return name;
  return null;
}

// New scale from dragging the corner handle: ratio of pointer distance to the original corner distance.
export function scaleFromDrag(box, start, point, startScale) {
  const d0 = Math.hypot(start.x - box.cx, start.y - box.cy) || 1;
  return startScale * Math.hypot(point.x - box.cx, point.y - box.cy) / d0;
}
export function rotationFromDrag(box, point) {
  return Math.atan2(point.y - box.cy, point.x - box.cx) * 180 / Math.PI + 90;
}

function drawText(ctx, layer) {
  const lines = layer.text.split('\n');
  ctx.font = fontOf(layer);
  ctx.fillStyle = layer.color;
  ctx.textBaseline = 'middle';
  ctx.textAlign = layer.align;
  const widths = lines.map(line => ctx.measureText(line).width);
  const block = Math.max(1, ...widths);
  const x = layer.align === 'left' ? -block / 2 : layer.align === 'right' ? block / 2 : 0;
  const top = -(lines.length * layer.fontSize * LINE_HEIGHT) / 2;
  lines.forEach((line, i) => ctx.fillText(line, x, top + (i + 0.5) * layer.fontSize * LINE_HEIGHT));
}

// images[i] is the decoded image for component layer i, or null if it failed (labelled placeholder is drawn).
export function paintRecipe(ctx, { recipe, background, images, geoms, selected = -1, scale = 1, unit = 1 }) {
  const { width, height } = recipe.canvas;
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);
  recipe.layers.forEach((layer, i) => {
    if (!layer.visible) return;
    const g = geoms[i];
    ctx.save();
    ctx.translate(g.cx, g.cy);
    ctx.rotate(rad(layer.rotation));
    ctx.scale(layer.scale, layer.scale);
    ctx.globalAlpha = layer.opacity;
    if (layer.type === 'text') drawText(ctx, layer);
    else if (images[i]) drawComponent(ctx, images[i], -g.w / 2, -g.h / 2, g.w, g.h);
    else {
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = '#842754';
      ctx.lineWidth = 2 / layer.scale;
      ctx.strokeRect(-g.w / 2, -g.h / 2, g.w, g.h);
      ctx.fillStyle = '#842754';
      ctx.font = `${14 / layer.scale}px ${FONT_STACK}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('加载失败', 0, 0);
    }
    ctx.restore();
  });
  const layer = recipe.layers[selected];
  if (layer?.visible) {
    const box = layerBox(layer, geoms[selected]);
    ctx.save();
    ctx.translate(box.cx, box.cy);
    ctx.rotate(rad(box.rotation));
    ctx.strokeStyle = '#892752';
    ctx.lineWidth = 2 * unit;
    ctx.setLineDash(layer.locked ? [6 * unit, 4 * unit] : []);
    ctx.strokeRect(-box.w / 2 - 3 * unit, -box.h / 2 - 3 * unit, box.w + 6 * unit, box.h + 6 * unit);
    ctx.restore();
    if (!layer.locked) {
      const points = handlePoints(box, unit);
      ctx.save();
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = '#892752';
      ctx.lineWidth = 2 * unit;
      const r = 8 * unit;
      ctx.beginPath(); ctx.rect(points.scale.x - r, points.scale.y - r, r * 2, r * 2); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.arc(points.rotate.x, points.rotate.y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.restore();
    }
  }
}
