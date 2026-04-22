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

// ============= ROUTES =============
// Authentication Routes
app.use('/api/auth', require('./src/routes/authRoutes'));

// Session Routes
app.use('/api/sessions', require('./src/routes/sessionRoutes'));

// Poll Routes
app.use('/api/polls', require('./src/routes/pollRoutes'));

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

// ============= SOCKET.IO WITH VOICE SIGNALING =============
// Store active voice rooms and participants
const voiceRooms = new Map();

io.on('connection', (socket) => {
  console.log('✅ New client connected:', socket.id);

  // Join session room (for participants)
  socket.on('join-session', (sessionCode) => {
    socket.join(`session-${sessionCode}`);
    console.log(`Socket ${socket.id} joined session-${sessionCode}`);
  });

  // Join host room (for hosts)
  socket.on('join-host', (hostId) => {
    socket.join(`host-${hostId}`);
    console.log(`Socket ${socket.id} joined host-${hostId}`);
  });

  // Join voice room (for voice calls)
  socket.on('join-voice-room', ({ roomName, userId, userName }) => {
    socket.join(roomName);
    
    if (!voiceRooms.has(roomName)) {
      voiceRooms.set(roomName, new Map());
    }
    
    const room = voiceRooms.get(roomName);
    room.set(socket.id, { userId, userName });
    
    // Notify others in the room
    socket.to(roomName).emit('user-joined', {
      userId,
      userName,
      socketId: socket.id
    });
    
    // Send existing participants to new user
    const participants = Array.from(room.entries()).map(([id, data]) => ({
      socketId: id,
      userId: data.userId,
      userName: data.userName
    }));
    
    socket.emit('room-participants', participants);
    console.log(`User ${userName} joined voice room: ${roomName}`);
  });

  // WebRTC signaling for voice calls
  socket.on('signal', ({ to, signal, from }) => {
    io.to(to).emit('signal', {
      signal,
      from: socket.id
    });
  });

  // Leave voice room
  socket.on('leave-voice-room', ({ roomName }) => {
    socket.leave(roomName);
    
    if (voiceRooms.has(roomName)) {
      const room = voiceRooms.get(roomName);
      const user = room.get(socket.id);
      room.delete(socket.id);
      
      if (room.size === 0) {
        voiceRooms.delete(roomName);
      }
      
      socket.to(roomName).emit('user-left', {
        socketId: socket.id,
        userId: user?.userId
      });
    }
  });

  socket.on('disconnect', () => {
    console.log('❌ Client disconnected:', socket.id);
    
    // Remove from all voice rooms
    for (const [roomName, participants] of voiceRooms.entries()) {
      if (participants.has(socket.id)) {
        const user = participants.get(socket.id);
        participants.delete(socket.id);
        socket.to(roomName).emit('user-left', {
          socketId: socket.id,
          userId: user?.userId
        });
        
        if (participants.size === 0) {
          voiceRooms.delete(roomName);
        }
        break;
      }
    }
  });
});

// ============= START SERVER =============
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`✅ QuickPulse server running on port ${PORT}`);
  console.log(`📡 Environment: ${process.env.NODE_ENV}`);
  console.log(`🗄️  Database: ${process.env.DB_NAME}`);
  console.log(`🔗 Client URL: ${process.env.CLIENT_URL}`);
});