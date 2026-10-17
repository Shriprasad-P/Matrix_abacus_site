const IMAGE = /^image\/(jpeg|png|webp|gif|avif)$/;
const PDF = 'application/pdf';
const imageKey = file => `${file.createdTime || ''}\u0000${file.id}`;
const indiaDay = time => new Date(time + 19800000).toISOString().slice(0, 10);

export function updateMediaState(previous, files, now, batchSize = 6) {
  const byId = new Map(files.map(file => [file.id, file]));
  const images = files.filter(file => IMAGE.test(file.mimeType))
    .sort((a, b) => imageKey(a).localeCompare(imageKey(b)));
  const lastPublishedAt = previous?.lastPublishedAt || null;
  const previousImages = (previous?.published || []).map(file => byId.get(file.id)).filter(Boolean);
  // The old state accumulated every published image. Its last image is the cursor
  // for the first daily rotation after upgrading.
  const lastImageKey = previous?.lastImageKey ||
    (previous?.published?.length ? imageKey(previous.published.at(-1)) : null);
  // Cron invocations can drift by seconds, so compare calendar days in India
  // rather than requiring exactly 24 hours between runs.
  const due = !lastPublishedAt || indiaDay(now) !== indiaDay(Date.parse(lastPublishedAt));
  let published = previousImages.slice(-batchSize);
  let nextImageKey = lastImageKey;
  if (due && images.length) {
    let start = lastImageKey ? images.findIndex(file => imageKey(file) > lastImageKey) : 0;
    if (start < 0) start = 0;
    published = Array.from({ length: Math.min(batchSize, images.length) },
      (_, offset) => images[(start + offset) % images.length]);
    nextImageKey = imageKey(published.at(-1));
  }
  const queuedCount = nextImageKey ? images.filter(file => imageKey(file) > nextImageKey).length : images.length;
  return {
    published,
    pdfs: files.filter(file => file.mimeType === PDF).sort((a, b) => a.name.localeCompare(b.name)),
    queuedCount,
    lastImageKey: nextImageKey,
    lastPublishedAt: due && published.length ? new Date(now).toISOString() : lastPublishedAt
  };
}
