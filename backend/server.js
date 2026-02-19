require('dotenv').config();
const express = require('express');
const { Client, GatewayIntentBits, Partials, ChannelType } = require('discord.js');
const mongoose = require('mongoose');

const app = express();
app.use(express.json());

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
    console.log(`🚀 [System] Private Room Mode Online on Port ${PORT}`);
});

// --- 2. เชื่อมต่อ MongoDB ---
mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 5000 })
    .then(() => console.log("📦 [Database] Connected Successfully!"))
    .catch(err => console.error("❌ [Database] Connection Failed!", err.message));

const Player = mongoose.model('Player', new mongoose.Schema({ 
    mcName: String, 
    discordId: String 
}));

const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildVoiceStates, 
        GatewayIntentBits.GuildMembers 
    ]
});

let liveData = {}; 

// --- ฟังก์ชันหาห้องว่างใน Category ---
async function findEmptyChannel(guild) {
    try {
        const category = await guild.channels.fetch(CATEGORY_ID);
        const emptyRoom = category.children.cache
            .filter(c => c.type === ChannelType.GuildVoice && c.members.size === 0 && c.id !== LOBBY_ID)
            .first();
        return emptyRoom;
    } catch (e) {
        console.error("❌ [Error] หา Category หรือห้องว่างไม่เจอ:", e.message);
        return null;
    }
}

// --- 3. ระบบย้ายจาก Lobby ไปห้องว่างทันที ---
client.on('voiceStateUpdate', async (oldState, newState) => {
    // ถ้าเข้าห้อง Lobby (ไม่ว่าจะมาจากไหน)
    if (newState.channelId === LOBBY_ID && oldState.channelId !== LOBBY_ID) {
        console.log(`🔔 [Lobby] ${newState.member.user.tag} เข้ามาที่ Lobby`);
        try {
            const emptyRoom = await findEmptyChannel(newState.guild);
            if (emptyRoom) {
                await newState.setChannel(emptyRoom);
                console.log(`🏠 [Auto-Assign] ย้าย ${newState.member.user.tag} ไปห้องว่าง: ${emptyRoom.name}`);
            } else {
                console.log("⚠️ [Warning] ไม่มีห้องว่างเหลืออยู่ใน Category!");
            }
        } catch (err) {
            console.error("❌ [Error] ย้ายคนจาก Lobby ไม่สำเร็จ:", err.message);
        }
    }
});

app.get('/', (req, res) => res.send('✅ Bot Proximity Private Room is Running!'));

// --- 4. API รับพิกัดจาก Minecraft ---
app.post('/sync', async (req, res) => {
    try {
        const { name, x, y, z } = req.body;
        if (!name) return res.sendStatus(400);

        let user = await Player.findOne({ mcName: name });
        
        // Auto-Link
        if (!user && mongoose.connection.readyState === 1) {
            try {
                const guild = await client.guilds.fetch(GUILD_ID);
                const members = await guild.members.fetch();
                const cleanMcName = name.replace(/[*.]/g, '').toLowerCase();
                const matchedMember = members.find(m => 
                    m.displayName.toLowerCase() === cleanMcName || 
                    m.user.username.toLowerCase() === cleanMcName
                );
                if (matchedMember) {
                    user = await Player.create({ mcName: name, discordId: matchedMember.id });
                    console.log(`🔗 [Linked] ${name} -> ${matchedMember.user.tag}`);
                }
            } catch (e) { console.log("Link error:", e.message); }
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
    } catch (err) { res.sendStatus(500); }
});

// --- 5. ระบบคำนวณระยะ รวม/แยก ห้อง ---
async function handleVoiceMove(moverName) {
    const mover = liveData[moverName];
    let partnerName = null;

    // หาคนที่อยู่ใกล้ที่สุดในระยะ
    for (let name in liveData) {
        if (name === moverName || !liveData[name].discordId) continue;
        const other = liveData[name];
        const dist = Math.sqrt(Math.pow(mover.x - other.x, 2) + Math.pow(mover.y - other.y, 2) + Math.pow(mover.z - other.z, 2));
        if (dist < DISTANCE_LIMIT) {
            partnerName = name;
            break;
        }
    }

    try {
        const guild = await client.guilds.fetch(GUILD_ID);
        const member = await guild.members.fetch(mover.discordId);
        if (!member.voice.channel) return;

        if (partnerName) {
            // --- กรณีเจอคนใกล้: ย้ายไปรวมกัน ---
            const partner = liveData[partnerName];
            const partnerMember = await guild.members.fetch(partner.discordId);
            
            // ถ้ายืนใกล้กันแต่ยังอยู่คนละห้อง ให้ย้ายคนขยับไปหาคนที่ยืนรอ
            if (partnerMember.voice.channelId && member.voice.channelId !== partnerMember.voice.channelId) {
                await member.voice.setChannel(partnerMember.voice.channelId);
                console.log(`👨‍👩‍👦 [Merge] ${moverName} ย้ายไปรวมกับ ${partnerName}`);
            }
        } else {
            // --- กรณีอยู่คนเดียว: ถ้าห้องที่อยู่ดันมีคนอื่น (ที่อยู่ไกล) ให้แยกตัวออกมา ---
            if (member.voice.channel.members.size > 1) {
                const emptyRoom = await findEmptyChannel(guild);
                if (emptyRoom) {
                    await member.voice.setChannel(emptyRoom);
                    console.log(`🏃 [Split] ${moverName} เดินแยกออกมาห้องว่าง: ${emptyRoom.name}`);
                }
            }
        }
    } catch (e) { }
}

client.once('ready', () => console.log(`✅ [Discord] Bot Online: Private Room System Ready`));
client.login(BOT_TOKEN);
