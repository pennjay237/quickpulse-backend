const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');

// Generate a random 6-character session code
function generateSessionCode() {
  const characters = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  return code;
}

// Create a new session (Host only)
router.post('/', auth, async (req, res) => {
  try {
    const { name } = req.body;
    const hostId = req.user.id;
    const db = req.app.get('db');

    // Generate unique session code
    let code;
    let existingSession;
    do {
      code = generateSessionCode();
      const result = await db.query('SELECT id FROM sessions WHERE code = $1', [code]);
      existingSession = result.rows[0];
    } while (existingSession);

    // Create session
    const result = await db.query(
      'INSERT INTO sessions (code, name, host_id) VALUES ($1, $2, $3) RETURNING *',
      [code, name, hostId]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Create session error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get all sessions for a host
router.get('/host', auth, async (req, res) => {
  try {
    const db = req.app.get('db');
    const result = await db.query(
      'SELECT * FROM sessions WHERE host_id = $1 ORDER BY created_at DESC',
      [req.user.id]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Get host sessions error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get session by code (for joining)
router.get('/code/:code', async (req, res) => {
  try {
    const { code } = req.params;
    const db = req.app.get('db');

    const result = await db.query(
      `SELECT s.*, 
        (SELECT COUNT(*) FROM participants WHERE session_id = s.id) as participant_count
       FROM sessions s
       WHERE s.code = $1 AND s.is_active = true`,
      [code.toUpperCase()]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Get session error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Join a session (Participant)
router.post('/join', async (req, res) => {
  try {
    const { code, name, email, phone } = req.body;
    const db = req.app.get('db');
    const io = req.app.get('io');

    // Find session
    const sessionResult = await db.query(
      'SELECT * FROM sessions WHERE code = $1 AND is_active = true',
      [code.toUpperCase()]
    );

    if (sessionResult.rows.length === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const session = sessionResult.rows[0];

    // Add participant
    const participantResult = await db.query(
      `INSERT INTO participants (session_id, name, email, phone) 
       VALUES ($1, $2, $3, $4) 
       ON CONFLICT (session_id, email) 
       DO UPDATE SET name = EXCLUDED.name
       RETURNING *`,
      [session.id, name, email, phone]
    );

    // Notify host that a new participant joined (via socket)
    io.to(`host-${session.host_id}`).emit('participant-joined', {
      sessionId: session.id,
      participant: participantResult.rows[0]
    });

    res.json({
      session: {
        id: session.id,
        code: session.code,
        name: session.name
      },
      participant: participantResult.rows[0]
    });
  } catch (error) {
    console.error('Join session error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get participants in a session (Host only)
router.get('/:sessionId/participants', auth, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const db = req.app.get('db');

    // Verify host owns this session
    const sessionCheck = await db.query(
      'SELECT * FROM sessions WHERE id = $1 AND host_id = $2',
      [sessionId, req.user.id]
    );

    if (sessionCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    const result = await db.query(
      'SELECT * FROM participants WHERE session_id = $1 ORDER BY joined_at DESC',
      [sessionId]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Get participants error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;