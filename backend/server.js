require('dotenv').config();
const express = require('express');
const { Client, GatewayIntentBits, ChannelType } = require('discord.js');
const mongoose = require('mongoose');

const app = express();
app.use(express.json());

const { BOT_TOKEN, MONGO_URI, GUILD_ID, LOBBY_ID, CATEGORY_ID, DISTANCE_LIMIT = 15, PORT = 3000 } = process.env;

// หน้าแรกป้องกัน 404 และใช้ปลุกบอท
app.get('/', (req, res) => res.send('🚀 Proximity Server is Online!'));

app.listen(PORT, '0.0.0.0', () => console.log(`🛰️  API Online on port ${PORT}`));

mongoose.connect(MONGO_URI).then(() => console.log("📦 DB Connected")).catch(err => console.error(err));

const Player = mongoose.model('Player', new mongoose.Schema({ mcName: String, discordId: String }));
const client = new Client({ 
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.GuildMembers] 
});

let liveData = {}; 
let currentPartner = {};

// ล้างข้อมูลคนที่หายไปเกิน 10 วินาที
setInterval(() => {
    const now = Date.now();
    for (const name in liveData) {
        if (now - liveData[name].lastUpdate > 10000) delete liveData[name];
    }
}, 5000);

app.post('/sync', async (req, res) => {
    const { name, x, y, z } = req.body;
    console.log(`📩 Received: ${name} at (${x}, ${y}, ${z})`); // ดู Log ใน Render

    try {
        let user = await Player.findOne({ mcName: name });
        if (!user) {
            const guild = await client.guilds.fetch(GUILD_ID);
            const members = await guild.members.fetch();
            const match = members.find(m => m.displayName.toLowerCase() === name.toLowerCase());
            if (match) user = await Player.create({ mcName: name, discordId: match.id });
        }
        
        liveData[name] = { discordId: user ? user.discordId : null, x, y, z, lastUpdate: Date.now() };
        if (liveData[name].discordId) handleMove(name);
        res.sendStatus(200);
    } catch (e) { res.sendStatus(500); }
});

async function handleMove(moverName) {
    const mover = liveData[moverName];
    let partnerName = null;
    let shortestDist = DISTANCE_LIMIT;

    for (let name in liveData) {
        if (name === moverName || !liveData[name].discordId) continue;
        const dist = Math.sqrt(Math.pow(mover.x-liveData[name].x, 2) + Math.pow(mover.z-liveData[name].z, 2));
        if (dist < shortestDist) { shortestDist = dist; partnerName = name; }
    }

    try {
        const guild = await client.guilds.fetch(GUILD_ID);
        const member = await guild.members.fetch(mover.discordId);
        if (!member.voice.channel) return;

        if (partnerName) {
            const pMover = liveData[partnerName];
            const pMember = await guild.members.fetch(pMover.discordId);
            if (pMember.voice.channelId && member.voice.channelId !== pMember.voice.channelId) {
                await member.voice.setChannel(pMember.voice.channelId);
                console.log(`🔗 Linked: ${moverName} <-> ${partnerName}`);
            }
        }
    } catch (e) {}
}

client.login(BOT_TOKEN);
