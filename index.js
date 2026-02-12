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
const { MongoClient, ObjectId } = require('mongodb');
const bcrypt = require("bcryptjs");
const fs = require("fs");
// path already required above
// Azure OpenAI removed - now using RAG service
const { generateReportHtml } = require("./reportTemplate");
const { convertHtmlToPdf } = require("./pdfGenerator");
const { uploadHtmlToBlob, getHtmlFromBlob, deleteHtmlFromBlob, uploadPdfToBlob, getBlobUrl } = require("./utils/blobStorage");
const { sendWhatsAppReport } = require("./services/whatsapp.service");
const { fetchMarketIntelligence } = require("./services/agenticIntelligenceService");
const { fetchMarketChatter } = require("./services/marketChatter");
const { normalizeMarketIntelligence } = require("./utils/normalizeMarketIntelligence");
const marketIntelligenceCache = require("./utils/marketIntelligenceCache");
const { resolveNseSymbol } = require("./utils/symbolResolver");
const { 
  saveReportDataFromLLM, 
  getReportDataByReportId, 
  getReportDataByCompanyName,
  getPriceDataByReportId,
  getPriceDataByCompanyName,
  getLatestReportDataByCompanyForReportIds,
  deleteReportDataByReportId,
  deleteReportDataByReportIds
} = require("./services/reportDataService");


// Mongoose models (wilFl be required after connecting)
const User = require('./models/User');
const ChatSession = require('./models/ChatSession');
const Message = require('./models/Message');
const PortfolioItem = require('./models/PortfolioItem');
const Report = require('./models/Report');
const Subscriber = require('./models/Subscriber');
const UserPreference = require('./models/UserPreference');
const ReportDelivery = require('./models/ReportDelivery');
const SharedChat = require('./models/SharedChat');
const UsageLimit = require('./models/UsageLimit');
const axios = require("axios");
const multer = require("multer");
const { v4: uuidv4 } = require("uuid");
const cookieParser = require("cookie-parser");
const passport = require("passport");

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

// Separate MongoDB connection for Agentic AI notifications database
const AGENTIC_AI_MONGO_URI = "mongodb+srv://sagealphaai:Alpha123@alert-ai.akqhuxw.mongodb.net/";
let notificationsDb = null;
let notificationsDbConnected = false;

// Create separate connection for notifications database
const notificationsClient = new MongoClient(AGENTIC_AI_MONGO_URI);

notificationsClient.connect().then(() => {
  notificationsDbConnected = true;
  notificationsDb = notificationsClient.db('sagealpha');
  console.log('[DB] Connected to Agentic AI notifications database');
}).catch((e) => {
  console.error('[DB] Agentic AI notifications DB connect failed:', e && e.message);
  if (!IS_PRODUCTION) {
    console.warn('[DB] Continuing without notifications DB (dev mode)');
  }
});

