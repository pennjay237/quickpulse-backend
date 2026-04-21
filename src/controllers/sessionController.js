const QRCode = require('qrcode');

// Generate a random 6-character session code
function generateSessionCode() {
  const characters = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  return code;
}

// Generate unique room name for voice
function generateRoomName(sessionCode) {
  return `room_${sessionCode}_${Date.now()}`;
}

// Create a new session (Host only)
exports.createSession = async (req, res) => {
  try {
    const { name, voice_enabled = false } = req.body;
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
      'INSERT INTO sessions (code, name, host_id, voice_enabled) VALUES ($1, $2, $3, $4) RETURNING *',
      [code, name, hostId, voice_enabled]
    );

    const session = result.rows[0];

    // If voice is enabled, create voice session record
    if (voice_enabled) {
      const roomName = generateRoomName(code);
      await db.query(
        'INSERT INTO voice_sessions (session_id, is_voice_enabled, room_name) VALUES ($1, $2, $3)',
        [session.id, true, roomName]
      );
    }

    // Generate QR code for the session
    const qrData = `${process.env.CLIENT_URL || 'http://localhost:5173'}/join/${code}`;
    const qrCodeImage = await QRCode.toDataURL(qrData);
    
    await db.query(
      'INSERT INTO qr_codes (session_id, qr_code, session_code, expires_at) VALUES ($1, $2, $3, $4)',
      [session.id, qrCodeImage, code, new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)]
    );

    res.status(201).json({ ...session, qrCode: qrCodeImage });
  } catch (error) {
    console.error('Create session error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

// Get all sessions for a host
exports.getHostSessions = async (req, res) => {
  try {
    const db = req.app.get('db');
    const result = await db.query(
      'SELECT s.*, vs.is_voice_enabled as voice_enabled, qc.qr_code FROM sessions s LEFT JOIN voice_sessions vs ON s.id = vs.session_id LEFT JOIN qr_codes qc ON s.id = qc.session_id WHERE s.host_id = $1 ORDER BY s.created_at DESC',
      [req.user.id]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Get host sessions error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

// Get session by code (for joining)
exports.getSessionByCode = async (req, res) => {
  try {
    const { code } = req.params;
    const db = req.app.get('db');

    const result = await db.query(
      `SELECT s.*, 
        (SELECT COUNT(*) FROM participants WHERE session_id = s.id) as participant_count,
        vs.is_voice_enabled as voice_enabled,
        vs.room_name as voice_room
       FROM sessions s
       LEFT JOIN voice_sessions vs ON s.id = vs.session_id
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
};

// Join a session (Participant)
exports.joinSession = async (req, res) => {
  try {
    const { code, name, email, phone } = req.body;
    const db = req.app.get('db');
    const io = req.app.get('io');

    // Find session
    const sessionResult = await db.query(
      'SELECT s.*, vs.room_name, vs.is_voice_enabled FROM sessions s LEFT JOIN voice_sessions vs ON s.id = vs.session_id WHERE s.code = $1 AND s.is_active = true',
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

    // Update participant count in voice session if voice is enabled
    if (session.is_voice_enabled) {
      await db.query(
        'UPDATE voice_sessions SET participant_count = participant_count + 1 WHERE session_id = $1',
        [session.id]
      );
    }

    // Notify host that a new participant joined
    io.to(`host-${session.host_id}`).emit('participant-joined', {
      sessionId: session.id,
      participant: participantResult.rows[0]
    });

    res.json({
      session: {
        id: session.id,
        code: session.code,
        name: session.name,
        voice_enabled: session.is_voice_enabled,
        voice_room: session.room_name
      },
      participant: participantResult.rows[0]
    });
  } catch (error) {
    console.error('Join session error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

// Get QR code for a session
exports.getSessionQRCode = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const db = req.app.get('db');

    const result = await db.query(
      'SELECT qr_code FROM qr_codes WHERE session_id = $1',
      [sessionId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'QR code not found' });
    }

    res.json({ qrCode: result.rows[0].qr_code });
  } catch (error) {
    console.error('Get QR code error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

// Enable/disable voice for a session
exports.toggleVoice = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { enabled } = req.body;
    const db = req.app.get('db');

    // Update session
    await db.query(
      'UPDATE sessions SET voice_enabled = $1 WHERE id = $2',
      [enabled, sessionId]
    );

    if (enabled) {
      // Create voice session if it doesn't exist
      const existing = await db.query(
        'SELECT * FROM voice_sessions WHERE session_id = $1',
        [sessionId]
      );
      
      if (existing.rows.length === 0) {
        const session = await db.query('SELECT code FROM sessions WHERE id = $1', [sessionId]);
        const roomName = generateRoomName(session.rows[0].code);
        await db.query(
          'INSERT INTO voice_sessions (session_id, is_voice_enabled, room_name) VALUES ($1, $2, $3)',
          [sessionId, true, roomName]
        );
      } else {
        await db.query(
          'UPDATE voice_sessions SET is_voice_enabled = true WHERE session_id = $1',
          [sessionId]
        );
      }
    } else {
      await db.query(
        'UPDATE voice_sessions SET is_voice_enabled = false WHERE session_id = $1',
        [sessionId]
      );
    }

    res.json({ success: true, enabled });
  } catch (error) {
    console.error('Toggle voice error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

// Get participants in a session (Host only)
exports.getParticipants = async (req, res) => {
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
};
