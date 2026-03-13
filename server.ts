import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { google } from "googleapis";
import cookieSession from "cookie-session";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;

// セッションの設定（OAuthトークンの保存用）
app.use(
  cookieSession({
    name: "session",
    keys: [process.env.SESSION_SECRET || "default-secret"],
    maxAge: 24 * 60 * 60 * 1000, // 24時間
    secure: true,
    sameSite: "none",
  })
);

app.use(express.json());

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  `${process.env.APP_URL}/auth/callback`
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

// 認証URLを取得
app.get("/api/auth/url", (req, res) => {
  const url = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent",
  });
  res.json({ url });
});

// OAuthコールバック
app.get("/auth/callback", async (req, res) => {
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

// ログアウト
app.get("/api/auth/logout", (req, res) => {
  req.session = null;
  res.json({ success: true });
});

// ユーザー情報取得
app.get("/api/auth/me", async (req, res) => {
  if (!req.session?.tokens) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  res.json({ authenticated: true });
});

// --- データ取得エンドポイント ---

// Gmailからタスクを抽出
app.get("/api/tasks/gmail", async (req, res) => {
  if (!req.session?.tokens) return res.status(401).send("Unauthorized");
  
  oauth2Client.setCredentials(req.session.tokens);
  const gmail = google.gmail({ version: "v1", auth: oauth2Client });

  try {
    // 「タスク」または「TODO」を含むスター付きメールを検索
    const response = await gmail.users.messages.list({
      userId: "me",
      q: "is:starred (タスク OR TODO)",
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
          description: snippet,
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

// Google Chatからメンションを抽出
app.get("/api/tasks/chat", async (req, res) => {
  if (!req.session?.tokens) return res.status(401).send("Unauthorized");
  
  oauth2Client.setCredentials(req.session.tokens);
  const chat = google.chat({ version: "v1", auth: oauth2Client });

  try {
    // 注意: Chat APIはスペースのリストを取得し、その中のメッセージを確認する必要があります
    // ここでは簡略化のため、スペースのリスト取得のみを例示します（Chat APIの制限により複雑なため）
    const spaces = await chat.spaces.list();
    const tasks: any[] = [];
    
    // 実際の運用では各スペースのメッセージをスキャンしますが、
    // ここではAPIの疎通確認としてスペース名を返します
    if (spaces.data.spaces) {
      spaces.data.spaces.forEach(s => {
        tasks.push({
          id: s.name,
          source: "Google Chat",
          title: `Space: ${s.displayName}`,
          description: "メンションの確認が必要です",
          link: "https://chat.google.com/",
        });
      });
    }
    res.json(tasks);
  } catch (error) {
    console.error("Chat API error:", error);
    res.status(500).json({ error: "Failed to fetch Chat tasks" });
  }
});

// Google Classroomから課題を抽出
app.get("/api/tasks/classroom", async (req, res) => {
  if (!req.session?.tokens) return res.status(401).send("Unauthorized");
  
  oauth2Client.setCredentials(req.session.tokens);
  const classroom = google.classroom({ version: "v1", auth: oauth2Client });

  try {
    const courses = await classroom.courses.list({ courseStates: ["ACTIVE"] });
    const tasks: any[] = [];

    if (courses.data.courses) {
      for (const course of courses.data.courses) {
        const coursework = await classroom.courses.courseWork.list({ courseId: course.id! });
        if (coursework.data.courseWork) {
          coursework.data.courseWork.forEach(cw => {
            tasks.push({
              id: cw.id,
              source: "Classroom",
              title: cw.title,
              description: `${course.name}: ${cw.description || "No description"}`,
              dueDate: cw.dueDate ? `${cw.dueDate.year}/${cw.dueDate.month}/${cw.dueDate.day}` : "No due date",
              link: cw.alternateLink,
            });
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

// --- Vite Middleware ---

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
