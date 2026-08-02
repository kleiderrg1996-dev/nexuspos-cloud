const express = require('express');
const router = express.Router();
const purchasesController = require('../controllers/purchases.controller');

router.post('/', purchasesController.createPurchase);
router.get('/', purchasesController.getPurchases);
router.get('/libro', purchasesController.getLibroCompras);
router.get('/:id', purchasesController.getPurchaseDetails);
router.delete('/:id', purchasesController.deletePurchase);

module.exports = router;