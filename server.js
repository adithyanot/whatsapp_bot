import express from "express";
import bodyParser from "body-parser";
import axios from "axios";
import dotenv from "dotenv";
import { InferenceClient } from "@huggingface/inference";

dotenv.config();
const app = express();
app.use(bodyParser.json());

// Hugging Face Client
const hfClient = new InferenceClient(process.env.HF_TOKEN);

// In-memory conversation history (per WhatsApp user)
const userMemory = {};

// Function to ask the LLM
async function askLLM(userMessage, userId) {
  try {
    const history = userMemory[userId] || [];
    const messages = [
      ...history,
      { role: "user", content: userMessage }
    ];

    const chatCompletion = await hfClient.chatCompletion({
      provider: "novita",  // you can try "together", "fireworks", etc.
      model: "Qwen/Qwen3-Next-80B-A3B-Instruct", // change if needed
      messages,
    });

    const reply = chatCompletion.choices[0]?.message?.content || "🤖 ...";

    // Save conversation
    userMemory[userId] = [
      ...messages,
      { role: "assistant", content: reply }
    ];

    return reply;
  } catch (err) {
    console.error("LLM Error:", err.response?.data || err.message);
    return "⚠️ LLM service error.";
  }
}

// Verification endpoint (for Meta setup)
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
    const from = message.from;  // WhatsApp number
    const userMessage = message.text.body;

    console.log(`📩 New message from ${from}: ${userMessage}`);

    const reply = await askLLM(userMessage, from);

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
