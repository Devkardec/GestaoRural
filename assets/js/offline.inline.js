function goHome() {
            window.location.href = '/';
        }
        
        // Verificar conexão periodicamente
        function checkConnection() {
            if (navigator.onLine) {
                window.location.reload();
            }
        }
        
        // Verificar a cada 5 segundos
        setInterval(checkConnection, 5000);
        
        // Escutar eventos de conexão
        window.addEventListener('online', () => {
            window.location.reload();
        });