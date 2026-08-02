const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');

router.get('/status', authController.getAuthStatus);
router.post('/set', authController.setAdminPassword);
router.post('/verify', authController.verifyAdminPassword);

// Devuelve el usuario autenticado actualmente (basado en cookie)
router.get('/me', (req, res) => {
  res.json({
    id: req.userId || null,
    rol: req.userRol || null
  });
});

module.exports = router;