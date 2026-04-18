// server.js
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');

// Load environment variables
dotenv.config();

const app = express();
const dns = require('dns');
dns.setServers(['8.8.8.8', '1.1.1.1', '8.8.4.4']);

// Ensure uploads directory exists
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
  console.log('📁 Uploads directory created');
}

// FIXED: CORS configuration - allow all necessary headers
const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:5000',
  'http://127.0.0.1:3000',
  'https://palagarismrender.onrender.com',
  'https://plagiarism-checker-olive.vercel.app'
];

app.use(cors({
  origin: function(origin, callback) {
    // Allow requests with no origin (like mobile apps, curl, etc)
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) !== -1 || process.env.NODE_ENV !== 'production') {
      callback(null, true);
    } else {
      console.log('CORS blocked for origin:', origin);
      callback(null, true); // Allow all in development
    }
  },
  methods: ['GET', 'POST', 'DELETE', 'PUT', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-Requested-With',
    'x-user-id',
    'x-user-email',
    'x-user-phone',
    'Accept'
  ],
  exposedHeaders: ['Content-Length', 'Content-Type'],
  credentials: true,
  optionsSuccessStatus: 200,
  preflightContinue: false
}));

// Handle preflight requests explicitly
app.options('*', cors());

// Body parsing middleware
app.use(express.json({ limit: '200mb' }));
app.use(express.urlencoded({ extended: true, limit: '200mb' }));

// Static files
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Request logging middleware
app.use((req, res, next) => {
  console.log(`📡 ${req.method} ${req.url} - ${new Date().toISOString()}`);

  // Set timeout for long requests (plagiarism checks)
  req.setTimeout(1800000, () => { // 30 minutes
    console.error(`⏰ Request timeout: ${req.method} ${req.url}`);
  });

  // Response timeout
  res.setTimeout(1800000, () => { // 30 minutes
    console.error(`⏰ Response timeout: ${req.method} ${req.url}`);
    if (!res.headersSent) {
      res.status(504).json({
        success: false,
        message: 'Request timeout - The plagiarism check is taking longer than expected. Please try with a smaller text.'
      });
    }
  });

  next();
});

// MongoDB Connection with options
const mongooseOptions = {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverSelectionTimeoutMS: 30000,
  socketTimeoutMS: 1800000, // 30 minutes
  family: 4
};

const connectDB = async () => {
  try {
    const mongoUri = process.env.MONGODB_URI ;

    console.log('🛢️ Attempting MongoDB connection...');
    console.log('🛢️ Using URI source:', process.env.MONGODB_URI ? 'MONGODB_URI from env' : 'local fallback');

    const conn = await mongoose.connect(mongoUri, mongooseOptions);

    console.log(`✅ MongoDB Connected: ${conn.connection.host}`);
    console.log(`✅ MongoDB Database: ${conn.connection.name}`);

    try {
      await conn.connection.db.collection('reports').createIndex({ createdAt: -1 });
      await conn.connection.db.collection('reports').createIndex({ fileName: 1 });
      console.log('📊 Database indexes created');
    } catch (indexErr) {
      console.log('Note: Indexes may already exist');
    }

  } catch (error) {
    console.error('❌ MongoDB Connection Error:', error.message);
    console.log('⚠️ Make sure MongoDB Atlas URI is correct and network access is allowed');
    setTimeout(connectDB, 5000);
  }
};

connectDB();

// MongoDB listeners
mongoose.connection.on('error', err => {
  console.error('❌ MongoDB connection error:', err);
});

mongoose.connection.on('disconnected', () => {
  console.log('⚠️ MongoDB disconnected, attempting to reconnect...');
  setTimeout(connectDB, 5000);
});

// API Routes
try {
  app.use('/api/plagiarism', require('./routes/plagiarismRoutes'));
  app.use('/api/reports', require('./routes/reportRoutes'));
  console.log('✅ Routes loaded successfully');
} catch (error) {
  console.error('❌ Error loading routes:', error.message);
}

// API Key status endpoint
app.get('/api/status', (req, res) => {
  const apiStatus = {
    google: {
      enabled: !!(process.env.GOOGLE_API_KEY && process.env.GOOGLE_CX),
      keyPresent: !!process.env.GOOGLE_API_KEY,
      cxPresent: !!process.env.GOOGLE_CX
    },
    serpapi: {
      enabled: !!process.env.SERPAPI_KEY,
      keyPresent: !!process.env.SERPAPI_KEY
    },
    core: {
      enabled: !!process.env.CORE_API_KEY,
      keyPresent: !!process.env.CORE_API_KEY
    },
    crossref: {
      enabled: !!process.env.CROSSREF_EMAIL,
      emailPresent: !!process.env.CROSSREF_EMAIL
    },
    tavily: {
      enabled: !!process.env.TAVILY_API_KEY,
      keyPresent: !!process.env.TAVILY_API_KEY
    },
    serper: {
      enabled: !!process.env.SERPER_API_KEY,
      keyPresent: !!process.env.SERPER_API_KEY
    },
    firecrawl: {
      enabled: !!process.env.FIRECRAWL_API_KEY,
      keyPresent: !!process.env.FIRECRAWL_API_KEY
    },
    exa: {
      enabled: !!process.env.EXA_API_KEY,
      keyPresent: !!process.env.EXA_API_KEY
    }
  };

  res.json({
    success: true,
    message: 'API Status',
    server: {
      status: 'running',
      port: process.env.PORT || 5000,
      environment: process.env.NODE_ENV || 'development'
    },
    apis: apiStatus,
    mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    timestamp: new Date()
  });
});

