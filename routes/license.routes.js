const express = require('express');
const router = express.Router();
const licenseController = require('../controllers/license.controller');

router.get('/info', licenseController.getLicenseInfo);
router.post('/activate', licenseController.activateLicense);
router.post('/redeem', licenseController.redeemToken);
router.post('/sync-contact', licenseController.syncLicenseContact);

module.exports = router;