const express = require('express');
const router = express.Router();
const newAuthController = require('../controllers/new_auth.controller');

router.post('/login', newAuthController.login);
router.post('/logout', newAuthController.logout);
router.get('/pulse', newAuthController.pulse);
router.get('/check', newAuthController.checkAuth);
router.get('/users', newAuthController.getUsers);
router.post('/users', newAuthController.createUser);
router.put('/users/:id/password', newAuthController.updateUserPassword);
router.delete('/users/:id', newAuthController.deleteUser);

module.exports = router;
