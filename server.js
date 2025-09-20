import express from "express";
import bodyParser from "body-parser";
import axios from "axios";
import dotenv from "dotenv";
import fs from "fs";
import { InferenceClient } from "@huggingface/inference";

dotenv.config();
const app = express();
app.use(bodyParser.json());

// Hugging Face Client
const hfClient = new InferenceClient(process.env.HF_TOKEN);

// In-memory conversation history (per WhatsApp user)
const userMemory = {};
// Notes & Mood storage
const userNotes = {};
const userMoods = {};

// Function to ask the LLM
async function askLLM(userMessage, userId) {
  try {
    const history = userMemory[userId] || [];
    const messages = [...history, { role: "user", content: userMessage }];

    const chatCompletion = await hfClient.chatCompletion({
      provider: "novita",
      model: "Qwen/Qwen3-Next-80B-A3B-Instruct",
      messages,
    });

    const reply = chatCompletion.choices[0]?.message?.content || "🤖 ...";

    // Save conversation
    userMemory[userId] = [
      ...messages,
      { role: "assistant", content: reply },
    ];

    return reply;
  } catch (err) {
    console.error("LLM Error:", err.response?.data || err.message);
    return "⚠️ LLM service error.";
  }
}

/* =====================
   📌 Feature Handlers
===================== */

// 🔹 Summarize chat
async function handleSummarize(userId) {
  const history = userMemory[userId] || [];
  if (history.length === 0) return "📭 No chat history to summarize.";

  const summaryPrompt = [
    ...history,
    { role: "user", content: "Summarize this conversation briefly." },
  ];

  const chatCompletion = await hfClient.chatCompletion({
    provider: "novita",
    model: "Qwen/Qwen3-Next-80B-A3B-Instruct",
    messages: summaryPrompt,
  });

  return chatCompletion.choices[0]?.message?.content || "🤖 Couldn't summarize.";
}

// 🔹 Notes manager
function handleNotes(userId, userMessage) {
  if (!userNotes[userId]) userNotes[userId] = [];

  const msg = userMessage.toLowerCase();

  if (msg.startsWith("add note")) {
    const note = userMessage.replace(/add note/i, "").trim();
    userNotes[userId].push({ text: note, done: false });
    return `📝 Note added: "${note}"`;
  } else if (msg.startsWith("strike note")) {
    const idx = parseInt(userMessage.replace(/strike note/i, "").trim()) - 1;
    if (userNotes[userId][idx]) {
      userNotes[userId][idx].done = true;
      return `✔️ Marked note ${idx + 1} as done.`;
    } else return "⚠️ Note not found.";
  } else if (msg.startsWith("remove note")) {
    const idx = parseInt(userMessage.replace(/remove note/i, "").trim()) - 1;
    if (userNotes[userId][idx]) {
      const removed = userNotes[userId].splice(idx, 1);
      return `🗑️ Removed note: "${removed[0].text}"`;
    } else return "⚠️ Note not found.";
  } else if (msg.includes("show notes")) {
    if (userNotes[userId].length === 0) return "📭 No notes yet.";
    return (
      "📒 Your notes:\n" +
      userNotes[userId]
        .map(
          (n, i) =>
            `${i + 1}. ${n.done ? "✔️" : "❌"} ${n.text}`
        )
        .join("\n")
    );
  }

  return null; // not a notes command
}

// 🔹 Mood log
function handleMood(userId, userMessage) {
  if (!userMoods[userId]) userMoods[userId] = [];

  if (userMessage.toLowerCase().includes("mood")) {
    const moodText = userMessage.replace(/mood/i, "").trim();
    const entry = { mood: moodText, time: new Date().toLocaleString() };
    userMoods[userId].push(entry);

    // Save to file for persistence
    fs.appendFileSync("moods.txt", JSON.stringify({ userId, ...entry }) + "\n");

    return `💖 Mood logged: "${moodText}"`;
  } else if (userMessage.toLowerCase().includes("show mood")) {
    if (userMoods[userId].length === 0) return "📭 No mood logs yet.";
    return (
      "🧘 Your mood log:\n" +
      userMoods[userId]
        .map((m, i) => `${i + 1}. [${m.time}] ${m.mood}`)
        .join("\n")
    );
  }

  return null;
}

/* =====================
   🌐 Webhook Endpoints
===================== */

// Verification endpoint (Meta setup)
app.get("/webhook", (req, res) => {
  const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode && token === VERIFY_TOKEN) {
    console.log("✅ Webhook verified!");
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// WhatsApp incoming messages
app.post("/webhook", async (req, res) => {
  const entry = req.body.entry?.[0];
  const changes = entry?.changes?.[0];
  const message = changes?.value?.messages?.[0];

  if (message && message.text) {
    const from = message.from;
    const userMessage = message.text.body;

    console.log(`📩 New message from ${from}: ${userMessage}`);

    let reply;

    // Check for special features
    if (/summarize/i.test(userMessage)) {
      reply = await handleSummarize(from);
    } else if (/note|notes/i.test(userMessage)) {
      reply = handleNotes(from, userMessage);
    } else if (/mood/i.test(userMessage)) {
      reply = handleMood(from, userMessage);
    } else {
      // default LLM chat
      reply = await askLLM(userMessage, from);
    }

    console.log(`🤖 Replying: ${reply}`);

    await axios.post(
      `https://graph.facebook.com/v20.0/${process.env.PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to: from,
        text: { body: reply },
      },
      { headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` } }
    );
  }

  res.sendStatus(200);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
