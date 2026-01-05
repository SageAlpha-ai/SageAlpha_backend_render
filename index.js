/**
 * SageAlpha.ai v3 - Node.js Backend
 * Single-file implementation (index.js)
 * Migrated from Flask
 */

// ==========================================
// 1. IMPORTS & CONFIGURATION
// ==========================================
const path = require("path");
const dotenv = require("dotenv").config();
// Production detection (Render sets RENDER env var, Azure sets WEBSITE_SITE_NAME)
const IS_PRODUCTION = process.env.RENDER || process.env.WEBSITE_SITE_NAME ? true : (process.env.NODE_ENV === 'production');
const PLAYWRIGHT_BROWSERS_PATH = IS_PRODUCTION
  ? (process.env.PLAYWRIGHT_BROWSERS_PATH || path.join(process.env.TMPDIR || '/tmp', 'playwright-browsers'))
  : path.join(__dirname, 'playwright-browsers');


process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

process.env.PLAYWRIGHT_BROWSERS_PATH = PLAYWRIGHT_BROWSERS_PATH;
const express = require("express");
const session = require("express-session");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const nunjucks = require("nunjucks");
const mongoose = require('mongoose');
const MongoStore = require('connect-mongo');
const bcrypt = require("bcryptjs");
const fs = require("fs");
// path already required above
const { OpenAI, AzureOpenAI } = require("openai");
const { generateReportHtml } = require("./reportTemplate");
const { convertHtmlToPdf } = require("./pdfGenerator");
const { uploadHtmlToBlob, getHtmlFromBlob, deleteHtmlFromBlob } = require("./utils/blobStorage");


// Mongoose models (wilFl be required after connecting)
const User = require('./models/User');
const ChatSession = require('./models/ChatSession');
const Message = require('./models/Message');
const PortfolioItem = require('./models/PortfolioItem');
const Report = require('./models/Report');
const Subscriber = require('./models/Subscriber');
const UserPreference = require('./models/UserPreference');
const ReportDelivery = require('./models/ReportDelivery');
const axios = require("axios");
const multer = require("multer");
const { v4: uuidv4 } = require("uuid");
const cookieParser = require("cookie-parser");

const http = require("http");
const { Server } = require("socket.io");
const app = express();
app.set('trust proxy', 1); // Trust first proxy (Azure)
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 8000;

// email setup
const speakeasy = require("speakeasy");
// const transporter = require("./email");
const { sendEmail, isEmailConfigured } = require("./email");

// const User = require("./models/UserModel");

// Load logo for PDF reports
let logoBase64 = "";
try {
  const logoPath = path.join(__dirname, "static/logo/sagealpha-logo.png");
  if (fs.existsSync(logoPath)) {
    logoBase64 = fs.readFileSync(logoPath).toString('base64');
  }
} catch (err) {
  console.warn("[PDF] Logo load failed:", err.message);
}
// Azure-safe file paths
// Use /tmp for temporary files in Azure (writable, but ephemeral)
// Use persistent storage paths if available via env vars
const DATA_DIR = IS_PRODUCTION
  ? (process.env.DATA_DIR || path.join(process.env.TMPDIR || '/tmp', 'sagealpha-data'))
  : __dirname;

// const REPORTS_DIR = IS_PRODUCTION
//   ? (process.env.REPORTS_DIR || path.join(DATA_DIR, 'generated_reports'))
//   : path.join(__dirname, "generated_reports");

const UPLOADS_DIR = IS_PRODUCTION
  ? (process.env.UPLOADS_DIR || path.join(DATA_DIR, 'uploads'))
  : path.join(__dirname, "uploads");

const VECTOR_STORE_DIR = IS_PRODUCTION
  ? (process.env.VECTOR_STORE_DIR || path.join(DATA_DIR, 'vector_store_data'))
  : path.join(__dirname, "vector_store_data");

// Ensure directories exist
[UPLOADS_DIR, VECTOR_STORE_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

const DB_PATH = IS_PRODUCTION
  ? (process.env.DB_PATH || path.join(DATA_DIR, 'sagealpha.db'))
  : path.join(__dirname, "sagealpha.db");

/**
 * Seeding function for default users.
 * Re-implemented for MongoDB transition.
 */
async function SeedDemoUsersMR() {
  const demoUsers = [
    { email: "demouser@sagealpha.ai", username: "demouser", display_name: "Demo User", password: "Demouser" },
    { email: "devuser@sagealpha.ai", username: "devuser", display_name: "Dev User", password: "Devuser" },
    { email: "produser@sagealpha.ai", username: "produser", display_name: "Prod User", password: "Produser" }
  ];

  for (const u of demoUsers) {
    const existing = await User.findOne({ email: u.email });
    if (!existing) {
      const hash = await bcrypt.hash(u.password, 10);
      await User.create({
        username: u.username,
        display_name: u.display_name,
        email: u.email,
        password_hash: hash,
        is_active: true
      });
      console.log(`[SEED] Created user: ${u.email}`);
    }
  }
}

// Ensure data directory exists in production
if (IS_PRODUCTION) {
  const dbDir = path.dirname(DB_PATH);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }
}

// MongoDB connection - MUST use environment variable in production
const MONGO_URL = process.env.MONGO_URL;
if (!MONGO_URL && IS_PRODUCTION) {
  console.error('[DB] CRITICAL: MONGO_URL environment variable is required in production!');
  process.exit(1);
}
if (!MONGO_URL) {
  console.warn('[DB] MONGO_URL not set, using fallback (NOT FOR PRODUCTION)');
}

let mongooseConnected = false;
if (MONGO_URL) {
  mongoose.connect(MONGO_URL).then(() => {
    mongooseConnected = true;
    console.log('[DB] Connected to MongoDB');
    SeedDemoUsersMR().catch(e => console.error('[DB] Seed error:', e.message));
  }).catch((e) => {
    console.error('[DB] MongoDB connect failed:', e && e.message);
    // In production, don't exit - allow graceful degradation
    if (!IS_PRODUCTION) {
      console.warn('[DB] Continuing without MongoDB (dev mode)');
    }
  });
}

// Environment Validation Logging
console.log(`[ENV] IS_PRODUCTION: ${IS_PRODUCTION}`);
console.log(`[ENV] PORT: ${PORT}`);
if (IS_PRODUCTION) {
  if (!process.env.MONGO_URL) console.warn('[ENV] MONGO_URL missing!');
  if (!process.env.AZURE_OPENAI_API_KEY) console.warn('[ENV] AZURE_OPENAI_API_KEY missing!');
}

// ==========================================
// 3. MIDDLEWARE & TRULY GLOBAL VARS
// ==========================================

// CORS Configuration - MUST be before other middleware
// Azure-safe: Read from environment variables
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
  : IS_PRODUCTION
    ? [] // Production MUST set ALLOWED_ORIGINS
    : ["http://localhost:5173", "http://localhost:3000"]; // Dev fallback

if (IS_PRODUCTION && allowedOrigins.length === 0) {
  console.warn('[CORS] WARNING: ALLOWED_ORIGINS not set in production! CORS may fail.');
}

// Helper function to check if origin is allowed
function isOriginAllowed(origin) {
  if (!origin) return true; // Allow requests with no origin
  return allowedOrigins.includes(origin);
}

// Enhanced CORS configuration for production
const corsOptions = {
  origin: function (origin, callback) {
    // Log all incoming origins for debugging
    console.log(`[CORS] Request from origin: ${origin || 'no-origin'}`);

    if (isOriginAllowed(origin)) {
      console.log(`[CORS] Origin allowed: ${origin || 'no-origin'}`);
      return callback(null, true);
    } else {
      console.log(`[CORS] Origin rejected: ${origin}`);
      return callback(new Error("Not allowed by CORS"));
    }
  },
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "X-Requested-With",
    "Accept",
    "Origin",
    "Access-Control-Request-Method",
    "Access-Control-Request-Headers"
  ],
  exposedHeaders: ["Authorization"],
  credentials: true,
  preflightContinue: false,
  optionsSuccessStatus: 200, // Changed to 200 for better compatibility
  maxAge: 86400 // 24 hours
};

// Apply CORS middleware FIRST - before any other middleware
// This MUST be before body parsers and other middleware
app.options("*", cors(corsOptions)); // Enable preflight for all routes

// Fallback CORS middleware - ensures headers are ALWAYS set for allowed origins
// This runs after cors() middleware as a safety net
app.use((req, res, next) => {
  const origin = req.headers.origin;

  // For preflight OPTIONS requests
  if (req.method === 'OPTIONS') {
    if (isOriginAllowed(origin)) {
      res.header('Access-Control-Allow-Origin', origin);
      res.header('Access-Control-Allow-Credentials', 'true');
      res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
      res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept, Origin, Access-Control-Request-Method, Access-Control-Request-Headers');
      res.header('Access-Control-Max-Age', '86400');
      return res.status(200).end();
    }
  }

  // For actual requests, ensure CORS headers are set
  if (isOriginAllowed(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Access-Control-Allow-Credentials', 'true');
  }

  next();
});

// Now add other middleware
app.use(express.static("static"));
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));
app.use(cookieParser());

