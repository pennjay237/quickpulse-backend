exports.createPoll = async (req, res) => {
  try {
    const { sessionId, question, type, options } = req.body;
    const db = req.app.get('db');
    
    const sessionCheck = await db.query(
      'SELECT * FROM sessions WHERE id = $1 AND host_id = $2',
      [sessionId, req.user.id]
    );
    
    if (sessionCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Not authorized' });
    }
    
    const result = await db.query(
      `INSERT INTO polls (session_id, question, type, options, status) 
       VALUES ($1, $2, $3, $4, 'draft') 
       RETURNING *`,
      [sessionId, question, type, JSON.stringify(options)]
    );
    
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Create poll error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.getSessionPolls = async (req, res) => {
  try {
    const { sessionCode } = req.params;
    const db = req.app.get('db');

    const sessionResult = await db.query(
      'SELECT id FROM sessions WHERE code = $1',
      [sessionCode.toUpperCase()]
    );

    if (sessionResult.rows.length === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const sessionId = sessionResult.rows[0].id;

    const pollsResult = await db.query(
      `SELECT p.*, COUNT(DISTINCT r.id) as response_count
       FROM polls p
       LEFT JOIN responses r ON p.id = r.poll_id
       WHERE p.session_id = $1
       GROUP BY p.id
       ORDER BY p.created_at DESC`,
      [sessionId]
    );

    res.json(pollsResult.rows);
  } catch (error) {
    console.error('Get session polls error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.publishPoll = async (req, res) => {
  try {
    const { pollId } = req.params;
    const db = req.app.get('db');
    const io = req.app.get('io');
    
    const result = await db.query(
      `UPDATE polls 
       SET status = 'published', published_at = CURRENT_TIMESTAMP 
       WHERE id = $1 AND session_id IN (SELECT id FROM sessions WHERE host_id = $2)
       RETURNING *`,
      [pollId, req.user.id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Poll not found' });
    }
    
    const poll = result.rows[0];
    
    const sessionResult = await db.query(
      'SELECT code FROM sessions WHERE id = $1',
      [poll.session_id]
    );
    
    const sessionCode = sessionResult.rows[0].code;
    
    io.to(`session_${sessionCode}`).emit('new-poll', poll);
    
    res.json(poll);
  } catch (error) {
    console.error('Publish poll error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.closePoll = async (req, res) => {
  try {
    const { pollId } = req.params;
    const db = req.app.get('db');
    const io = req.app.get('io');
    
    const result = await db.query(
      `UPDATE polls 
       SET status = 'closed', closed_at = CURRENT_TIMESTAMP 
       WHERE id = $1 AND session_id IN (SELECT id FROM sessions WHERE host_id = $2)
       RETURNING *`,
      [pollId, req.user.id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Poll not found' });
    }
    
    const poll = result.rows[0];
    
    const sessionResult = await db.query(
      'SELECT code FROM sessions WHERE id = $1',
      [poll.session_id]
    );
    
    const sessionCode = sessionResult.rows[0].code;
    
    io.to(`session_${sessionCode}`).emit('poll-closed', { pollId });
    
    res.json(poll);
  } catch (error) {
    console.error('Close poll error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.reopenPoll = async (req, res) => {
  try {
    const { pollId } = req.params;
    const db = req.app.get('db');
    const io = req.app.get('io');
    
    const result = await db.query(
      `UPDATE polls 
       SET status = 'published', closed_at = NULL 
       WHERE id = $1 AND session_id IN (SELECT id FROM sessions WHERE host_id = $2)
       RETURNING *`,
      [pollId, req.user.id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Poll not found' });
    }
    
    const poll = result.rows[0];
    
    const sessionResult = await db.query(
      'SELECT code FROM sessions WHERE id = $1',
      [poll.session_id]
    );
    
    const sessionCode = sessionResult.rows[0].code;
    
    io.to(`session_${sessionCode}`).emit('poll-reopened', poll);
    
    res.json(poll);
  } catch (error) {
    console.error('Reopen poll error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.getPollResults = async (req, res) => {
  try {
    const { pollId } = req.params;
    const db = req.app.get('db');
    
    const result = await db.query(
      `SELECT p.*, COUNT(DISTINCT r.id) as total_responses,
        COALESCE(json_agg(DISTINCT jsonb_build_object('answer', r.answer, 'participant_name', part.name)) FILTER (WHERE r.id IS NOT NULL), '[]') as responses
       FROM polls p
       LEFT JOIN responses r ON p.id = r.poll_id
       LEFT JOIN participants part ON r.participant_id = part.id
       WHERE p.id = $1
       GROUP BY p.id`,
      [pollId]
    );
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Get poll results error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.submitResponse = async (req, res) => {
  try {
    const { pollId } = req.params;
    const { participantId, answer } = req.body;
    const db = req.app.get('db');
    const io = req.app.get('io');

    const pollCheck = await db.query(
      'SELECT * FROM polls WHERE id = $1 AND status = $2',
      [pollId, 'published']
    );

    if (pollCheck.rows.length === 0) {
      return res.status(400).json({ error: 'Poll is not available' });
    }

    const existingResponse = await db.query(
      'SELECT * FROM responses WHERE poll_id = $1 AND participant_id = $2',
      [pollId, participantId]
    );

    if (existingResponse.rows.length > 0) {
      return res.status(400).json({ error: 'Already answered this poll' });
    }

    const result = await db.query(
      'INSERT INTO responses (poll_id, participant_id, answer) VALUES ($1, $2, $3) RETURNING *',
      [pollId, participantId, answer]
    );

    const participantResult = await db.query(
      'SELECT name FROM participants WHERE id = $1',
      [participantId]
    );
    
    const participantName = participantResult.rows[0].name;

    const sessionResult = await db.query(
      `SELECT s.code, s.host_id 
       FROM sessions s 
       JOIN polls p ON p.session_id = s.id 
       WHERE p.id = $1`,
      [pollId]
    );
    
    const sessionCode = sessionResult.rows[0].code;
    const hostId = sessionResult.rows[0].host_id;

    io.to(`host_${hostId}`).emit('response-received', {
      pollId,
      answer,
      participantName
    });

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Submit response error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};
