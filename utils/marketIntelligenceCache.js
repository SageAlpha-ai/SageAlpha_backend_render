/**
 * Simple in-memory cache for market intelligence responses
 * Cache key: ticker:analysisDate:riskProfile
 * TTL: 15-30 minutes (randomized to prevent cache stampede)
 */

class MarketIntelligenceCache {
  constructor() {
    this.cache = new Map();
    this.DEFAULT_TTL_MS = 15 * 60 * 1000; // 15 minutes
    this.MAX_TTL_MS = 30 * 60 * 1000; // 30 minutes
  }

  /**
   * Generate cache key
   * @param {string} ticker - Stock ticker
   * @param {string} analysisDate - Analysis date (YYYY-MM-DD)
   * @param {string} riskProfile - Risk profile (LOW/MODERATE/HIGH)
   * @returns {string} Cache key
   */
  _generateKey(ticker, analysisDate, riskProfile) {
    return `${ticker.toUpperCase()}:${analysisDate}:${riskProfile.toUpperCase()}`;
  }

  /**
   * Get cached value if valid
   * @param {string} ticker - Stock ticker
   * @param {string} analysisDate - Analysis date (YYYY-MM-DD)
   * @param {string} riskProfile - Risk profile (LOW/MODERATE/HIGH)
   * @returns {Object|null} Cached value or null if not found/expired
   */
  get(ticker, analysisDate, riskProfile) {
    const key = this._generateKey(ticker, analysisDate, riskProfile);
    const cached = this.cache.get(key);

    if (!cached) {
      return null;
    }

    // Check if expired
    if (Date.now() > cached.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    return cached.data;
  }

  /**
   * Set cache value with randomized TTL
   * @param {string} ticker - Stock ticker
   * @param {string} analysisDate - Analysis date (YYYY-MM-DD)
   * @param {string} riskProfile - Risk profile (LOW/MODERATE/HIGH)
   * @param {Object} data - Data to cache
   */
  set(ticker, analysisDate, riskProfile, data) {
    const key = this._generateKey(ticker, analysisDate, riskProfile);
    
    // Randomize TTL between 15-30 minutes to prevent cache stampede
    const ttl = this.DEFAULT_TTL_MS + Math.random() * (this.MAX_TTL_MS - this.DEFAULT_TTL_MS);
    
    this.cache.set(key, {
      data,
      expiresAt: Date.now() + ttl,
      createdAt: Date.now()
    });

    // Clean up expired entries periodically (every 100 sets)
    if (this.cache.size % 100 === 0) {
      this._cleanup();
    }
  }

  /**
   * Remove expired entries from cache
   */
  _cleanup() {
    const now = Date.now();
    for (const [key, value] of this.cache.entries()) {
      if (now > value.expiresAt) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Clear all cache entries
   */
  clear() {
    this.cache.clear();
  }

  /**
   * Get cache statistics
   * @returns {Object} Cache stats
   */
  getStats() {
    const now = Date.now();
    let validEntries = 0;
    let expiredEntries = 0;

    for (const value of this.cache.values()) {
      if (now > value.expiresAt) {
        expiredEntries++;
      } else {
        validEntries++;
      }
    }

    return {
      totalEntries: this.cache.size,
      validEntries,
      expiredEntries
    };
  }
}

// Singleton instance
const marketIntelligenceCache = new MarketIntelligenceCache();

module.exports = marketIntelligenceCache;

