require('dotenv').config();
const express = require('express');
const { Client, GatewayIntentBits, ChannelType } = require('discord.js');
const mongoose = require('mongoose');

const app = express();
app.use(express.json());

const { BOT_TOKEN, MONGO_URI, GUILD_ID, LOBBY_ID, CATEGORY_ID, DISTANCE_LIMIT = 15, PORT = 3000 } = process.env;

app.get('/', (req, res) => res.send('🚀 Bot Standby!'));
app.listen(PORT, '0.0.0.0', () => console.log(`🛰️ API Server Online`));

mongoose.connect(MONGO_URI).then(() => console.log("📦 DB Connected")).catch(e => console.error(e));

const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildVoiceStates, 
        GatewayIntentBits.GuildMembers // 🚨 ต้องเปิดใน Developer Portal ด้วย!
    ] 
});

let liveData = {};

// รับข้อมูลจาก Minecraft
app.post('/sync', (req, res) => {
    const { name, x, z } = req.body;
    
    // 🟢 ตอบกลับทันทีเพื่อแก้ 502
    res.sendStatus(200);

    // เก็บพิกัดไว้ประมวลผล
    liveData[name] = { x, z, lastUpdate: Date.now() };
    
    // สั่งย้ายห้อง (ทำเบื้องหลัง)
    processProximity(name);
});

async function processProximity(moverName) {
    try {
        const guild = await client.guilds.fetch(GUILD_ID);
        const members = await guild.members.fetch();
        
        // 🔍 หาตัวผู้เล่นใน Discord (เช็คจาก DisplayName)
        const mover = members.find(m => m.displayName.toLowerCase() === moverName.toLowerCase());

        if (!mover) {
            console.log(`❌ [Debug] ไม่พบชื่อ [${moverName}] ใน Discord (เช็ค Nickname ด่วน!)`);
            return;
        }

        if (!mover.voice.channel) return; // ไม่ได้อยู่ในห้องเสียง

        for (let name in liveData) {
            if (name === moverName) continue;
            
            // ลบข้อมูลคนที่ไม่ได้ส่งมาเกิน 10 วินาที (ออกจากเกม)
            if (Date.now() - liveData[name].lastUpdate > 10000) {
                delete liveData[name];
                continue;
            }

            const targetPos = liveData[name];
            const dist = Math.sqrt(Math.pow(liveData[moverName].x - targetPos.x, 2) + Math.pow(liveData[moverName].z - targetPos.z, 2));

            if (dist <= DISTANCE_LIMIT) {
                const partner = members.find(m => m.displayName.toLowerCase() === name.toLowerCase());
                
                if (partner && partner.voice.channelId && mover.voice.channelId !== partner.voice.channelId) {
                    console.log(`🔗 [Match!] ย้าย ${moverName} ไปหา ${name} (ระยะ: ${Math.round(dist)})`);
                    await mover.voice.setChannel(partner.voice.channelId);
                }
            }
        }
    } catch (e) { console.error("ระบบย้ายคนมีปัญหา:", e.message); }
}

client.login(BOT_TOKEN);
