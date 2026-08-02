const express = require('express');
const router = express.Router();
const presentationController = require('../controllers/presentation.controller');

// Lista todas o por producto: GET /api/presentations?productId=123
router.get('/', presentationController.getPresentations);

// Crear presentación: POST /api/presentations
router.post('/', presentationController.createPresentation);

// Buscar por barcode: GET /api/presentations/barcode/:barcode
router.get('/barcode/:barcode', presentationController.getPresentationByBarcode);

// Obtener una por id: GET /api/presentations/:id
router.get('/:id', presentationController.getPresentationById);

// Actualizar: PUT /api/presentations/:id
router.put('/:id', presentationController.updatePresentation);

// Eliminar (soft delete): DELETE /api/presentations/:id
router.delete('/:id', presentationController.deletePresentation);

module.exports = router;