// Development Content-Security-Policy (relaxed for local dev and Chrome devtools extensions)
if (!IS_PRODUCTION) {
  app.use((req, res, next) => {
    // Relaxed dev policy: allow CDNs used by the templates and Chrome DevTools local endpoints
    res.setHeader('Content-Security-Policy', "default-src 'self' data: blob: http: https:; connect-src 'self' http: https: ws: wss: http://localhost:5173 http://localhost:9222 http://localhost:9229; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.tailwindcss.com https://cdn.jsdelivr.net https://unpkg.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://api.fontshare.com https://cdn.jsdelivr.net https://cdn.tailwindcss.com; font-src 'self' https://fonts.gstatic.com https://api.fontshare.com data:; img-src 'self' data: https:;");
    next();
  });
}

// Template Engine (Nunjucks for Jinja2 compatibility)
// CRITICAL: Disable file watching in production (Azure CPU/memory issue)
let nunjucksWatch = false;
if (!IS_PRODUCTION) {
  try {
    require.resolve('chokidar');
    nunjucksWatch = true;
  } catch (e) {
    console.warn('[TEMPLATES] chokidar not installed; disabling watch');
  }
} else {
  console.log('[TEMPLATES] File watching disabled in production (Azure-safe)');
}

const env = nunjucks.configure("templates", {
  autoescape: true,
  express: app,
  watch: nunjucksWatch // Always false in production
});

env.addFilter("tojson", function (obj) {
  return JSON.stringify(obj || "");
});

env.addGlobal("url_for", function (endpoint, kwargs) {
  if (endpoint === 'static' && kwargs && kwargs.filename) {
    return '/static/' + kwargs.filename;
  }
  const routes = {
    'auth.login': '/login',
    'auth.register': '/register',
    'auth.logout': '/logout',
    'auth.forgot_password': '/forgot-password',
    'auth.google_login': '/auth/google',
    'portfolio.index': '/portfolio',
    'portfolio.subscribers': '/subscribers'
  };
  return routes[endpoint] || '#';
});
app.set("view engine", "html");

// Session Setup
let sessionStore;
try {
  const sessionStore = MongoStore.create({
    mongoUrl: process.env.MONGO_URL,
    collectionName: "sessions"
  });
} catch (e) {
  console.warn('[SESSION] connect-mongo initialization failed:', e.message);
  sessionStore = null;
}

// Session secret - MUST be set in production
const SESSION_SECRET = process.env.SESSION_SECRET || process.env.FLASK_SECRET;
if (IS_PRODUCTION && !SESSION_SECRET) {
  console.error('[SESSION] CRITICAL: SESSION_SECRET or FLASK_SECRET must be set in production!');
  process.exit(1);
}

app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: true,  // ✔ required
      httpOnly: true,
      sameSite: "none", // ✔ required for cross-origin
      maxAge: 7 * 24 * 60 * 60 * 1000
    },
    store: MongoStore.create({
      mongoUrl: process.env.MONGO_URL
    })
  })
);


// User Loader Middleware (supporting both Session and JWT)
app.use(async (req, res, next) => {
  res.locals.APP_VERSION = process.env.SAGEALPHA_VERSION || "3.0.0";
  res.locals.IS_PRODUCTION = IS_PRODUCTION;

  let userId = req.session.userId;

  // Check for JWT token in Authorization header
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.split(" ")[1];
    try {
      const JWT_SECRET = process.env.JWT_SECRET;
      if (!JWT_SECRET && IS_PRODUCTION) {
        throw new Error("JWT_SECRET not configured");
      }
      const decoded = jwt.verify(token, JWT_SECRET || "fallback_jwt_secret_DEV_ONLY");
      userId = decoded.id;
    } catch (err) {
      console.warn("[AUTH] Invalid JWT token");
    }
  }

  if (userId && mongooseConnected) {
    try {
      const user = await User.findById(userId).lean();
      if (user) {
        req.user = user;
        req.user._id = user._id.toString(); // Ensure string ID for consistency
        res.locals.current_user = { is_authenticated: true, ...user };
        return next();
      }
    } catch (e) {
      console.error('[AUTH] Error decoing user:', e.message);
    }
  }

  res.locals.current_user = { is_authenticated: false };
  next();
});

function loginRequired(req, res, next) {
  if (!req.user) {
    const accept = req.headers.accept || ""; // Prevent undefined

    if (req.xhr || accept.includes("json")) {
      return res.status(401).json({ error: "Authentication required" });
    }

    return res.redirect("/login");
  }
  next();
}
// ==========================================
// 4. AUTH & USER ROUTES
// ==========================================


// health check
app.get("/health", (req, res) => {
  res.status(200).json({
    status: "ok",
    service: "backend-api",
    message: "server is running",
    uptime: process.uptime(),        // seconds
    timestamp: new Date().toISOString()
  });
});



app.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: "Email and password required" });
    }

    if (!mongooseConnected) {
      return res.status(500).json({ success: false, message: "Database not connected" });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ success: false, message: "Invalid credentials" });
    }

    // Compare password (using password_hash from Mongoose model)
    const isMatch = await bcrypt.compare(password, user.password_hash || "");
    if (!isMatch) {
      // Logic for demo users fallback
      const isDemo = (email === "demouser@sagealpha.ai" && password === "Demouser") ||
        (email === "devuser@sagealpha.ai" && password === "Devuser") ||
        (email === "produser@sagealpha.ai" && password === "Produser");
      if (!isDemo) {
        return res.status(401).json({ success: false, message: "Invalid credentials" });
      }
    }

    // Generate JWT
    const JWT_SECRET = process.env.JWT_SECRET;
    if (!JWT_SECRET && IS_PRODUCTION) {
      return res.status(500).json({ success: false, message: "Server configuration error" });
    }
    const token = jwt.sign(
      { id: user._id },
      JWT_SECRET || "fallback_jwt_secret_DEV_ONLY",
      { expiresIn: "7d" }
    );

    // Also set session for backward compatibility (LLM routes)
    req.session.userId = user._id.toString();
    req.session.save();

    res.status(200).json({
      success: true,
      message: "Login successful",
      token,
      user: {
        id: user._id,
        name: user.display_name || user.username,
        email: user.email,
      },
    });
  } catch (error) {
    console.error("Login Error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

app.post("/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error("[AUTH] Logout error:", err);
      return res.status(500).json({ success: false, message: "Could not log out" });
    }
    res.clearCookie("connect.sid");
    res.status(200).json({ success: true, message: "Logged out successfully" });
  });
});

app.post("/forgot-password", async (req, res) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email });

    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    // Check if email service is configured
    if (!isEmailConfigured) {
      console.error("[FORGOT-PASSWORD] Email service not configured. Please set BREVO_API_KEY environment variable.");
      return res.status(503).json({
        success: false,
        message: "Email service is not configured. Please contact support."
      });
    }

    const otp = speakeasy.totp({
      secret: process.env.JWT_SECRET || "fallback_jwt_secret_DEV_ONLY",
      digits: 6,
      step: 300
    });

    const otpExpiryMinutes = parseInt(process.env.OTP_EXPIRY_MINUTES) || 5;
    user.otp_code = otp;
    user.otp_expires = new Date(Date.now() + (otpExpiryMinutes * 60000));
    await user.save();
    console.log("email", email, "otp", otp);
    try {
      await sendEmail({
        to: email,
        subject: "Password Reset OTP - SageAlpha",
        html: `
          <div style="font-family:Arial;padding:20px;border:1px solid #ddd;">
            <h2>Your OTP Code</h2>
            <p>Use the following OTP to reset your password:</p>
            <h1 style="color:#007bff">${otp}</h1>
            <p>This OTP is valid for <strong>${otpExpiryMinutes} minutes</strong>.</p>
          </div>
        `
      });
      console.log(`[FORGOT-PASSWORD] OTP sent successfully to ${email}`);
      return res.json({ success: true, message: "OTP sent to email" });
    } catch (emailError) {
      console.error("[FORGOT-PASSWORD] Email send error:", emailError.message);

      // Generic email error
      return res.status(500).json({
        success: false,
        message: "Failed to send email. Please try again later or contact support."
      });
    }

  } catch (err) {
    console.error("[FORGOT-PASSWORD] Error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});



app.post("/reset-password", async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;
    const user = await User.findOne({ email });

    if (!user) return res.status(404).json({ message: "User not found" });

    if (!user.otp_code || !user.otp_expires)
      return res.status(400).json({ message: "OTP not requested" });

    if (new Date() > user.otp_expires)
      return res.status(400).json({ message: "OTP expired" });

    if (otp !== user.otp_code)
      return res.status(400).json({ message: "Invalid OTP" });

    user.password_hash = bcrypt.hashSync(newPassword, 10);
    user.otp_code = null;
    user.otp_expires = null;
    await user.save();

    res.json({ success: true, message: "Password reset successful" });

  } catch (error) {
    console.error("Reset Password Error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
});


app.post("/register", async (req, res) => {
  const { username, email, password, waitlist_user } = req.body;
  let isWaitlist = (waitlist_user === "true" || waitlist_user === true) ? true : false;

  if (!username || !email || !password) {
    return res.status(400).json({ success: false, message: "All fields required" });
  }

  if (!mongooseConnected) {
    return res.status(503).json({ success: false, message: "Database service unavailable" });
  }

  try {
    // Check for existing user first to avoid messy duplicate key errors
    const existingUser = await User.findOne({
      $or: [{ email: email }, { username: username }]
    });

    if (existingUser) {
      const field = existingUser.email === email ? "Email" : "Username";
      return res.status(400).json({ success: false, message: `${field} already exists` });
    }

    const hash = bcrypt.hashSync(password, 10);
    const created = await User.create({ username, display_name: username, password_hash: hash, email, is_active: true, is_waitlist: isWaitlist });

    const JWT_SECRET = process.env.JWT_SECRET;
    if (!JWT_SECRET && IS_PRODUCTION) {
      return res.status(500).json({ success: false, message: "Server configuration error" });
    }
    const token = jwt.sign(
      { id: created._id },
      JWT_SECRET || "fallback_jwt_secret_DEV_ONLY",
      { expiresIn: "7d" }
    );

    req.session.userId = created._id.toString();
    req.session.save();

    res.status(201).json({
      success: true,
      token,
      user: {
        id: created._id,
        username: created.username,
        email: created.email
      }
    });
  } catch (err) {
    console.error("Register error:", err);
    let error = "Registration failed";
    if (err.message && err.message.includes("duplicate key")) error = "Username or email taken";
    res.status(400).json({ success: false, message: error });
  }
});

app.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/login");
  });
});

