const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { getDataBasePath } = require('./utils/settings');

const uploadsBasePath = path.join(getDataBasePath(), 'uploads');
if (!fs.existsSync(uploadsBasePath)) {
  try { fs.mkdirSync(uploadsBasePath, { recursive: true }); } catch (e) {}
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsBasePath),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const extension = path.extname(file.originalname);
    const prefix = file.fieldname === 'logoFile' ? 'logo-' : 'import-';
    cb(null, prefix + uniqueSuffix + extension);
  }
});

const upload = multer({ storage });

const imageStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const imgDir = path.join(uploadsBasePath, 'products');
    if (!fs.existsSync(imgDir)) fs.mkdirSync(imgDir, { recursive: true });
    cb(null, imgDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const extension = path.extname(file.originalname);
    cb(null, 'product-' + uniqueSuffix + extension);
  }
});

const imageUpload = multer({ storage: imageStorage });

module.exports = { upload, imageUpload };
