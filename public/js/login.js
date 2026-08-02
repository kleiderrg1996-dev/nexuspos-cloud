document.addEventListener('DOMContentLoaded', () => {
    const loginForm = document.getElementById('login-form');
    const errorMsg = document.getElementById('error-message');
    const loginBtn = document.getElementById('login-btn');

    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const username = document.getElementById('username').value;
        const password = document.getElementById('password').value;

        loginBtn.disabled = true;
        loginBtn.textContent = 'Verificando...';
        errorMsg.classList.add('hidden');

        try {
            const response = await fetch('/api/manage-users/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });

            const data = await response.json();

            if (data.success) {
                console.log('Login exitoso, redirigiendo...');
                loginBtn.textContent = 'Correcto. Entrando...';
                // Guardar "sesión" en sessionStorage (se borra al cerrar la ventana)
                sessionStorage.setItem('nexuspos_session', JSON.stringify({
                    id: data.user.id,
                    username: data.user.username,
                    nombre: data.user.nombre,
                    rol: data.user.rol,
                    sessionToken: data.sessionToken, // Nuevo: token para headers
                    loginTime: Date.now()
                }));

                // Limpiar localStorage viejo por si acaso
                localStorage.removeItem('nexuspos_session');

                // Redirigir al panel principal
                window.location.href = '/index.html';
            } else {
                if (response.status === 403) {
                    errorMsg.textContent = data.error || 'Sesión activa detectada en otro dispositivo.';
                } else {
                    errorMsg.textContent = data.error || 'Credenciales incorrectas.';
                }
                errorMsg.classList.remove('hidden');
                loginBtn.disabled = false;
                loginBtn.textContent = 'Entrar al Sistema';
            }
        } catch (error) {
            console.error('Error al iniciar sesión:', error);
            errorMsg.textContent = 'Error de conexión con el servidor.';
            errorMsg.classList.remove('hidden');
            loginBtn.disabled = false;
            loginBtn.textContent = 'Entrar al Sistema';
        }
    });
});
