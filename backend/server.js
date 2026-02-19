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
    console.log(`🚀 [System] Proximity Random Split Online on Port ${PORT}`);
});

mongoose.connect(MONGO_URI).catch(err => console.error("❌ DB Error:", err.message));

const Player = mongoose.model('Player', new mongoose.Schema({ mcName: String, discordId: String }));

const client = new Client({ 
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.GuildMembers] 
});

let liveData = {}; 
let currentPartner = {}; // ใช้ติดตามว่าตอนนี้ใครคู่กับใครใน Discord

// --- 1. ระบบล้างข้อมูลคนออกเกม (Cleanup) ทุกๆ 5 วินาที ---
setInterval(() => {
    const now = Date.now();
    for (const name in liveData) {
        if (now - liveData[name].lastUpdate > 5000) { // ถ้าหายไปเกิน 5 วินาที
            console.log(`🗑️ [Cleanup] ลบพิกัดคนออฟไลน์: ${name}`);
            delete liveData[name];
        }
    }
}, 5000);

// ฟังก์ชันสุ่มหาห้องว่าง (ที่ต้องไม่ใช่ห้องเดิม)
async function findRandomEmptyChannel(guild, currentChannelId) {
    try {
        const category = await guild.channels.fetch(CATEGORY_ID);
        const emptyRooms = category.children.cache
            .filter(c => 
                c.type === ChannelType.GuildVoice && 
                c.members.size === 0 && 
                c.id !== LOBBY_ID && 
                c.id !== currentChannelId // ห้ามสุ่มได้ห้องเดิม
            );
        
        if (emptyRooms.size === 0) return null;
        return emptyRooms.random();
    } catch (e) { return null; }
}

// เข้า Lobby แล้วดีดไปห้องสุ่ม
client.on('voiceStateUpdate', async (oldState, newState) => {
    if (newState.channelId === LOBBY_ID && oldState.channelId !== LOBBY_ID) {
        const randomRoom = await findRandomEmptyChannel(newState.guild, null);
        if (randomRoom) await newState.setChannel(randomRoom);
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

async function handleVoiceMove(moverName) {
    const mover = liveData[moverName];
    let partnerName = null;
    let shortestDist = DISTANCE_LIMIT;

    // หาเพื่อนที่อยู่ใกล้ที่สุด
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
            // --- [กรณี: เจอเพื่อน] ---
            if (currentPartner[moverName] !== partnerName) {
                // ใช้กฎลำดับตัวอักษรเพื่อป้องกันการย้ายสวนกัน
                if (moverName.toLowerCase() > partnerName.toLowerCase()) {
                    const partner = liveData[partnerName];
                    const partnerMember = await guild.members.fetch(partner.discordId);
                    if (partnerMember.voice.channelId && member.voice.channelId !== partnerMember.voice.channelId) {
                        await member.voice.setChannel(partnerMember.voice.channelId);
                        currentPartner[moverName] = partnerName;
                        console.log(`🔗 [Merge] ${moverName} ไปหา ${partnerName}`);
                    }
                } else {
                    // เราเป็นคนยืนนิ่ง รอเพื่อนย้ายมาหา
                    currentPartner[moverName] = partnerName;
                }
            }
        } else {
            // --- [กรณี: อยู่คนเดียว] ---
            // ถ้าเดิมเคยมีคู่ (เพิ่งแยกกัน) หรือ ห้องปัจจุบันมีคนอื่นอยู่
            if (currentPartner[moverName] !== null || member.voice.channel.members.size > 1) {
                const randomRoom = await findRandomEmptyChannel(guild, member.voice.channelId);
                if (randomRoom) {
                    await member.voice.setChannel(randomRoom);
                    currentPartner[moverName] = null; // รีเซ็ตสถานะเป็นโสด
                    console.log(`🏃 [Split] ${moverName} แยกไปห้องสุ่มใหม่: ${randomRoom.name}`);
                }
            }
        }
    } catch (e) { }
}

client.login(BOT_TOKEN);
