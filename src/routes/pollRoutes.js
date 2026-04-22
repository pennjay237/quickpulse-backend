const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const pollController = require('../controllers/pollController');

// Protected routes (host only)
router.post('/', auth, pollController.createPoll);
router.patch('/:pollId/publish', auth, pollController.publishPoll);
router.patch('/:pollId/close', auth, pollController.closePoll);
router.patch('/:pollId/reopen', auth, pollController.reopenPoll);
router.get('/:pollId/results', auth, pollController.getPollResults);

// Public routes (participants)
router.get('/session/:sessionCode', pollController.getSessionPolls);
router.post('/:pollId/respond', pollController.submitResponse);

module.exports = router;