app.get("/api/status", (req, res) => {
  res.json({
    status: "ok",
    version: res.locals.APP_VERSION,
    node_env: process.env.NODE_ENV
  });
});

// ==========================================
// 5. CHAT & AI LOGIC
// ==========================================

// --- Vector Store (Simple In-Memory + File Persistence) ---
// Azure-safe: Use configured directory
class VectorStore {
  constructor(storeDir) {
    this.storeDir = storeDir;
    if (!fs.existsSync(storeDir)) {
      fs.mkdirSync(storeDir, { recursive: true });
    }

    this.metaPath = path.join(storeDir, "metadata.json");
    this.embPath = path.join(storeDir, "embeddings.json"); // Using JSON for simplicity in Node

    this.docs = []; // { doc_id, text, meta, embedding }
    this.load();
  }

  load() {
    if (fs.existsSync(this.metaPath) && fs.existsSync(this.embPath)) {
      try {
        const meta = JSON.parse(fs.readFileSync(this.metaPath, "utf-8"));
        const embs = JSON.parse(fs.readFileSync(this.embPath, "utf-8"));
        // Merge
        this.docs = meta.map((m, i) => ({
          ...m,
          embedding: embs[i]
        }));
        console.log(`[VectorStore] Loaded ${this.docs.length} documents.`);
      } catch (e) {
        console.error("[VectorStore] Load error:", e);
        this.docs = [];
      }
    }
  }

  save() {
    const meta = this.docs.map(d => ({ doc_id: d.doc_id, text: d.text, meta: d.meta }));
    const embs = this.docs.map(d => d.embedding);
    fs.writeFileSync(this.metaPath, JSON.stringify(meta, null, 2));
    fs.writeFileSync(this.embPath, JSON.stringify(embs));
  }

  cosineSimilarity(vecA, vecB) {
    if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < vecA.length; i++) {
      dot += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }
    return dot / (Math.sqrt(normA) * Math.sqrt(normB) + 1e-9);
  }

  search(queryEmbedding, k = 5) {
    if (!queryEmbedding || this.docs.length === 0) return [];

    const scored = this.docs.map(doc => ({
      ...doc,
      score: this.cosineSimilarity(queryEmbedding, doc.embedding)
    }));

    // Sort DESC
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, k);
  }
}

const vs = new VectorStore(VECTOR_STORE_DIR);

// --- LLM Client Setup ---
let llmClient = null;
let llmMode = "none"; // azure, openai, mock

function initLLM() {
  // 1. Azure OpenAI
  if (process.env.AZURE_OPENAI_API_KEY && process.env.AZURE_OPENAI_ENDPOINT) {
    llmClient = new AzureOpenAI({
      apiKey: process.env.AZURE_OPENAI_API_KEY,
      endpoint: process.env.AZURE_OPENAI_ENDPOINT,
      apiVersion: process.env.AZURE_OPENAI_API_VERSION || "2024-02-15-preview",
      deployment: process.env.AZURE_OPENAI_DEPLOYMENT
    });
    llmMode = "azure";
    console.log("[LLM] Azure OpenAI initialized.");
  }
  // 2. Standard OpenAI
  else if (process.env.OPENAI_API_KEY) {
    llmClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    llmMode = "openai";
    console.log("[LLM] OpenAI initialized.");
  }
  // 3. Mock
  else {
    llmMode = "mock";
    console.log("[LLM] Formatting Mock mode enabled.");
  }
}
initLLM();

async function getEmbedding(text) {
  if (llmMode === "mock" || !llmClient) {
    // Deterministic dummy embedding (pseudo-random based on hash)
    // Note: Real world this is garbage, but fine for mock structure test
    return new Array(1536).fill(0).map(() => Math.random() * 0.1);
  }
  try {
    const model = process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT || "text-embedding-3-small";
    // Safety check: Avoid non-embedding models like 'gpt-5-chat'
    const finalModel = (model.includes('gpt') || model.includes('chat')) ? "text-embedding-3-small" : model;

    const resp = await llmClient.embeddings.create({
      model: finalModel,
      input: text
    });
    return resp.data[0].embedding;
  } catch (e) {
    console.error("[Embedding] Error:", e.message);
    return new Array(1536).fill(0);
  }
}

async function chatCompletion(messages) {
  if (llmMode === "mock" || !llmClient) {
    const lastMsg = messages[messages.length - 1].content;
    return `[MOCK RESPONSE] You asked: "${lastMsg}". SageAlpha Node backend is running! Real LLM not configured.`;
  }

  const model = llmMode === "azure"
    ? (process.env.AZURE_OPENAI_DEPLOYMENT || "SageAlpha.ai")
    : (process.env.OPENAI_MODEL || "gpt-4.0");

  const resp = await llmClient.chat.completions.create({
    model: model,
    messages: messages,
    temperature: 0.5,
    max_tokens: 1500,
    top_p: 1,
    frequency_penalty: 0,
    presence_penalty: 0
  });
  return resp.choices[0].message.content;
}

// REPORTS_DIR already defined above in Azure-safe paths section

async function generateEquityResearchHTML(companyName, userMessage, contextText) {
  const systemPrompt = `You are a Senior Equity Research Analyst.
Generate a high-end investment research report for ${companyName} in professional JSON format.
Use these sections: Executive Summary, Financial Performance, Valuation analysis, Risks, and Recommendation.
Use the following context if relevant:
${contextText}

The output must be ONLY a valid JSON object matching this structure:
{
  "companyName": "Company Name",
  "ticker": "TICKER",
  "subtitle": "Brief catchy subtitle",
  "sector": "Sector Name",
  "region": "Region Name",
  "rating": "OVERWEIGHT/NEUTRAL/UNDERWEIGHT",
  "targetPrice": "INRPrice",
  "targetPeriod": "12-18M",
  "currentPrice": "INRPrice",
  "upside": "+X%",
  "marketCap": "INRX",
  "entValue": "INRX",
  "evEbitda": "X.x",
  "pe": "X.x",
  "investmentThesis": [
    { "title": "Headline", "content": "Detailed analysis" }
  ],
  "highlights": [
    { "title": "Headline", "content": "Recent results analysis" }
  ],
  "valuationMethodology": [
    { "method": "DCF / PE Relative", "details": "Explanation of model and assumptions" }
  ],
  
  "catalysts": [
    { "title": "Upcoming product launch", "impact": "Expected revenue uplift" }
  ],
  
  "risks": [
    { "title": "Competitive pressure", "impact": "Margin compression" }
  ],
  "financialSummary": [
    { "year": "2024A", "rev": "0", "ebitda": "0", "mrg": "0%", "eps": "0", "fcf": "0" },
    { "year": "2025E", "rev": "0", "ebitda": "0", "mrg": "0%", "eps": "0", "fcf": "0" },
    { "year": "2026E", "rev": "0", "ebitda": "0", "mrg": "0%", "eps": "0", "fcf": "0" }
  ],
  "analyst": "SageAlpha Research Team",
  "analystEmail": "research@sagealpha.ai",
  "ratingHistory": [
    { "event": "Init", "date": "Month Year @ $Price" }
  ]
}
Do not include any other text or markdown formatting.`;

  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userMessage }
  ];

  let response = await chatCompletion(messages);

  // Clean up JSON if LLM added markdown blocks
  response = response.replace(/```json/g, "").replace(/```/g, "").trim();

  try {
    const reportData = JSON.parse(response);
    console.log("report data in index.js", reportData);
    return generateReportHtml(reportData, logoBase64);
  } catch (err) {
    console.error("[Report] JSON Parse Error. Falling back to simple HTML. Raw:", response);
    // Fallback to a very simple HTML if JSON fails
    return `<html><body><h1>Error generating structured report</h1><pre>${response}</pre></body></html>`;
  }
}




// Helper function to get base URL for production/development
function getBaseUrl(req) {
  if (IS_PRODUCTION) {
    return process.env.BACKEND_URL || process.env.WEBSITE_HOSTNAME
      ? `${process.env.WEBSITE_HOSTNAME || process.env.BACKEND_URL}`
      : `${req.protocol}://${req.get('host')}`;
  } else {
    const protocol = req.protocol || 'http';
    const host = req.get('host') || `localhost:${PORT}`;
    return `${protocol}://${host}`;
  }
}





// ==========================================
// 6. CHAT ROUTES
// ==========================================

