require('dotenv').config();
const express = require('express');
const { Client, GatewayIntentBits, Partials, ChannelType } = require('discord.js');
const mongoose = require('mongoose');

const app = express();
app.use(express.json());

// --- ดึงค่าจาก Environment Variables ---
const {
    BOT_TOKEN,
    MONGO_URI,
    GUILD_ID,
    LOBBY_ID,
    CATEGORY_ID,
    DISTANCE_LIMIT = 15,
    PORT = 3000
} = process.env;

// --- 1. สั่งให้เซิร์ฟเวอร์ออนไลน์ทันที (แก้ปัญหา 502 Bad Gateway) ---
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 [System] API Hub Server Online on Port ${PORT}`);
});

// --- 2. เชื่อมต่อ MongoDB แบบ Non-Blocking ---
mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 5000 })
    .then(() => console.log("📦 [Database] Connected to MongoDB Successfully!"))
    .catch(err => {
        console.error("❌ [Database] Connection Failed!");
        console.error("ตรวจสอบ IP Whitelist (0.0.0.0/0) ใน MongoDB Atlas ด้วยนะครับ");
    });

const Player = mongoose.model('Player', new mongoose.Schema({ 
    mcName: String, 
    discordId: String 
}));

const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildVoiceStates, 
        GatewayIntentBits.GuildMessages, 
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers 
    ],
    partials: [Partials.Channel]
});

let liveData = {}; 

// --- 3. หน้าแรกสำหรับเช็คสถานะ (ถ้าเข้าลิงก์แล้วเห็นคำนี้ แปลว่าไม่ 502 แล้ว) ---
app.get('/', (req, res) => {
    res.send('✅ Bot is running and healthy!');
});

// --- 4. API รับพิกัดจาก Minecraft ---
app.post('/sync', async (req, res) => {
    try {
        const { name, x, y, z } = req.body;
        if (!name) return res.sendStatus(400);

        // เช็คสถานะ DB ก่อนค้นหา
        let user = null;
        if (mongoose.connection.readyState === 1) {
            user = await Player.findOne({ mcName: name });
        }

        // ระบบ Auto-Link
        if (!user && mongoose.connection.readyState === 1) {
            try {
                const guild = await client.guilds.fetch(GUILD_ID);
                const members = await guild.members.fetch();
                const cleanMcName = name.replace('*', '').toLowerCase();
                const matchedMember = members.find(m => 
                    m.displayName.toLowerCase() === cleanMcName || 
                    m.user.username.toLowerCase() === cleanMcName
                );
                if (matchedMember) {
                    user = await Player.create({ mcName: name, discordId: matchedMember.id });
                    console.log(`🔗 [Auto-Link] Linked: ${name} -> ${matchedMember.user.tag}`);
                }
            } catch (scanErr) { console.error("Auto-Link Error:", scanErr.message); }
        }

        liveData[name] = { 
            discordId: user ? user.discordId : null,
            x, y, z, 
            lastUpdate: Date.now() 
        };

        if (liveData[name].discordId) {
            handleVoiceMove(name);
        }
        res.sendStatus(200);
    } catch (err) {
        console.error("Sync Error:", err.message);
        res.sendStatus(500);
    }
});

// --- 5. ระบบย้ายห้องเสียง ---
async function handleVoiceMove(moverName) {
    const mover = liveData[moverName];
    let partner = null;

    for (let name in liveData) {
        if (name === moverName || !liveData[name].discordId) continue;
        const other = liveData[name];
        const dist = Math.sqrt(Math.pow(mover.x - other.x, 2) + Math.pow(mover.y - other.y, 2) + Math.pow(mover.z - other.z, 2));
        if (dist < DISTANCE_LIMIT) { partner = other; break; }
    }

    try {
        const guild = await client.guilds.fetch(GUILD_ID);
        const member = await guild.members.fetch(mover.discordId);
        if (!member.voice.channel) return;

        const category = guild.channels.cache.get(CATEGORY_ID) || await guild.channels.fetch(CATEGORY_ID);
        const voiceRoomList = category.children.cache
            .filter(c => c.type === ChannelType.GuildVoice)
            .map(c => c.id);

        if (voiceRoomList.length === 0) return;

        const targetChannelId = partner ? voiceRoomList[0] : LOBBY_ID;
        if (member.voice.channelId !== targetChannelId) {
            await member.voice.setChannel(targetChannelId);
            console.log(`🎙️ [Move] Moved ${member.user.tag} to ${partner ? 'Talk Room' : 'Lobby'}`);
        }
    } catch (e) { /* ปิด error จุกจิก */ }
}

client.once('ready', () => {
    console.log(`✅ [Discord] Logged in as ${client.user.tag}`);
});

client.login(BOT_TOKEN);
