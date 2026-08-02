/**
 * public/js/nexusAI.js
 * Lógica del asistente NexusAI para la interacción en tiempo real.
 */

class NexusAI {
    constructor() {
        this.container = null;
        this.trigger = null;
        this.messagesArea = null;
        this.input = null;
        this.sendBtn = null;
        this.isOpen = false;
        this.lastCheck = 0;
        this.badge = null;
        this.toast = null;
        this.stockAlertsActive = true;
        this.lastAlertState = '';

        this.init();
    }

    init() {
        // Inyectar el HTML del asistente al final del body
        const html = `
            <div id="nexus-ai-trigger" title="Preguntar a NexusAI">
                <i class="fas fa-robot"></i>
                <span id="nexus-ai-badge" class="nexus-ai-badge hidden">0</span>
            </div>
            <div id="nexus-ai-container">
                <div class="nexus-ai-header">
                    <h3><i class="fas fa-magic"></i> NexusAI</h3>
                    <span class="nexus-ai-close">&times;</span>
                </div>
                <div class="nexus-ai-messages" id="nexus-ai-messages-list">
                    <div class="ai-msg bot">
                        ¡Hola! Soy **NexusAI**. Estoy aquí para ayudarte a analizar tu negocio. ¿Qué deseas saber hoy?
                    </div>
                </div>
                <div class="nexus-ai-suggestions" id="nexus-ai-suggestions">
                    <button class="ai-suggestion-btn" data-query="Ventas de hoy">Ventas hoy</button>
                    <button class="ai-suggestion-btn" data-query="¿Quiénes me deben?">Deudores</button>
                    <button class="ai-suggestion-btn" data-query="Valor del inventario">Inventario</button>
                    <button class="ai-suggestion-btn" data-query="Mejores clientes">Top Clientes</button>
                </div>
                <div class="nexus-ai-input">
                    <button id="nexus-ai-mic-btn" title="Hablar"><i class="fas fa-microphone"></i></button>
                    <input type="text" id="nexus-ai-input-field" placeholder="Escribe tu pregunta..." autocomplete="off">
                    <button id="nexus-ai-send-btn"><i class="fas fa-paper-plane"></i></button>
                </div>
            </div>
            <div id="nexus-ai-stock-toast" class="nexus-ai-stock-toast">
                <i class="fas fa-exclamation-triangle"></i>
                <div class="toast-text" id="nexus-ai-toast-text">Stock bajo detectado</div>
                <span class="toast-close">&times;</span>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', html);

        // Referencias a elementos
        this.container = document.getElementById('nexus-ai-container');
        this.trigger = document.getElementById('nexus-ai-trigger');
        this.messagesArea = document.getElementById('nexus-ai-messages-list');
        this.input = document.getElementById('nexus-ai-input-field');
        this.sendBtn = document.getElementById('nexus-ai-send-btn');
        this.micBtn = document.getElementById('nexus-ai-mic-btn');
        this.badge = document.getElementById('nexus-ai-badge');
        this.toast = document.getElementById('nexus-ai-stock-toast');
        this.toastText = document.getElementById('nexus-ai-toast-text');
        const closeBtn = this.container.querySelector('.nexus-ai-close');
        const closeToast = this.toast.querySelector('.toast-close');

        // Eventos
        this.trigger.addEventListener('click', () => this.toggle());
        closeBtn.addEventListener('click', () => this.toggle());
        
        if (this.toast) {
            this.toast.addEventListener('click', (e) => {
                if (e.target.classList.contains('toast-close')) {
                    this.hideToast();
                } else {
                    this.hideToast();
                    if (!this.isOpen) this.toggle();
                }
            });
        }

        this.sendBtn.addEventListener('click', () => this.sendMessage());
        this.input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.sendMessage();
        });

        // Evento de Voz
        if (this.micBtn) {
            this.micBtn.addEventListener('click', () => this.toggleSpeech());
        }

        // Sugerencias rápidas
        this.container.addEventListener('click', (e) => {
            const btn = e.target.closest('.ai-suggestion-btn');
            if (btn) {
                const query = btn.dataset.query;
                this.input.value = query;
                this.sendMessage();
            }
        });

        // Cargar estilos si no están
        if (!document.querySelector('link[href*="nexusAI.css"]')) {
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = '/css/nexusAI.css';
            document.head.appendChild(link);
        }

        // Iniciar chequeos automáticos
        setTimeout(() => this.checkStockAlerts(), 5000); 
        setTimeout(() => this.checkExpirationAlerts(), 10000); // 10s para no saturar al inicio
        
        setInterval(() => this.checkStockAlerts(), 1000 * 60 * 5); // Cada 5 minutos
        setInterval(() => this.checkExpirationAlerts(), 1000 * 60 * 15); // Cada 15 minutos
    }

    toggle() {
        this.isOpen = !this.isOpen;
        this.container.classList.toggle('active', this.isOpen);
        if (this.isOpen) {
            this.input.focus();
            // Limpiar badge al abrir si hay alertas
            if (this.badge) {
                this.badge.classList.add('hidden');
                this.badge.textContent = '0';
            }
        }
    }

    addMessage(text, sender) {
        const msgDiv = document.createElement("div");
        msgDiv.className = `ai-msg ${sender}`;

        // Formatear enlaces markdown [label](url) y negritas
        let formattedText = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" class="ai-link" target="_blank">$1</a>');
        formattedText = formattedText.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
        formattedText = formattedText.replace(/\n/g, '<br>');

        msgDiv.innerHTML = formattedText;
        this.messagesArea.appendChild(msgDiv);
        this.messagesArea.scrollTop = this.messagesArea.scrollHeight;

        // --- TTS: RESPUESTA POR VOZ ---
        if (sender === "bot" && text !== '...') {
            if (!window.speechSynthesis) return;
            if (localStorage.getItem('nexusai_voice_enabled') === 'false') return;

            // Limpiar texto de etiquetas markdown/formato para la voz
            const cleanText = text.replace(/\*\*/g, '').replace(/\[.*?\]/g, '');

            const utterance = new SpeechSynthesisUtterance(cleanText);
            utterance.lang = 'es-ES';
            utterance.rate = 1.1; // Un poco más rápido para fluidez

            // Si el bot está preguntando algo (termina en ?) o estamos en modo guiado
            // Reactivar el micrófono automáticamente después de que termine de hablar
            utterance.onend = () => {
                const isQuestion = text.includes('?') || text.includes('¿');
                if (isQuestion && this.recognition && !this.isListening) { // Only start if not already listening
                    this.startSpeech();
                }
            };

            // Cancelar cualquier discurso previo para evitar solapamientos
            window.speechSynthesis.cancel();
            
            // Forzar carga de voces si es necesario
            if (window.speechSynthesis.getVoices().length === 0) {
                window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.speak(utterance);
            } else {
                window.speechSynthesis.speak(utterance);
            }
        }
    }

    // The speak function is now integrated into addMessage for bot messages.
    // Keeping it here as a placeholder or if it's used elsewhere.
    // If not used, it can be removed.
    speak(text) {
        if (!window.speechSynthesis) return;
        if (localStorage.getItem('nexusai_voice_enabled') === 'false') return;
        const cleanText = text.replace(/\*\*/g, '').replace(/\[.*?\]/g, '');
        const utterance = new SpeechSynthesisUtterance(cleanText);
        utterance.lang = 'es-ES';
        utterance.rate = 1.0;
        utterance.pitch = 1.0;
        // Cancelar cualquier discurso previo para evitar solapamientos
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(utterance);
    }

    async sendMessage() {
        const text = this.input.value.trim();
        if (!text) return;

        // Limpiar input y agregar mensaje del usuario
        this.input.value = '';
        this.addMessage(text, 'user');

        try {
            // Loader
            const loaderId = 'ai-loader-' + Date.now();
            this.addMessage('...', 'bot');
            const lastMsg = this.messagesArea.lastElementChild;
            lastMsg.id = loaderId;

            const response = await fetch('/api/ai/query', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt: text })
            });

            const data = await response.json();

            // Eliminar loader y poner respuesta
            lastMsg.remove();
            this.addMessage(data.text, 'bot');

            // Ejecutar acciones especiales (callbacks)
            if (data.action) {
                this.handleAction(data.action);
            }

        } catch (error) {
            console.error('Error in AI Assistant:', error);
            this.addMessage('Lo siento, hubo un error de conexión con mi cerebro virtual.', 'bot');
        }
    }

    handleAction(action) {
        setTimeout(() => {
            switch (action) {
                case 'redirect_reports':
                    window.location.href = '/reports.html';
                    break;
                case 'redirect_inventory':
                    window.location.href = '/inventario.html';
                    break;
                case 'show_inventory_report':
                case 'download_pdf':
                    // Si el bot dice descargar, simulamos clic en el botón de exportar del inventario
                    // O podemos abrir el modal de discrepancias directamente
                    // Abrir en ventana tipo APP
                    if (typeof window.openAppWindow === 'function') {
                        window.openAppWindow('/inventario.html?view=discrepancies&action=download', 'Reporte de Inventario', 1000, 800);
                    } else {
                        window.open('/inventario.html?view=discrepancies&action=download', '_blank');
                    }
                    break;
                default:
                    console.log('Acción no reconocida:', action);
            }
        }, 2000);
    }

    // --- ALERTAS DE STOCK ---

    // --- RECONOCIMIENTO DE VOZ ---
    toggleSpeech() {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            this.addMessage("Tu navegador no soporta reconocimiento de voz.", "bot");
            return;
        }

        if (this.isListening) {
            this.recognition.stop();
            return;
        }

        this.recognition = new SpeechRecognition();
        this.recognition.lang = 'es-ES';
        this.recognition.interimResults = false;
        this.recognition.maxAlternatives = 1;

        this.recognition.onstart = () => {
            this.isListening = true;
            this.micBtn.classList.add('listening');
            this.input.placeholder = "Escuchando...";
        };

        this.recognition.onresult = (event) => {
            const transcript = event.results[0][0].transcript;
            this.input.value = transcript;
            this.sendMessage();
        };

        this.recognition.onerror = (event) => {
            console.error("Speech Error:", event.error);
            if (event.error === 'not-allowed') {
                this.addMessage("El microfono está bloqueado. En móvil debes usar HTTPS o habilitar el flag de 'Insecure origins as secure' en Chrome.", "bot");
            } else {
                this.addMessage("Ocurrió un error con el reconocimiento de voz: " + event.error, "bot");
            }
            this.stopSpeech();
        };

        this.recognition.onend = () => {
            this.stopSpeech();
        };

        this.recognition.start();
    }

    stopSpeech() {
        this.isListening = false;
        if (this.micBtn) this.micBtn.classList.remove('listening');
        if (this.input) this.input.placeholder = "Escribe tu pregunta...";
    }

    async checkStockAlerts() {
        if (!this.stockAlertsActive) return;

        try {
            console.log('[NexusAI] Checking stock alerts...');
            const response = await fetch('/api/products?stock_bajo=1');
            if (!response.ok) return;

            const data = await response.json();
            // Filtrado del lado del cliente como doble chequeo y por el default de 5
            const lowStockProducts = data.products.filter(p => p.stock <= (p.stock_minimo || 5));

            if (lowStockProducts.length > 0) {
                // Verificar si hay cambios reales en stock para evitar alertas repetitivas idénticas
                const currentAlertState = lowStockProducts.map(p => `${p.id}:${p.stock}`).join('|');
                if (currentAlertState !== this.lastAlertState) {
                    this.lastAlertState = currentAlertState;
                    this.showStockNotification(lowStockProducts);
                }
            }
        } catch (error) {
            console.error('Error checking stock alerts:', error);
        }
    }

    showStockNotification(products) {
        const count = products.length;
        
        // Actualizar badge
        if (this.badge) {
            this.badge.textContent = count;
            this.badge.classList.remove('hidden');
        }

        // Crear mensaje AI
        let msg = `⚠️ **¡Alerta de Stock Bajo!**\n\nHe detectado que **${count}** productos han alcanzado su nivel crítico:\n\n`;
        
        products.slice(0, 5).forEach(p => {
            msg += `- **${p.nombre}**: Quedan ${p.stock} (Mínimo: ${p.stock_minimo || 5})\n`;
        });

        if (count > 5) {
            msg += `\n...y ${count - 5} productos más.`;
        }

        msg += `\n\n¿Deseas que te ayude a generar una lista de pedidos?`;

        // Mostrar Toast si no está abierto el chat
        if (!this.isOpen) {
            this.showToast(`¡Alerta! Productos con stock bajo`);
        }

        // Notificar por voz
        this.addMessage(msg, 'bot');
        
        // Efecto visual en el trigger
        this.trigger.classList.add('pulse-alert');
        setTimeout(() => this.trigger.classList.remove('pulse-alert'), 10000);
    }

    showToast(text) {
        if (!this.toast) return;
        this.toastText.textContent = text;
        this.toast.classList.add('active');
        
        // Auto ocultar después de 8 segundos
        if (this.toastTimeout) clearTimeout(this.toastTimeout);
        this.toastTimeout = setTimeout(() => this.hideToast(), 8000);
    }

    hideToast() {
        if (this.toast) this.toast.classList.remove('active');
    }

    async checkExpirationAlerts() {
        try {
            const response = await fetch('/api/products');
            if (!response.ok) return;
            const data = await response.json();
            
            const today = new Date();
            today.setHours(0,0,0,0);
            
            const expiringSoon = data.products.filter(p => {
                if (!p.fecha_vencimiento) return false;
                const expDate = new Date(p.fecha_vencimiento + 'T00:00:00');
                const diffTime = expDate - today;
                const daysLeft = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                return daysLeft <= 15;
            });

            if (expiringSoon.length > 0) {
                this.showExpirationNotification(expiringSoon);
            }
        } catch (error) {
            console.error('Error checking expiration alerts:', error);
        }
    }

    showExpirationNotification(products) {
        const count = products.length;
        this.playAlertSound('expiration');

        if (this.badge) {
            const current = parseInt(this.badge.textContent) || 0;
            this.badge.textContent = current + count;
            this.badge.classList.remove('hidden');
        }

        let msg = `📅 **¡Alerta de Vencimiento!**\n\nHe detectado que **${count}** productos están vencidos o próximos a vencer (15 días):\n\n`;
        
        products.slice(0, 5).forEach(p => {
            const today = new Date();
            today.setHours(0,0,0,0);
            const expDate = new Date(p.fecha_vencimiento + 'T00:00:00');
            const diffTime = expDate - today;
            const daysLeft = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            const status = daysLeft <= 0 ? 'VENCIDO' : `Vence en ${daysLeft} días`;
            msg += `- **${p.nombre}**: ${status} (${p.fecha_vencimiento})\n`;
        });

        if (count > 5) msg += `\n...y ${count - 5} productos más.`;

        if (!this.isOpen) {
            this.showToast(`¡Alerta! ${count} productos vencidos/por vencer`);
        }

        this.addMessage(msg, 'bot');
        this.trigger.classList.add('pulse-alert');
        setTimeout(() => this.trigger.classList.remove('pulse-alert'), 10000);
    }

    playAlertSound(type = 'stock') {
        try {
            const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            if (audioCtx.state === 'suspended') audioCtx.resume();

            const playBeep = (freq, duration, vol) => {
                const osc = audioCtx.createOscillator();
                const gain = audioCtx.createGain();
                osc.connect(gain);
                gain.connect(audioCtx.destination);
                osc.type = 'sine';
                osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
                gain.gain.setValueAtTime(vol, audioCtx.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + duration);
                osc.start();
                osc.stop(audioCtx.currentTime + duration);
            };

            if (type === 'expiration') {
                playBeep(880, 0.1, 0.1);
                setTimeout(() => playBeep(880, 0.1, 0.1), 150);
            } else {
                playBeep(440, 0.3, 0.1);
            }
        } catch (e) { console.warn('Audio not available', e); }
    }
}

// Inicialización segura
function initNexusAI() {
    if (!window.nexusAIInstance) {
        window.nexusAIInstance = new NexusAI();
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initNexusAI);
} else {
    initNexusAI();
}
