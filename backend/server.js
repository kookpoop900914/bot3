require('dotenv').config();
const express = require('express');
const { Client, GatewayIntentBits, ChannelType } = require('discord.js');
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
    console.log(`🚀 [System] Fixed Proximity Mode Online on Port ${PORT}`);
});

mongoose.connect(MONGO_URI)
    .then(() => console.log("📦 [Database] Connected Successfully!"))
    .catch(err => console.error("❌ [Database] Connection Failed!", err.message));

const Player = mongoose.model('Player', new mongoose.Schema({ mcName: String, discordId: String }));

const client = new Client({ 
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.GuildMembers] 
});

let liveData = {}; 

// ฟังก์ชันหาห้องว่าง
async function findEmptyChannel(guild) {
    try {
        const category = await guild.channels.fetch(CATEGORY_ID);
        return category.children.cache
            .filter(c => c.type === ChannelType.GuildVoice && c.members.size === 0 && c.id !== LOBBY_ID)
            .first();
    } catch (e) { return null; }
}

// ระบบ Auto-Move จาก Lobby
client.on('voiceStateUpdate', async (oldState, newState) => {
    if (newState.channelId === LOBBY_ID && oldState.channelId !== LOBBY_ID) {
        const emptyRoom = await findEmptyChannel(newState.guild);
        if (emptyRoom) await newState.setChannel(emptyRoom);
    }
});

app.post('/sync', async (req, res) => {
    try {
        const { name, x, y, z } = req.body;
        if (!name) return res.sendStatus(400);

        let user = await Player.findOne({ mcName: name });
        if (!user) {
            const guild = await client.guilds.fetch(GUILD_ID);
            const members = await guild.members.fetch();
            const cleanMcName = name.replace(/[*.]/g, '').toLowerCase();
            const matchedMember = members.find(m => m.displayName.toLowerCase() === cleanMcName || m.user.username.toLowerCase() === cleanMcName);
            if (matchedMember) user = await Player.create({ mcName: name, discordId: matchedMember.id });
        }

        liveData[name] = { discordId: user ? user.discordId : null, x, y, z, lastUpdate: Date.now() };
        if (liveData[name].discordId) handleVoiceMove(name);
        res.sendStatus(200);
    } catch (err) { res.sendStatus(500); }
});

// --- หัวใจการแก้ไขบัคสลับห้อง ---
async function handleVoiceMove(moverName) {
    const mover = liveData[moverName];
    let partnerName = null;
    let shortestDist = DISTANCE_LIMIT;

    // 1. หาคนที่อยู่ใกล้ที่สุด
    for (let name in liveData) {
        if (name === moverName || !liveData[name].discordId) continue;
        const other = liveData[name];
        const dist = Math.sqrt(Math.pow(mover.x - other.x, 2) + Math.pow(mover.y - other.y, 2) + Math.pow(mover.z - other.z, 2));
        if (dist < shortestDist) {
            shortestDist = dist;
            partnerName = name;
        }
    }

    try {
        const guild = await client.guilds.fetch(GUILD_ID);
        const member = await guild.members.fetch(mover.discordId);
        if (!member.voice.channel) return;

        if (partnerName) {
            // --- กรณีเจอคนใกล้ (MERGE) ---
            // ใช้กฎ: คนที่ชื่อ "มาทีหลัง" ในลำดับตัวอักษร จะเป็นคนย้ายไปหาคนที่ชื่อ "มาก่อน"
            // เช่น A กับ B -> B จะย้ายไปหา A เสมอ (ป้องกันการย้ายสวนกัน)
            if (moverName.toLowerCase() > partnerName.toLowerCase()) {
                const partner = liveData[partnerName];
                const partnerMember = await guild.members.fetch(partner.discordId);
                
                if (partnerMember.voice.channelId && member.voice.channelId !== partnerMember.voice.channelId) {
                    await member.voice.setChannel(partnerMember.voice.channelId);
                    console.log(`🔗 [Merge] ${moverName} ย้ายไปหา ${partnerName}`);
                }
            }
        } else {
            // --- กรณีอยู่คนเดียว (SPLIT) ---
            if (member.voice.channel.members.size > 1) {
                // เช็คว่าคนอื่นในห้องอยู่ไกลหมดเลยใช่ไหม?
                let anyoneNear = false;
                member.voice.channel.members.forEach(m => {
                    const otherName = Object.keys(liveData).find(k => liveData[k].discordId === m.id);
                    if (otherName && otherName !== moverName) {
                        const other = liveData[otherName];
                        const d = Math.sqrt(Math.pow(mover.x-other.x,2)+Math.pow(mover.y-other.y,2)+Math.pow(mover.z-other.z,2));
                        if (d < DISTANCE_LIMIT) anyoneNear = true;
                    }
                });

                if (!anyoneNear) {
                    const emptyRoom = await findEmptyChannel(guild);
                    if (emptyRoom) {
                        await member.voice.setChannel(emptyRoom);
                        console.log(`🏃 [Split] ${moverName} แยกไปห้องว่าง`);
                    }
                }
            }
        }
    } catch (e) { }
}

client.login(BOT_TOKEN);
