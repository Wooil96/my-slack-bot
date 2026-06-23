// api/slack/events.js  ← Vercel은 이 경로가 자동으로 /api/slack/events 엔드포인트가 됨
import crypto from "crypto";

const SLACK_BOT_TOKEN      = process.env.SLACK_BOT_TOKEN;
const SLACK_SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET;
const GEMINI_API_KEY       = process.env.GEMINI_API_KEY;
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

  // Slack 재시도 요청은 무시 (중복 번역 방지)
  if (req.headers["x-slack-retry-num"]) {
    return res.status(200).end();
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
    (event.subtype && event.subtype !== "file_share") || // 이미지 첨부는 허용
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

// ─── Gemini API 번역 ──────────────────────────────────────
// ─── Gemini API 번역 (503 등 일시적 오류 재시도) ──────────
async function translateToEnglish(text, attempt = 1) {
  const MAX_ATTEMPTS = 4;
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{
            parts: [{
              text: `Translate the following Korean Slack message to natural English.
Return ONLY the translated text with no explanation or preamble.

Korean: ${text}`,
            }],
          }],
        }),
      }
    );
    const data = await res.json();

    const result = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (result) return result;

    const code = data.error?.code;
    if ((code === 503 || code === 429 || code === 500) && attempt < MAX_ATTEMPTS) {
      const wait = attempt * 2000;
      console.log(`Gemini ${code} - ${attempt}번째 재시도, ${wait}ms 대기`);
      await new Promise(r => setTimeout(r, wait));
      return translateToEnglish(text, attempt + 1);
    }

    console.error("번역 오류:", JSON.stringify(data));
    return "(Translation failed)";
  } catch (err) {
    if (attempt < MAX_ATTEMPTS) {
      await new Promise(r => setTimeout(r, attempt * 2000));
      return translateToEnglish(text, attempt + 1);
    }
    return "(Translation failed - please try again)";
  }
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