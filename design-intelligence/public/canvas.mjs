// Centering geometry adapted from Shirley Creative Studio's drawImageCover.
// Source: shirley-creative-studio index.html at d8a8a554024f1f98c898720369b6a14d9e16b71b.
export function drawComponent(ctx, image, x, y, width, height) {
  const scale = Math.min(width / image.width, height / image.height);
  const drawnWidth = image.width * scale;
  const drawnHeight = image.height * scale;
  ctx.drawImage(image, x + (width - drawnWidth) / 2, y + (height - drawnHeight) / 2, drawnWidth, drawnHeight);
}
