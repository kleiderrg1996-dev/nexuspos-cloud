const express = require('express');
const router = express.Router();
const utilsController = require('../controllers/utils.controller');

router.get('/local-ip', utilsController.getLocalIp);

// Nuevo endpoint para abrir URLs en el navegador del sistema operativo
router.get('/open-external', (req, res) => {
    const { url } = req.query;
    if (!url) return res.status(400).json({ error: 'Falta la URL' });
    
    const { exec } = require('child_process');
    
    // Si es URL de WhatsApp, convertir a protocolo directo (abre la app sin pasar por el navegador)
    let finalUrl = url;
    if (url.includes('api.whatsapp.com/send') || url.includes('wa.me/')) {
        finalUrl = url
            .replace('https://api.whatsapp.com/send', 'whatsapp://send?')
            .replace('https://wa.me/', 'whatsapp://send?phone=')
            .replace('http://api.whatsapp.com/send', 'whatsapp://send?');
        // Limpiar doble '?' si ya existía
        finalUrl = finalUrl.replace('whatsapp://send??', 'whatsapp://send?');
    }

    // En Windows, 'start' abre la URL con el handler del sistema
    exec(`start "" "${finalUrl}"`, (error) => {
        if (error) {
            console.error('Error abriendo URL externa:', error);
            return res.status(500).json({ error: 'Error abriendo navegador' });
        }
        res.json({ success: true });
    });
});

module.exports = router;