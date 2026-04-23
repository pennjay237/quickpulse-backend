const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const dotenv = require('dotenv');

dotenv.config();
const pool = require('./src/config/database');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: ['http://localhost:5173', 'http://127.0.0.1:5173'],
    methods: ['GET', 'POST'],
    credentials: true
  },
  allowEIO3: true,
  transports: ['websocket', 'polling']
});

app.use(cors({
  origin: ['http://localhost:5173', 'http://127.0.0.1:5173'],
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.set('db', pool);
app.set('io', io);

app.use('/api/auth', require('./src/routes/authRoutes'));
app.use('/api/sessions', require('./src/routes/sessionRoutes'));
app.use('/api/polls', require('./src/routes/pollRoutes'));

app.get('/', (req, res) => {
  res.json({ message: 'QuickPulse API is running', status: 'online' });
});

app.get('/api/test-db', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW() as time');
    res.json({ success: true, time: result.rows[0].time });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Store active sessions and users
const sessionRooms = new Map();

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  // Host joins their personal room
  socket.on('host-join', (hostId) => {
    socket.join(`host_${hostId}`);
    console.log(`Host ${hostId} joined room host_${hostId}`);
  });

  // Participant joins a session room
  socket.on('participant-join', ({ sessionCode, participantId, participantName }) => {
    socket.join(`session_${sessionCode}`);
    
    if (!sessionRooms.has(sessionCode)) {
      sessionRooms.set(sessionCode, new Set());
    }
    sessionRooms.get(sessionCode).add(socket.id);
    
    console.log(`Participant ${participantName} joined session_${sessionCode}`);
    
    // Notify host
    pool.query('SELECT host_id FROM sessions WHERE code = $1', [sessionCode])
      .then(result => {
        if (result.rows.length > 0) {
          io.to(`host_${result.rows[0].host_id}`).emit('participant-joined', {
            sessionCode,
            participantId,
            participantName
          });
        }
      });
  });

  // Handle poll published event
  socket.on('poll-published', ({ poll, sessionCode }) => {
    console.log(`Poll published in session ${sessionCode}: ${poll.question}`);
    io.to(`session_${sessionCode}`).emit('new-poll', poll);
  });

  // Handle poll closed event
  socket.on('poll-closed', ({ pollId, sessionCode }) => {
    console.log(`Poll ${pollId} closed in session ${sessionCode}`);
    io.to(`session_${sessionCode}`).emit('poll-closed', { pollId });
  });

  // Handle poll reopened event
  socket.on('poll-reopened', ({ poll, sessionCode }) => {
    console.log(`Poll ${poll.id} reopened in session ${sessionCode}`);
    io.to(`session_${sessionCode}`).emit('poll-reopened', poll);
  });

  // Handle new response
  socket.on('new-response', ({ pollId, answer, participantName, sessionCode }) => {
    console.log(`Response received for poll ${pollId} from ${participantName}`);
    
    pool.query('SELECT host_id FROM sessions WHERE code = $1', [sessionCode])
      .then(result => {
        if (result.rows.length > 0) {
          io.to(`host_${result.rows[0].host_id}`).emit('response-received', {
            pollId,
            answer,
            participantName
          });
        }
      });
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    for (const [sessionCode, sockets] of sessionRooms.entries()) {
      if (sockets.has(socket.id)) {
        sockets.delete(socket.id);
        if (sockets.size === 0) {
          sessionRooms.delete(sessionCode);
        }
        break;
      }
    }
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
