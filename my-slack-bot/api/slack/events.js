// api/slack/events.js  ← Vercel은 이 경로가 자동으로 /api/slack/events 엔드포인트가 됨
import crypto from "crypto";

const SLACK_BOT_TOKEN      = process.env.SLACK_BOT_TOKEN;
const SLACK_SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET;
const ANTHROPIC_API_KEY    = process.env.ANTHROPIC_API_KEY;
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

  // 4) 즉시 200 응답 (Slack 3초 제한 대응) ← 핵심!
  res.status(200).end();

  // 5) 응답 후 번역 작업 실행 (Vercel waitUntil 사용)
  const event = body.event;
  if (!event) return;

  if (
    event.type !== "message" ||
    event.subtype ||
    event.bot_id ||
    event.user === BOT_USER_ID
  ) return;

  const text = event.text || "";
  const hasKorean = /[\uAC00-\uD7A3\u1100-\u11FF\u3130-\u318F]/.test(text);
  if (!hasKorean) return;

  // waitUntil: 응답 후에도 함수가 종료되지 않고 작업 완료까지 대기
  // Vercel의 경우 이게 없으면 res.end() 이후 함수가 바로 종료될 수 있음
  const translationWork = (async () => {
    try {
      const translated = await translateToEnglish(text);
      await postTranslation(event.channel, event.ts, translated);
    } catch (err) {
      console.error("번역 오류:", err);
    }
  })();

  // Vercel Edge Runtime이라면 waitUntil 사용, 아니면 그냥 await
  if (typeof globalThis.EdgeRuntime !== "undefined") {
    // @ts-ignore
    globalThis.waitUntil?.(translationWork);
  } else {
    await translationWork; // Node.js runtime은 await로 충분
  }
}

// ─── Claude API 번역 ──────────────────────────────────────
async function translateToEnglish(text) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      messages: [{
        role: "user",
        content: `Translate the following Korean Slack message to natural English.
Return ONLY the translated text with no explanation or preamble.

Korean: ${text}`,
      }],
    }),
  });
  const data = await res.json();
  return data.content?.[0]?.text?.trim() || "(Translation failed)";
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