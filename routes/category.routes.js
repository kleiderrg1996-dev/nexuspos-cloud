const express = require('express');
const router = express.Router();
const productController = require('../controllers/product.controller');

router.get('/', productController.getCategories);
router.put('/:id', productController.updateCategory);
router.delete('/:id', productController.deleteCategory);

module.exports = router;