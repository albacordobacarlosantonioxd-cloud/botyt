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
// Asegúrate de que este puerto sea el 41010 (el de tu servidor de descargas)
const API_DOWNLOAD_URL = 'http://descargas.duck.opik.net:41010/api/download';

app.use(cors());
app.use(express.json());
app.get("/", (req, res) => res.send("🚀 Bot de Descargas Activo"));
app.listen(PORT, () => console.log(`🚀 Servidor local corriendo en puerto ${PORT}`));

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
        getMessage: async () => ({ conversation: 'Mensaje omitido' })
    });

    sock.ev.on("creds.update", saveCreds);
    
    sock.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) qrcode.generate(qr, { small: true });
        if (connection === "close") {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            if (statusCode !== DisconnectReason.loggedOut) setTimeout(() => startBot(), 3000);
        } else if (connection === "open") {
            console.log("\n🏁 ¡Bot de descargas activo y patrullando! 🚀\n");
        }
    });

    sock.ev.on("messages.upsert", async (chatUpdate) => {
        try {
            if (chatUpdate.type !== 'notify') return;
            const m = chatUpdate.messages[0];
            if (!m.message || m.key.fromMe) return;

            const from = m.key.remoteJid;
            const body = (m.message.conversation || m.message.extendedTextMessage?.text || m.message.imageMessage?.caption || "").trim();

            const regexYouTube = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|shorts\/|watch\?v=)|youtu\.be\/)([a-zA-Z0-9_-]{11})/i;
            const match = body.match(regexYouTube);
            if (!match) return;

            const videoId = match[1];
            const urlLimpia = `https://www.youtube.com/watch?v=${videoId}`;

            console.log(`🎯 ENLACE DETECTADO: ${videoId}`);

            // Avisamos al usuario
            await sock.sendPresenceUpdate('composing', from);
            await sock.sendMessage(from, { text: '⏳ *Procesando video, espérame un momento...*' }, { quoted: m });

            // Petición a la API
            const respuesta = await axios.post(API_DOWNLOAD_URL, { videoUrl: urlLimpia }, { timeout: 600000 });

            if (respuesta.data && respuesta.data.success) {
                await sock.sendMessage(from, {
                    video: { url: respuesta.data.downloadUrl },
                    caption: '👑 *Aquí tienes tu video en 720p, pa!*'
                }, { quoted: m });
                console.log(`✅ Video enviado con éxito a ${from}`);
            } else {
                throw new Error('La API no devolvió éxito.');
            }
        } catch (error) {
            console.error('❌ Error en el proceso:', error.message);
            await sock.sendMessage(m?.key.remoteJid, { text: '⚠️ Falló la descarga, intenta con otro enlace o espera un poco.' });
        }
    });
}

startBot();
