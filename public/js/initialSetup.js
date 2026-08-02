document.addEventListener('DOMContentLoaded', async () => {
    try {
        const modal = document.getElementById('contact-info-modal');
        const form = document.getElementById('form-contact-info');
        const statusMsg = document.getElementById('contact-status');
        const btnSave = document.getElementById('btn-save-contact');

        if (!modal || !form) return;

        // MODO OPEN SOURCE: Desactivado para no molestar al usuario
        return;


    // 2. Manejar envío
    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const phone = document.getElementById('contact-phone').value.trim();
        const email = document.getElementById('contact-email').value.trim();

        if (phone.length < 5 || !email.includes('@')) {
            showStatus('Por favor ingresa datos válidos.', true);
            return;
        }

        showStatus('Guardando...', false);
        btnSave.disabled = true;
        btnSave.classList.add('opacity-50', 'cursor-not-allowed');

        try {
            // A. Guardar localmente
            const saveRes = await fetch('/api/settings/contact-info', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ clientPhone: phone, clientEmail: email })
            });

            if (!saveRes.ok) throw new Error('Error al guardar datos');

            // B. Sincronizar con servidor de licencias (si hay internet)
            showStatus('Registrando licencia...', false);
            try {
                await fetch('/api/license/sync-contact', { method: 'POST' });
            } catch (syncErr) {
                console.warn('No se pudo sincronizar online (se hará después):', syncErr);
            }

            // C. Éxito
            modal.classList.add('hidden');
            if (window.showToast) window.showToast('Configuración completada con éxito', 'success');

        } catch (error) {
            console.error(error);
            showStatus('Error: ' + error.message, true);
            btnSave.disabled = false;
            btnSave.classList.remove('opacity-50', 'cursor-not-allowed');
        }
    });

    function showStatus(msg, isError) {
        statusMsg.textContent = msg;
        statusMsg.classList.remove('hidden');
        if (isError) statusMsg.classList.add('text-red-600');
        else statusMsg.classList.remove('text-red-600');
    }

} catch (err) {
    console.error('Error en initial setup:', err);
}
});
