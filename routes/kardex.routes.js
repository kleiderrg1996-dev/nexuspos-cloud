const express = require('express');
const router = express.Router();
const kardexController = require('../controllers/kardex.controller');

router.get('/', kardexController.getKardex);

module.exports = router;
