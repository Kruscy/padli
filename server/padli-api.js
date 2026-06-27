// ============================================================================
// Padli Kép-összefűző - API Szerver (Node.js)
// ============================================================================
// Patreon integráció · Aktiválás · Validálás · Verzió ellenőrzés

import dotenv from 'dotenv';
dotenv.config({ path: '/opt/padli/.env' });

import express from 'express';
import cors from 'cors';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { pool } from './db.js';

const app = express();
const PORT = process.env.PADLI_API_PORT || 5001;

// ── Konfiguráció ────────────────────────────────────────────────────────────
const SECRET_KEY = process.env.PADLI_SECRET_KEY || 'CHANGE_THIS_TO_RANDOM_STRING';
const API_KEY = process.env.PADLI_API_KEY || null;

const APP_VERSION = '1.0.0'; // ← FRISSÍTSD MINDEN VERZIÓVAL!
const DOWNLOAD_URL = process.env.PADLI_DOWNLOAD_URL || `${process.env.SITE_URL || 'http://localhost:3000'}/downloads/Padli-Keposszefu.exe`;

// ── Logging Konfiguráció ────────────────────────────────────────────────────
const LOG_DIR = path.join(process.cwd(), 'logs', 'padli-api');
const MAX_LOG_SIZE = 10 * 1024 * 1024;  // 10 MB
const MAX_TOTAL_SIZE = 1024 * 1024 * 1024; // 1 GB

// Log directory létrehozása
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

// ── Logger Osztály ──────────────────────────────────────────────────────────
class RotatingLogger {
  constructor(logDir, maxFileSize, maxTotalSize) {
    this.logDir = logDir;
    this.maxFileSize = maxFileSize;
    this.maxTotalSize = maxTotalSize;
    this.currentLogFile = null;
    this.currentLogStream = null;
    this.initLogFile();
  }

  initLogFile() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    this.currentLogFile = path.join(this.logDir, `padli-api-${timestamp}.log`);
    this.currentLogStream = fs.createWriteStream(this.currentLogFile, { flags: 'a' });
    
    console.log(`📝 Log file: ${this.currentLogFile}`);
  }

  log(level, message, data = null) {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      level,
      message,
      ...(data && { data })
    };
    
    const logLine = JSON.stringify(logEntry) + '\n';
    
    // Console output
    console.log(`[${timestamp}] ${level.toUpperCase()}: ${message}`);
    if (data) console.log('  Data:', data);
    
    // File output
    this.currentLogStream.write(logLine);
    
    // Check rotation
    this.checkRotation();
  }

  checkRotation() {
    try {
      const stats = fs.statSync(this.currentLogFile);
      
      // Ha a file túl nagy (>10MB)
      if (stats.size > this.maxFileSize) {
        this.rotate();
      }
      
      // Teljes log size ellenőrzés
      this.cleanupOldLogs();
      
    } catch (err) {
      console.error('Log rotation check error:', err);
    }
  }

  rotate() {
    console.log('📄 Log rotation: File méret limit elérve, új file indítása...');
    
    // Régi stream lezárása
    if (this.currentLogStream) {
      this.currentLogStream.end();
    }
    
    // Új file indítása
    this.initLogFile();
  }

  cleanupOldLogs() {
    try {
      // Összes log file listázása
      const files = fs.readdirSync(this.logDir)
        .filter(f => f.startsWith('padli-api-') && f.endsWith('.log'))
        .map(f => ({
          name: f,
          path: path.join(this.logDir, f),
          size: fs.statSync(path.join(this.logDir, f)).size,
          mtime: fs.statSync(path.join(this.logDir, f)).mtime
        }))
        .sort((a, b) => a.mtime - b.mtime); // Legrégebbi előre
      
      // Teljes méret számítás
      const totalSize = files.reduce((sum, f) => sum + f.size, 0);
      
      if (totalSize > this.maxTotalSize) {
        console.log(`🗑️  Teljes log méret: ${(totalSize / 1024 / 1024).toFixed(2)} MB (limit: ${(this.maxTotalSize / 1024 / 1024).toFixed(0)} MB)`);
        
        let deletedSize = 0;
        let deletedCount = 0;
        
        // Legrégebbi fileok törlése amíg a limit alá nem csökken
        for (const file of files) {
          // Ne töröljük a current log file-t!
          if (file.path === this.currentLogFile) continue;
          
          if (totalSize - deletedSize > this.maxTotalSize) {
            console.log(`   Törlés: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)`);
            fs.unlinkSync(file.path);
            deletedSize += file.size;
            deletedCount++;
          } else {
            break;
          }
        }
        
        console.log(`✅ ${deletedCount} régi log törölve (${(deletedSize / 1024 / 1024).toFixed(2)} MB felszabadítva)`);
      }
      
    } catch (err) {
      console.error('Log cleanup error:', err);
    }
  }

  close() {
    if (this.currentLogStream) {
      this.currentLogStream.end();
    }
  }
}