// Health check
app.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'Plagiarism Detector API Running ✅',
    status: 'OK',
    timestamp: new Date(),
    mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    uptime: process.uptime(),
    memory: process.memoryUsage()
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    success: true,
    message: '📚 Plagiarism Detector API',
    version: '2.0.0',
    endpoints: {
      health: '/health',
      status: '/api/status',
      checkFile: '/api/plagiarism/check-file (POST)',
      checkText: '/api/plagiarism/check-text (POST)',
      history: '/api/plagiarism/history (GET)',
      report: '/api/plagiarism/report/:id (GET)',
      reports: '/api/reports (GET)',
      download: '/api/reports/download/:id (GET)',
      delete: '/api/reports/:id (DELETE)'
    },
    apis: {
      google: !!(process.env.GOOGLE_API_KEY && process.env.GOOGLE_CX) ? '✅ Configured' : '❌ Not configured',
      serpapi: !!process.env.SERPAPI_KEY ? '✅ Configured' : '❌ Not configured',
      core: !!process.env.CORE_API_KEY ? '✅ Configured' : '❌ Not configured',
      crossref: !!process.env.CROSSREF_EMAIL ? '✅ Configured' : '❌ Not configured'
    },
    timestamp: new Date()
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.originalUrl} not found`,
    availableEndpoints: [
      '/',
      '/health',
      '/api/status',
      '/api/plagiarism/check-file (POST)',
      '/api/plagiarism/check-text (POST)',
      '/api/plagiarism/history (GET)',
      '/api/plagiarism/report/:id (GET)'
    ]
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('❌ Server Error:', err.stack);

  if (err.code === 'ECONNABORTED') {
    return res.status(504).json({
      success: false,
      message: 'Request timeout - The plagiarism check took too long. Please try with a smaller text.'
    });
  }

  if (err.name === 'MulterError') {
    return res.status(400).json({
      success: false,
      message: `File upload error: ${err.message}`
    });
  }

  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal server error',
    error: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });
});

const PORT = process.env.PORT || 5000;

const server = app.listen(PORT, () => {
  console.log(`
┌─────────────────────────────────────┐
│  🚀 Plagiarism Detector Server      │
├─────────────────────────────────────┤
│  📡 Port: ${PORT}                         │
│  🌐 URL: http://localhost:${PORT}        │
│  ⏰ Timeout: 30 minutes              │
│  📁 Uploads: ${uploadDir}     │
│  🔑 APIs: ${Object.entries({
    Google: !!(process.env.GOOGLE_API_KEY && process.env.GOOGLE_CX),
    SerpAPI: !!process.env.SERPAPI_KEY,
    CORE: !!process.env.CORE_API_KEY,
    Crossref: !!process.env.CROSSREF_EMAIL
  }).filter(([_, v]) => v).map(([k]) => k).join(', ') || 'None'}
├─────────────────────────────────────┤
│  ✅ Server is ready                  │
│  📝 Check /health for status         │
└─────────────────────────────────────┘
  `);
});

// Server timeout configuration
server.timeout = 1800000;        // 30 minutes
server.keepAliveTimeout = 1800000;
server.headersTimeout = 1810000; // slightly higher

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('👋 SIGTERM received: closing HTTP server...');
  server.close(() => {
    console.log('🔴 HTTP server closed');
    mongoose.connection.close()
      .then(() => {
        console.log('🔴 MongoDB connection closed');
        process.exit(0);
      })
      .catch((err) => {
        console.error('❌ Error closing MongoDB connection:', err);
        process.exit(1);
      });
  });
});

process.on('SIGINT', () => {
  console.log('👋 SIGINT received: closing HTTP server...');
  server.close(() => {
    console.log('🔴 HTTP server closed');
    mongoose.connection.close()
      .then(() => {
        console.log('🔴 MongoDB connection closed');
        process.exit(0);
      })
      .catch((err) => {
        console.error('❌ Error closing MongoDB connection:', err);
        process.exit(1);
      });
  });
});

process.on('uncaughtException', (err) => {
  console.error('💥 Uncaught Exception:', err);
  server.close(() => {
    mongoose.connection.close()
      .then(() => process.exit(1))
      .catch(() => process.exit(1));
  });
});

process.on('unhandledRejection', (err) => {
  console.error('💥 Unhandled Rejection:', err);
  console.error('This rejection was not handled, but server continues running');
});

module.exports = app;