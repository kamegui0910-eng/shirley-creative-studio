// Centering geometry adapted from Shirley Creative Studio's drawImageCover.
// Source: shirley-creative-studio index.html at d8a8a554024f1f98c898720369b6a14d9e16b71b.
export function drawComponent(ctx, image, x, y, width, height) {
  const scale = Math.min(width / image.width, height / image.height);
  const drawnWidth = image.width * scale;
  const drawnHeight = image.height * scale;
  ctx.drawImage(image, x + (width - drawnWidth) / 2, y + (height - drawnHeight) / 2, drawnWidth, drawnHeight);
}

export const STAGE = { width: 640, height: 480 };

// Grid layout shared by painting and hit-testing. Same geometry as the Phase 1 preview.
export function gridLayout(count, width = STAGE.width, height = STAGE.height, pad = 12) {
  if (count < 1) return [];
  const columns = Math.min(4, Math.ceil(Math.sqrt(count)));
  const cellW = width / columns;
  const cellH = height / Math.ceil(count / columns);
  return Array.from({ length: count }, (_, i) => ({
    x: (i % columns) * cellW + pad, y: Math.floor(i / columns) * cellH + pad, w: cellW - pad * 2, h: cellH - pad * 2
  }));
}

export function hitTest(rects, x, y) {
  for (let i = rects.length - 1; i >= 0; i--) {
    const r = rects[i];
    if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return i;
  }
  return -1;
}

// images[i] === null marks an asset that failed to load: draw a labelled placeholder instead of aborting the frame.
export function recipeRects(components, layout = STAGE) {
  return gridLayout(components.length, layout.width, layout.height).map((grid, index) => {
    const placement = components[index].layout;
    if (!placement) return grid;
    const w = grid.w * placement.scale, h = grid.h * placement.scale;
    return { x: placement.x * layout.width - w / 2, y: placement.y * layout.height - h / 2, w, h, rotation: placement.rotation };
  });
}

export function paintRecipe(ctx, { background, images, components = images.map(() => ({})), layout = STAGE,
  layers = images.map((_, componentIndex) => ({ componentIndex })), selected = -1, scale = 1 }) {
  const { width, height } = layout;
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);
  const rects = recipeRects(components, layout);
  layers.forEach(layer => {
    if (layer.visible === false) return;
    const index = layer.componentIndex;
    const image = images[index];
    const r = rects[index];
    if (!r) return;
    ctx.save();
    ctx.globalAlpha = layer.opacity ?? 1;
    if (r.rotation) {
      const x = r.x + r.w / 2, y = r.y + r.h / 2;
      ctx.translate(x,y); ctx.rotate(r.rotation * Math.PI / 180); ctx.translate(-x,-y);
    }
    if (image) { drawComponent(ctx, image, r.x, r.y, r.w, r.h); ctx.restore(); return; }
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = '#842754';
    ctx.strokeRect(r.x, r.y, r.w, r.h);
    ctx.fillStyle = '#842754';
    ctx.font = '14px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('加载失败', r.x + r.w / 2, r.y + r.h / 2);
    ctx.restore();
  });
  if (selected >= 0 && rects[selected]) {
    const r = rects[selected];
    ctx.save();
    ctx.strokeStyle = '#892752';
    ctx.lineWidth = 3;
    ctx.strokeRect(r.x - 4, r.y - 4, r.w + 8, r.h + 8);
    ctx.restore();
  }
  return rects;
}