// Logger instance
const logger = new RotatingLogger(LOG_DIR, MAX_LOG_SIZE, MAX_TOTAL_SIZE);

// ── Middleware ──────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());

// Request logger middleware
app.use((req, res, next) => {
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.log('info', 'HTTP Request', {
      method: req.method,
      path: req.path,
      status: res.statusCode,
      duration: `${duration}ms`,
      ip: req.ip,
      userAgent: req.get('user-agent')
    });
  });
  
  next();
});

// ── Segédfüggvények ─────────────────────────────────────────────────────────

function generateActivationKey(email) {
  return crypto
    .createHash('sha256')
    .update(email + SECRET_KEY)
    .digest('hex')
    .substring(0, 32)
    .toUpperCase();
}

function validateApiKey(req, res, next) {
  if (!API_KEY) return next();
  
  const apiKey = req.headers['x-api-key'];
  if (apiKey !== API_KEY) {
    logger.log('warn', 'Invalid API key attempt', { ip: req.ip });
    return res.status(401).json({ 
      success: false, 
      message: 'Érvénytelen API kulcs' 
    });
  }
  next();
}

// ── API Végpontok ───────────────────────────────────────────────────────────

/**
 * Verzió ellenőrzés
 * GET /api/padli/version
 */
app.get('/api/padli/version', (req, res) => {
  logger.log('info', 'Version check', {
    client_version: req.query.current_version || 'unknown',
    ip: req.ip
  });
  
  res.json({
    success: true,
    version: APP_VERSION,
    download_url: DOWNLOAD_URL,
    changelog: [
      '• Patreon OAuth integráció',
      '• Automatikus frissítés ellenőrzés',
      '• Korlátlan prémium funkciók',
      '• Hibakezelés javítások'
    ],
    release_date: '2026-04-16',
    update_required: false // Ha kötelező frissítés kellene
  });
});

/**
 * Health check
 * GET /api/padli/health
 */
app.get('/api/padli/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({
      status: 'ok',
      version: APP_VERSION,
      message: 'Padli API működik',
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    logger.log('error', 'Health check failed', { error: err.message });
    res.status(500).json({
      status: 'error',
      message: err.message
    });
  }
});

/**
 * Új felhasználó aktiválása
 * POST /api/padli/activate
 */
app.post('/api/padli/activate', validateApiKey, async (req, res) => {
  const { email } = req.body;
  
  if (!email || !email.includes('@')) {
    return res.status(400).json({
      success: false,
      message: 'Érvénytelen email cím'
    });
  }
  
  const emailLower = email.toLowerCase().trim();
  const activationKey = generateActivationKey(emailLower);
  
  try {
    const existing = await pool.query(
      'SELECT activation_key FROM padli_activations WHERE email = $1',
      [emailLower]
    );
    
    if (existing.rows.length > 0) {
      logger.log('info', 'Activation: Already exists', { email: emailLower });
      return res.json({
        success: true,
        activation_key: existing.rows[0].activation_key,
        message: 'Az email már regisztrálva van',
        already_exists: true
      });
    }
    
    await pool.query(
      `INSERT INTO padli_activations (email, activation_key, is_premium)
       VALUES ($1, $2, false)
       ON CONFLICT (email) DO NOTHING`,
      [emailLower, activationKey]
    );
    
    logger.log('info', 'Activation: New user', { email: emailLower });
    
    res.json({
      success: true,
      activation_key: activationKey,
      message: 'Aktiválási kulcs generálva'
    });
    
  } catch (err) {
    logger.log('error', 'Activation failed', { email: emailLower, error: err.message });
    res.status(500).json({
      success: false,
      message: `Hiba történt: ${err.message}`
    });
  }
});

/**
 * Aktiválási kulcs ellenőrzése
 * POST /api/padli/verify
 */
