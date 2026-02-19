require('dotenv').config();
const express = require('express');
const { Client, GatewayIntentBits, Partials } = require('discord.js');
const mongoose = require('mongoose');

const app = express();
app.use(express.json());

const { BOT_TOKEN, MONGO_URI, GUILD_ID, LOBBY_ID, VOICE_ROOMS, PORT = 3000 } = process.env;
const voiceRoomList = VOICE_ROOMS ? VOICE_ROOMS.split(',') : [];

mongoose.connect(MONGO_URI).then(() => console.log("📦 Connected to MongoDB"));
const Player = mongoose.model('Player', new mongoose.Schema({ mcName: String, discordId: String }));

const client = new Client({ 
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers],
    partials: [Partials.Channel]
});

let liveData = {}; 

app.post('/sync', async (req, res) => {
    const { name, x, y, z } = req.body;
    let user = await Player.findOne({ mcName: name });

    if (!user) {
        try {
            const guild = await client.guilds.fetch(GUILD_ID);
            const members = await guild.members.fetch();
            const cleanMcName = name.replace('*', '').toLowerCase();
            const matchedMember = members.find(m => m.displayName.toLowerCase() === cleanMcName || m.user.username.toLowerCase() === cleanMcName);

            if (matchedMember) {
                user = await Player.create({ mcName: name, discordId: matchedMember.id });
            }
        } catch (err) {}
    }

    liveData[name] = { discordId: user ? user.discordId : null, x, y, z, lastUpdate: Date.now() };
    if (liveData[name].discordId) handleVoiceMove(name);
    res.sendStatus(200);
});

async function handleVoiceMove(moverName) {
    const mover = liveData[moverName];
    let partner = null;

    for (let name in liveData) {
        if (name === moverName || !liveData[name].discordId) continue;
        const other = liveData[name];
        const dist = Math.sqrt(Math.pow(mover.x - other.x, 2) + Math.pow(mover.y - other.y, 2) + Math.pow(mover.z - other.z, 2));
        if (dist < 15) { partner = other; break; }
    }

    try {
        const guild = await client.guilds.fetch(GUILD_ID);
        const member = await guild.members.fetch(mover.discordId);
        if (!member.voice.channel) return;
        const targetChannelId = partner ? voiceRoomList[0] : LOBBY_ID;
        if (member.voice.channelId !== targetChannelId) await member.voice.setChannel(targetChannelId);
    } catch (e) {}
}

client.login(BOT_TOKEN);
app.listen(PORT, '0.0.0.0', () => console.log(`🚀 API Hub Online on Port ${PORT}`));