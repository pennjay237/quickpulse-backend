const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const sessionController = require('../controllers/sessionController');

// Host routes (protected)
router.post('/', auth, sessionController.createSession);
router.get('/host', auth, sessionController.getHostSessions);
router.get('/:sessionId/participants', auth, sessionController.getParticipants);
router.get('/:sessionId/qrcode', auth, sessionController.getSessionQRCode);
router.patch('/:sessionId/voice', auth, sessionController.toggleVoice);

// Public routes (for participants)
router.get('/code/:code', sessionController.getSessionByCode);
router.post('/join', sessionController.joinSession);

module.exports = router;
