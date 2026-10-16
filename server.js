const express = require('express');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const cors = require('cors');
const path = require('path');
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

// Multer memory storage (Handles files up to 100MB)
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: { fileSize: 100 * 1024 * 1024 } // 100 MB max limit
});

// Upload API Endpoint
app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'কোনো ফাইল সিলেক্ট করা হয়নি।' });
    }

    const isVideo = req.file.mimetype.startsWith('video');

    // Cloudinary Stream Uploader
    const uploadToCloudinary = () => {
      return new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
          {
            resource_type: isVideo ? 'video' : 'auto',
            folder: 'prince_cloud'
          },
          (error, result) => {
            if (error) return reject(error);
            resolve(result);
          }
        );
        Readable.from(req.file.buffer).pipe(uploadStream);
      });
    };

    const result = await uploadToCloudinary();

    return res.json({
      success: true,
      url: result.secure_url,
      format: result.format,
      resource_type: result.resource_type,
      size: result.bytes
    });
  } catch (error) {
    console.error('Upload Error:', error);
    return res.status(500).json({ success: false, message: 'আপলোড ব্যর্থ হয়েছে। আবার চেষ্টা করুন।' });
  }
});

// Default Route
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Prince Cloud Server is running on port ${PORT}`);
});
