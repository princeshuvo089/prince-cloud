const express = require('express');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const cors = require('cors');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const { Readable } = require('stream');

const app = express();
const PORT = process.env.PORT || 3000;

// Cloudinary Configuration
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME || 'hyg1nscf',
  api_key: process.env.CLOUDINARY_API_KEY || '853692318542916',
  api_secret: process.env.CLOUDINARY_API_SECRET || 'S03HpJUZgLFNewDkFX9cdYz-lfk'
});

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: { fileSize: 100 * 1024 * 1024 }
});

// Upload Endpoint (Generates Prince Cloud Direct Masked Links)
app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file selected.' });
    }

    const isVideo = req.file.mimetype.startsWith('video');
    const ext = path.extname(req.file.originalname).toLowerCase().replace('.', '') || (isVideo ? 'mp4' : 'png');
    const uniqueId = crypto.randomBytes(6).toString('hex'); // ImgChest style 12-char ID

    const uploadStream = cloudinary.uploader.upload_stream(
      {
        resource_type: isVideo ? 'video' : 'image',
        public_id: uniqueId,
        folder: 'prince_vault'
      },
      (error, result) => {
        if (error) {
          console.error(error);
          return res.status(500).json({ success: false, message: 'Upload failed.' });
        }

        // Generate 100% Branded Prince Cloud URL
        const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'https';
        const host = req.get('host');
        const directPrinceUrl = `${protocol}://${host}/files/${uniqueId}.${ext}`;
        const postPageUrl = `${protocol}://${host}/p/${uniqueId}`;

        return res.json({
          success: true,
          url: directPrinceUrl,
          postUrl: postPageUrl,
          rawUrl: result.secure_url,
          format: ext,
          resource_type: isVideo ? 'video' : 'image'
        });
      }
    );

    Readable.from(req.file.buffer).pipe(uploadStream);

  } catch (error) {
    return res.status(500).json({ success: false, message: 'Upload error.' });
  }
});

// Custom Direct CDN Proxy: Serves file under prince-cloud domain
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

// Catch-all
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Prince Cloud running on port ${PORT}`);
});
