require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const connectDB = require('./config/db');

const authRoutes = require('./routes/auth');
const waRoutes = require('./routes/wa');
const apiRoutes = require('./routes/api');
const mediaController = require('./controllers/mediaController');
const authJwt = require('./middleware/authJwt');

const app = express();

// Ensure tmp upload directory exists (multer uses it before we stream into GridFS)
try {
  fs.mkdirSync('/tmp/wablas_uploads', { recursive: true });
} catch {}

app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Media is stored in MongoDB GridFS and served via /api/media/:id (nginx only proxies /api/* in prod)
// Keep /media/:id for backward compatibility / local dev.
app.get('/api/media/:id', authJwt, mediaController.getMedia);
app.get('/media/:id', authJwt, mediaController.getMedia);

// JWT routes (mount under /api/* so nginx can proxy only /api/)
app.use('/api/auth', authRoutes);
app.use('/api/wa', waRoutes);

// Backward compatibility / local dev (optional)
app.use('/auth', authRoutes);
app.use('/wa', waRoutes);

app.use('/api', apiRoutes);

app.get('/health', (req, res) => {
  res.json({ success: true, status: 'ok' });
});

// Prod convenience when only /api is proxied
app.get('/api/health', (req, res) => {
  res.json({ success: true, status: 'ok' });
});

app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Route not found' });
});

const PORT = process.env.PORT || 3000;

const start = async () => {
  await connectDB();
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
};

start().catch((err) => {
  console.error('Failed to start server', err);
  process.exit(1);
});