app.post("/chat", async (req, res) => {
  try {
    const { message, session_id, top_k } = req.body;
    if (!message) return res.status(400).json({ error: "Empty message" });

    // const userId = req.user._id ? req.user._id : req.user.id;
    let userId;

    if (req.user) {
      userId = req.user._id || req.user.id;
    } else {
      userId = new mongoose.Types.ObjectId();; // or generate temp ID
    }

    let chatId = session_id;

    // 1. Session Management
    let dbSession = null;
    if (mongooseConnected) {
      if (chatId) dbSession = await ChatSession.findOne({ id: chatId, user_id: userId });
      if (!dbSession) {
        chatId = uuidv4();
        await ChatSession.create({ id: chatId, user_id: userId, title: 'New Chat' });
      }
    }

    // 2. Save User Message
    if (mongooseConnected) {
      await Message.create({ user_id: userId, session_id: chatId, role: 'user', content: message });
    }

    // 3. Update Title (if new)
    let count = 0;
    if (mongooseConnected) {
      count = await Message.countDocuments({ session_id: chatId });
      if (count <= 2) {
        const newTitle = message.substring(0, 60);
        await ChatSession.updateOne({ id: chatId }, { $set: { title: newTitle, updated_at: new Date() } });
      }
    }

    // 4. RAG Retrieval
    const qEmb = await getEmbedding(message);
    const docs = vs.search(qEmb, parseInt(top_k) || 5);

    // Build Context
    let contextText = "";
    const sources = [];
    if (docs.length > 0 && docs[0].score > 0.35) {
      contextText = docs.map(d => `Source: ${d.meta.source}\n${d.text}`).join("\n\n").substring(0, 6000);
      sources.push(...docs.map(d => ({ doc_id: d.doc_id, source: d.meta.source, score: d.score })));
    }

    // 5. Build Messages
    const systemPrompt = `You are SageAlpha, a financial assistant.
Use this context if relevant:
${contextText}

If context is empty or irrelevant, answer from knowledge. Be precise.`;

    // Get recent history
    let historyRows = [];
    if (mongooseConnected) {
      historyRows = (await Message.find({ session_id: chatId }).sort({ _id: -1 }).limit(10).lean()).reverse();
    }

    const messages = [
      { role: "system", content: systemPrompt },
      ...historyRows.map(r => ({ role: r.role, content: r.content }))
    ];

    // 6. LLM Call
    const aiResponse = await chatCompletion(messages);

    // 7. Save Assistant Message
    if (mongooseConnected) {
      await Message.create({ user_id: userId, session_id: chatId, role: 'assistant', content: aiResponse });
    }

    return res.json({
      id: uuidv4(),
      response: aiResponse,
      message: { role: "assistant", content: aiResponse },
      sources: sources,
      session_id: chatId
    });

  } catch (e) {
    console.error("Chat error:", e);
    res.status(500).json({ error: e.message });
  }
});

// ==========================================
// 7. PORTFOLIO ROUTES
// ==========================================

app.get("/", loginRequired, (req, res) => {
  // Determine if we show Chat or Portfolio as home? 
  // Python app.py route "/" calls index.html which is the Chat interface.
  // Portfolio is /portfolio

  // We need to pass data for the chat interface (available sessions, etc)
  res.render("index.html", {
    APP_VERSION: res.locals.APP_VERSION,
    LLM_MODE: llmMode
  });
});

app.get("/portfolio", loginRequired, async (req, res) => {
  const userId = req.user._id;
  const date = req.query.date ? new Date(req.query.date) : new Date();

  if (mongooseConnected) {
    const items = await PortfolioItem.find({ user_id: userId, item_date: { $gte: new Date(date.toISOString().split('T')[0]) } }).sort({ updated_at: -1 }).lean();
    // Get all reports for the user (not just today's) - for portfolio page
    const reports = await Report.find({ user_id: userId }).sort({ created_at: -1 }).lean();
    const allApproved = reports.length > 0 && reports.every(r => r.status === 'approved');

    // Add download URL to each report
    const baseUrl = getBaseUrl(req);
    const reportsWithUrls = reports.map(report => {
      // Extract report ID from report_data or report_path
      let reportId = report.report_data;
      if (!reportId && report.report_path) {
        const filename = path.basename(report.report_path, '.html');
        reportId = filename;
      }

      return {
        ...report,
        download_url: reportId ? `${baseUrl}/reports/download/${reportId}` : null,
        company_name: report.title.replace('Equity Research Note – ', '').trim()
      };
    });

    return res.json({
      portfolio_items: items,
      reports: reportsWithUrls,
      all_approved: allApproved,
      selected_date: date.toISOString().split('T')[0]
    });
  }

  res.status(500).json({ error: "Database not connected" });
});

// Additional page routes so frontend navigation to pages like /profile works
app.get('/profile', loginRequired, (req, res) => {
  if (req.xhr || req.headers.accept?.indexOf('json') > -1) {
    return res.json({ user: res.locals.current_user });
  }
  res.render('profile.html', { user: res.locals.current_user });
});
app.get('/quick_report', loginRequired, (req, res) => {
  res.render('quick_report.html');
});
app.get('/report_preview', loginRequired, (req, res) => {
  res.render('report_preview.html');
});
app.get('/sagealpha_reports', loginRequired, (req, res) => {
  res.render('sagealpha_reports.html');
});
app.get('/reset_password', (req, res) => {
  res.render('reset_password.html');
});
app.get('/forgot_password', (req, res) => {
  res.render('forgot_password.html');
});
// also map old-style endpoints
app.get('/forgot-password', (req, res) => res.redirect('/forgot_password'));
app.get('/auth/login', (req, res) => res.redirect('/login'));

