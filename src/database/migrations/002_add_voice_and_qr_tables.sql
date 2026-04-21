-- Voice sessions table
CREATE TABLE IF NOT EXISTS voice_sessions (
    id SERIAL PRIMARY KEY,
    session_id INTEGER REFERENCES sessions(id) ON DELETE CASCADE,
    is_voice_enabled BOOLEAN DEFAULT false,
    room_name VARCHAR(100) UNIQUE,
    participant_count INTEGER DEFAULT 0,
    signaling_data JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_voice_sessions_session_id ON voice_sessions(session_id);
CREATE INDEX IF NOT EXISTS idx_voice_sessions_room_name ON voice_sessions(room_name);

-- QR codes table
CREATE TABLE IF NOT EXISTS qr_codes (
    id SERIAL PRIMARY KEY,
    session_id INTEGER REFERENCES sessions(id) ON DELETE CASCADE,
    qr_code TEXT,
    session_code VARCHAR(10),
    expires_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create index for QR lookups
CREATE INDEX IF NOT EXISTS idx_qr_codes_session_id ON qr_codes(session_id);
CREATE INDEX IF NOT EXISTS idx_qr_codes_session_code ON qr_codes(session_code);

-- Add voice_enabled column to sessions table
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS voice_enabled BOOLEAN DEFAULT false;
