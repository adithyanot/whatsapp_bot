import express from "express";

const app = express();
const VERIFY_TOKEN = "adithya"; // Change this to your token

app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("Webhook verified ✅");
    res.status(200).send(challenge); // MUST send challenge string exactly
  } else {
    console.log("Webhook verification failed ❌");
    res.sendStatus(403);
  }
});

app.listen(3000, () => console.log("🌐 Server running on port 3000"));
