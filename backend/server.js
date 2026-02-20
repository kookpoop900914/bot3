require('dotenv').config();
const express = require('express');
const { Client, GatewayIntentBits, ChannelType } = require('discord.js');
const mongoose = require('mongoose');

const app = express();
app.use(express.json());

const { BOT_TOKEN, MONGO_URI, GUILD_ID, LOBBY_ID, CATEGORY_ID, DISTANCE_LIMIT = 15 } = process.env;

app.listen(process.env.PORT || 3000, '0.0.0.0', () => console.log(`🚀 Proximity System Online`));
mongoose.connect(MONGO_URI).then(() => console.log("📦 DB Connected"));

const client = new Client({ 
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.GuildMembers] 
});

let liveData = {}; // เก็บพิกัด { x, z, lastUpdate }
let userStates = {}; // เก็บสถานะว่าใครอยู่กับใคร

// ฟังก์ชันหาห้องว่างในหมวดหมู่ที่กำหนด
async function findEmptyChannel(guild) {
    const category = await guild.channels.fetch(CATEGORY_ID);
    const voiceChannels = category.children.cache.filter(c => c.type === ChannelType.GuildVoice && c.id !== LOBBY_ID);
    // หาห้องที่ไม่มีคนอยู่เลย
    return voiceChannels.find(c => c.members.size === 0);
}

// 1. ระบบย้ายจาก Lobby ไปห้องว่างทันที
client.on('voiceStateUpdate', async (oldState, newState) => {
    if (newState.channelId === LOBBY_ID) {
        const guild = newState.guild;
        const emptyRoom = await findEmptyChannel(guild);
        if (emptyRoom) {
            await newState.setChannel(emptyRoom);
            console.log(`🏠 Moved ${newState.member.displayName} to empty room: ${emptyRoom.name}`);
        }
    }
});

// 2. ระบบคำนวณพิกัด (รวมห้อง/แยกห้อง)
app.post('/sync', async (req, res) => {
    const { name, x, z } = req.body;
    res.sendStatus(200);
    liveData[name] = { x, z, lastUpdate: Date.now() };

    try {
        const guild = await client.guilds.fetch(GUILD_ID);
        const members = await guild.members.fetch();
        const mover = members.find(m => m.displayName.toLowerCase() === name.toLowerCase());

        if (!mover || !mover.voice.channel) return;

        let foundPartner = null;

        // เช็คหาคนที่อยู่ใกล้ที่สุด
        for (let otherName in liveData) {
            if (otherName === name) continue;
            // เช็คว่าคนนั้นยังออนไลน์อยู่ (ไม่เกิน 10 วินาที)
            if (Date.now() - liveData[otherName].lastUpdate > 10000) continue;

            const dist = Math.sqrt(Math.pow(x - liveData[otherName].x, 2) + Math.pow(z - liveData[otherName].z, 2));

            if (dist <= DISTANCE_LIMIT) {
                foundPartner = members.find(m => m.displayName.toLowerCase() === otherName.toLowerCase());
                break; // เจอคนใกล้แล้วหยุดหา
            }
        }

        if (foundPartner && foundPartner.voice.channelId) {
            // --- กรณีอยู่ใกล้กัน ---
            if (mover.voice.channelId !== foundPartner.voice.channelId) {
                // เอ เดินไปหา บี -> เอ ย้ายไปหา บี
                await mover.voice.setChannel(foundPartner.voice.channelId);
                console.log(`🔗 Joined: ${name} -> ${foundPartner.displayName}`);
            }
        } else {
            // --- กรณีอยู่ห่างกัน (และปัจจุบันไม่ได้อยู่คนเดียว) ---
            // ถ้าในห้องปัจจุบันมีคนอื่นอยู่ด้วย แต่ไม่มีใครอยู่ใกล้แล้ว ให้แยกตัวออก
            if (mover.voice.channel.members.size > 1) {
                const emptyRoom = await findEmptyChannel(guild);
                if (emptyRoom) {
                    await mover.voice.setChannel(emptyRoom);
                    console.log(`🚪 Split: ${name} moved to solo room`);
                }
            }
        }
    } catch (e) { console.error(e); }
});

client.login(BOT_TOKEN);
