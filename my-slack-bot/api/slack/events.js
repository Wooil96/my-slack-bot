// api/slack/events.js  ← Vercel은 이 경로가 자동으로 /api/slack/events 엔드포인트가 됨
import crypto from "crypto";

const SLACK_BOT_TOKEN      = process.env.SLACK_BOT_TOKEN;
const SLACK_SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET;
// Google Translate는 API 키 불필요!
const BOT_USER_ID          = process.env.BOT_USER_ID;

export const config = {
  api: { bodyParser: false }, // 서명 검증을 위해 raw body 필요
};

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  // 1) Raw body 읽기 (서명 검증용)
  const rawBody = await getRawBody(req);
  
  const body = JSON.parse(rawBody);

  // 2) URL 검증 (앱 등록 시 1회) — 서명 검증보다 먼저!
  if (body.type === "url_verification") {
    return res.status(200).json({ challenge: body.challenge });
  }

  // 3) Slack 서명 검증 (일반 이벤트에만 적용)
  if (!verifySignature(req.headers, rawBody)) {
    return res.status(403).send("Invalid signature");
  }

  // 4) 이벤트 처리 및 번역 (응답 전에 완료)
  const event = body.event;
  if (!event) return res.status(200).end();

  if (
    event.type !== "message" ||
    event.subtype ||
    event.bot_id ||
    event.user === BOT_USER_ID
  ) return res.status(200).end();

  const text = event.text || "";
  const hasKorean = /[\uAC00-\uD7A3\u1100-\u11FF\u3130-\u318F]/.test(text);
  if (!hasKorean) return res.status(200).end();

  // 번역 완료 후 200 응답
  try {
    const translated = await translateToEnglish(text);
    await postTranslation(event.channel, event.ts, translated);
  } catch (err) {
    console.error("번역 오류:", err);
  }
  return res.status(200).end();
}

// ─── Google Translate (무료, API 키 불필요) ───────────────
async function translateToEnglish(text) {
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=ko&tl=en&dt=t&q=${encodeURIComponent(text)}`;
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0" }
  });
  const data = await res.json();
  const translated = data[0]?.map(item => item[0]).join("") || "(Translation failed)";
  return translated;
}

// ─── Slack 스레드에 번역 게시 ─────────────────────────────
async function postTranslation(channel, thread_ts, translated) {
  await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
    },
    body: JSON.stringify({
      channel,
      thread_ts,
      text: `🇺🇸 *English translation:*\n${translated}`,
      unfurl_links: false,
    }),
  });
}

// ─── Slack 서명 검증 ─────────────────────────────────────
function verifySignature(headers, rawBody) {
  const timestamp = headers["x-slack-request-timestamp"];
  const signature = headers["x-slack-signature"];
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;

  const hmac = crypto
    .createHmac("sha256", SLACK_SIGNING_SECRET)
    .update(`v0:${timestamp}:${rawBody}`)
    .digest("hex");

  return `v0=${hmac}` === signature;
}

// ─── Raw body 읽기 헬퍼 ──────────────────────────────────
function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", c => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString()));
    req.on("error", reject);
  });
}