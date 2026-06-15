// api/listen.js — 브라우저 Web Speech API로 TTS 재생
export default function handler(req, res) {
  const text = req.query.text || "No text provided.";
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Listening...</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #1a1a2e;
      color: #fff;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }
    .card {
      background: #252545;
      border-radius: 20px;
      padding: 40px;
      max-width: 540px;
      width: 100%;
      text-align: center;
      box-shadow: 0 20px 60px rgba(0,0,0,0.4);
    }
    .icon { font-size: 48px; margin-bottom: 16px; }
    h2 { font-size: 20px; font-weight: 600; margin-bottom: 16px; color: #a78bfa; }
    .text-box {
      background: #1a1a2e;
      border-radius: 12px;
      padding: 20px;
      font-size: 15px;
      line-height: 1.7;
      color: #e2e8f0;
      margin-bottom: 28px;
      text-align: left;
    }
    .btn {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 14px 32px;
      border-radius: 50px;
      border: none;
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
    }
    .btn-play { background: #7c3aed; color: #fff; }
    .btn-play:hover { background: #6d28d9; transform: scale(1.03); }
    .btn-stop { background: #374151; color: #fff; display: none; }
    .btn-stop:hover { background: #4b5563; }
    .status { margin-top: 16px; font-size: 13px; color: #9ca3af; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">🔊</div>
    <h2>Slack Summary</h2>
    <div class="text-box" id="text">${text
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")}</div>
    <button class="btn btn-play" id="playBtn" onclick="speak()">▶ Play</button>
    <button class="btn btn-stop" id="stopBtn" onclick="stopSpeak()">■ Stop</button>
    <p class="status" id="status">Click Play to listen</p>
  </div>
  <script>
    const text = ${JSON.stringify(text)};
    let utterance = null;

    function speak() {
      window.speechSynthesis.cancel();
      utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = "en-US";
      utterance.rate = 0.95;
      utterance.pitch = 1;
      utterance.onstart = () => {
        document.getElementById("playBtn").style.display = "none";
        document.getElementById("stopBtn").style.display = "inline-flex";
        document.getElementById("status").textContent = "Playing...";
      };
      utterance.onend = () => {
        document.getElementById("playBtn").style.display = "inline-flex";
        document.getElementById("stopBtn").style.display = "none";
        document.getElementById("status").textContent = "Done!";
      };
      window.speechSynthesis.speak(utterance);
    }

    function stopSpeak() {
      window.speechSynthesis.cancel();
      document.getElementById("playBtn").style.display = "inline-flex";
      document.getElementById("stopBtn").style.display = "none";
      document.getElementById("status").textContent = "Stopped.";
    }

    // 페이지 열리면 자동 재생
    window.onload = () => setTimeout(speak, 500);
  </script>
</body>
</html>`;
  res.setHeader("Content-Type", "text/html");
  res.status(200).send(html);
}
