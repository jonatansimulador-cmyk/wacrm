# WACRM — Backend real de WhatsApp

Este backend conecta la plataforma a tu WhatsApp de verdad usando un código QR
(igual que WhatsApp Web), y permite enviar mensajes individuales y masivos reales.

## Requisitos

- Node.js 18 o superior → https://nodejs.org
- Google Chrome o Chromium instalado en tu computadora (lo usa el sistema internamente para controlar WhatsApp Web)
- Un número de WhatsApp activo en tu celular para escanear el QR

## Instalación

1. Abre una terminal dentro de esta carpeta (`wacrm-backend`).
2. Instala las dependencias:
   ```
   npm install
   ```
3. Inicia el servidor:
   ```
   npm start
   ```
4. Abre tu navegador en:
   ```
   http://localhost:3000
   ```
5. Ve al menú **Dispositivos** en la barra lateral. Ahí aparecerá el código QR real.
6. En tu celular: WhatsApp → **Ajustes → Dispositivos vinculados → Vincular un dispositivo**, y escanea el código.
7. En unos segundos verás el estado cambiar a **Conectado**. A partir de ahí:
   - **Mensaje Individual**: envía un mensaje real a un número.
   - **Mensajes Masivos**: pega varios números (uno por línea) y un mensaje; se enviarán con un retraso aleatorio entre cada uno (para reducir el riesgo de bloqueo).

## Notas importantes

- Esta integración usa `whatsapp-web.js`, una librería **no oficial** que automatiza WhatsApp Web desde el navegador. No es la API oficial de Meta.
- WhatsApp puede **suspender temporal o permanentemente** números que envíen muchos mensajes en poco tiempo, sobre todo a desconocidos. Usa retrasos razonables (ya vienen configurados entre 3 y 9 segundos) y evita enviar a números que no te hayan escrito antes o no hayan dado consentimiento.
- La sesión queda guardada localmente (carpeta `.wwebjs_auth`) para que no tengas que escanear el QR cada vez que reinicies el servidor.
- Si más adelante quieres una vía 100% aprobada por WhatsApp (sin riesgo de baneo, pero que requiere aprobación de Meta Business), puedo ayudarte a migrar a la **WhatsApp Business Cloud API** oficial.

## Estructura

```
wacrm-backend/
├── server.js        ← servidor Express + whatsapp-web.js + socket.io
├── package.json      
├── public/
│   └── index.html    ← la plataforma (interfaz) ya conectada al backend real
└── README.md
```

## Usuarios y asignación de conversaciones (nuevo)

Al iniciar el servidor por primera vez, se crea automáticamente un usuario administrador. Verás esto en la terminal (o en los "Deploy Logs" de Railway):

```
👤 Usuario admin creado automáticamente:
   Usuario: admin
   Contraseña: admin123
```

**Cambia esa contraseña cuanto antes.** Puedes definir tu propio usuario/contraseña admin desde el inicio configurando estas variables de entorno antes de correr el servidor (en Railway: pestaña Variables):

```
ADMIN_USER=tu_usuario
ADMIN_PASS=una_contraseña_segura
SESSION_SECRET=un_texto_aleatorio_largo_y_único
```

**Cómo funciona:**
- Inicia sesión con el usuario admin en la URL pública de tu app.
- Ve a **Usuarios** → crea un asesor (nombre, usuario, contraseña).
- Cuando un cliente nuevo escribe, el bot conversa con él y el caso queda "🙋 Esperando asesor" en **Conversaciones**.
- Como admin, abre esa conversación y en **"Asignar a"** elige el asesor.
- Ese asesor, al iniciar sesión con su propio usuario, solo verá esa conversación (no las de otros asesores) y podrá responder directamente.
- Un asesor también puede tomar una conversación no asignada haciendo click en **"Tomar conversación"** — automáticamente queda asignada a él.

Los datos de usuarios (`users.json`) y conversaciones (`conversations.json`) se guardan en el mismo servidor — no se suben a GitHub (están en `.gitignore`) por seguridad. Igual que con la sesión de WhatsApp, en el plan gratis de Railway estos datos se pierden si el servicio se reinicia por completo, salvo que agregues un Volume persistente.
