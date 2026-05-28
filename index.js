import "dotenv/config";
import express from "express";
import cors from "cors";
import pino from "pino";
import axios from "axios";
import qrcode from "qrcode-terminal";
import {
    default as makeWASocket,
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    DisconnectReason
} from "@whiskeysockets/baileys";

const app = express();
const PORT = process.env.PORT || 3000;

const API_DOWNLOAD_URL = 'http://duck.opik.net:41007/api/download';

// --- CONFIGURACIÓN EXPRESS ---
app.use(cors());
app.use(express.json());
app.get("/", (req, res) => res.send("🚀 Bot de Descargas Activo"));
app.listen(PORT, () => console.log(`🚀 Servidor local corriendo en puerto ${PORT}`));

// --- WHATSAPP CONNECTION ---
let sock;
async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState("sesions/owner");
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
        version,
        logger: pino({ level: "silent" }),
        auth: state,
        browser: ["Charly-Descargas", "Chrome", "1.0.0"],
        
        syncFullHistory: false,
        shouldSyncHistoryMessage: () => false,
        getMessage: async () => {
            return { conversation: 'Mensaje omitido' };
        }
    });

    sock.ev.on("creds.update", saveCreds);
    
    sock.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            console.log('\n📌 ESCANEA EL CÓDIGO QR, PA:\n');
            qrcode.generate(qr, { small: true });
        }
        
        if (connection === "close") {
            const statusCode = lastDisconnect?.error?.output?.statusCode || lastDisconnect?.error?.statusCode;
            if (statusCode === DisconnectReason.loggedOut) {
                console.log("🛑 Sesión cerrada definitivamente por el usuario.");
                return;
            }
            console.log("🔄 Conexión interrumpida. Reiniciando en 3 segundos...");
            setTimeout(() => startBot(), 3000);
        } else if (connection === "open") {
            console.log("\n🏁 ¡Bot de descargas exclusivo activo y patrullando chats! 🚀\n");
        }
    });

    // 📩 MANEJO DE MENSAJES (Formato blindado anti-congelamiento)
    sock.ev.on("messages.upsert", async (chatUpdate) => {
        try {
            // Validamos que el update traiga un mensaje real y que sea un mensaje NUEVO ('notify')
            if (!chatUpdate.messages || chatUpdate.type !== 'notify') return;
            
            const m = chatUpdate.messages[0];
            if (!m.message || m.key.fromMe) return;

            const from = m.key.remoteJid;
            
            // Extraer el texto de cualquier parte donde venga escondido
            const body = (
                m.message.conversation || 
                m.message.extendedTextMessage?.text || 
                m.message.imageMessage?.caption || 
                ""
            ).trim();

            if (!body) return;

            // 🔥 LOG OBLIGATORIO: Sí o sí tiene que pintar esto en tu terminal al recibir texto
            console.log(`💬 Texto detectado en [${from}]: "${body}"`);

            // 🎯 Expresión regular todoterreno
            const regexYouTube = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|shorts\/|watch\?v=)|youtu\.be\/)([a-zA-Z0-9_-]{11})/i;
            const match = body.match(regexYouTube);

            if (!match) return;

            const videoId = match[1];
            const urlLimpia = `https://www.youtube.com/watch?v=${videoId}`;

            console.log(`🎯 ¡ENLACE MATCHED! ID: ${videoId}. Enviando petición a la API...`);

            await sock.sendMessage(from, { 
                text: '⏳ *Detecté tu enlace, pariente. Procesando video en 720p, espérame un momento...*' 
            }, { quoted: m });

            const respuesta = await axios.post(API_DOWNLOAD_URL, {
                videoUrl: urlLimpia
            });

            if (respuesta.data.success) {
                const videoLinkDirecto = respuesta.data.downloadUrl;
                
                await sock.sendMessage(from, {
                    video: { url: videoLinkDirecto },
                    caption: '👑 *Aquí tienes tu video en 720p, pa!* 👑'
                }, { quoted: m });

                console.log(`✅ Video enviado con éxito a ${from}`);
            } else {
                throw new Error('La API respondió false en success.');
            }

        } catch (error) {
            console.error('❌ Error dentro del lector de mensajes:', error.message);
        }
    });
}

startBot();

export { sock };
