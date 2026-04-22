-- Add response tracking to polls table
ALTER TABLE polls ADD COLUMN IF NOT EXISTS total_responses INTEGER DEFAULT 0;
ALTER TABLE polls ADD COLUMN IF NOT EXISTS can_reopen BOOLEAN DEFAULT true;

-- Create voice recordings table
CREATE TABLE IF NOT EXISTS voice_recordings (
    id SERIAL PRIMARY KEY,
    session_id INTEGER REFERENCES sessions(id) ON DELETE CASCADE,
    participant_id INTEGER REFERENCES participants(id) ON DELETE CASCADE,
    recording_url TEXT,
    duration INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create poll_results table for detailed analytics
CREATE TABLE IF NOT EXISTS poll_results (
    id SERIAL PRIMARY KEY,
    poll_id INTEGER REFERENCES polls(id) ON DELETE CASCADE,
    participant_id INTEGER REFERENCES participants(id) ON DELETE CASCADE,
    answer TEXT,
    responded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_poll_results_poll_id ON poll_results(poll_id);
CREATE INDEX IF NOT EXISTS idx_voice_recordings_session_id ON voice_recordings(session_id);
