const IMAGE = /^image\/(jpeg|png|webp|gif|avif)$/;
const PDF = 'application/pdf';

export function updateMediaState(previous, files, now, batchSize = 6, everyDays = 7) {
  const byId = new Map(files.map(file => [file.id, file]));
  const images = files.filter(file => IMAGE.test(file.mimeType))
    .sort((a, b) => (a.createdTime || '').localeCompare(b.createdTime || '') || a.id.localeCompare(b.id));
  const published = (previous?.published || []).map(file => byId.get(file.id)).filter(Boolean);
  const used = new Set(published.map(file => file.id));
  const queued = images.filter(file => !used.has(file.id));
  const lastPublishedAt = previous?.lastPublishedAt || null;
  const due = !lastPublishedAt || now - Date.parse(lastPublishedAt) >= everyDays * 86400000;
  const added = due ? queued.splice(0, batchSize) : [];
  published.push(...added);
  return {
    published,
    pdfs: files.filter(file => file.mimeType === PDF).sort((a, b) => a.name.localeCompare(b.name)),
    queuedCount: queued.length,
    lastPublishedAt: added.length ? new Date(now).toISOString() : lastPublishedAt
  };
}