app.post('/api/padli/verify', async (req, res) => {
  const { email, activation_key } = req.body;
  
  if (!email || !activation_key) {
    return res.status(400).json({
      success: false,
      message: 'Email és aktiválási kulcs megadása kötelező'
    });
  }
  
  const emailLower = email.toLowerCase().trim();
  const keyUpper = activation_key.toUpperCase().trim();
  
  try {
    const result = await pool.query(
      `SELECT 
        pa.email,
        pa.activation_key,
        pa.is_premium AS stored_premium,
        ps.active AS patreon_active,
        ps.tier AS patreon_tier,
        u.role AS user_role
      FROM padli_activations pa
      LEFT JOIN patreon_status ps ON pa.patreon_user_id = ps.patreon_user_id
      LEFT JOIN users u ON ps.user_id = u.id
      WHERE pa.email = $1`,
      [emailLower]
    );
    
    if (result.rows.length === 0) {
      logger.log('warn', 'Verify: Email not found', { email: emailLower });
      return res.status(404).json({
        success: false,
        message: 'Nincs regisztráció ezzel az email címmel'
      });
    }
    
    const user = result.rows[0];
    
    if (user.activation_key !== keyUpper) {
      logger.log('warn', 'Verify: Invalid key', { email: emailLower });
      return res.status(401).json({
        success: false,
        message: 'Érvénytelen aktiválási kulcs'
      });
    }
    
    const isPremium = (
      user.patreon_active === true ||
      user.user_role === 'admin' ||
      user.patreon_tier === 'Admin' ||
      user.stored_premium === true
    );
    
    await pool.query(
      `UPDATE padli_activations
       SET is_premium = $1, last_verified = NOW()
       WHERE email = $2`,
      [isPremium, emailLower]
    );
    
    logger.log('info', 'Verify: Success', { 
      email: emailLower, 
      isPremium,
      tier: user.patreon_tier 
    });
    
    res.json({
      success: true,
      is_premium: isPremium,
      tier: isPremium ? user.patreon_tier : null,
      message: isPremium 
        ? 'Korlátlan használat' 
        : 'Ingyenes verzió (10 mappa/nap)'
    });
    
  } catch (err) {
    logger.log('error', 'Verify failed', { email: emailLower, error: err.message });
    res.status(500).json({
      success: false,
      message: `Hiba történt: ${err.message}`
    });
  }
});

/**
 * Email összekapcsolása Patreon user_id-val
 * POST /api/padli/link-patreon
 */
app.post('/api/padli/link-patreon', validateApiKey, async (req, res) => {
  const { email, patreon_user_id } = req.body;
  
  if (!email || !patreon_user_id) {
    return res.status(400).json({
      success: false,
      message: 'Email és patreon_user_id megadása kötelező'
    });
  }
  
  const emailLower = email.toLowerCase().trim();
  const activationKey = generateActivationKey(emailLower);
  
  try {
    const result = await pool.query(
      `INSERT INTO padli_activations 
        (email, activation_key, patreon_user_id, is_premium)
       VALUES ($1, $2, $3, true)
       ON CONFLICT (email) 
       DO UPDATE SET 
         patreon_user_id = EXCLUDED.patreon_user_id,
         is_premium = true,
         updated_at = NOW()
       RETURNING activation_key`,
      [emailLower, activationKey, patreon_user_id]
    );
    
    logger.log('info', 'Link Patreon', { 
      email: emailLower, 
      patreon_user_id 
    });
    
    res.json({
      success: true,
      activation_key: result.rows[0].activation_key,
      message: 'Patreon összekapcsolás sikeres',
      already_exists: result.rowCount === 0
    });
    
  } catch (err) {
    logger.log('error', 'Link Patreon failed', { 
      email: emailLower, 
      error: err.message 
    });
    res.status(500).json({
      success: false,
      message: `Hiba történt: ${err.message}`
    });
  }
});

/**
 * Prémium státusz frissítése
 * POST /api/padli/sync-premium
 */
