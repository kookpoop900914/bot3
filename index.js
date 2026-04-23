require('dotenv').config();
const express = require('express');
const { Client, GatewayIntentBits } = require('discord.js');
const mongoose = require('mongoose');
const readline = require('readline');

const app = express();
app.use(express.json());

// --- 1. ตั้งค่าบอทหลายตัว (Bot Pool) ---
// วิธีใช้ใน .env: BOT_TOKENS=token1,token2,token3
const tokens = process.env.BOT_TOKENS ? process.env.BOT_TOKENS.split(',') : [process.env.BOT_TOKEN];
const clients = [];
let botIndex = 0;

// --- 2. เชื่อมต่อ MongoDB ---
mongoose.connect(process.env.MONGO_URI)
    .then(() => {
        console.log("📦 Connected to MongoDB");
        initBots(); // เริ่มทำงานบอทเมื่อ DB พร้อม
    })
    .catch(err => console.error("❌ DB Error:", err));

const Area = mongoose.model('Area', new mongoose.Schema({
    name: String,
    channelId: String,
    pos1: { x: Number, y: Number, z: Number },
    pos2: { x: Number, y: Number, z: Number }
}));

// --- 3. ฟังก์ชันเตรียมบอททั้งหมด ---
function initBots() {
    tokens.forEach((token, i) => {
        const client = new Client({ 
            intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.GuildMembers] 
        });
        client.once('ready', () => {
            console.log(`🤖 Bot ${i + 1} Ready: ${client.user.tag}`);
            if (i === 0) showMenu(); // แสดงเมนูแค่ครั้งเดียวจากบอทตัวแรก
        });
        client.login(token.trim());
        clients.push(client);
    });
}

// --- 4. ระบบเมนู Console (เพิ่ม/ลบ/ดู) ---
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function showMenu() {
    console.log("\n--- 🛠️  Multi-Bot Area Manager ---");
    console.log("1. เพิ่มโซนใหม่ (Add Area)");
    console.log("2. ลบโซน (Delete Area)");
    console.log("3. ดูโซนทั้งหมด (List Areas)");
    console.log("---------------------------------");
    rl.question("เลือกรายการ (1-3): ", async (choice) => {
        if (choice === '1') {
            rl.question("ใส่ข้อมูล [ชื่อ] [ChannelID] [x1 y1 z1] [x2 y2 z2]:\n", async (input) => {
                const args = input.split(' ');
                if (args.length < 8) { console.log("⚠️ ข้อมูลไม่ครบ!"); return showMenu(); }
                await Area.create({
                    name: args[0], channelId: args[1],
                    pos1: { x: Number(args[2]), y: Number(args[3]), z: Number(args[4]) },
                    pos2: { x: Number(args[5]), y: Number(args[6]), z: Number(args[7]) }
                });
                console.log(`✅ เพิ่มโซน "${args[0]}" สำเร็จ!`);
                showMenu();
            });
        } else if (choice === '2') {
            rl.question("พิมพ์ชื่อโซนที่จะลบ: ", async (name) => {
                const res = await Area.deleteOne({ name });
                console.log(res.deletedCount > 0 ? `🗑️ ลบ "${name}" แล้ว` : "❌ ไม่พบโซนนี้");
                showMenu();
            });
        } else if (choice === '3') {
            const areas = await Area.find();
            console.log("\n--- รายชื่อโซน ---");
            areas.forEach((a, i) => console.log(`${i+1}. ${a.name} -> ID: ${a.channelId}`));
            showMenu();
        } else { showMenu(); }
    });
}

// --- 5. ฟังก์ชันย้ายห้องโดยใช้บอทสลับกัน (Bot Pool Logic) ---
async function distributeMove(guildId, memberId, targetChannelId) {
    const currentBot = clients[botIndex];
    botIndex = (botIndex + 1) % clients.length; // สลับบอทตัวถัดไป

    try {
        const guild = await currentBot.guilds.fetch(guildId);
        const member = await guild.members.fetch(memberId);
        if (member.voice.channelId !== targetChannelId) {
            await member.voice.setChannel(targetChannelId);
            console.log(`🚀 [${currentBot.user.username}] ย้าย ${member.displayName} ไปห้อง ${targetChannelId}`);
        }
    } catch (err) {
        console.error(`❌ บอท ${currentBot.user.username} ย้ายไม่ได้:`, err.message);
    }
}

// --- 6. API รับค่าจาก Minecraft ---
app.post('/sync', async (req, res) => {
    const { name, x, y, z } = req.body;
    res.sendStatus(200);

    try {
        const areas = await Area.find();
        const currentArea = areas.find(area => {
            const p1 = area.pos1; const p2 = area.pos2;
            return (
                x >= Math.min(p1.x, p2.x) && x <= Math.max(p1.x, p2.x) &&
                y >= Math.min(p1.y, p2.y) && y <= Math.max(p1.y, p2.y) &&
                z >= Math.min(p1.z, p2.z) && z <= Math.max(p1.z, p2.z)
            );
        });

        if (currentArea) {
            // ใช้บอทตัวแรกค้นหาข้อมูลสมาชิก
            const guild = await clients[0].guilds.fetch(process.env.GUILD_ID);
            const members = await guild.members.fetch();
            const mover = members.find(m => m.displayName.toLowerCase() === name.toLowerCase());

            if (mover && mover.voice.channelId) {
                await distributeMove(process.env.GUILD_ID, mover.id, currentArea.channelId);
            }
        }
    } catch (e) { }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`🚀 API Server running on port ${PORT}`));