app.post("/portfolio/add", loginRequired, async (req, res) => {
  // { company_name, ticker }
  const { company_name, ticker } = req.body;
  const userId = req.user._id ? req.user._id : req.user.id;

  if (!company_name) return res.status(400).json({ error: "Company Name Required" });

  const today = new Date().toISOString().split('T')[0];
  const now = new Date();

  if (mongooseConnected) {
    let item = await PortfolioItem.findOne({ user_id: userId, company_name: company_name, item_date: { $gte: new Date(today) } });
    let itemId;
    if (item) {
      itemId = item._id;
      await PortfolioItem.updateOne({ _id: itemId }, { $set: { updated_at: new Date() } });
    } else {
      const created = await PortfolioItem.create({ user_id: userId, company_name, ticker: ticker || "", item_date: new Date(today) });
      itemId = created._id;

      await Report.create({ portfolio_item_id: itemId, user_id: userId, title: `Equity Research Note – ${company_name}`, status: 'pending', report_date: new Date(today), created_at: now });
    }

    return res.json({ success: true, item_id: itemId });
  }

  // Fallback SQLite behavior
  const exist = db.prepare("SELECT id FROM portfolio_items WHERE user_id=? AND company_name=? AND item_date=?").get(userId, company_name, today);

  let itemId;
  if (exist) {
    itemId = exist.id;
    db.prepare("UPDATE portfolio_items SET updated_at=? WHERE id=?").run(now, itemId);
  } else {
    const info = db.prepare(`
            INSERT INTO portfolio_items (user_id, company_name, ticker, item_date, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(userId, company_name, ticker || "", today, now, now);
    itemId = info.lastInsertRowid;

    // Auto report
    db.prepare(`
            INSERT INTO reports (portfolio_item_id, user_id, title, status, report_date, created_at)
            VALUES (?, ?, ?, 'pending', ?, ?)
        `).run(itemId, userId, `Equity Research Note – ${company_name}`, today, now);
  }

  res.json({ success: true, item_id: itemId });
});

app.get("/subscribers", loginRequired, async (req, res) => {
  const userId = req.user._id ? req.user._id : req.user.id;

  try {
    let subscribers = [];

    if (mongooseConnected) {
      subscribers = await Subscriber.find({ user_id: userId, is_active: true }).sort({ created_at: -1 }).lean();
      // Convert MongoDB ObjectIds to strings for JSON serialization
      subscribers = subscribers.map(sub => ({
        ...sub,
        _id: sub._id.toString(),
        user_id: sub.user_id.toString()
      }));
    } else {
      subscribers = db.prepare("SELECT * FROM subscribers WHERE user_id = ? AND is_active = 1 ORDER BY created_at DESC").all(userId);
    }

    console.log(`[Subscribers] Returning ${subscribers.length} subscribers for user ${userId}`);

    // Always return JSON for API requests
    // Check if it's an API request (has Authorization header or Accept: application/json)
    const isApiRequest = req.headers.authorization ||
      req.headers.accept?.indexOf('application/json') > -1 ||
      req.xhr;

    if (isApiRequest) {
      return res.json({ subscribers });
    }

    // Otherwise render HTML template (for server-side rendering)
    return res.render("subscribers.html", { subscribers });
  } catch (e) {
    console.error("[Subscribers] Fetch error:", e);
    return res.status(500).json({ error: "Failed to fetch subscribers", subscribers: [] });
  }
});

app.post("/subscribers/add", loginRequired, async (req, res) => {
  const { name, email, mobile, risk_profile } = req.body;
  const userId = req.user._id ? req.user._id : req.user.id;

  if (!name || !email) {
    return res.status(400).json({ error: "Name and email are required" });
  }

  // Validate risk_profile
  const validRiskProfiles = ['Low', 'Medium', 'High'];
  const riskProfile = risk_profile && validRiskProfiles.includes(risk_profile) ? risk_profile : 'Medium';

  try {
    if (mongooseConnected) {
      // Check for duplicate email
      const existing = await Subscriber.findOne({ user_id: userId, email: email.toLowerCase().trim() });
      if (existing) {
        return res.status(400).json({ error: "Subscriber with this email already exists" });
      }

      await Subscriber.create({
        user_id: userId,
        name: name.trim(),
        mobile: mobile?.trim() || "",
        email: email.toLowerCase().trim(),
        risk_profile: riskProfile
      });
    } else {
      db.prepare(`
            INSERT INTO subscribers (user_id, name, mobile, email, risk_profile, created_at)
            VALUES (?, ?, ?, ?, ?, datetime('now'))
        `).run(userId, name.trim(), mobile?.trim() || "", email.toLowerCase().trim(), riskProfile);
    }

    // Always return JSON for API requests
    return res.json({ success: true, message: "Subscriber added successfully" });
  } catch (e) {
    console.error("[Subscriber] Add error:", e);
    return res.status(500).json({ error: e.message || "Failed to add subscriber" });
  }
});

// Edit subscriber route
app.put("/subscribers/:id", loginRequired, async (req, res) => {
  const { id } = req.params;
  const { name, email, mobile, risk_profile } = req.body;
  const userId = req.user._id ? req.user._id : req.user.id;

  if (!name || !email) {
    return res.status(400).json({ error: "Name and email are required" });
  }

  // Validate risk_profile
  const validRiskProfiles = ['Low', 'Medium', 'High'];
  const riskProfile = risk_profile && validRiskProfiles.includes(risk_profile) ? risk_profile : 'Medium';

  try {
    if (mongooseConnected) {
      // Check if subscriber exists and belongs to user
      const subscriber = await Subscriber.findOne({ _id: id, user_id: userId });
      if (!subscriber) {
        return res.status(404).json({ error: "Subscriber not found" });
      }

      // Check for duplicate email (excluding current subscriber)
      const existing = await Subscriber.findOne({
        user_id: userId,
        email: email.toLowerCase().trim(),
        _id: { $ne: id }
      });
      if (existing) {
        return res.status(400).json({ error: "Subscriber with this email already exists" });
      }

      // Update subscriber
      await Subscriber.updateOne(
        { _id: id, user_id: userId },
        {
          name: name.trim(),
          mobile: mobile?.trim() || "",
          email: email.toLowerCase().trim(),
          risk_profile: riskProfile
        }
      );
    } else {
      // SQLite implementation
      const existing = db.prepare("SELECT * FROM subscribers WHERE _id = ? AND user_id = ?").get(id, userId);
      if (!existing) {
        return res.status(404).json({ error: "Subscriber not found" });
      }

      // Check for duplicate email
      const duplicate = db.prepare("SELECT * FROM subscribers WHERE email = ? AND user_id = ? AND _id != ?")
        .get(email.toLowerCase().trim(), userId, id);
      if (duplicate) {
        return res.status(400).json({ error: "Subscriber with this email already exists" });
      }

      db.prepare(`
        UPDATE subscribers 
        SET name = ?, mobile = ?, email = ?, risk_profile = ?
        WHERE _id = ? AND user_id = ?
      `).run(name.trim(), mobile?.trim() || "", email.toLowerCase().trim(), riskProfile, id, userId);
    }

    return res.json({ success: true, message: "Subscriber updated successfully" });
  } catch (e) {
    console.error("[Subscriber] Update error:", e);
    return res.status(500).json({ error: e.message || "Failed to update subscriber" });
  }
});

// Delete subscriber route
app.delete("/subscribers/:id", loginRequired, async (req, res) => {
  const { id } = req.params;
  const userId = req.user._id ? req.user._id : req.user.id;

  try {
    if (mongooseConnected) {
      // Check if subscriber exists and belongs to user
      const subscriber = await Subscriber.findOne({ _id: id, user_id: userId });
      if (!subscriber) {
        return res.status(404).json({ error: "Subscriber not found" });
      }

      // Soft delete by setting is_active to false
      await Subscriber.updateOne(
        { _id: id, user_id: userId },
        { is_active: false }
      );
    } else {
      // SQLite implementation - soft delete
      const existing = db.prepare("SELECT * FROM subscribers WHERE _id = ? AND user_id = ?").get(id, userId);
      if (!existing) {
        return res.status(404).json({ error: "Subscriber not found" });
      }

      db.prepare(`
        UPDATE subscribers 
        SET is_active = 0
        WHERE _id = ? AND user_id = ?
      `).run(id, userId);
    }

    return res.json({ success: true, message: "Subscriber deleted successfully" });
  } catch (e) {
    console.error("[Subscriber] Delete error:", e);
    return res.status(500).json({ error: e.message || "Failed to delete subscriber" });
  }
});



// ==========================================
// 8. SESSION & DATA ROUTES (Missing from initial pass)
// ==========================================

app.get("/user", loginRequired, (req, res) => {
  res.json({
    id: req.user.id,
    username: req.user.username,
    email: req.user.email,
    display_name: req.user.display_name,
    avatar_url: null
  });
});

app.get("/sessions", loginRequired, async (req, res) => {
  const userId = req.user._id ? req.user._id : req.user.id;
  if (mongooseConnected) {
    const rows = await ChatSession.find({ user_id: userId }).sort({ updated_at: -1 }).lean();
    return res.json({ sessions: rows });
  }
  res.status(500).json({ error: "Database not connected" });
});

app.post("/sessions", loginRequired, async (req, res) => {
  const userId = req.user._id ? req.user._id : req.user.id;
  const { title } = req.body;
  const id = uuidv4();

  if (mongooseConnected) {
    await ChatSession.create({ id, user_id: userId, title: title || 'New Chat' });
    return res.json({ session: { id, title: title || "New Chat", updated_at: new Date() } });
  }

  res.status(500).json({ error: "Database not connected" });
});

app.get("/sessions/:id", loginRequired, async (req, res) => {
  const userId = req.user._id ? req.user._id : req.user.id;
  const { id } = req.params;

  if (mongooseConnected) {
    const session = await ChatSession.findOne({ id, user_id: userId }).lean();
    if (!session) return res.status(404).json({ error: "Session not found" });

    const messages = await Message.find({ session_id: id }).sort({ _id: 1 }).lean();
    return res.json({ session: { ...session, messages } });
  }

  res.status(500).json({ error: "Database not connected" });
});

app.post("/sessions/:id/rename", loginRequired, async (req, res) => {
  const userId = req.user._id ? req.user._id : req.user.id;
  const { id } = req.params;
  const { title } = req.body;

  if (mongooseConnected) {
    await ChatSession.updateOne({ id, user_id: userId }, { $set: { title, updated_at: new Date() } });
    return res.json({ success: true });
  }

  res.status(500).json({ error: "Database not connected" });
});

app.post("/sessions/:id/delete", loginRequired, async (req, res) => {
  const userId = req.user._id ? req.user._id : req.user.id;
  const { id } = req.params;

  if (mongooseConnected) {
    const session = await ChatSession.findOne({ id, user_id: userId });
    if (!session) return res.status(403).json({ error: "Unauthorized" });

    await Message.deleteMany({ session_id: id });
    await ChatSession.deleteOne({ id });

    return res.json({ success: true });
  }

  res.status(500).json({ error: "Database not connected" });
});

app.post("/chat/clear-all", loginRequired, async (req, res) => {
  const userId = req.user._id ? req.user._id : req.user.id;

  if (mongooseConnected) {
    try {
      // Delete all messages for this user
      await Message.deleteMany({ user_id: userId });

      // Delete all chat sessions for this user
      await ChatSession.deleteMany({ user_id: userId });

      return res.json({ success: true, message: "All chat history cleared successfully" });
    } catch (error) {
      console.error("Error clearing chat history:", error);
      return res.status(500).json({ error: "Failed to clear chat history" });
    }
  }

  res.status(500).json({ error: "Database not connected" });
});

app.post("/reports/delete-all", loginRequired, async (req, res) => {
  const userId = req.user._id ? req.user._id : req.user.id;

  if (mongooseConnected) {
    try {
      // Get all reports for this user
      const reports = await Report.find({ user_id: userId }).lean();

      // Delete all blob storage files for these reports
      for (const report of reports) {
        if (report.report_data) {
          try {
            await deleteHtmlFromBlob(report.report_data);
          } catch (blobErr) {
            console.warn("[Report] Failed to delete blob:", blobErr.message);
            // Continue with DB deletion even if blob deletion fails
          }
        }
      }

      // Delete all reports from database
      await Report.deleteMany({ user_id: userId });

      // Delete all portfolio items for this user
      await PortfolioItem.deleteMany({ user_id: userId });

      return res.json({ success: true, message: "All reports and portfolio items deleted successfully" });
    } catch (error) {
      console.error("Error deleting reports and portfolio:", error);
      return res.status(500).json({ error: "Failed to delete reports and portfolio" });
    }
  }

  res.status(500).json({ error: "Database not connected" });
});

app.post("/sessions/:id/share", loginRequired, async (req, res) => {
  const userId = req.user._id ? req.user._id : req.user.id;
  const { id } = req.params;

  if (mongooseConnected) {
    const session = await ChatSession.findOne({ id, user_id: userId });
    if (!session) return res.status(404).json({ error: "Session not found" });

    // Mock share URL
    const shareUrl = `${req.protocol}://${req.get('host')}/share/${id}`;
    return res.json({ success: true, share_url: shareUrl });
  }
  res.status(500).json({ error: "Database not connected" });
});

app.post("/chat/create-report", loginRequired, async (req, res) => {
  let { company_name, session_id } = req.body;
  const userId = req.user._id;

  if (!company_name) return res.status(400).json({ error: "Company name is required" });

  try {
    console.log(`[Report] Generating for: ${company_name}`);

    // Context retrieval
    const qEmb = await getEmbedding(company_name);
    const docs = vs.search(qEmb, 3);
    const contextText = docs.map(d => d.text).join("\n\n").substring(0, 5000);

    const reportHtml = await generateEquityResearchHTML(
      company_name,
      `Generate research report for ${company_name}`,
      contextText
    );

    const safeCompanyName = company_name.replace(/ /g, "_").replace(/[^\w]/g, "").toLowerCase();
    const reportId = `${safeCompanyName}_${Date.now()}`;

    // Upload HTML to Azure Blob Storage
    const blobFileName = await uploadHtmlToBlob(reportId, reportHtml);
    console.log(`[Report] HTML uploaded to blob: ${blobFileName}`);

    // Generate download URL using helper function
    const baseUrl = getBaseUrl(req);
    const downloadUrl = `${baseUrl}/reports/download/${reportId}`;
    const aiMessage = `✅ Your research report for **${company_name}** is ready!\n\n📄 [Download Report as PDF](${downloadUrl})`;

    // Save report to database for portfolio
    let savedReport = null;
    if (mongooseConnected) {
      // Save report to Report model
      savedReport = await Report.create({
        user_id: userId,
        title: `Equity Research Note – ${company_name}`,
        status: 'pending',
        report_path: blobFileName, // Store blob filename (e.g., "reportId.html")
        report_data: reportId, // Store report ID for reference (used to generate download URL)
        report_type: 'equity_research',
        report_date: new Date(),
        created_at: new Date()
      });


      // Save chat history
      if (!session_id) {
        session_id = uuidv4();
        await ChatSession.create({ id: session_id, user_id: userId, title: `Report: ${company_name}` });
      }

      await Message.create({ user_id: userId, session_id, role: 'user', content: `Generate report for ${company_name}` });
      await Message.create({ user_id: userId, session_id, role: 'assistant', content: aiMessage });
    }

    return res.json({
      success: true,
      response: aiMessage,
      download_url: downloadUrl,
      report_id: reportId,
      session_id: session_id
    });

  } catch (e) {
    console.error("[Report] Error:", e);
    res.status(500).json({ error: "Failed to generate report" });
  }
});

// Approve report endpoint
app.post("/reports/:id/approve", loginRequired, async (req, res) => {
  const reportId = req.params.id;
  const userId = req.user._id;

  try {
    if (!mongooseConnected) {
      return res.status(500).json({ error: "Database not connected" });
    }

    const report = await Report.findOne({ _id: reportId, user_id: userId });
    if (!report) {
      return res.status(404).json({ error: "Report not found" });
    }

    await Report.updateOne(
      { _id: reportId },
      {
        $set: {
          status: 'approved',
          approved_at: new Date()
        }
      }
    );

    return res.json({ success: true, message: "Report approved successfully" });
  } catch (e) {
    console.error("[Report] Approve error:", e);
    res.status(500).json({ error: "Failed to approve report" });
  }
});

// Delete report endpoint
// Delete report endpoint
app.post("/reports/:id/delete", loginRequired, async (req, res) => {
  const reportId = req.params.id;
  const userId = req.user._id;

  try {
    if (!mongooseConnected) {
      return res.status(500).json({ error: "Database not connected" });
    }

    const report = await Report.findOne({ _id: reportId, user_id: userId });
    if (!report) {
      return res.status(404).json({ error: "Report not found" });
    }

    // Delete the HTML blob from Azure Blob Storage
    if (report.report_data) {
      try {
        await deleteHtmlFromBlob(report.report_data);
      } catch (blobErr) {
        console.warn("[Report] Failed to delete blob:", blobErr.message);
        // Continue with DB deletion even if blob deletion fails
      }
    }

    await Report.deleteOne({ _id: reportId });

    return res.json({ success: true, message: "Report deleted successfully" });
  } catch (e) {
    console.error("[Report] Delete error:", e);
    res.status(500).json({ error: "Failed to delete report" });
  }
});
// Azure-safe upload directory
const upload = multer({
  dest: UPLOADS_DIR,
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB limit
  }
});
app.post("/upload", loginRequired, upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });
  res.json({
    filename: req.file.originalname,
    doc_id: uuidv4(),
    chunks: Math.floor(Math.random() * 20) + 5,
    url: `/uploads/${req.file.filename}`
  });
});


