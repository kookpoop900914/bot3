require('dotenv').config();
const express = require('express');
const { Client, GatewayIntentBits, Partials, ChannelType } = require('discord.js');
const mongoose = require('mongoose');

const app = express();
app.use(express.json());

// --- ดึงค่าจาก Environment Variables (.env) ---
const {
    BOT_TOKEN,
    MONGO_URI,
    GUILD_ID,
    LOBBY_ID,
    CATEGORY_ID, // เปลี่ยนมารับ ID ของหมวดหมู่แทน
    DISTANCE_LIMIT = 15,
    PORT = 3000
} = process.env;

// --- เชื่อมต่อฐานข้อมูล MongoDB ---
mongoose.connect(MONGO_URI)
    .then(() => console.log("📦 Connected to MongoDB"))
    .catch(err => console.error("❌ MongoDB Error:", err));

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

// --- API รับพิกัดและสแกนชื่ออัตโนมัติ ---
app.post('/sync', async (req, res) => {
    const { name, x, y, z } = req.body;
    
    let user = await Player.findOne({ mcName: name });

    // ระบบ Auto-Link: สแกนหาชื่อที่ตรงกันใน Discord ทันทีที่ผู้เล่นขยับตัว
    if (!user) {
        try {
            const guild = await client.guilds.fetch(GUILD_ID);
            const members = await guild.members.fetch();
            
            // ตัดเครื่องหมาย * (Geyser) ออกเพื่อเทียบชื่อ
            const cleanMcName = name.replace('*', '').toLowerCase();

            const matchedMember = members.find(m => 
                m.displayName.toLowerCase() === cleanMcName || 
                m.user.username.toLowerCase() === cleanMcName
            );

            if (matchedMember) {
                user = await Player.create({ mcName: name, discordId: matchedMember.id });
                console.log(`[Auto-Link] ผูกไอดีสำเร็จ: ${name} -> ${matchedMember.user.tag}`);
            }
        } catch (err) {
            console.error("Auto-Link Scan Error:", err);
        }
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
});

// --- ระบบย้ายห้องเสียงตามระยะห่าง (อ่านจาก Category) ---
async function handleVoiceMove(moverName) {
    const mover = liveData[moverName];
    let partner = null;

    // คำนวณระยะห่าง
    for (let name in liveData) {
        if (name === moverName || !liveData[name].discordId) continue;
        const other = liveData[name];
        
        const dist = Math.sqrt(
            Math.pow(mover.x - other.x, 2) + 
            Math.pow(mover.y - other.y, 2) + 
            Math.pow(mover.z - other.z, 2)
        );

        if (dist < DISTANCE_LIMIT) {
            partner = other;
            break; 
        }
    }

    try {
        const guild = await client.guilds.fetch(GUILD_ID);
        const member = await guild.members.fetch(mover.discordId);
        
        // ถ้าผู้เล่นไม่ได้เข้าห้องเสียงใดๆ อยู่เลย ให้ข้ามไป
        if (!member.voice.channel) return;

        // ดึงข้อมูลห้องทั้งหมดในเซิร์ฟเวอร์เพื่อให้แคชทำงาน
        await guild.channels.fetch(); 
        const category = guild.channels.cache.get(CATEGORY_ID);

        if (!category) {
            return console.log(`⚠️ หาหมวดหมู่ไม่เจอ! กรุณาเช็ค CATEGORY_ID ในไฟล์ .env`);
        }

        // กรองเอาเฉพาะ "ห้องเสียง" ที่อยู่ภายใต้หมวดหมู่นั้น
        const voiceRoomList = category.children.cache
            .filter(c => c.type === ChannelType.GuildVoice)
            .map(c => c.id);

        if (voiceRoomList.length === 0) {
            return console.log("⚠️ ไม่พบห้องเสียงในหมวดหมู่นี้เลย!");
        }

        // ถ้าใกล้กันย้ายไปห้องคุย (ดึงห้องแรกจากหมวดหมู่มาใช้) ถ้าไกลย้ายกลับ Lobby
        const targetChannelId = partner ? voiceRoomList[0] : LOBBY_ID;
        
        // ถ้าย้ายไปห้องนั้นอยู่แล้ว จะได้ไม่ต้องสั่งย้ายซ้ำให้เปลืองเน็ต
        if (member.voice.channelId !== targetChannelId) {
            await member.voice.setChannel(targetChannelId);
        }
    } catch (e) {
        // ปิดแจ้งเตือน Error จุกจิก เช่น กรณีคนกดย้ายห้องเองหรือออกดิสคอร์ดกะทันหัน
    }
}

client.once('ready', () => console.log(`✅ บอท ${client.user.tag} พร้อมทำงาน!`));
client.login(BOT_TOKEN);

app.listen(PORT, '0.0.0.0', () => console.log(`🚀 API Hub Server Online on Port ${PORT}`));
