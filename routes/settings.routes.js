const express = require('express');
const router = express.Router();
const settingsController = require('../controllers/settings.controller');
const { upload } = require('../server');

router.get('/rates', settingsController.getRates);
router.post('/rates', settingsController.updateRates);

router.get('/business', settingsController.getBusinessSettings);
router.post('/business', upload.single('logoFile'), settingsController.updateBusinessSettings);

router.get('/print', settingsController.getPrintSettings);
router.post('/print', settingsController.updatePrintSettings);

// Admin password: estado (si hay contraseña configurada o no)
router.get('/admin-password', settingsController.getAdminPasswordStatus);

// Admin password: guardar / borrar contraseña de administrador
router.post('/admin-password', settingsController.updateAdminPassword);

// Actualizar información de contacto (setup inicial)
router.post('/contact-info', settingsController.updateContactInfo);


module.exports = router;
