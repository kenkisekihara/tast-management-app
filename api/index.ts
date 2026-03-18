import express from "express";
import { google } from "googleapis";
import cookieSession from "cookie-session";
import dotenv from "dotenv";

dotenv.config();

const app = express();

// Vercelなどのリバースプロキシ環境でセキュアCookieを有効にするために必須
app.set("trust proxy", 1);

app.use(
  cookieSession({
    name: "session",
    keys: [process.env.SESSION_SECRET || "default-secret"],
    maxAge: 24 * 60 * 60 * 1000, // 24時間
    secure: process.env.NODE_ENV === "production" || process.env.VERCEL === "1",
    sameSite: "none",
  })
);

app.use(express.json());

// Vercelデプロイ時とローカル開発時のURLを自動判別
const getAppUrl = () => {
  if (process.env.APP_URL) return process.env.APP_URL;
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
};

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  `${getAppUrl()}/api/auth/callback`
);

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/chat.messages.readonly",
  "https://www.googleapis.com/auth/classroom.coursework.me.readonly",
  "https://www.googleapis.com/auth/classroom.courses.readonly",
  "openid",
  "email",
  "profile",
];

// --- 認証エンドポイント ---

app.get("/api/auth/url", (req, res) => {
  const url = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent",
  });
  res.json({ url });
});

// OAuthコールバック
app.get("/api/auth/callback", async (req, res) => {
  const { code } = req.query;
  try {
    const { tokens } = await oauth2Client.getToken(code as string);
    req.session!.tokens = tokens;
    
    res.send(`
      <html>
        <body>
          <script>
            if (window.opener) {
              window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS' }, '*');
              window.close();
            } else {
              window.location.href = '/';
            }
          </script>
          <p>認証に成功しました。このウィンドウは自動的に閉じます。</p>
        </body>
      </html>
    `);
  } catch (error) {
    console.error("Error retrieving access token", error);
    res.status(500).send("Authentication failed");
  }
});

app.get("/api/auth/logout", (req, res) => {
  req.session = null;
  res.json({ success: true });
});

app.get("/api/auth/me", async (req, res) => {
  if (!req.session?.tokens) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  res.json({ authenticated: true });
});

// --- データ取得エンドポイント ---

app.get("/api/tasks/gmail", async (req, res) => {
  if (!req.session?.tokens) return res.status(401).send("Unauthorized");
  
  oauth2Client.setCredentials(req.session.tokens);
  const gmail = google.gmail({ version: "v1", auth: oauth2Client });

  try {
    const response = await gmail.users.messages.list({
      userId: "me",
      q: "is:starred OR タスク OR TODO",
      maxResults: 10,
    });

    const tasks = [];
    if (response.data.messages) {
      for (const msg of response.data.messages) {
        const detail = await gmail.users.messages.get({ userId: "me", id: msg.id! });
        const subject = detail.data.payload?.headers?.find(h => h.name === "Subject")?.value;
        const snippet = detail.data.snippet;
        tasks.push({
          id: msg.id,
          source: "Gmail",
          title: subject || "No Subject",
          description: snippet || "詳細なし",
          link: `https://mail.google.com/mail/u/0/#inbox/${msg.id}`,
        });
      }
    }
    res.json(tasks);
  } catch (error) {
    console.error("Gmail API error:", error);
    res.status(500).json({ error: "Failed to fetch Gmail tasks" });
  }
});

app.get("/api/tasks/chat", async (req, res) => {
  if (!req.session?.tokens) return res.status(401).send("Unauthorized");
  
  oauth2Client.setCredentials(req.session.tokens);
  const chat = google.chat({ version: "v1", auth: oauth2Client });

  try {
    // 直近のスペースを最大10件取得
    const spaces = await chat.spaces.list({ pageSize: 10 });
    const tasks: any[] = [];
    
    if (spaces.data.spaces) {
      for (const space of spaces.data.spaces) {
        try {
          // 各スペースの直近のメッセージを取得
          const msgs = await chat.spaces.messages.list({
            parent: space.name,
            pageSize: 15,
          });
          
          if (msgs.data.messages) {
            msgs.data.messages.forEach(msg => {
              // メンションされているか判定（簡易的にアノテーションまたはテキスト内の@を確認）
              const isMentioned = msg.annotations?.some(a => a.type === "USER_MENTION") || msg.text?.includes("@");
              
              if (isMentioned) {
                tasks.push({
                  id: msg.name,
                  source: "Google Chat",
                  title: `Space: ${space.displayName || "Chat"}`,
                  description: msg.text || "メンションされました",
                  link: "https://mail.google.com/chat/u/0/#chat/home",
                });
              }
            });
          }
        } catch (e) {
          // 一部のスペースで読み取り権限がない場合はスキップ
          console.warn(`Skipping space ${space.name}`);
        }
      }
    }
    res.json(tasks);
  } catch (error) {
    console.error("Chat API error:", error);
    res.status(500).json({ error: "Failed to fetch Chat tasks" });
  }
});

app.get("/api/tasks/classroom", async (req, res) => {
  if (!req.session?.tokens) return res.status(401).send("Unauthorized");
  
  oauth2Client.setCredentials(req.session.tokens);
  const classroom = google.classroom({ version: "v1", auth: oauth2Client });

  try {
    const courses = await classroom.courses.list({ courseStates: ["ACTIVE"] });
    const tasks: any[] = [];

    if (courses.data.courses) {
      for (const course of courses.data.courses) {
        // 1. コース内のすべての課題を取得
        const cwRes = await classroom.courses.courseWork.list({ courseId: course.id! });
        const cwMap = new Map();
        if (cwRes.data.courseWork) {
          cwRes.data.courseWork.forEach(cw => cwMap.set(cw.id, cw));
        }

        // 2. 自分の提出状況を取得
        const subRes = await classroom.courses.courseWork.studentSubmissions.list({
          courseId: course.id!,
          courseWorkId: "-",
          userId: "me",
        });

        if (subRes.data.studentSubmissions) {
          subRes.data.studentSubmissions.forEach(sub => {
            // 未提出（TURNED_INでもRETURNEDでもない）のものをフィルタ
            if (sub.state !== "TURNED_IN" && sub.state !== "RETURNED") {
              const cw = cwMap.get(sub.courseWorkId);
              // 期限付きの課題のみを抽出
              if (cw && cw.dueDate) {
                tasks.push({
                  id: sub.id,
                  source: "Classroom",
                  title: cw.title,
                  description: `${course.name}: ${cw.description || "未提出の課題です"}`,
                  dueDate: `${cw.dueDate.year}/${cw.dueDate.month || 1}/${cw.dueDate.day || 1}`,
                  link: cw.alternateLink,
                });
              }
            }
          });
        }
      }
    }
    res.json(tasks);
  } catch (error) {
    console.error("Classroom API error:", error);
    res.status(500).json({ error: "Failed to fetch Classroom tasks" });
  }
});

export default app;
