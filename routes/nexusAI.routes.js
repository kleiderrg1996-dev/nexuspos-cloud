// routes/nexusAI.routes.js
const express = require('express');
const router = express.Router();
const nexusAIController = require('../controllers/nexusAI.controller');

// Endpoint principal para consultas a la IA
router.post('/query', nexusAIController.queryAI);

module.exports = router;
