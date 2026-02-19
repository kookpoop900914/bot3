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

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 [System] API Hub Server Online on Port ${PORT}`);
});

mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 5000 })
    .then(() => console.log("📦 [Database] Connected to MongoDB Successfully!"))
    .catch(err => console.error("❌ [Database] Connection Failed!", err.message));

const Player = mongoose.model('Player', new mongoose.Schema({ 
    mcName: String, 
    discordId: String 
}));

const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildVoiceStates, 
        GatewayIntentBits.GuildMessages, 
        GatewayIntentBits.GuildMembers 
    ]
});

let liveData = {}; 
let lastAttempt = {}; // เก็บเวลาที่พยายามหาชื่อล่าสุด

app.get('/', (req, res) => res.send('✅ Bot is running and healthy!'));

app.post('/sync', async (req, res) => {
    try {
        const { name, x, y, z } = req.body;
        if (!name) return res.sendStatus(400);

        let user = null;
        if (mongoose.connection.readyState === 1) {
            user = await Player.findOne({ mcName: name });
        }

        // --- ระบบ Auto-Link แบบป้องกัน Rate Limit ---
        const now = Date.now();
        if (!user && mongoose.connection.readyState === 1) {
            // ถ้าไม่เคยพยายามหาคนนี้ หรือหาครั้งล่าสุดเกิน 60 วินาทีแล้ว ค่อยหาใหม่
            if (!lastAttempt[name] || (now - lastAttempt[name] > 60000)) {
                lastAttempt[name] = now;
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
                        console.log(`🔗 [Auto-Link] Linked: ${name} -> ${matchedMember.user.tag}`);
                    } else {
                        console.log(`🔍 [Search] ไม่พบชื่อ "${cleanMcName}" ใน Discord (รอเช็คใหม่รอบหน้า)`);
                    }
                } catch (scanErr) { 
                    console.error("Auto-Link Error (Rate Limit?):", scanErr.message); 
                }
            }
        }

        liveData[name] = { 
            discordId: user ? user.discordId : null,
            x, y, z, 
            lastUpdate: now 
        };

        if (liveData[name].discordId) {
            handleVoiceMove(name);
        }
        res.sendStatus(200);
    } catch (err) {
        res.sendStatus(500);
    }
});

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
            .sort((a, b) => a.position - b.position)
            .map(c => c.id);

        if (voiceRoomList.length === 0) return;

        const targetChannelId = partner ? voiceRoomList[0] : LOBBY_ID;
        if (member.voice.channelId !== targetChannelId) {
            await member.voice.setChannel(targetChannelId);
            console.log(`🎙️ [Move] Moved ${member.user.tag} to ${partner ? 'Talk Room' : 'Lobby'}`);
        }
    } catch (e) { }
}

client.once('ready', () => console.log(`✅ [Discord] Logged in as ${client.user.tag}`));
client.login(BOT_TOKEN);