// Environment Validation Logging
console.log(`[ENV] IS_PRODUCTION: ${IS_PRODUCTION}`);
console.log(`[ENV] PORT: ${PORT}`);
if (IS_PRODUCTION) {
  if (!process.env.MONGO_URL) console.warn('[ENV] MONGO_URL missing!');
  if (!process.env.RAG_API_KEY) console.warn('[ENV] RAG_API_KEY missing!');
  if (!process.env.RAG_API_URL) console.warn('[ENV] RAG_API_URL missing!');
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
    : ["http://localhost:5173", "http://localhost:3000","http://localhost:5174","http://localhost:5175","http://localhost:5175","https://sagealphaai.onrender.com"]; // Dev fallback

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
    "Access-Control-Request-Headers",
    "x-demo-id"
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
      res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept, Origin, Access-Control-Request-Method, Access-Control-Request-Headers, x-demo-id');
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

// Initialize Passport (for Google OAuth)
// Note: We don't use sessions for OAuth, but Passport requires session middleware
app.use(passport.initialize());
app.use(passport.session());

// Configure Google OAuth Strategy
const configureGoogleStrategy = require('./backend/auth/googleStrategy');
configureGoogleStrategy();

// Passport serialization (minimal - we use JWT, not sessions)
passport.serializeUser((user, done) => {
  done(null, user._id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findById(id);
    done(null, user);
  } catch (error) {
    done(error, null);
  }
});


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

/**
 * Safely resolve user ID from request
 * Returns user ID if authenticated, or "demo-user" for demo mode
 * @param {Object} req - Express request object
 * @returns {string|ObjectId} User ID or "demo-user" string
 */
function resolveUserId(req) {
  if (req.user) {
    return req.user._id || req.user.id;
  }
  return "demo-user";
}

/**
 * Check if request is from authenticated user
 * @param {Object} req - Express request object
 * @returns {boolean} True if authenticated, false if demo mode
 */
function isAuthenticated(req) {
  return !!req.user;
}

/**
 * Resolve user identity for usage tracking
 * Returns object with identifier and identifierType
 * @param {Object} req - Express request object
 * @returns {Object} { identifier: string, identifierType: 'user'|'demo' }
 */
function resolveUserIdentity(req) {
  // If authenticated, use userId
  if (req.user && req.user._id) {
    return {
      identifier: req.user._id.toString(),
      identifierType: 'user'
    };
  }
  
  // For demo users, try demoId header first, then fall back to IP
  const demoId = req.headers['x-demo-id'];
  if (demoId) {
    return {
      identifier: demoId,
      identifierType: 'demo'
    };
  }
  
  // Fall back to IP address
  // req.ip is set by express with trust proxy enabled
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  return {
    identifier: ip,
    identifierType: 'demo'
  };
}

/**
 * Middleware to check and enforce usage limits for AI tools
 * @param {string} aiType - Type of AI tool: 'chat', 'compliance', 'market', 'defender'
 * @param {number} maxUsage - Maximum allowed usage (default: 5)
 * @returns {Function} Express middleware
 */
function checkUsageLimit(aiType, maxUsage = 50) {
  return async (req, res, next) => {
    try {
      // Skip usage limit check if database is not connected
      if (!mongooseConnected) {
        console.warn(`[UsageLimit] Database not connected, skipping usage limit check for ${aiType}`);
        return next();
      }

      // Resolve user identity
      const { identifier, identifierType } = resolveUserIdentity(req);

      // Find or create usage record
      let usageRecord = await UsageLimit.findOne({
        identifier,
        identifierType,
        aiType
      });

      if (!usageRecord) {
        // Create new usage record
        usageRecord = await UsageLimit.create({
          identifier,
          identifierType,
          aiType,
          usageCount: 0,
          lastUsedAt: new Date()
        });
      }

      // Check if usage limit is reached
      if (usageRecord.usageCount >= maxUsage) {
        return res.status(403).json({
          success: false,
          code: "USAGE_LIMIT_REACHED",
          message: "You have reached the free usage limit. Upgrade to continue using SageAlpha services."
        });
      }

      // Increment usage count and update last used timestamp
      usageRecord.usageCount += 1;
      usageRecord.lastUsedAt = new Date();
      await usageRecord.save();

      // Attach usage info to request for potential logging/debugging
      req.usageInfo = {
        identifier,
        identifierType,
        aiType,
        currentUsage: usageRecord.usageCount,
        maxUsage
      };

      // Allow request to proceed
      next();
    } catch (error) {
      console.error(`[UsageLimit] Error checking usage limit for ${aiType}:`, error);
      // On error, allow request to proceed (fail open)
      // This prevents usage limit system from breaking the app
      next();
    }
  };
}

/**
 * GET /usage/status
 * Returns current usage counts for all AI tools
 * Works for both authenticated and demo users
 */
app.get("/usage/status", async (req, res) => {
  try {
    // Skip if database is not connected
    if (!mongooseConnected) {
      return res.json({
        chat: { usageCount: 0, maxUsage: 5 },
        compliance: { usageCount: 0, maxUsage: 5 },
        market: { usageCount: 0, maxUsage: 5 },
        defender: { usageCount: 0, maxUsage: 5 }
      });
    }

    // Resolve user identity
    const { identifier, identifierType } = resolveUserIdentity(req);

    // Fetch usage records for all AI types
    const usageRecords = await UsageLimit.find({
      identifier,
      identifierType
    });

    // Create a map for easy lookup
    const usageMap = {};
    usageRecords.forEach(record => {
      usageMap[record.aiType] = {
        usageCount: record.usageCount,
        maxUsage: 5,
        lastUsedAt: record.lastUsedAt
      };
    });

    // Return usage status for all AI tools (default to 0 if not found)
    return res.json({
      chat: usageMap.chat || { usageCount: 0, maxUsage: 5 },
      compliance: usageMap.compliance || { usageCount: 0, maxUsage: 5 },
      market: usageMap.market || { usageCount: 0, maxUsage: 5 },
      defender: usageMap.defender || { usageCount: 0, maxUsage: 5 }
    });
  } catch (error) {
    console.error("[UsageStatus] Error fetching usage status:", error);
    // Return default values on error
    return res.json({
      chat: { usageCount: 0, maxUsage: 5 },
      compliance: { usageCount: 0, maxUsage: 5 },
      market: { usageCount: 0, maxUsage: 5 },
      defender: { usageCount: 0, maxUsage: 5 }
    });
  }
});

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
    const { email, password, rememberMe } = req.body;

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

    // Check if user is a Google OAuth user (should not use password login)
    if (user.authProvider === 'google' || user.googleId) {
      return res.status(401).json({ 
        success: false, 
        message: "This account uses Google Sign-In. Please sign in with Google instead." 
      });
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

    // Generate JWT with conditional expiry based on "Remember Me"
    // If rememberMe is true: 7 days, otherwise: 1 hour
    const JWT_SECRET = process.env.JWT_SECRET;
    if (!JWT_SECRET && IS_PRODUCTION) {
      return res.status(500).json({ success: false, message: "Server configuration error" });
    }
    
    const expiresIn = rememberMe === true ? "7d" : "1h";
    const token = jwt.sign(
      { id: user._id },
      JWT_SECRET || "fallback_jwt_secret_DEV_ONLY",
      { expiresIn }
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
        avatar: user.avatar || null,
        authProvider: user.authProvider || 'local',
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

// ==========================================
// GOOGLE OAUTH ROUTES
// ==========================================

/**
 * GET /auth/google
 * Initiates Google OAuth flow
 * Redirects user to Google's consent screen
 */
app.get("/auth/google", (req, res, next) => {
  const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
  if (!GOOGLE_CLIENT_ID) {
    return res.status(503).json({ 
      success: false, 
      message: "Google OAuth is not configured" 
    });
  }
  
  // Use Passport to authenticate with Google
  passport.authenticate('google', {
    scope: ['profile', 'email']
  })(req, res, next);
});

/**
 * GET /auth/google/callback
 * Google OAuth callback handler
 * - Verifies Google response
 * - Finds or creates user
 * - Generates JWT token (7 days)
 * - Redirects to frontend with token
 */
app.get("/auth/google/callback", 
  passport.authenticate('google', { session: false, failureRedirect: '/login?error=google_auth_failed' }),
  async (req, res) => {
    try {
      if (!req.user) {
        return res.redirect('/login?error=google_auth_failed');
      }

      const user = req.user;

      // Generate JWT token (7 days expiry for OAuth users)
      const JWT_SECRET = process.env.JWT_SECRET;
      if (!JWT_SECRET && IS_PRODUCTION) {
        console.error('[GOOGLE OAUTH] JWT_SECRET not configured');
        return res.redirect('/login?error=server_config');
      }

      const token = jwt.sign(
        { id: user._id },
        JWT_SECRET || "fallback_jwt_secret_DEV_ONLY",
        { expiresIn: "7d" }
      );

      // Set session for backward compatibility (LLM routes)
      req.session.userId = user._id.toString();
      req.session.save();

      // Get frontend URL from environment or construct from request
      const FRONTEND_URL = process.env.FRONTEND_URL || 
                          process.env.CLIENT_URL || 
                          (IS_PRODUCTION ? 
                            (process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',')[0].trim() : null) :
                            'http://localhost:5173'
                          );

      if (!FRONTEND_URL) {
        console.error('[GOOGLE OAUTH] FRONTEND_URL not configured');
        return res.redirect('/login?error=server_config');
      }

      // Remove trailing slash
      const frontendUrl = FRONTEND_URL.replace(/\/$/, '');
      
      // Redirect to frontend with token
      const redirectUrl = `${frontendUrl}/oauth-success?token=${token}`;
      res.redirect(redirectUrl);
    } catch (error) {
      console.error('[GOOGLE OAUTH] Callback error:', error);
      res.redirect('/login?error=server_error');
    }
  }
);

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

// --- RAG Service Configuration ---
const RAG_API_URL = process.env.RAG_API_URL || "https://financial-rag-websearch-model-auhbdtdpgug6awht.centralindia-01.azurewebsites.net";
const RAG_API_KEY = process.env.RAG_API_KEY;

let ragMode = "none"; // rag, mock

function initRAG() {
  if (RAG_API_URL && RAG_API_KEY) {
    ragMode = "rag";
    console.log("[RAG] RAG service initialized.");
    console.log(`[RAG] API URL: ${RAG_API_URL}`);
  } else {
    ragMode = "mock";
    console.log("[RAG] Mock mode enabled (RAG_API_URL or RAG_API_KEY not set).");
  }
}
initRAG();

async function getEmbedding(text) {
  // Embeddings are now handled by the RAG service, so we return a dummy for local vector store compatibility
  // The RAG service handles its own embeddings internally
  return new Array(1536).fill(0).map(() => Math.random() * 0.1);
}

/**
 * Call RAG service for chat completion
 * @param {string} query - User query/message
 * @param {string} sessionId - Optional session ID for conversation context
 * @returns {Promise<string>} Response from RAG service
 */
async function ragChatCompletion(query, sessionId = null) {
  if (ragMode === "mock" || !RAG_API_KEY) {
    return `[MOCK RESPONSE] You asked: "${query}". SageAlpha Node backend is running! RAG service not configured.`;
  }

  try {
    const response = await axios.post(
      `${RAG_API_URL}/query`,
      {
        query: query,
        session_id: sessionId || undefined
      },
      {
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${RAG_API_KEY}`,
          "X-API-Key": RAG_API_KEY
        },
        timeout: 60000 // 60 seconds timeout
      }
    );

    // Handle different response formats
    if (response.data && typeof response.data === 'string') {
      return response.data;
    } else if (response.data && response.data.response) {
      return response.data.response;
    } else if (response.data && response.data.answer) {
      return response.data.answer;
    } else if (response.data && response.data.message) {
      return response.data.message;
    } else {
      console.warn("[RAG] Unexpected response format:", response.data);
      return JSON.stringify(response.data);
    }
  } catch (error) {
    console.error("[RAG] Chat completion error:", error.message);
    if (error.response) {
      console.error("[RAG] Response status:", error.response.status);
      console.error("[RAG] Response data:", error.response.data);
      throw new Error(`RAG service error: ${error.response.status} - ${error.response.data?.message || error.message}`);
    } else if (error.request) {
      throw new Error("No response from RAG service. Please try again later.");
    } else {
      throw new Error(`Failed to call RAG service: ${error.message}`);
    }
  }
}

/**
 * Call RAG service for report generation
 * @param {string} prompt - Report generation prompt
 * @param {string} sessionId - Optional session ID
 * @returns {Promise<string>} JSON response from RAG service
 */
async function ragReportGeneration(prompt, sessionId = null) {
  if (ragMode === "mock" || !RAG_API_KEY) {
    return JSON.stringify({
      companyName: "Mock Company",
      ticker: "MOCK",
      subtitle: "Mock Report",
      sector: "Technology",
      region: "Global",
      rating: "NEUTRAL",
      targetPrice: "100",
      targetPeriod: "12-18M",
      currentPrice: "100",
      upside: "+0%",
      marketCap: "INR1000",
      entValue: "INR1000",
      evEbitda: "10.0",
      pe: "10.0",
      investmentThesis: [{ title: "Mock", content: "Mock data" }],
      highlights: [{ title: "Mock", content: "Mock data" }],
      valuationMethodology: [{ method: "DCF", details: "Mock" }],
      catalysts: [{ title: "Mock", impact: "Mock" }],
      risks: [{ title: "Mock", impact: "Mock" }],
      financialSummary: [
        { year: "2024A", rev: "0", ebitda: "0", mrg: "0%", eps: "0", fcf: "0" },
        { year: "2025E", rev: "0", ebitda: "0", mrg: "0%", eps: "0", fcf: "0" },
        { year: "2026E", rev: "0", ebitda: "0", mrg: "0%", eps: "0", fcf: "0" }
      ],
      analyst: "SageAlpha Research Team",
      analystEmail: "research@sagealpha.ai",
      ratingHistory: [{ event: "Init", date: "Month Year @ $Price" }]
    });
  }

  try {
    const response = await axios.post(
      `${RAG_API_URL}/query`,
      {
        query: prompt,
        session_id: sessionId || undefined
      },
      {
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${RAG_API_KEY}`,
          "X-API-Key": RAG_API_KEY
        },
        timeout: 120000 // 120 seconds timeout for report generation
      }
    );

    // Handle different response formats
    let responseText = "";
    if (response.data && typeof response.data === 'string') {
      responseText = response.data;
    } else if (response.data && response.data.response) {
      responseText = response.data.response;
    } else if (response.data && response.data.answer) {
      responseText = response.data.answer;
    } else if (response.data && response.data.message) {
      responseText = response.data.message;
    } else {
      console.warn("[RAG] Unexpected response format:", response.data);
      responseText = JSON.stringify(response.data);
    }

    return responseText;
  } catch (error) {
    console.error("[RAG] Report generation error:", error.message);
    if (error.response) {
      console.error("[RAG] Response status:", error.response.status);
      console.error("[RAG] Response data:", error.response.data);
      throw new Error(`RAG service error: ${error.response.status} - ${error.response.data?.message || error.message}`);
    } else if (error.request) {
      throw new Error("No response from RAG service. Please try again later.");
    } else {
      throw new Error(`Failed to call RAG service: ${error.message}`);
    }
  }
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

  // Combine system prompt and user message for RAG service
  const fullPrompt = `${systemPrompt}\n\nUser Request: ${userMessage}`;

  let response = await ragReportGeneration(fullPrompt);

  // Clean up JSON if LLM added markdown blocks
  response = response.replace(/```json/g, "").replace(/```/g, "").trim();

  try {
    const reportData = JSON.parse(response);
    console.log("report data in index.js", reportData);
    const html = generateReportHtml(reportData, logoBase64);
    // Return both HTML and reportData for price extraction
    return { html, reportData };
  } catch (err) {
    console.error("[Report] JSON Parse Error. Falling back to simple HTML. Raw:", response);
    // Fallback to a very simple HTML if JSON fails
    return { 
      html: `<html><body><h1>Error generating structured report</h1><pre>${response}</pre></body></html>`,
      reportData: null 
    };
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

app.post("/chat", checkUsageLimit('chat'), async (req, res) => {
  try {
    const { message, session_id, top_k } = req.body;
    if (!message) return res.status(400).json({ error: "Empty message" });

    // Safely resolve user ID (returns "demo-user" if not authenticated)
    const userId = resolveUserId(req);
    const isAuth = isAuthenticated(req);

    let chatId = session_id;

    // 1. Session Management (skip DB operations for demo users)
    let dbSession = null;
    if (mongooseConnected && isAuth) {
      if (chatId) dbSession = await ChatSession.findOne({ id: chatId, user_id: userId });
      if (!dbSession) {
        chatId = chatId || uuidv4();
        await ChatSession.create({ id: chatId, user_id: userId, title: 'New Chat' });
      }
    } else if (!chatId) {
      // Generate session ID for demo users (not persisted)
      chatId = uuidv4();
    }

    // 2. Save User Message (skip for demo users)
    if (mongooseConnected && isAuth) {
      await Message.create({ user_id: userId, session_id: chatId, role: 'user', content: message });
    }

    // 3. Update Title (if new) (skip for demo users)
    if (mongooseConnected && isAuth) {
      const count = await Message.countDocuments({ session_id: chatId });
      if (count <= 2) {
        const newTitle = message.substring(0, 60);
        await ChatSession.updateOne({ id: chatId }, { $set: { title: newTitle, updated_at: new Date() } });
      }
    }

    // 4. RAG Service Call
    // The RAG service handles embeddings and context retrieval internally
    // We just pass the user message and session ID
    let aiResponse;
    let sources = [];
    
    try {
      // Call RAG service directly to get full response (including sources if available)
      const response = await axios.post(
        `${RAG_API_URL}/query`,
        {
          query: message,
          session_id: chatId || undefined
        },
        {
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${RAG_API_KEY}`,
            "X-API-Key": RAG_API_KEY
          },
          timeout: 60000
        }
      );

      // Extract response text
      if (response.data && typeof response.data === 'string') {
        aiResponse = response.data;
      } else if (response.data && response.data.response) {
        aiResponse = response.data.response;
      } else if (response.data && response.data.answer) {
        aiResponse = response.data.answer;
      } else if (response.data && response.data.message) {
        aiResponse = response.data.message;
      } else {
        aiResponse = JSON.stringify(response.data);
      }

      // Extract sources if available
      if (response.data && response.data.sources) {
        sources = response.data.sources;
      } else if (response.data && response.data.sources_list) {
        sources = response.data.sources_list;
      }
    } catch (error) {
      console.error("[RAG] Chat completion error:", error.message);
      if (ragMode === "mock" || !RAG_API_KEY) {
        aiResponse = `[MOCK RESPONSE] You asked: "${message}". SageAlpha Node backend is running! RAG service not configured.`;
      } else {
        throw error;
      }
    }

    // 7. Save Assistant Message (skip for demo users)
    if (mongooseConnected && isAuth) {
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
// 6.1 COMPLIANCE CHAT ROUTE
// ==========================================

app.post("/compliance/chat", checkUsageLimit('compliance'), async (req, res) => {
  try {
    const { query } = req.body;
    
    if (!query || typeof query !== 'string' || query.trim().length === 0) {
      return res.status(400).json({ error: "Query is required and must be a non-empty string" });
    }

    const complianceApiUrl = "https://compliance-rag-api.azurewebsites.net/query";
    
    console.log(`[Compliance Chat] Forwarding query to compliance API: ${complianceApiUrl}`);
    
    // Forward query to external compliance API
    const response = await axios.post(
      complianceApiUrl,
      { query: query.trim() },
      {
        headers: {
          "Content-Type": "application/json",
        },
        timeout: 30000, // 30 second timeout
      }
    );

    // Extract response - handle different possible field names
    // IMPORTANT: Do NOT modify, replace, or manipulate the response text in any way
    // Preserve all characters including dashes, underscores, asterisks, etc.
    let reply = null;
    let sources = null;
    
    if (response.data) {
      reply = response.data.answer || response.data.response || response.data.reply || response.data.text;
      sources = response.data.sources || response.data.references || null;
      
      // If still no reply, try to get the entire response as string
      if (!reply && typeof response.data === 'string') {
        reply = response.data;
      }
      
      // Last resort: stringify the entire response
      if (!reply) {
        console.warn("[Compliance Chat] Unexpected response format:", response.data);
        reply = JSON.stringify(response.data);
      }
    }

    if (!reply) {
      throw new Error("No response received from compliance API");
    }

    console.log(`[Compliance Chat] Successfully received response from compliance API`);
    
    // DEBUG: Log a sample of the reply to verify URLs are preserved
    if (reply && typeof reply === 'string' && reply.includes('sebi.gov.in')) {
      // Try to find URLs with the specific pattern mentioned (may-19-2025-_94058)
      const urlPattern = /https?:\/\/[^\s\)]+may-19-2025[^\s\)]+/g;
      const urlMatches = reply.match(urlPattern);
      if (urlMatches && urlMatches.length > 0) {
        console.log(`[Compliance Chat] Found ${urlMatches.length} URLs with may-19-2025 pattern:`);
        urlMatches.forEach((url, idx) => {
          console.log(`[Compliance Chat] URL ${idx + 1}:`, url);
          // Check specifically for the dash before underscore
          if (url.includes('2025_')) {
            console.warn(`[Compliance Chat] WARNING: URL missing dash before underscore!`);
            console.warn(`[Compliance Chat] Expected: ...2025-_94058, Got:`, url);
          }
        });
      }
      // Also log a general sample
      const generalUrlMatch = reply.match(/https?:\/\/[^\s\)]+/);
      if (generalUrlMatch) {
        console.log(`[Compliance Chat] General sample URL:`, generalUrlMatch[0]);
      }
    }
    
    // Return response exactly as received - no manipulation
    // Use res.json() which will properly stringify without modifying content
    const responseData = { reply: reply };
    if (sources) {
      responseData.sources = sources;
    }
    
    return res.json(responseData);

  } catch (error) {
    console.error("[Compliance Chat] Error:", error.message);
    
    // Handle axios errors specifically
    if (error.response) {
      // The request was made and the server responded with a status code outside 2xx
      console.error("[Compliance Chat] API responded with error:", error.response.status, error.response.data);
      return res.status(502).json({ 
        error: "Compliance service returned an error",
        reply: "Sorry, the compliance service is currently unavailable. Please try again later."
      });
    } else if (error.request) {
      // The request was made but no response was received
      console.error("[Compliance Chat] No response from compliance API");
      return res.status(503).json({ 
        error: "Compliance service is unreachable",
        reply: "Sorry, I couldn't reach the compliance service. Please check your connection and try again."
      });
    } else {
      // Something happened in setting up the request
      console.error("[Compliance Chat] Request setup error:", error.message);
      return res.status(500).json({ 
        error: "Internal server error",
        reply: "Sorry, an unexpected error occurred. Please try again later."
      });
    }
  }
});

/**
 * POST /defender/query
 * 
 * Proxy endpoint for Defender AI queries.
 * This endpoint forwards queries to the Defender AI service while keeping
 * the Defender AI URL and credentials secure on the backend.
 * 
 * Request body:
 * {
 *   "query": string (required, non-empty)
 * }
 * 
 * Returns Defender AI response as-is:
 * {
 *   "query": string,
 *   "answer": string (markdown),
 *   "method": string,
 *   "confidence": number (0-1),
 *   "sources": array,
 *   "flags": array,
 *   "disclaimer": string
 * }
 */
app.post("/defender/query", checkUsageLimit('defender'), async (req, res) => {
  try {
    const { query } = req.body;
    
    // Validate input
    if (!query || typeof query !== 'string' || query.trim().length === 0) {
      return res.status(400).json({ 
        error: "Query is required and must be a non-empty string" 
      });
    }

    // Get Defender AI endpoint from environment variable
    const defenderAiEndpoint = process.env.DEFENDER_AI_Endpoint || process.env.DEFENDER_AI_BASE_URL;
    
    if (!defenderAiEndpoint) {
      console.error("[Defender AI] DEFENDER_AI_Endpoint environment variable is not set");
      return res.status(500).json({ 
        error: "Defender AI service is not configured",
        answer: "Sorry, the Defender AI service is not available. Please contact support."
      });
    }

    // Ensure endpoint ends with /query
    const defenderAiUrl = defenderAiEndpoint.endsWith('/query') 
      ? defenderAiEndpoint 
      : `${defenderAiEndpoint.replace(/\/$/, '')}/query`;

    console.log(`[Defender AI] Forwarding query to Defender AI service`);
    
    // Forward query to Defender AI API (server-side only)
    const response = await axios.post(
      defenderAiUrl,
      { query: query.trim() },
      {
        headers: {
          "Content-Type": "application/json",
        },
        timeout: 30000, // 30 second timeout
      }
    );

    // Return Defender AI response as-is (no mutation)
    if (!response.data) {
      throw new Error("No response received from Defender AI");
    }

    console.log(`[Defender AI] Successfully received response from Defender AI`);
    
    // Return response exactly as received from Defender AI
    return res.json(response.data);

  } catch (error) {
    console.error("[Defender AI] Error:", error.message);
    
    // Handle axios errors specifically
    if (error.response) {
      // The request was made and the server responded with a status code outside 2xx
      console.error("[Defender AI] API responded with error:", error.response.status, error.response.data);
      return res.status(502).json({ 
        error: "Defender AI service returned an error",
        answer: "Sorry, the Defender AI service returned an error. Please try again later.",
        confidence: null,
        sources: [],
        flags: [],
        disclaimer: ""
      });
    } else if (error.request) {
      // The request was made but no response was received
      console.error("[Defender AI] No response from Defender AI API");
      return res.status(503).json({ 
        error: "Defender AI service is unreachable",
        answer: "Sorry, I couldn't reach the Defender AI service. Please check your connection and try again.",
        confidence: null,
        sources: [],
        flags: [],
        disclaimer: ""
      });
    } else if (error.code === 'ECONNABORTED') {
      // Timeout error
      console.error("[Defender AI] Request timeout");
      return res.status(504).json({ 
        error: "Request timeout",
        answer: "Sorry, the request timed out. Please try again with a shorter question.",
        confidence: null,
        sources: [],
        flags: [],
        disclaimer: ""
      });
    } else {
      // Something happened in setting up the request
      console.error("[Defender AI] Request setup error:", error.message);
      return res.status(500).json({ 
        error: "Internal server error",
        answer: "Sorry, an unexpected error occurred. Please try again later.",
        confidence: null,
        sources: [],
        flags: [],
        disclaimer: ""
      });
    }
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
    LLM_MODE: ragMode
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

/**
 * GET /portfolio/items/:id/price-analysis
 *
 * Returns price analysis metadata for a portfolio item.
 *
 * NOTE:
 * - Frontend expects: { lastApprovedDate, approvedCurrentPrice }
 * - We compute lastApprovedDate from the latest approved Report for this portfolio_item_id.
 * - approvedCurrentPrice is not currently persisted in DB; kept as null until market-price capture
 *   is implemented at approval time (future enhancement). Do NOT break existing flows.
 */
app.get("/portfolio/items/:id/price-analysis", loginRequired, async (req, res) => {
  try {
    if (!mongooseConnected) {
      return res.status(500).json({ error: "Database not connected" });
    }

    const userId = req.user._id;
    const portfolioItemId = req.params.id;

    // Ensure the portfolio item belongs to the user
    const item = await PortfolioItem.findOne({ _id: portfolioItemId, user_id: userId }).lean();
    if (!item) {
      return res.status(404).json({ error: "Portfolio item not found" });
    }

    // For single-item price analysis, use persisted reportData values from the latest approved report(s).
    const approvedReportIds = await Report.find({
      user_id: userId,
      portfolio_item_id: portfolioItemId,
      status: "approved",
    }).select("_id").lean();

    const reportIds = approvedReportIds.map(r => r._id);

    const normalizeCompanyKey = (name) =>
      (name || "").toString().trim().toLowerCase();

    const latestByCompanyRows = await getLatestReportDataByCompanyForReportIds(reportIds);
    const key = normalizeCompanyKey(item.company_name || item.symbol || "");
    const latest = latestByCompanyRows.find(r => normalizeCompanyKey(r.company_name) === key) || null;

    const lastApprovedDate = latest?.created_at || null;
    const approvedCurrentPrice = typeof latest?.current_price === "number" ? latest.current_price : null;
    const approvedTargetPrice = typeof latest?.target_price === "number" ? latest.target_price : null;

    return res.json({
      lastApprovedDate,
      approvedCurrentPrice,
      approvedTargetPrice
    });
  } catch (e) {
    console.error("[Price Analysis] Error:", e);
    return res.status(500).json({ error: "Failed to fetch price analysis" });
  }
});

/**
 * GET /portfolio/price-analysis
 *
 * Returns price analysis metadata for ALL portfolio items belonging to the user.
 * This is the universal endpoint for the Stock Price Analysis feature.
 *
 * Returns:
 * {
 *   items: [
 *     {
 *       companyName: string,
 *       lastApprovedDate: Date | null,
 *       approvedCurrentPrice: number | null,
 *       approvedTargetPrice: number | null
 *     },
 *     ...
 *   ]
 * }
 *
 * NOTE:
 * - We compute lastApprovedDate from the latest approved Report for each portfolio_item_id.
 * - approvedCurrentPrice and approvedTargetPrice are not currently persisted in DB;
 *   kept as null until market-price capture is implemented at approval time (future enhancement).
 *   Do NOT break existing approval/portfolio workflows.
 */
/**
 * Helper function to fetch current price from Yahoo Finance
 * Returns null if price cannot be fetched (does not throw)
 */
const fetchYahooPrice = async (symbol) => {
  if (!symbol || typeof symbol !== 'string' || symbol.trim() === '') {
    return null;
  }

  // Append .NS for NSE stocks
  const yahooSymbol = symbol.toUpperCase().trim() + '.NS';
  
  try {
    const yahooResponse = await axios.get(
      `https://query1.finance.yahoo.com/v8/finance/chart/${yahooSymbol}?interval=1d&range=1d`,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
          'Accept': 'application/json'
        },
        timeout: 10000
      }
    );

    const yahooData = yahooResponse.data;
    
    // Extract price from meta.regularMarketPrice
    if (yahooData?.chart?.result?.[0]?.meta?.regularMarketPrice) {
      const price = yahooData.chart.result[0].meta.regularMarketPrice;
      if (typeof price === 'number' && !isNaN(price) && price > 0) {
        console.log(`[Price Analysis] Fetched price for ${yahooSymbol}:`, price);
        return price;
      }
    }
    
    console.warn(`[Price Analysis] No price found for ${yahooSymbol}`);
    return null;
  } catch (error) {
    console.error(`[Price Analysis] Yahoo API error for ${yahooSymbol}:`, error.message);
    return null;
  }
};

app.get("/portfolio/price-analysis", loginRequired, async (req, res) => {
  try {
    if (!mongooseConnected) {
      return res.status(500).json({ error: "Database not connected" });
    }

    const userId = req.user._id;

    // Get ONLY approved portfolio items for the user
    // This ensures Performance Dashboard only shows finalized items
    const portfolioItems = await PortfolioItem.find({ 
      user_id: userId, 
      approved: true 
    }).sort({ approved_at: -1 }).lean();
    
    console.log(`[Price Analysis] Found ${portfolioItems.length} approved portfolio items`);

    // We only want to use *persisted* data from reportData for the "Last Approved" column.
    // To keep scope tight and avoid re-parsing, we:
    // 1) find user's approved reports
    // 2) fetch latest reportData per company_name for those report_ids
    const approvedReportIds = await Report.find({
      user_id: userId,
      status: "approved",
    }).select("_id").lean();

    const reportIds = approvedReportIds.map(r => r._id);

    const normalizeCompanyKey = (name) =>
      (name || "").toString().trim().toLowerCase();

    const latestByCompanyRows = await getLatestReportDataByCompanyForReportIds(reportIds);
    const latestByCompany = {};
    for (const row of latestByCompanyRows) {
      const key = normalizeCompanyKey(row.company_name);
      if (key && !latestByCompany[key]) {
        latestByCompany[key] = row;
      }
    }

    // Build base items array - use approved_at from portfolio item as Approved Date
    const baseItems = portfolioItems
      .map((item) => {
        const companyKey = normalizeCompanyKey(item.company_name || item.symbol || "");
        const latest = latestByCompany[companyKey];
      return {
        companyName: item.company_name || item.symbol || "Unknown",
          symbol: item.symbol || null,
          approvedDate: item.approved_at || null, // Use portfolio item's approved_at
          recommendedPrice: typeof latest?.current_price === "number" ? latest.current_price : null,
          targetPrice: typeof latest?.target_price === "number" ? latest.target_price : null,
          _hasReportData: !!latest
      };
      })
      .filter((x) => x._hasReportData)
      .map(({ _hasReportData, ...rest }) => rest);

    // Fetch current prices from Yahoo Finance for each item (one by one)
    console.log(`[Price Analysis] Fetching current prices for ${baseItems.length} items`);
    const itemsWithPrices = await Promise.all(
      baseItems.map(async (item) => {
        let currentPrice = null;
        
        // Only fetch if we have a symbol
        if (item.symbol) {
          currentPrice = await fetchYahooPrice(item.symbol);
        } else {
          console.warn(`[Price Analysis] No symbol for ${item.companyName}, skipping price fetch`);
        }

        return {
          companyName: item.companyName,
          symbol: item.symbol,
          approvedDate: item.approvedDate, // Already set from portfolio item's approved_at
          recommendedPrice: item.recommendedPrice,
          targetPrice: item.targetPrice,
          currentPrice: currentPrice
        };
      })
    );

    console.log(`[Price Analysis] Returning ${itemsWithPrices.length} items with prices`);
    return res.json({ items: itemsWithPrices });
  } catch (e) {
    console.error("[Price Analysis] Error:", e);
    return res.status(500).json({ error: "Failed to fetch price analysis" });
  }
});

// ==========================================
// NOTIFICATIONS API ROUTES
// ==========================================

/**
 * GET /api/notifications
 * Fetch notifications for the logged-in user from Agentic AI database
 * 
 * SECURITY: Symbol-based filtering prevents cross-user data leakage
 * 
 * Why symbol-scoped?
 * - Notifications are GLOBAL events written by Alert AI Agent
 * - notification.user_id is NOT reliable (not set by AI agent)
 * - Users should ONLY see notifications for symbols in their portfolio
 * 
 * Why symbol is the join key?
 * - symbol is the SINGLE SOURCE OF TRUTH (uppercase, NSE-compatible)
 * - Both notifications and portfolio_items use symbol field
 * - This ensures consistent matching across collections
 * 
 * Filtering Logic:
 * 1. Fetch user's portfolio symbols (portfolio_items.symbol WHERE user_id = current user)
 * 2. Filter notifications WHERE notification.symbol IN portfolioSymbols
 * 3. MongoDB $in query ensures efficient filtering at database level
 * 
 * Indexes Required:
 * - portfolio_items.user_id (for user lookup)
 * - portfolio_items.symbol (for symbol extraction)
 * - notifications.symbol (for $in query performance)
 * - notifications.created_at (for sorting)
 * 
 * Returns notifications sorted by created_at descending with unread count
 */
app.get("/api/notifications", loginRequired, async (req, res) => {
  try {
    if (!notificationsDbConnected || !notificationsDb) {
      return res.status(503).json({ 
        error: "Notifications service unavailable",
        notifications: [],
        unread_count: 0
      });
    }

    if (!mongooseConnected) {
      return res.status(503).json({ 
        error: "Database service unavailable",
        notifications: [],
        unread_count: 0
      });
    }

    const userId = req.user._id ? req.user._id.toString() : req.user.id;

    // Step 1: Fetch user's portfolio symbols
    // This query uses index on portfolio_items.user_id for performance
    const portfolioItems = await PortfolioItem.find({ user_id: userId })
      .select('symbol')
      .lean();

    // Extract unique symbols (uppercase, NSE-compatible)
    // Symbol is already uppercase in schema, but ensure consistency
    const portfolioSymbols = [...new Set(
      portfolioItems
        .map(item => item.symbol?.toUpperCase())
        .filter(symbol => symbol) // Remove null/undefined
    )];

    // If user has no portfolio items, return empty notifications
    // This prevents users from seeing notifications for symbols they don't own
    if (portfolioSymbols.length === 0) {
      return res.json({
        notifications: [],
        unread_count: 0
      });
    }

    // Step 2: Fetch notifications filtered by portfolio symbols
    // MongoDB $in query filters at database level (efficient)
    // Uses index on notifications.symbol for optimal performance
    // Sort by created_at descending (newest first)
    const notifications = await notificationsDb
      .collection('notifications')
      .find({
        symbol: { $in: portfolioSymbols }
      })
      .sort({ created_at: -1 })
      .toArray();

    // Calculate unread count from filtered results
    const unreadCount = notifications.filter(n => !n.is_read).length;

    // Format notifications for response
    const formattedNotifications = notifications.map(notif => ({
      _id: notif._id.toString(),
      event_id: notif.event_id || null,
      company_code: notif.company_code || null,
      symbol: notif.symbol || null,
      title: notif.title || 'Notification',
      message: notif.message || '',
      is_read: notif.is_read || false,
      created_at: notif.created_at || new Date()
    }));

    return res.json({
      notifications: formattedNotifications,
      unread_count: unreadCount
    });

  } catch (error) {
    console.error("[Notifications] Fetch error:", error);
    return res.status(500).json({ 
      error: "Failed to fetch notifications",
      notifications: [],
      unread_count: 0
    });
  }
});

/**
 * PATCH /api/notifications/:id/read
 * Mark a notification as read
 * 
 * SECURITY: Validates user owns the symbol before allowing read
 * 
 * Why validate symbol ownership?
 * - Prevents users from marking notifications as read for symbols they don't own
 * - Ensures users can only interact with notifications they have access to
 * - Maintains data integrity and prevents cross-user data manipulation
 * 
 * Validation Logic:
 * 1. Find notification by ID
 * 2. Verify user has the notification's symbol in their portfolio
 * 3. Only then allow marking as read
 */
app.patch("/api/notifications/:id/read", loginRequired, async (req, res) => {
  try {
    if (!notificationsDbConnected || !notificationsDb) {
      return res.status(503).json({ 
        error: "Notifications service unavailable"
      });
    }

    if (!mongooseConnected) {
      return res.status(503).json({ 
        error: "Database service unavailable"
      });
    }

    const notificationId = req.params.id;
    const userId = req.user._id ? req.user._id.toString() : req.user.id;

    // Validate ObjectId format
    if (!ObjectId.isValid(notificationId)) {
      return res.status(400).json({ error: "Invalid notification ID" });
    }

    // Find notification to ensure it exists
    const notification = await notificationsDb
      .collection('notifications')
      .findOne({ _id: new ObjectId(notificationId) });

    if (!notification) {
      return res.status(404).json({ error: "Notification not found" });
    }

    // SECURITY: Validate user owns the symbol in their portfolio
    // This prevents users from marking notifications as read for symbols they don't own
    if (notification.symbol) {
      const userOwnsSymbol = await PortfolioItem.exists({
        user_id: userId,
        symbol: notification.symbol.toUpperCase()
      });

      if (!userOwnsSymbol) {
        return res.status(403).json({ 
          error: "You do not have access to this notification" 
        });
      }
    }

    // Update notification to mark as read
    const result = await notificationsDb
      .collection('notifications')
      .updateOne(
        { _id: new ObjectId(notificationId) },
        { $set: { is_read: true } }
      );

    if (result.matchedCount === 0) {
      return res.status(404).json({ error: "Notification not found" });
    }

    return res.json({ 
      success: true, 
      message: "Notification marked as read" 
    });

  } catch (error) {
    console.error("[Notifications] Mark read error:", error);
    return res.status(500).json({ 
      error: "Failed to mark notification as read"
    });
  }
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
  // Accepts either company_name or symbol from the client.
  // We ALWAYS resolve to a canonical NSE symbol before writing.
  const { company_name: rawCompanyName, ticker, symbol: rawSymbol } = req.body;
  const userId = req.user._id ? req.user._id : req.user.id;

  const userInput = rawSymbol || ticker || rawCompanyName;
  if (!userInput) {
    return res
      .status(400)
      .json({ error: "company_name or symbol is required" });
  }

  // Resolve NSE symbol + official company name.
  // This makes `symbol` the single source of truth for downstream agents.
  const resolved = resolveNseSymbol(userInput);
  if (!resolved) {
    return res.status(400).json({
      error:
        "Unable to resolve NSE symbol for the provided company/symbol. Please use a valid NSE-listed stock.",
    });
  }

  const { symbol, company_name } = resolved;

  const today = new Date().toISOString().split("T")[0];
  const now = new Date();

  if (mongooseConnected) {
    // Use (user_id, symbol, item_date) as logical uniqueness for the day.
    let item = await PortfolioItem.findOne({
      user_id: userId,
      symbol,
      item_date: { $gte: new Date(today) },
    });
    let itemId;
    if (item) {
      itemId = item._id;
      await PortfolioItem.updateOne(
        { _id: itemId },
        {
          $set: {
            company_name,
            updated_at: now,
          },
        }
      );
    } else {
      const created = await PortfolioItem.create({
        user_id: userId,
        company_name,
        symbol,
        source_type: "chat",
        item_date: new Date(today),
        approved: false, // New items are not approved by default
        approved_at: null, // Set when item is approved
      });
      itemId = created._id;

      await Report.create({
        portfolio_item_id: itemId,
        user_id: userId,
        title: `Equity Research Note – ${company_name}`,
        status: "pending",
        report_date: new Date(today),
        created_at: now,
      });
    }

    return res.json({ success: true, item_id: itemId });
  }

  // Fallback SQLite behavior (legacy) - keep ticker column for backward compatibility.
  const exist = db
    .prepare(
      "SELECT id FROM portfolio_items WHERE user_id=? AND company_name=? AND item_date=?"
    )
    .get(userId, company_name, today);

  let itemId;
  if (exist) {
    itemId = exist.id;
    db.prepare("UPDATE portfolio_items SET updated_at=? WHERE id=?").run(
      now,
      itemId
    );
  } else {
    const info = db
      .prepare(
        `
            INSERT INTO portfolio_items (user_id, company_name, ticker, item_date, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
        `
      )
      .run(userId, company_name, symbol, today, now, now);
    itemId = info.lastInsertRowid;

    // Auto report
    db.prepare(
      `
            INSERT INTO reports (portfolio_item_id, user_id, title, status, report_date, created_at)
            VALUES (?, ?, ?, 'pending', ?, ?)
        `
    ).run(
      itemId,
      userId,
      `Equity Research Note – ${company_name}`,
      today,
      now
    );
  }

  res.json({ success: true, item_id: itemId });
});

// Update portfolio item for a given id.
// This route also enforces symbol normalization for consistency.
app.put("/portfolio/:id", loginRequired, async (req, res) => {
  const { id } = req.params;
  const { company_name: rawCompanyName, ticker, symbol: rawSymbol } = req.body;
  const userId = req.user._id ? req.user._id : req.user.id;

  const userInput = rawSymbol || ticker || rawCompanyName;
  if (!userInput) {
    return res
      .status(400)
      .json({ error: "company_name or symbol is required" });
  }

  const resolved = resolveNseSymbol(userInput);
  if (!resolved) {
    return res.status(400).json({
      error:
        "Unable to resolve NSE symbol for the provided company/symbol. Please use a valid NSE-listed stock.",
    });
  }

  const { symbol, company_name } = resolved;
  const now = new Date();

  if (mongooseConnected) {
    const filter = { _id: id, user_id: userId };
    const update = {
      company_name,
      symbol,
      updated_at: now,
    };

    const result = await PortfolioItem.findOneAndUpdate(filter, update, {
      new: true,
    });

    if (!result) {
      return res.status(404).json({ error: "Portfolio item not found" });
    }

    return res.json({ success: true, item: result });
  }

  // SQLite fallback update
  const info = db
    .prepare(
      "UPDATE portfolio_items SET company_name = ?, ticker = ?, updated_at = ? WHERE id = ? AND user_id = ?"
    )
    .run(company_name, symbol, now, id, userId);

  if (info.changes === 0) {
    return res.status(404).json({ error: "Portfolio item not found" });
  }

  return res.json({ success: true });
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

      const phoneValue = mobile?.trim() || "";
      await Subscriber.create({
        user_id: userId,
        name: name.trim(),
        mobile: phoneValue,
        phone: phoneValue, // Sync phone field
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
      const phoneValue = mobile?.trim() || "";
      await Subscriber.updateOne(
        { _id: id, user_id: userId },
        {
          name: name.trim(),
          mobile: phoneValue,
          phone: phoneValue, // Sync phone field
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
    id: req.user._id || req.user.id,
    _id: req.user._id || req.user.id,
    username: req.user.username,
    email: req.user.email,
    display_name: req.user.display_name,
    avatar: req.user.avatar || null,
    avatar_url: req.user.avatar || null,
    authProvider: req.user.authProvider || 'local'
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
      const reportIds = reports.map(r => r._id);

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

      // Delete associated reportData (best-effort)
      try {
        await deleteReportDataByReportIds(reportIds);
      } catch (e) {
        console.warn("[ReportData] Failed to delete reportData in bulk:", e?.message || e);
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

// Share Chat - Create share link
app.post("/api/chat/:chatId/share", loginRequired, async (req, res) => {
  const userId = req.user._id ? req.user._id : req.user.id;
  const { chatId } = req.params;

  if (!mongooseConnected) {
    return res.status(500).json({ error: "Database not connected" });
  }

  try {
    // Fetch chat session
    const session = await ChatSession.findOne({ id: chatId, user_id: userId });
    if (!session) {
      return res.status(404).json({ error: "Chat not found" });
    }

    // Fetch all messages for this chat
    const messages = await Message.find({ session_id: chatId })
      .sort({ _id: 1 })
      .lean();

    if (!messages || messages.length === 0) {
      return res.status(400).json({ error: "Chat has no messages to share" });
    }

    // Create snapshot of messages
    const messageSnapshot = messages.map(msg => ({
      role: msg.role,
      content: msg.content,
      createdAt: msg.timestamp || msg.createdAt || new Date()
    }));

    // Generate unique shareId
    const shareId = uuidv4();

    // Create SharedChat document
    const sharedChat = await SharedChat.create({
      shareId,
      originalChatId: chatId,
      messages: messageSnapshot,
      model: 'gpt-4', // Default model, can be enhanced later
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days
    });

    // Generate share URL
    const frontendUrl = process.env.FRONTEND_URL || process.env.CLIENT_URL || `${req.protocol}://${req.get('host')}`;
    const shareUrl = `${frontendUrl}/share/${shareId}`;

    return res.json({
      success: true,
      shareUrl: shareUrl
    });
  } catch (error) {
    console.error("Error creating share link:", error);
    return res.status(500).json({ error: "Failed to create share link" });
  }
});

// Get Shared Chat - Public, read-only endpoint
app.get("/api/share/:shareId", async (req, res) => {
  const { shareId } = req.params;

  if (!mongooseConnected) {
    return res.status(500).json({ error: "Database not connected" });
  }

  try {
    // Find shared chat
    const sharedChat = await SharedChat.findOne({ shareId }).lean();

    if (!sharedChat) {
      return res.status(404).json({ error: "Shared chat not found" });
    }

    // Check if expired
    if (sharedChat.expiresAt && new Date(sharedChat.expiresAt) < new Date()) {
      return res.status(410).json({ error: "This shared chat has expired" });
    }

    // Return chat data (read-only)
    return res.json({
      messages: sharedChat.messages || [],
      model: sharedChat.model || 'gpt-4',
      createdAt: sharedChat.createdAt
    });
  } catch (error) {
    console.error("Error fetching shared chat:", error);
    return res.status(500).json({ error: "Failed to fetch shared chat" });
  }
});

app.post("/chat/create-report", async (req, res) => {
  let { company_name, session_id } = req.body;
  
  // Safely resolve user ID (returns "demo-user" if not authenticated)
  const userId = resolveUserId(req);
  const isAuth = isAuthenticated(req);

  if (!company_name) return res.status(400).json({ error: "Company name is required" });

  try {
    console.log(`[Report] Generating for: ${company_name}`);

    // Context retrieval is now handled by the RAG service
    // We pass the company name and let the RAG service retrieve relevant context from ChromaDB
    const contextText = ""; // RAG service handles context internally

    const reportResult = await generateEquityResearchHTML(
      company_name,
      `Generate research report for ${company_name}`,
      contextText
    );
    const reportHtml = reportResult.html || reportResult; // Handle both old and new return format
    const reportData = reportResult.reportData || null;

    const safeCompanyName = company_name.replace(/ /g, "_").replace(/[^\w]/g, "").toLowerCase();
    const reportId = `${safeCompanyName}_${Date.now()}`;

    // Extract price data from reportData if available
    let currentPrice = null;
    let targetPrice = null;
    if (reportData) {
      // Extract numeric value from price strings like "INR 1,050", "INR875", "1,050", etc.
      const extractPrice = (priceStr) => {
        if (!priceStr) return null;
        // Handle both string and number types
        if (typeof priceStr === 'number') return priceStr;
        if (typeof priceStr !== 'string') return null;
        
        // Remove currency symbols (INR, $, ₹), commas, spaces, and any non-numeric characters except decimal point
        const numericStr = priceStr.replace(/[INR$₹,\s]/gi, '').replace(/[^\d.]/g, '').trim();
        if (!numericStr) return null;
        
        const num = parseFloat(numericStr);
        return isNaN(num) ? null : num;
      };
      currentPrice = extractPrice(reportData.currentPrice);
      targetPrice = extractPrice(reportData.targetPrice);
      
      console.log(`[Report] Extracted prices - Current: ${currentPrice}, Target: ${targetPrice}`);
    }

    // Upload HTML to Azure Blob Storage
    const blobFileName = await uploadHtmlToBlob(reportId, reportHtml);
    console.log(`[Report] HTML uploaded to blob: ${blobFileName}`);

    // Generate download URL using helper function
    const baseUrl = getBaseUrl(req);
    const downloadUrl = `${baseUrl}/reports/download/${reportId}`;
    const aiMessage = `✅ Your research report for **${company_name}** is ready!\n\n📄 [Download Report as PDF](${downloadUrl})`;

    // Save report to database for portfolio (skip for demo users)
    let savedReport = null;
    if (mongooseConnected && isAuth) {
      // Create or update PortfolioItem for this company.
      // We try to resolve an NSE symbol here, but if resolution fails, we use
      // the company_name (uppercase) as a fallback symbol to ensure PortfolioItem is always created.
      const today = new Date().toISOString().split('T')[0];
      const now = new Date();

      let portfolioItemId = null;
      const resolved = resolveNseSymbol(company_name);

      // Use resolved symbol/name if available, otherwise fallback to company_name
      let symbol, resolvedCompanyName;
      if (resolved) {
        symbol = resolved.symbol;
        resolvedCompanyName = resolved.company_name;
      } else {
        // Fallback: use company_name as symbol (uppercase) when resolution fails
        console.warn("[Portfolio] Unable to resolve NSE symbol for company:", company_name, "- using company_name as fallback symbol");
        symbol = company_name.trim().toUpperCase();
        resolvedCompanyName = company_name.trim();
      }

      // Find or create PortfolioItem
      let portfolioItem = await PortfolioItem.findOne({ 
        user_id: userId, 
        symbol,
        item_date: { $gte: new Date(today) }
      });

      if (portfolioItem) {
        // Update existing portfolio item
        portfolioItemId = portfolioItem._id;
        await PortfolioItem.updateOne(
          { _id: portfolioItemId },
          { $set: { company_name: resolvedCompanyName, updated_at: now } }
        );
      } else {
        // Create new portfolio item (always create, even if symbol resolution failed)
        const createdPortfolioItem = await PortfolioItem.create({
          user_id: userId,
          company_name: resolvedCompanyName,
          symbol,
          source_type: 'chat',
          item_date: new Date(today)
        });
        portfolioItemId = createdPortfolioItem._id;
      }

      // Save report to Report model and link to PortfolioItem
      savedReport = await Report.create({
        portfolio_item_id: portfolioItemId,
        user_id: userId,
        title: `Equity Research Note – ${company_name}`,
        status: 'pending',
        report_path: blobFileName, // Store blob filename (e.g., "reportId.html")
        report_data: reportId, // Store report ID for reference (used to generate download URL)
        report_type: 'equity_research',
        report_date: new Date(),
        created_at: new Date(),
        // Store price data extracted from report
        current_price: currentPrice,
        target_price: targetPrice
      });

      // Save structured report data to reportData collection
      // This extracts and stores all numeric values for later reuse (e.g., price analysis)
      if (reportData && savedReport && savedReport._id) {
        await saveReportDataFromLLM(savedReport._id, reportData, company_name);
      }

      // Save chat history
      if (!session_id) {
        session_id = uuidv4();
        await ChatSession.create({ id: session_id, user_id: userId, title: `Report: ${company_name}` });
      }

      await Message.create({ user_id: userId, session_id, role: 'user', content: `Generate report for ${company_name}` });
      await Message.create({ user_id: userId, session_id, role: 'assistant', content: aiMessage });
    } else if (!session_id) {
      // Generate session ID for demo users (not persisted)
      session_id = uuidv4();
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

    // Capture prices at approval time (use current_price/target_price if available, otherwise keep existing approved prices)
    const updateData = {
      status: 'approved',
      approved_at: new Date()
    };

    // If report has current_price/target_price, copy them to approved_current_price/approved_target_price
    if (report.current_price !== null && report.current_price !== undefined) {
      updateData.approved_current_price = report.current_price;
    }
    if (report.target_price !== null && report.target_price !== undefined) {
      updateData.approved_target_price = report.target_price;
    }

    await Report.updateOne(
      { _id: reportId },
      { $set: updateData }
    );

    // Also approve the associated portfolio item
    if (report.portfolio_item_id) {
      await PortfolioItem.updateOne(
        { _id: report.portfolio_item_id, user_id: userId },
        {
          $set: {
            approved: true,
            approved_at: new Date()
          }
        }
      );
      console.log(`[Report] Approved portfolio item ${report.portfolio_item_id} along with report ${reportId}`);
    }

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

    // Delete associated reportData (best-effort)
    try {
      await deleteReportDataByReportId(reportId);
    } catch (e) {
      console.warn("[ReportData] Failed to delete reportData:", e?.message || e);
    }

    await Report.deleteOne({ _id: reportId });

    return res.json({ success: true, message: "Report deleted successfully" });
  } catch (e) {
    console.error("[Report] Delete error:", e);
    res.status(500).json({ error: "Failed to delete report" });
  }
});

// Get report data by report_id (for Price Analysis feature)
app.get("/reports/:id/data", loginRequired, async (req, res) => {
  const reportId = req.params.id;
  const userId = req.user._id;

  try {
    if (!mongooseConnected) {
      return res.status(500).json({ error: "Database not connected" });
    }

    // Verify report belongs to user
    const report = await Report.findOne({ _id: reportId, user_id: userId });
    if (!report) {
      return res.status(404).json({ error: "Report not found" });
    }

    // Fetch report data
    const reportData = await getReportDataByReportId(reportId);
    if (!reportData) {
      return res.status(404).json({ error: "Report data not found" });
    }

    return res.json({ success: true, data: reportData });
  } catch (e) {
    console.error("[ReportData] Get error:", e);
    res.status(500).json({ error: "Failed to fetch report data" });
  }
});

// Get price data by report_id (convenience endpoint for Price Analysis)
app.get("/reports/:id/prices", loginRequired, async (req, res) => {
  const reportId = req.params.id;
  const userId = req.user._id;

  try {
    if (!mongooseConnected) {
      return res.status(500).json({ error: "Database not connected" });
    }

    // Verify report belongs to user
    const report = await Report.findOne({ _id: reportId, user_id: userId });
    if (!report) {
      return res.status(404).json({ error: "Report not found" });
    }

    // Fetch price data
    const priceData = await getPriceDataByReportId(reportId);
    if (!priceData) {
      return res.status(404).json({ error: "Price data not found" });
    }

    return res.json({ success: true, data: priceData });
  } catch (e) {
    console.error("[ReportData] Get price error:", e);
    res.status(500).json({ error: "Failed to fetch price data" });
  }
});

// Get report data by company_name
app.get("/reports/company/:companyName/data", loginRequired, async (req, res) => {
  const companyName = decodeURIComponent(req.params.companyName);
  const limit = parseInt(req.query.limit) || 10;

  try {
    if (!mongooseConnected) {
      return res.status(500).json({ error: "Database not connected" });
    }

    // Fetch report data list
    const reportDataList = await getReportDataByCompanyName(companyName, limit);

    return res.json({ success: true, data: reportDataList, count: reportDataList.length });
  } catch (e) {
    console.error("[ReportData] Get by company error:", e);
    res.status(500).json({ error: "Failed to fetch report data" });
  }
});

// Get price data by company_name (returns most recent)
app.get("/reports/company/:companyName/prices", loginRequired, async (req, res) => {
  const companyName = decodeURIComponent(req.params.companyName);

  try {
    if (!mongooseConnected) {
      return res.status(500).json({ error: "Database not connected" });
    }

    // Fetch most recent price data
    const priceData = await getPriceDataByCompanyName(companyName);
    if (!priceData) {
      return res.status(404).json({ error: "Price data not found for this company" });
    }

    return res.json({ success: true, data: priceData });
  } catch (e) {
    console.error("[ReportData] Get price by company error:", e);
    res.status(500).json({ error: "Failed to fetch price data" });
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

// Send report via email endpoint (for demo/ad traffic)
app.post("/report/send-email", async (req, res) => {
  try {
    const { email, reportId } = req.body;

    // Validate input
    if (!email || !reportId) {
      return res.status(400).json({
        success: false,
        error: "Email and report ID are required"
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        error: "Invalid email format"
      });
    }

    // Sanitize report ID
    const safeReportId = reportId.replace(/[^\w\-_]/g, "_");

    console.log(`[SendEmail] Request to send report ${safeReportId} to ${email}`);

    // Check if email service is configured
    if (!isEmailConfigured) {
      console.error("[SendEmail] Email service not configured");
      return res.status(500).json({
        success: false,
        error: "Email service is not configured"
      });
    }

    // Get HTML content from Azure Blob Storage
    const htmlContent = await getHtmlFromBlob(safeReportId);

    if (!htmlContent) {
      console.error(`[SendEmail] HTML blob not found for report ID: ${safeReportId}`);
      return res.status(404).json({
        success: false,
        error: "Report not found"
      });
    }

    // Validate HTML size (reject > 1.5MB)
    const sizeValidation = validateHtmlSize(htmlContent);
    if (!sizeValidation.valid) {
      console.error(`[SendEmail] HTML size validation failed: ${sizeValidation.error}`);
      return res.status(400).json({
        success: false,
        error: "HTML content too large for PDF generation",
        message: sizeValidation.error
      });
    }

    // Log HTML size
    console.log(`[SendEmail] HTML content size: ${sizeValidation.sizeBytes} bytes (${(sizeValidation.sizeBytes / 1024).toFixed(2)} KB)`);

    // Convert HTML to PDF (reuse existing logic)
    console.log(`[SendEmail] Converting HTML to PDF`);
    const pdfBuffer = await convertHtmlToPdf(htmlContent);

    console.log(`[SendEmail] PDF generated successfully (${pdfBuffer.length} bytes)`);

    // Prepare email content
    const emailSubject = "Your SageAlpha Equity Research Report";
    const emailHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 600px;
      margin: 0 auto;
      padding: 20px;
      background-color: #ffffff;
    }
    .header {
      text-align: center;
      padding: 20px 0;
      border-bottom: 2px solid #0066cc;
    }
    .content {
      padding: 24px 0;
      font-size: 15px;
    }
   
    .footer {
      margin-top: 30px;
      padding-top: 20px;
      border-top: 1px solid #eee;
      font-size: 12px;
      color: #666;
      text-align: center;
    }
  </style>
</head>

<body>
  <div class="header">
    <h1 style="color: #0066cc; margin: 0;">SageAlpha Research</h1>
    <p style="margin: 6px 0 0; font-size: 13px; color: #666;">
      Institutional-style Equity Research
    </p>
  </div>

  <div class="content">
    <p>Hello,</p>

    <p>
      Thank you for requesting an equity research report from <strong>SageAlpha</strong>.
      We're pleased to share the detailed report you asked for.
    </p>

    <div>
      <p style="margin: 0;">
        Your equity research report is attached to this email as a PDF.
      </p>
    </div>

    <p>
      This report has been prepared to help you better understand the company's
      business fundamentals, growth outlook, and key risks.
    </p>

    <p>
      If you have any questions after reviewing the report or would like
      insights on other companies or sectors, feel free to reach out — we're happy to help.
    </p>

    <p style="margin-top: 28px;">
      Warm regards,<br>
      <strong>The SageAlpha Research Team</strong>
    </p>
  </div>

  <div class="footer">
    <p>
      SageAlpha.ai provides research and analysis for informational purposes only.
      This content should not be considered financial advice.
    </p>
    <p style="margin-top: 10px; font-size: 11px; color: #999;">
      This is an automated email. Please do not reply directly to this message.
    </p>
  </div>
</body>
</html>
`;

    // Send email with PDF attachment
    await sendEmail({
      to: email,
      subject: emailSubject,
      html: emailHtml,
      attachments: [
        {
          filename: `SageAlpha_${safeReportId}.pdf`,
          content: pdfBuffer
        }
      ]
    });

    console.log(`[SendEmail] Report sent successfully to ${email}`);

    return res.json({
      success: true,
      message: "Report sent successfully"
    });

  } catch (err) {
    console.error("[SendEmail] Endpoint Error:", err.message);
    console.error("[SendEmail] Error stack:", err.stack);
    return res.status(500).json({
      success: false,
      error: "Failed to send report",
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

// Send report via WhatsApp
app.post("/api/whatsapp/send-report", loginRequired, async (req, res) => {
  const { subscriberId, phone, reportId } = req.body;
  const userId = req.user._id ? req.user._id : req.user.id;

  try {
    // Validate input
    if (!subscriberId || !phone || !reportId) {
      return res.status(400).json({ 
        error: "subscriberId, phone, and reportId are required" 
      });
    }

    // Verify subscriber exists and belongs to user
    let subscriber = null;
    if (mongooseConnected) {
      subscriber = await Subscriber.findOne({
        _id: subscriberId,
        user_id: userId,
        is_active: true
      });
    } else {
      subscriber = db.prepare(
        "SELECT * FROM subscribers WHERE _id = ? AND user_id = ? AND is_active = 1"
      ).get(subscriberId, userId);
    }

    if (!subscriber) {
      return res.status(404).json({ error: "Subscriber not found or access denied" });
    }

    // Verify WhatsApp opt-in
    if (subscriber.whatsappOptIn !== true) {
      return res.status(400).json({ 
        error: "Subscriber has not opted in for WhatsApp notifications" 
      });
    }

    // Verify phone number matches
    const subscriberPhone = subscriber.phone || subscriber.mobile || "";
    const cleanedSubscriberPhone = subscriberPhone.replace(/[^\d]/g, '');
    const cleanedRequestPhone = phone.replace(/[^\d]/g, '');
    
    // Normalize both phones (remove country code if present for comparison)
    const normalizePhone = (phone) => {
      const cleaned = phone.replace(/[^\d]/g, '');
      return cleaned.length > 10 ? cleaned.slice(-10) : cleaned;
    };

    if (normalizePhone(cleanedSubscriberPhone) !== normalizePhone(cleanedRequestPhone)) {
      console.warn(`[WhatsApp] Phone mismatch: subscriber has ${subscriberPhone}, request has ${phone}`);
      // Don't block, but log warning
    }

    // Fetch report details
    let report = null;
    if (mongooseConnected) {
      // Try finding by _id first
      if (reportId.match(/^[0-9a-fA-F]{24}$/)) {
        report = await Report.findOne({
          _id: reportId,
          user_id: userId
        }).lean();
      }
      
      // If not found, try finding by report_data
      if (!report) {
        report = await Report.findOne({
          report_data: reportId,
          user_id: userId
        }).lean();
      }
    } else {
      // SQLite fallback
      report = db.prepare(
        "SELECT * FROM reports WHERE (id = ? OR report_data = ?) AND user_id = ?"
      ).get(reportId, reportId, userId);
    }

    if (!report) {
      return res.status(404).json({ error: "Report not found or access denied" });
    }

    // Get safe report ID
    const safeReportId = report.report_data || reportId;

    // Get HTML content from blob storage
    const htmlContent = await getHtmlFromBlob(safeReportId);
    if (!htmlContent) {
      return res.status(404).json({ error: "Report HTML not found in storage" });
    }

    // Generate PDF from HTML
    console.log(`[WhatsApp] Generating PDF for report ${safeReportId}...`);
    const pdfBuffer = await convertHtmlToPdf(htmlContent);
    console.log(`[WhatsApp] PDF generated successfully (${pdfBuffer.length} bytes)`);

    // Upload PDF to blob storage
    const pdfBlobName = await uploadPdfToBlob(safeReportId, pdfBuffer);
    console.log(`[WhatsApp] PDF uploaded to blob: ${pdfBlobName}`);

    // Get public URL for PDF (valid for 24 hours)
    const pdfUrl = await getBlobUrl(pdfBlobName, 24);
    console.log(`[WhatsApp] PDF URL generated: ${pdfUrl.substring(0, 100)}...`);

    // Extract report name
    const reportName = report.title?.replace("Equity Research Note – ", "").trim() || 
                      report.company_name || 
                      "Report";

    // Send WhatsApp message with PDF attachment
    const result = await sendWhatsAppReport({
      phone: phone.replace(/[^\d]/g, ''), // Format: 91XXXXXXXXXX (no +)
      userName: subscriber.name,
      reportName: reportName,
      pdfUrl: pdfUrl // Public URL to PDF file
    });

    // Log delivery (optional - similar to email delivery logging)
    try {
      if (mongooseConnected) {
        await ReportDelivery.create({
          subscriber_id: subscriberId,
          report_id: report._id || report.id,
          user_id: userId,
          delivery_method: 'whatsapp',
          message_sid: result.messageSid
        });
      }
    } catch (dbErr) {
      console.warn("[WhatsApp] Failed to log delivery:", dbErr.message);
      // Don't fail the request if logging fails
    }

    console.log(`[WhatsApp] Report sent successfully to ${subscriber.name} (${phone}). SID: ${result.messageSid}`);

    return res.json({
      success: true,
      message: "Report sent on WhatsApp successfully",
      messageSid: result.messageSid
    });

  } catch (err) {
    console.error("[WhatsApp] Error sending report:", err);
    
    // Handle Twilio-specific errors
    if (err.code) {
      return res.status(400).json({
        error: "Failed to send WhatsApp message",
        code: err.code,
        message: err.message
      });
    }

    return res.status(500).json({
      error: "Failed to send report on WhatsApp",
      message: err.message || "Internal server error"
    });
  }
});

// ==========================================
// 8.5. MARKET INTELLIGENCE ROUTES
// ==========================================

/**
 * Helper function to map user/subscriber risk profile to agentic AI format
 * @param {string} riskProfile - Risk profile from database ('Low', 'Medium', 'High')
 * @returns {string} Normalized risk profile ('LOW', 'MODERATE', 'HIGH')
 */
function normalizeRiskProfileForAPI(riskProfile) {
  if (!riskProfile) return 'MODERATE';
  
  const normalized = riskProfile.toUpperCase();
  // Map database values to API values
  if (normalized === 'LOW') return 'LOW';
  if (normalized === 'MEDIUM') return 'MODERATE';
  if (normalized === 'HIGH') return 'HIGH';
  
  // Default to MODERATE for unknown values
  return 'MODERATE';
}

/**
 * Get user's risk profile from preferences or use default
 * @param {string} userId - User ID
 * @returns {Promise<string>} Risk profile ('LOW', 'MODERATE', 'HIGH')
 */
async function getUserRiskProfile(userId) {
  // Check UserPreference for risk profile (if we add it in future)
  // For now, we'll check for any active subscriber's risk profile or use default
  if (mongooseConnected) {
    try {
      // UserPreference and Subscriber are already imported at the top
      const preference = await UserPreference.findOne({ user_id: userId }).lean();
      if (preference && preference.risk_profile) {
        return normalizeRiskProfileForAPI(preference.risk_profile);
      }
      
      // Try to get from first active subscriber (fallback)
      const subscriber = await Subscriber.findOne({ user_id: userId, is_active: true }).lean();
      if (subscriber && subscriber.risk_profile) {
        return normalizeRiskProfileForAPI(subscriber.risk_profile);
      }
    } catch (e) {
      console.warn('[MarketIntelligence] Error fetching user risk profile:', e.message);
    }
  }
  
  // Default to MODERATE
  return 'MODERATE';
}

/**
 * POST /api/market-intelligence
 * Fetch market intelligence for a given ticker
 * Requires authentication
 */
app.post("/api/market-intelligence", loginRequired, async (req, res) => {
  try {
    const { ticker } = req.body;

    if (!ticker || typeof ticker !== 'string' || ticker.trim() === '') {
      return res.status(400).json({
        status: "error",
        message: "Ticker is required"
      });
    }

    const normalizedTicker = ticker.trim().toUpperCase();
    const userId = req.user._id || req.user.id;

    // Get user's risk profile (default to MODERATE)
    const riskProfile = await getUserRiskProfile(userId);
    console.log(`[MarketIntelligence] Request for ${normalizedTicker} with risk profile: ${riskProfile}`);

    // Get current date for analysis_date (YYYY-MM-DD)
    const analysisDate = new Date().toISOString().split('T')[0];

    // Check cache first
    const cachedResult = marketIntelligenceCache.get(normalizedTicker, analysisDate, riskProfile);
    if (cachedResult) {
      console.log(`[MarketIntelligence] Cache hit for ${normalizedTicker} on ${analysisDate}`);
      return res.json({
        status: "success",
        data: cachedResult,
        cached: true
      });
    }

    // Fetch from agentic AI service
    console.log(`[MarketIntelligence] Fetching from agentic AI service for ${normalizedTicker}...`);
    const rawResponse = await fetchMarketIntelligence({
      ticker: normalizedTicker,
      riskProfile: riskProfile
    });

    // Normalize the response
    const normalizedData = normalizeMarketIntelligence(rawResponse);

    // Update analysis date from response if available
    const actualAnalysisDate = normalizedData.analysisDate || analysisDate;

    // Cache the normalized result
    marketIntelligenceCache.set(normalizedTicker, actualAnalysisDate, riskProfile, normalizedData);

    console.log(`[MarketIntelligence] Successfully fetched and cached intelligence for ${normalizedTicker}`);

    // Return normalized response
    return res.json({
      status: "success",
      data: normalizedData,
      cached: false
    });

  } catch (error) {
    console.error("[MarketIntelligence] Error:", error);
    return res.status(500).json({
      status: "error",
      message: error.message || "Failed to fetch market intelligence"
    });
  }
});

/**
 * POST /api/market-chatter
 * Fetch market chatter analysis from external Market Chatter AI service
 * Requires authentication
 * 
 * Request body:
 * {
 *   "query": "Wipro",  // required
 *   "lookback_hours": 24,    // optional, default: 24
 *   "max_results": 20        // optional, default: 20
 * }
 */
app.post("/api/market-chatter", loginRequired, checkUsageLimit('market'), async (req, res) => {
  try {
    const { query, lookback_hours, max_results } = req.body;

    // Validate required field
    if (!query || typeof query !== 'string' || query.trim() === '') {
      return res.status(400).json({
        status: "error",
        message: "Query is required and must be a non-empty string"
      });
    }

    // Call the service wrapper
    const result = await fetchMarketChatter({
      query: query.trim(),
      lookbackHours: lookback_hours,
      maxResults: max_results
    });

    // Return the service response directly without transformation
    return res.json(result);

  } catch (error) {
    console.error("[MarketChatter] Error:", error);
    
    // Return generic error message to frontend (do not leak stack traces)
    return res.status(502).json({
      status: "error",
      message: "Market chatter service temporarily unavailable"
    });
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
    Promise.all([
      mongoose.connection.close().then(() => {
        console.log('[PROCESS] Main MongoDB connection closed');
      }),
      notificationsClient.close().then(() => {
        console.log('[PROCESS] Notifications MongoDB connection closed');
      }).catch(() => {
        console.warn('[PROCESS] Notifications MongoDB close failed (may not be connected)');
      })
    ]).then(() => {
      process.exit(0);
    }).catch(() => process.exit(1));
  });
});

// SPA Fallback Route - Serve index.html for all non-API routes
// This allows React Router to handle client-side routing
// Must be placed AFTER all API routes but BEFORE error handler
app.get('*', (req, res, next) => {
  // Skip if it's an API route, static file, or socket.io
  if (
    req.path.startsWith('/api') ||
    req.path.startsWith('/static') ||
    req.path.startsWith('/uploads') ||
    req.path.startsWith('/socket.io') ||
    req.path.startsWith('/health') ||
    req.path.includes('.') // Has file extension (e.g., .js, .css, .png)
  ) {
    return next(); // Let Express handle 404 for these
  }

  // For all other routes, serve index.html (SPA routing)
  // In production, serve from the built React app directory
  // In development, this will be handled by Vite dev server
  const indexPath = path.join(__dirname, 'static', 'index.html');
  
  if (fs.existsSync(indexPath)) {
    return res.sendFile(indexPath);
  }

  // If index.html doesn't exist, continue to error handler
  next();
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
  console.log(`[SageAlpha Node] HTML Reports Storage: Azure Blob Storage (Container: ${process.env.AZURE_CONTAINER_NAME || 'html-pdf-report'})`);
  console.log(`[SageAlpha Node] Uploads Dir: ${UPLOADS_DIR}`);
  if (!IS_PRODUCTION) {
    console.log(`[SageAlpha Node] Local URL: http://localhost:${PORT}`);
  }
});
