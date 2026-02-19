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

// --- 1. สั่งให้เซิร์ฟเวอร์ออนไลน์ทันที ---
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 [System] API Hub Server Online on Port ${PORT}`);
});

// --- 2. เชื่อมต่อ MongoDB ---
mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 5000 })
    .then(() => console.log("📦 [Database] Connected to MongoDB Successfully!"))
    .catch(err => {
        console.error("❌ [Database] Connection Failed!", err.message);
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

app.get('/', (req, res) => {
    res.send('✅ Bot is running and healthy!');
});

// --- 3. API รับพิกัด (แก้ไขส่วน Auto-Link ให้รองรับจุด . และดอกจัน *) ---
app.post('/sync', async (req, res) => {
    try {
        const { name, x, y, z } = req.body;
        if (!name) return res.sendStatus(400);

        let user = null;
        if (mongoose.connection.readyState === 1) {
            user = await Player.findOne({ mcName: name });
        }

        // ระบบ Auto-Link (จุดสำคัญที่แก้ไข!)
        if (!user && mongoose.connection.readyState === 1) {
            try {
                const guild = await client.guilds.fetch(GUILD_ID);
                const members = await guild.members.fetch();
                
                // แก้ไขตรงนี้: ตัดทั้ง * และ . ออกก่อนนำไปเทียบกับชื่อใน Discord
                const cleanMcName = name.replace(/[*.]/g, '').toLowerCase();
                
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

// --- 4. ระบบย้ายห้องเสียง ---
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

        // ถ้ามีเพื่อนอยู่ใกล้ ให้ย้ายไปห้องคุย (ห้องแรกในหมวดหมู่) ถ้าไม่มีให้ย้ายกลับ Lobby
        const targetChannelId = partner ? voiceRoomList[0] : LOBBY_ID;
        
        if (member.voice.channelId !== targetChannelId) {
            await member.voice.setChannel(targetChannelId);
            console.log(`🎙️ [Move] Moved ${member.user.tag} to ${partner ? 'Talk Room' : 'Lobby'}`);
        }
    } catch (e) { /* ละเว้น error การย้ายห้องที่ซ้ำซ้อน */ }
}

client.once('ready', () => {
    console.log(`✅ [Discord] Logged in as ${client.user.tag}`);
});

client.login(BOT_TOKEN);
