const express = require('express');
const router = express.Router();
const supplierController = require('../controllers/supplier.controller');

router.get('/', supplierController.getSuppliers);
router.get('/:id', supplierController.getSupplierById);
router.post('/', supplierController.createSupplier);
router.put('/:id', supplierController.updateSupplier);
router.delete('/:id', supplierController.deleteSupplier);

// Informes/Reportes
router.get('/:id/purchases', supplierController.getSupplierPurchases);
router.get('/:id/statement', supplierController.getSupplierStatement);

module.exports = router;