app.post('/api/padli/sync-premium', validateApiKey, async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE padli_activations pa
       SET 
         is_premium = CASE 
           WHEN ps.active = true THEN true
           WHEN ps.tier = 'Admin' THEN true
           WHEN u.role = 'admin' THEN true
           ELSE false
         END,
         updated_at = NOW()
       FROM patreon_status ps
       LEFT JOIN users u ON ps.user_id = u.id
       WHERE pa.patreon_user_id = ps.patreon_user_id`
    );
    
    const updated = result.rowCount;
    
    logger.log('info', 'Sync premium', { updated_count: updated });
    
    res.json({
      success: true,
      updated_count: updated,
      message: `${updated} felhasználó státusza frissítve`
    });
    
  } catch (err) {
    logger.log('error', 'Sync premium failed', { error: err.message });
    res.status(500).json({
      success: false,
      message: `Hiba történt: ${err.message}`
    });
  }
});

/**
 * Patreon User ID alapú validálás
 * POST /api/padli/verify-patreon
 */
app.post('/api/padli/verify-patreon', async (req, res) => {
  const { patreon_user_id } = req.body;
  
  if (!patreon_user_id) {
    return res.status(400).json({
      success: false,
      message: 'Patreon User ID megadása kötelező'
    });
  }
  
  try {
    const result = await pool.query(
      `SELECT 
        ps.patreon_user_id,
        ps.active,
        ps.tier,
        u.role AS user_role
      FROM patreon_status ps
      LEFT JOIN users u ON ps.user_id = u.id
      WHERE ps.patreon_user_id = $1`,
      [patreon_user_id]
    );
    
    if (result.rows.length === 0) {
      logger.log('info', 'Verify Patreon: Not found', { patreon_user_id });
      return res.json({
        success: true,
        is_premium: false,
        tier: null,
        message: 'Ingyenes verzió (10 mappa/nap)',
        note: 'Patreon fiók nem található'
      });
    }
    
    const user = result.rows[0];
    
    const isPremium = (
      user.active === true ||
      user.tier === 'Admin' ||
      user.user_role === 'admin'
    );
    
    logger.log('info', 'Verify Patreon: Success', { 
      patreon_user_id, 
      isPremium,
      tier: user.tier
    });
    
    res.json({
      success: true,
      is_premium: isPremium,
      tier: isPremium ? user.tier : null,
      message: isPremium 
        ? 'Korlátlan használat' 
        : 'Ingyenes verzió (10 mappa/nap)'
    });
    
  } catch (err) {
    logger.log('error', 'Verify Patreon failed', { 
      patreon_user_id, 
      error: err.message 
    });
    res.status(500).json({
      success: false,
      message: `Hiba történt: ${err.message}`
    });
  }
});

/**
 * Napi használat naplózása
 * POST /api/padli/usage
 */
app.post('/api/padli/usage', async (req, res) => {
  const { email, folders_processed = 1 } = req.body;
  
  if (!email) {
    return res.status(400).json({ 
      success: false, 
      message: 'Email hiányzik' 
    });
  }
  
  const emailLower = email.toLowerCase().trim();
  const today = new Date().toISOString().split('T')[0];
  
  try {
    await pool.query(
      `INSERT INTO padli_usage_stats (email, date, folders_processed)
       VALUES ($1, $2, $3)
       ON CONFLICT (email, date)
       DO UPDATE SET 
         folders_processed = padli_usage_stats.folders_processed + EXCLUDED.folders_processed`,
      [emailLower, today, folders_processed]
    );
    
    logger.log('info', 'Usage logged', { 
      email: emailLower, 
      folders: folders_processed 
    });
    
    res.json({
      success: true,
      message: 'Használat naplózva'
    });
    
  } catch (err) {
    logger.log('error', 'Usage logging failed', { 
      email: emailLower, 
      error: err.message 
    });
    res.status(500).json({
      success: false,
      message: `Hiba: ${err.message}`
    });
  }
});

// ── Szerver indítás ─────────────────────────────────────────────────────────

app.listen(PORT, '0.0.0.0', () => {
  logger.log('info', 'Padli API Started', {
    port: PORT,
    version: APP_VERSION,
    log_dir: LOG_DIR,
    max_log_size: `${MAX_LOG_SIZE / 1024 / 1024} MB`,
    max_total_size: `${MAX_TOTAL_SIZE / 1024 / 1024 / 1024} GB`
  });
  
  console.log(`🚀 Padli API v${APP_VERSION} fut a ${PORT} porton`);
  console.log(`   Health: http://localhost:${PORT}/api/padli/health`);
  console.log(`   Version: http://localhost:${PORT}/api/padli/version`);
  console.log(`   Logs: ${LOG_DIR}`);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.log('info', 'SIGTERM received, shutting down gracefully');
  logger.close();
  await pool.end();
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.log('info', 'SIGINT received, shutting down gracefully');
  logger.close();
  await pool.end();
  process.exit(0);
});
