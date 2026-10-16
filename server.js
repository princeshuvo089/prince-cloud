const express = require('express');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const cors = require('cors');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const { Readable } = require('stream');

const app = express();
const PORT = process.env.PORT || 3000;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME || 'hyg1nscf',
  api_key: process.env.CLOUDINARY_API_KEY || '853692318542916',
  api_secret: process.env.CLOUDINARY_API_SECRET || 'S03HpJUZgLFNewDkFX9cdYz-lfk'
});

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname));

const DB_FILE = path.join(__dirname, 'vault_data.json');
function readDB() {
  try {
    if (!fs.existsSync(DB_FILE)) return {};
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8') || '{}');
  } catch (e) {
    return {};
  }
}
function writeDB(data) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
  } catch (e) {}
}

const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: { fileSize: 105 * 1024 * 1024 } // Absolute max
});

// Upload Endpoint with strict 30MB (Image) / 100MB (Video) restriction
app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file selected.' });
    }

    const isVideo = req.file.mimetype.startsWith('video');
    const fileSize = req.file.size;

    // Strict Server-Side Size Validation
    if (!isVideo && fileSize > 30 * 1024 * 1024) {
      return res.status(400).json({ success: false, message: 'Image exceeds maximum 30MB limit.' });
    }
    if (isVideo && fileSize > 100 * 1024 * 1024) {
      return res.status(400).json({ success: false, message: 'Video exceeds maximum 100MB limit.' });
    }

    const email = (req.body.email || 'guest').toLowerCase().trim();
    const cleanTag = email.replace(/[^a-zA-Z0-9]/g, '_');
    const ext = path.extname(req.file.originalname).toLowerCase().replace('.', '') || (isVideo ? 'mp4' : 'png');
    const uniqueId = crypto.randomBytes(6).toString('hex');

    const uploadStream = cloudinary.uploader.upload_stream(
      {
        resource_type: isVideo ? 'video' : 'image',
        public_id: uniqueId,
        folder: 'prince_vault',
        tags: [cleanTag, 'prince_cloud']
      },
      (error, result) => {
        if (error) {
          return res.status(500).json({ success: false, message: 'Upload failed.' });
        }

        const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'https';
        const host = req.get('host');
        const directPrinceUrl = `${protocol}://${host}/files/${uniqueId}.${ext}`;
        const postPageUrl = `${protocol}://${host}/p/${uniqueId}`;

        const db = readDB();
        if (!db[email]) db[email] = [];
        db[email].unshift({
          id: uniqueId,
          url: directPrinceUrl,
          postUrl: postPageUrl,
          type: isVideo ? 'video' : 'image',
          createdAt: Date.now()
        });
        writeDB(db);

        return res.json({
          success: true,
          url: directPrinceUrl,
          postUrl: postPageUrl,
          type: isVideo ? 'video' : 'image',
          id: uniqueId
        });
      }
    );

    Readable.from(req.file.buffer).pipe(uploadStream);

  } catch (error) {
    return res.status(500).json({ success: false, message: 'Upload error.' });
  }
});

// Vault sync
app.get('/api/my-vault', async (req, res) => {
  const email = (req.query.email || '').toLowerCase().trim();
  if (!email) return res.json({ success: true, files: [] });

  const db = readDB();
  let files = db[email] || [];

  if (files.length === 0) {
    try {
      const cleanTag = email.replace(/[^a-zA-Z0-9]/g, '_');
      const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'https';
      const host = req.get('host');

      const imgRes = await cloudinary.api.resources_by_tag(cleanTag, { resource_type: 'image', max_results: 50 }).catch(() => ({ resources: [] }));
      const vidRes = await cloudinary.api.resources_by_tag(cleanTag, { resource_type: 'video', max_results: 50 }).catch(() => ({ resources: [] }));

      const combined = [...(imgRes.resources || []), ...(vidRes.resources || [])];
      files = combined.map(r => {
        const id = path.basename(r.public_id);
        const ext = r.format || (r.resource_type === 'video' ? 'mp4' : 'jpg');
        return {
          id: id,
          url: `${protocol}://${host}/files/${id}.${ext}`,
          postUrl: `${protocol}://${host}/p/${id}`,
          type: r.resource_type,
          createdAt: new Date(r.created_at).getTime()
        };
      });

      if (files.length > 0) {
        db[email] = files;
        writeDB(db);
      }
    } catch (e) {}
  }

  res.json({ success: true, files });
});

app.post('/api/delete-file', async (req, res) => {
  const { id, email, type } = req.body;
  if (!id || !email) return res.status(400).json({ success: false });

  try {
    await cloudinary.uploader.destroy(`prince_vault/${id}`, { resource_type: type || 'image' });
  } catch (e) {}

  const db = readDB();
  if (db[email]) {
    db[email] = db[email].filter(f => f.id !== id);
    writeDB(db);
  }
  res.json({ success: true });
});

app.get('/files/:filename', (req, res) => {
  const filename = req.params.filename;
  const dotIndex = filename.lastIndexOf('.');
  const id = dotIndex !== -1 ? filename.substring(0, dotIndex) : filename;
  const ext = dotIndex !== -1 ? filename.substring(dotIndex + 1).toLowerCase() : '';
  const isVideo = ['mp4', 'webm', 'mov', 'mkv'].includes(ext);

  const cloudinaryUrl = `https://res.cloudinary.com/hyg1nscf/${isVideo ? 'video' : 'image'}/upload/prince_vault/${id}`;

  https.get(cloudinaryUrl, (cdnRes) => {
    if (cdnRes.statusCode >= 400) {
      return res.status(cdnRes.statusCode).send('File not found');
    }

    res.setHeader('Content-Type', cdnRes.headers['content-type'] || (isVideo ? 'video/mp4' : 'image/jpeg'));
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    cdnRes.pipe(res);
  }).on('error', () => {
    res.status(500).send('Streaming error');
  });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Prince Cloud running on port ${PORT}`);
});