/**
 * Validate HTML size for PDF generation
 * @param {string} htmlContent - HTML content to validate
 * @param {number} maxSizeBytes - Maximum size in bytes (default: 1.5MB)
 * @returns {Object} { valid: boolean, sizeBytes: number, error?: string }
 */
function validateHtmlSize(htmlContent, maxSizeBytes = 1.5 * 1024 * 1024) {
  const sizeBytes = Buffer.byteLength(htmlContent, 'utf8');
  if (sizeBytes > maxSizeBytes) {
    return {
      valid: false,
      sizeBytes,
      error: `HTML content exceeds maximum size of ${maxSizeBytes} bytes (${(maxSizeBytes / 1024 / 1024).toFixed(2)}MB). Actual size: ${sizeBytes} bytes (${(sizeBytes / 1024 / 1024).toFixed(2)}MB)`
    };
  }
  return { valid: true, sizeBytes };
}

/**
 * Detect and log Base64 images in HTML
 * @param {string} htmlContent - HTML content to analyze
 * @returns {number} Number of Base64 images detected
 */
function detectBase64Images(htmlContent) {
  // Match img tags with data:image base64 src
  const base64ImagePattern = /<img[^>]*src=["']data:image\/[^;]+;base64,[^"']+["'][^>]*>/gi;
  const matches = htmlContent.match(base64ImagePattern);
  const count = matches ? matches.length : 0;

  if (count > 0) {
    console.log(`[PDF] Detected ${count} Base64 image(s) in HTML content`);
  }

  return count;
}

/**
 * Strip all HTML tags and return only text content
 * @param {string} htmlContent - HTML content to strip
 * @returns {string} Plain text content without HTML tags
 */
function stripHtmlTags(htmlContent) {
  // Remove script and style elements and their content
  let text = htmlContent.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');

  // Replace HTML entities
  text = text.replace(/&nbsp;/g, ' ');
  text = text.replace(/&amp;/g, '&');
  text = text.replace(/&lt;/g, '<');
  text = text.replace(/&gt;/g, '>');
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#39;/g, "'");

  // Remove all HTML tags
  text = text.replace(/<[^>]+>/g, '');

  // Clean up whitespace - replace multiple spaces/newlines with single space
  text = text.replace(/\s+/g, ' ');

  // Trim and return
  return text.trim();
}

app.get("/reports/download/:id", async (req, res) => {
  try {
    const reportId = req.params.id.replace(/[^\w\-_]/g, "_");

    console.log(`[Download] Request for report ID: ${reportId}`);

    // Get HTML content from Azure Blob Storage
    const htmlContent = await getHtmlFromBlob(reportId);

    if (!htmlContent) {
      console.error(`[Download] HTML blob not found for report ID: ${reportId}`);
      return res.status(404).json({ error: "Report not found" });
    }

    // Validate HTML size (reject > 1.5MB)
    const sizeValidation = validateHtmlSize(htmlContent);
    if (!sizeValidation.valid) {
      console.error(`[Download] HTML size validation failed: ${sizeValidation.error}`);
      return res.status(400).json({
        error: "HTML content too large for PDF generation",
        message: sizeValidation.error
      });
    }

    // Log HTML size and Base64 image detection
    console.log(`[Download] HTML content size: ${sizeValidation.sizeBytes} bytes (${(sizeValidation.sizeBytes / 1024).toFixed(2)} KB)`);
    detectBase64Images(htmlContent);

    console.log(`[Download] Converting HTML to PDF (HTML passed unchanged to PDF generator)`);

    // Convert HTML to PDF (HTML passed exactly as received, no modification)
    const pdf = await convertHtmlToPdf(htmlContent);

    console.log(`[Download] PDF generated successfully (${pdf.length} bytes)`);

    // Set correct response headers
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="SageAlpha_${reportId}.pdf"`
    );

    return res.send(pdf);

  } catch (err) {
    console.error("[Download] Endpoint Error:", err.message);
    console.error("[Download] Error stack:", err.stack);
    return res.status(500).json({
      error: "PDF generation failed",
      message: err.message
    });
  }
});




// Serve HTML files publicly
app.get("/reports/html/:id", async (req, res) => {
  try {
    const reportId = req.params.id.replace(/[^\w\-_]/g, "_");

    // Get HTML content from Azure Blob Storage
    const htmlContent = await getHtmlFromBlob(reportId);

    if (!htmlContent) {
      return res.status(404).send("Report not found");
    }

    // Disable caching to ensure we always serve the latest version
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');

    res.send(htmlContent);
  } catch (err) {
    console.error("[HTML] Error serving file:", err.message);
    res.status(500).send("Error serving HTML file");
  }
});


// Preview endpoint - serves PDF inline for preview
app.get("/reports/preview/:id", async (req, res) => {
  try {
    const reportId = req.params.id.replace(/[^\w\-_]/g, "_");

    // Get HTML content from Azure Blob Storage
    const htmlContent = await getHtmlFromBlob(reportId);

    if (!htmlContent) {
      return res.status(404).json({ error: "Report not found" });
    }

    // Validate HTML size (reject > 1.5MB)
    const sizeValidation = validateHtmlSize(htmlContent);
    if (!sizeValidation.valid) {
      console.error(`[Preview] HTML size validation failed: ${sizeValidation.error}`);
      return res.status(400).json({
        error: "HTML content too large for PDF generation",
        message: sizeValidation.error
      });
    }

    // Log HTML size and Base64 image detection
    console.log(`[Preview] HTML content size: ${sizeValidation.sizeBytes} bytes (${(sizeValidation.sizeBytes / 1024).toFixed(2)} KB)`);
    detectBase64Images(htmlContent);

    console.log("[Preview] Converting HTML to PDF from blob (HTML passed unchanged to PDF generator)");
    const pdfBuffer = await convertHtmlToPdf(htmlContent);

    // Set correct response headers
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="SageAlpha_${reportId}.pdf"`);
    res.send(pdfBuffer);
    console.log("[Preview] PDF sent successfully.");
  } catch (e) {
    console.error("[Preview] Endpoint error:", e.message);
    res.status(500).send("Error generating PDF: " + e.message);
  }
});

