const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

// Database connection
const pool = require('./src/config/database');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_URL || 'http://localhost:5173',
    methods: ['GET', 'POST'],
    credentials: true
  }
});

// Middleware
app.use(cors({
  origin: process.env.CLIENT_URL || 'http://localhost:5173',
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Make db pool and io available to routes
app.set('db', pool);
app.set('io', io);

// Basic test route
app.get('/', (req, res) => {
  res.json({ 
    message: 'QuickPulse API is running',
    status: 'online',
    timestamp: new Date().toISOString()
  });
});

// Test database route
app.get('/api/test-db', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW() as time');
    res.json({ 
      success: true, 
      time: result.rows[0].time,
      message: 'Database connection successful'
    });
  } catch (error) {
    console.error('Database test error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log('✅ New client connected:', socket.id);

  socket.on('disconnect', () => {
    console.log('❌ Client disconnected:', socket.id);
  });
});

// Start server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`✅ QuickPulse server running on port ${PORT}`);
  console.log(`📡 Environment: ${process.env.NODE_ENV}`);
  console.log(`🗄️  Database: ${process.env.DB_NAME}`);
  console.log(`🔗 Client URL: ${process.env.CLIENT_URL}`);
});
