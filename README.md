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