// Get HTML content for editing
// Get HTML content for editing
app.get("/reports/edit/:id", loginRequired, async (req, res) => {
  try {
    const reportId = req.params.id.replace(/[^\w\-_]/g, "_");

    const userId = req.user._id ? req.user._id : req.user.id;
    const report = await Report.findOne({
      report_data: reportId,
      user_id: userId
    });

    if (!report) {
      return res.status(404).json({ error: "Report not found or access denied" });
    }

    // Get original HTML content
    const fullHtml = await getHtmlFromBlob(reportId);
    if (!fullHtml) {
      return res.status(404).json({ error: "Report HTML not found in storage" });
    }

    // Extract only the body content (everything between <body> and </body> tags)
    // This removes <html>, <head>, and <body> wrapper tags but preserves the HTML structure
    const bodyMatch = fullHtml.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    const bodyContent = bodyMatch ? bodyMatch[1] : fullHtml;

    // Return the body HTML content (with structure) for editing
    // Users can edit the HTML structure, and when they save, we'll wrap it with head/styles
    const trimmedBodyContent = bodyContent.trim();

    console.log(`[Edit] Extracted body HTML content for editing (${trimmedBodyContent.length} characters)`);

    res.json({
      html: trimmedBodyContent,  // Send body HTML content (with structure, but no <html>/<head>/<body> tags)
      reportId
    });

  } catch (err) {
    console.error("[Edit] Error reading HTML:", err.message);
    res.status(500).json({ error: "Error reading report HTML" });
  }
});


// Save updated HTML and regenerate PDF
// Save updated HTML and regenerate full report HTML
app.put("/reports/edit/:id", loginRequired, async (req, res) => {
  try {
    const reportId = req.params.id.replace(/[^\w\-_]/g, "_");
    const { html } = req.body;

    if (!html || typeof html !== 'string') {
      return res.status(400).json({ error: "HTML content is required" });
    }

    const userId = req.user._id ? req.user._id : req.user.id;
    const report = await Report.findOne({
      report_data: reportId,
      user_id: userId
    });

    if (!report) {
      return res.status(404).json({ error: "Report not found or access denied" });
    }

    // Get original full HTML from blob storage to extract head/styles
    const originalHtml = await getHtmlFromBlob(reportId);
    if (!originalHtml) {
      return res.status(404).json({ error: "Original report HTML not found in storage" });
    }

    // Extract head section (including styles) from original HTML
    const headMatch = originalHtml.match(/<head[^>]*>([\s\S]*?)<\/head>/i);
    const headContent = headMatch ? headMatch[1] : '<meta charset="UTF-8">';

    // Extract html tag attributes (like lang="en") if present
    const htmlTagMatch = originalHtml.match(/<html\s+([^>]*)>/i);
    const htmlAttributes = htmlTagMatch && htmlTagMatch[1].trim() ? htmlTagMatch[1] : 'lang="en"';

    // Extract DOCTYPE if present
    const doctypeMatch = originalHtml.match(/<!DOCTYPE[^>]*>/i);
    const doctype = doctypeMatch ? doctypeMatch[0] : '<!DOCTYPE html>';

    // Reconstruct full HTML with original head/styles and new body content
    const fullHtml = `${doctype}
<html ${htmlAttributes}>
<head>
${headContent}
</head>
<body>
${html}
</body>
</html>`;

    // Upload updated full HTML back to Blob
    const blobFileName = await uploadHtmlToBlob(reportId, fullHtml);
    console.log(`[Edit] Report updated and wrapped with complete HTML (preserved original styles)`);

    // Ensure DB is updated if required
    await Report.updateOne(
      { report_data: reportId, user_id: userId },
      { report_path: blobFileName }
    );

    res.json({
      success: true,
      message: "Report updated & formatted successfully",
      reportId
    });

  } catch (err) {
    console.error("[Edit] Error saving report:", err.message);
    res.status(500).json({ error: "Error saving report HTML" });
  }
});


