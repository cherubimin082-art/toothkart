// Product images. On Vercel they go to Vercel Blob (public URLs); locally they are files in backend/uploads.
// What is saved in products.image is the full https URL for Blob images, or just the file name for local ones.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { usesBlob, uploadDir } = require('./config');

const EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };
const isUrl = v => /^https?:\/\//.test(v);

// file = an uploaded file held in memory (multer memoryStorage)
async function saveImage(file) {
  const name = crypto.randomUUID() + EXT[file.mimetype];
  if (usesBlob) {
    const { put } = await import('@vercel/blob'); // the Blob library is loaded only when it is needed
    const blob = await put(`products/${name}`, file.buffer, { access: 'public', contentType: file.mimetype, addRandomSuffix: false });
    return blob.url;
  }
  fs.mkdirSync(uploadDir, { recursive: true });
  await fs.promises.writeFile(path.join(uploadDir, name), file.buffer);
  return name;
}

// Never throws: a leftover image file is not worth failing a request over
async function removeImage(stored) {
  if (!stored) return;
  try {
    if (isUrl(stored)) {
      const { del } = await import('@vercel/blob');
      await del(stored);
    } else {
      await fs.promises.rm(path.join(uploadDir, stored), { force: true });
    }
  } catch (err) {
    console.error('Could not delete an old image:', err.message);
  }
}

const imageUrl = stored => (!stored ? null : isUrl(stored) ? stored : `/uploads/${stored}`);

module.exports = { saveImage, removeImage, imageUrl, EXT };
