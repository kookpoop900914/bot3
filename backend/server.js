require('dotenv').config();
const express = require('express');
const { Client, GatewayIntentBits } = require('discord.js');
const mongoose = require('mongoose');

const app = express();
app.use(express.json());

const { BOT_TOKEN, MONGO_URI, GUILD_ID, LOBBY_ID, CATEGORY_ID, DISTANCE_LIMIT = 15, PORT = 3000 } = process.env;

app.get('/', (req, res) => res.send('🚀 Proximity Server is Online!'));
app.listen(PORT, '0.0.0.0', () => console.log(`🛰️ API Online on port ${PORT}`));

mongoose.connect(MONGO_URI).then(() => console.log("📦 DB Connected")).catch(err => console.error(err));

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.GuildMembers] });
let liveData = {};

app.post('/sync', async (req, res) => {
    const { name, x, y, z } = req.body;
    console.log(`📩 ได้รับข้อมูลจากเกม: [${name}] พิกัด (${x}, ${y}, ${z})`); // บรรทัดนี้สำคัญมาก!
    
    liveData[name] = { x, y, z, lastUpdate: Date.now() };
    
    try {
        const guild = await client.guilds.fetch(GUILD_ID);
        const members = await guild.members.fetch();
        
        // ค้นหาคนที่มีชื่อในดิสคอร์ด ตรงกับชื่อในมายคราฟ
        const match = members.find(m => 
            m.displayName.toLowerCase() === name.toLowerCase() || 
            m.user.username.toLowerCase() === name.toLowerCase()
        );

        if (match) {
            console.log(`🔎 เจอตัวแล้ว! ${name} คือ ${match.user.tag}`);
            handleMove(name, match, guild);
        } else {
            console.log(`❓ ไม่พบชื่อ [${name}] ในเซิร์ฟเวอร์ Discord (เช็คชื่อเล่นให้ตรงกันด้วยนะ)`);
        }
    } catch (e) { console.error("Error in sync:", e); }
    
    res.sendStatus(200);
});

async function handleMove(moverName, member, guild) {
    if (!member.voice.channel) return;

    for (let name in liveData) {
        if (name === moverName) continue;
        const target = liveData[name];
        const dist = Math.sqrt(Math.pow(liveData[moverName].x - target.x, 2) + Math.pow(liveData[moverName].z - target.z, 2));

        if (dist < DISTANCE_LIMIT) {
            const allMembers = await guild.members.fetch();
            const partner = allMembers.find(m => m.displayName.toLowerCase() === name.toLowerCase());
            
            if (partner && partner.voice.channelId && member.voice.channelId !== partner.voice.channelId) {
                console.log(`🔗 กำลังย้าย ${moverName} ไปหา ${name}`);
                await member.voice.setChannel(partner.voice.channelId);
            }
        }
    }
}
client.login(BOT_TOKEN);
