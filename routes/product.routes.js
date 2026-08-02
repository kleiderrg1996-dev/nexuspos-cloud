const express = require('express');
const router = express.Router();
const productController = require('../controllers/product.controller');
const { upload, imageUpload } = require('../server');

router.get('/', productController.getProducts);
router.post('/', productController.createProduct);
router.get('/export', productController.exportProducts);
router.post('/import', upload.single('csvFile'), productController.importProducts);
router.post('/upload-image', imageUpload.single('imagen'), productController.uploadProductImage);
router.get('/bultos', productController.getBultoProducts);
router.get('/barcode/:barcode', productController.getProductByBarcode);
router.get('/:id', productController.getProductById);
router.put('/:id', productController.updateProduct);
router.patch('/:id/stock', productController.updateStock);
router.put('/:id/barcode', productController.updateBarcode);
router.delete('/:id', productController.deleteProduct);

// Mass Actions
router.post('/mass-delete', productController.deleteProductsMassive);
router.post('/mass-update-profit', productController.updateProductsProfitMassive);

module.exports = router;