// Send reports to subscribers via email
app.post("/reports/send", loginRequired, multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
}).single('additional_document'), async (req, res) => {
  let subscriber_emails, reports;
  
  // Handle both JSON and FormData
  if (req.body.subscriber_emails) {
    // FormData - parse JSON strings
    try {
      subscriber_emails = typeof req.body.subscriber_emails === 'string' 
        ? JSON.parse(req.body.subscriber_emails) 
        : req.body.subscriber_emails;
      reports = typeof req.body.reports === 'string' 
        ? JSON.parse(req.body.reports) 
        : req.body.reports;
    } catch (parseError) {
      return res.status(400).json({ error: "Invalid JSON in form data" });
    }
  } else {
    // Regular JSON body
    subscriber_emails = req.body.subscriber_emails;
    reports = req.body.reports;
  }
  
  const userId = req.user._id ? req.user._id : req.user.id;
  const additionalDocument = req.file; // File from multer

  if (!subscriber_emails || !Array.isArray(subscriber_emails) || subscriber_emails.length === 0) {
    return res.status(400).json({ error: "At least one subscriber email is required" });
  }

  if (!reports || !Array.isArray(reports) || reports.length === 0) {
    return res.status(400).json({ error: "At least one report is required" });
  }

  // Check if email service is configured
  if (!isEmailConfigured) {
    return res.status(500).json({ error: "Email service not configured (BREVO_API_KEY missing)" });
  }

  const results = [];
  const errors = [];

  try {
    for (const subscriberEmail of subscriber_emails) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(subscriberEmail)) {
        errors.push({ email: subscriberEmail, error: "Invalid email format" });
        continue;
      }

      // Fetch subscriber
      let subscriber;
      if (mongooseConnected) {
        subscriber = await Subscriber.findOne({
          user_id: userId,
          email: subscriberEmail.toLowerCase().trim(),
          is_active: true
        });
      } else {
        subscriber = db.prepare(
          "SELECT * FROM subscribers WHERE user_id = ? AND email = ? AND is_active = 1"
        ).get(userId, subscriberEmail.toLowerCase().trim());
      }

      if (!subscriber) {
        errors.push({ email: subscriberEmail, error: "Subscriber not found or inactive" });
        continue;
      }

      for (const reportData of reports) {
        try {
          const reportId =
            reportData.report_data ||
            reportData._id?.toString() ||
            reportData.id?.toString();

          if (!reportId) {
            errors.push({ email: subscriberEmail, error: "Report ID missing" });
            continue;
          }

          // ---------- HTML → PDF ----------
          const safeReportId = String(reportId).replace(/[^\w\-_]/g, "_");
          const htmlContent = await getHtmlFromBlob(safeReportId);

          if (!htmlContent) {
            throw new Error("Report HTML not found in blob storage");
          }

          // Validate HTML size (reject > 1.5MB)
          const sizeValidation = validateHtmlSize(htmlContent);
          if (!sizeValidation.valid) {
            throw new Error(`HTML content too large for PDF generation: ${sizeValidation.error}`);
          }

          // Log HTML size and Base64 image detection
          console.log(`[Send Report] HTML content size: ${sizeValidation.sizeBytes} bytes (${(sizeValidation.sizeBytes / 1024).toFixed(2)} KB) for report ${safeReportId}`);
          detectBase64Images(htmlContent);

          // Convert HTML to PDF (HTML passed exactly as received, no modification)
          console.log(`[Send Report] Converting HTML to PDF for report ${safeReportId} (HTML passed unchanged to PDF generator)`);
          const pdfBuffer = await convertHtmlToPdf(htmlContent);

          // ---------- Email content ----------
          const companyName =
            reportData.company_name ||
            reportData.title?.replace("Equity Research Note – ", "").trim() ||
            "Company";

          const reportTitle =
            reportData.title || `Equity Research Report - ${companyName}`;

          // ---------- SEND EMAIL (using new email service) ----------
          // Prepare attachments array
          const attachments = [
            {
              filename: `SageAlpha_${companyName.replace(/[^a-zA-Z0-9]/g, "_")}_Report.pdf`,
              content: pdfBuffer
            }
          ];

          // Add additional document if provided
          if (additionalDocument) {
            attachments.push({
              filename: additionalDocument.originalname || `Additional_Document_${Date.now()}`,
              content: additionalDocument.buffer
            });
          }

          // Update email body to mention additional document if present
          const additionalDocText = additionalDocument 
            ? `<p>Additionally, we have attached an additional document for your reference.</p>`
            : '';

          await sendEmail({
            to: subscriberEmail,
            subject: `📊 ${reportTitle} - SageAlpha Research`,
            html: `
              <!DOCTYPE html>
              <html>
              <head>
                <meta charset="utf-8">
                <style>
                  body { margin: 0; padding: 0; font-family: Arial, sans-serif; }
                </style>
              </head>
              <body>
                <!-- Header with gradient background -->
                <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center;">
                  <div style="display: inline-block; color: white; font-size: 24px; font-weight: bold;">
                    <span style="font-size: 28px; margin-right: 10px;">📊</span>
                    <span>SageAlpha Research Report</span>
                  </div>
                </div>
                
                <!-- Email body -->
                <div style="background: #ffffff; padding: 30px; font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
                  <p>Dear ${subscriber.name || 'Valued Subscriber'},</p>
                  <p>We are pleased to share with you our latest equity research report:</p>
                  <h2 style="color: #333; margin: 20px 0;">${reportTitle}</h2>
                  <p>This comprehensive report contains detailed analysis, financial insights, and investment recommendations for <strong>${companyName}</strong>.</p>
                  <p>The PDF report is attached to this email for your review.</p>
                  ${additionalDocText}
                  <p>If you have any questions or need further assistance, please don't hesitate to contact us.</p>
                  <p style="margin-top: 30px;">Best regards,<br><strong>SageAlpha Research Team</strong></p>
                </div>
              </body>
              </html>
            `,
            attachments: attachments
          });

          // ---------- SAVE DELIVERY ----------
          try {
            let reportDoc = null;

            if (mongooseConnected) {
              if (reportData._id) {
                reportDoc = await Report.findOne({
                  _id: reportData._id,
                  user_id: userId
                });
              }
              if (!reportDoc && reportId) {
                reportDoc = await Report.findOne({
                  report_data: reportId,
                  user_id: userId
                });
              }
            } else {
              reportDoc = db.prepare(
                "SELECT * FROM reports WHERE report_data = ? AND user_id = ?"
              ).get(reportId, userId);
            }

            if (reportDoc) {
              const subscriberId = subscriber._id || subscriber.id;
              const reportDocId = reportDoc._id || reportDoc.id;

              if (mongooseConnected) {
                await ReportDelivery.create({
                  subscriber_id: subscriberId,
                  report_id: reportDocId,
                  user_id: userId
                });
              } else {
                db.prepare(`
                  INSERT INTO report_deliveries (subscriber_id, report_id, user_id, sent_at)
                  VALUES (?, ?, ?, datetime('now'))
                `).run(subscriberId, reportDocId, userId);
              }
            }
          } catch (dbErr) {
            console.error("[Send Report] Delivery save failed:", dbErr.message);
          }

          results.push({
            email: subscriberEmail,
            report: reportTitle,
            status: "sent"
          });

          console.log(`[Send Report] ✓ Sent ${reportTitle} to ${subscriberEmail}`);

        } catch (sendErr) {
          console.error("[Send Report] Email send error:", sendErr);
          errors.push({
            email: subscriberEmail,
            error: sendErr.message || "Email send failed"
          });
        }
      }
    }

    return res.json({
      success: true,
      sent: results.length,
      failed: errors.length,
      results,
      errors: errors.length ? errors : undefined
    });

  } catch (err) {
    console.error("[Send Report] Fatal error:", err);
    return res.status(500).json({
      error: "Failed to send reports",
      message: err.message
    });
  }
});


// Get report history for a subscriber
app.get("/subscribers/:id/history", loginRequired, async (req, res) => {
  const { id: subscriberId } = req.params;
  const userId = req.user._id ? req.user._id : req.user.id;

  try {
    // Verify subscriber belongs to user
    let subscriber = null;
    if (mongooseConnected) {
      subscriber = await Subscriber.findOne({
        _id: subscriberId,
        user_id: userId,
        is_active: true
      });
    } else {
      subscriber = db.prepare("SELECT * FROM subscribers WHERE _id = ? AND user_id = ? AND is_active = 1")
        .get(subscriberId, userId);
    }

    if (!subscriber) {
      return res.status(404).json({ error: "Subscriber not found or access denied" });
    }

    let deliveries = [];
    if (mongooseConnected) {
      // Fetch deliveries with populated report data
      deliveries = await ReportDelivery.find({
        subscriber_id: subscriberId,
        user_id: userId
      })
        .populate('report_id', 'title report_data company_name status')
        .sort({ sent_at: -1 })
        .lean();
    } else {
      // SQLite fallback
      deliveries = db.prepare(`
        SELECT rd.*, r.title, r.report_data, r.status
        FROM report_deliveries rd
        LEFT JOIN reports r ON rd.report_id = r.id
        WHERE rd.subscriber_id = ? AND rd.user_id = ?
        ORDER BY rd.sent_at DESC
      `).all(subscriberId, userId);
    }

    // Format the response
    const history = deliveries.map(delivery => {
      const report = mongooseConnected ? delivery.report_id : {
        title: delivery.title,
        report_data: delivery.report_data,
        status: delivery.status
      };

      const companyName = report?.title?.replace("Equity Research Note – ", "").trim() || "Unknown Company";

      // Handle date - sent_at is the createdAt timestamp in the schema
      let sentDate = delivery.sent_at || delivery.created_at;
      if (mongooseConnected && sentDate) {
        sentDate = new Date(sentDate).toISOString();
      } else if (!sentDate) {
        sentDate = new Date().toISOString();
      }

      return {
        id: delivery._id?.toString() || delivery.id?.toString() || delivery._id || delivery.id,
        company_name: companyName,
        report_title: report?.title || "Unknown Report",
        report_id: report?._id?.toString() || report?.id?.toString() || report?._id || report?.id,
        sent_date: sentDate,
        status: "sent"
      };
    });

    res.json({
      success: true,
      history,
      subscriber: {
        id: subscriber._id?.toString() || subscriber.id?.toString(),
        name: subscriber.name,
        email: subscriber.email
      }
    });
  } catch (err) {
    console.error("[Subscriber History] Error:", err.message);
    res.status(500).json({ error: "Failed to fetch report history" });
  }
});

// ==========================================
// 9. SOCKET.IO
// ==========================================
io.on("connection", (socket) => {
  console.log("[Socket] Connected:", socket.id);
  socket.on("chat_message", async (data) => {
    // Echo for now, client handles HTTP fallback nicely usually
    // But to be cool:
    socket.emit("chat_response", {
      response: `[Socket Echo] ${data.message} (Real LLM via Socket not fully wired yet, use HTTP)`
    });
  });
});

// ==========================================
// 10. GLOBAL ERROR HANDLERS & PROCESS SAFETY
// ==========================================

// Unhandled promise rejection handler (Azure requirement)
process.on('unhandledRejection', (reason, promise) => {
  console.error('[PROCESS] Unhandled Rejection at:', promise, 'reason:', reason);
  // In production, log but don't crash (Azure will restart if needed)
  if (!IS_PRODUCTION) {
    console.error('[PROCESS] Exiting due to unhandled rejection (dev mode)');
    process.exit(1);
  }
});

// Uncaught exception handler
process.on('uncaughtException', (error) => {
  console.error('[PROCESS] Uncaught Exception:', error);
  // Always exit on uncaught exception (critical error)
  process.exit(1);
});

// Graceful shutdown handler
process.on('SIGTERM', () => {
  console.log('[PROCESS] SIGTERM received, shutting down gracefully...');
  server.close(() => {
    console.log('[PROCESS] Server closed');
    mongoose.connection.close().then(() => {
      console.log('[PROCESS] MongoDB connection closed');
      process.exit(0);
    }).catch(() => process.exit(1));
  });
});

// Express error handler (catch-all)
app.use((err, req, res, next) => {
  console.error('[EXPRESS] Error:', err);
  if (!res.headersSent) {
    res.status(err.status || 500).json({
      error: IS_PRODUCTION ? 'Internal server error' : err.message
    });
  }
});

// Start Server
// Azure requirement: Must bind to process.env.PORT
server.listen(PORT, '0.0.0.0', () => {
  console.log(`[SageAlpha Node] Server running on port ${PORT}`);
  console.log(`[SageAlpha Node] Environment: ${IS_PRODUCTION ? 'PRODUCTION' : 'DEVELOPMENT'}`);
  console.log(`[SageAlpha Node] HTML Reports Storage: Azure Blob Storage (Container: ${process.env.AZURE_CONTAINER_NAME || 'equity-html-reports'})`);
  console.log(`[SageAlpha Node] Uploads Dir: ${UPLOADS_DIR}`);
  if (!IS_PRODUCTION) {
    console.log(`[SageAlpha Node] Local URL: http://localhost:${PORT}`);
  }
});
