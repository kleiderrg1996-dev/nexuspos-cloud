const express = require('express');
const router = express.Router();
const salesController = require('../controllers/sales.controller');

router.post('/', salesController.processSale);
router.post('/budget', salesController.generateBudget);
router.get('/:id/receipt', salesController.getSaleReceipt);
router.get('/receipt/:id', salesController.getSaleReceipt);
router.get('/:id/details', salesController.getSaleDetails);
router.post('/:id/change', salesController.registerChange);

// Ticket Designer Routes
router.get('/settings/design', salesController.getTicketDesign);
router.post('/settings/design', salesController.saveTicketDesign);
router.get('/settings/template', salesController.getTicketTemplate);
router.post('/settings/template', salesController.saveTicketTemplate);
router.post('/settings/template/reset', salesController.resetTicketTemplate);

module.exports = router;