/**
 * symbolResolver.js
 *
 * Centralized NSE symbol resolution for portfolio items.
 *
 * WHY THIS EXISTS:
 * - Alert / AI agents downstream only understand NSE trading symbols.
 * - `symbol` must be the single source of truth; we never re-derive it from company_name later.
 * - All portfolio writes (create/update) must go through this resolver before persisting.
 */

// Minimal static NSE mapping for top / commonly used companies.
// This can be extended or wired to a live market data service later.
const NSE_SYMBOL_MAP = {
  // Tata Consultancy Services
  TCS: { symbol: 'TCS', company_name: 'Tata Consultancy Services' },
  'TATA CONSULTANCY SERVICES': {
    symbol: 'TCS',
    company_name: 'Tata Consultancy Services',
  },

  // Reliance Industries
  RELIANCE: { symbol: 'RELIANCE', company_name: 'Reliance Industries' },
  'RELIANCE INDUSTRIES': {
    symbol: 'RELIANCE',
    company_name: 'Reliance Industries',
  },

  // Infosys
  INFY: { symbol: 'INFY', company_name: 'Infosys' },
  INFOSYS: { symbol: 'INFY', company_name: 'Infosys' },

  // HDFC Bank
  HDFCBANK: { symbol: 'HDFCBANK', company_name: 'HDFC Bank' },
  'HDFC BANK': { symbol: 'HDFCBANK', company_name: 'HDFC Bank' },

  // ICICI Bank
  ICICIBANK: { symbol: 'ICICIBANK', company_name: 'ICICI Bank' },
  'ICICI BANK': { symbol: 'ICICIBANK', company_name: 'ICICI Bank' },

  // Wipro
  WIPRO: { symbol: 'WIPRO', company_name: 'Wipro' },

  // Tata Motors
  TATAMOTORS: { symbol: 'TATAMOTORS', company_name: 'Tata Motors' },
  'TATA MOTORS': { symbol: 'TATAMOTORS', company_name: 'Tata Motors' },

  // State Bank of India
  SBIN: { symbol: 'SBIN', company_name: 'State Bank of India' },
  'STATE BANK OF INDIA': {
    symbol: 'SBIN',
    company_name: 'State Bank of India',
  },
};

/**
 * Resolve a user-provided input (company name or symbol) to a canonical NSE symbol
 * and official company name.
 *
 * @param {string} rawInput - User provided symbol or company name.
 * @returns {{ symbol: string, company_name: string } | null}
 */
function resolveNseSymbol(rawInput) {
  if (!rawInput || typeof rawInput !== 'string') {
    return null;
  }

  const key = rawInput.trim().toUpperCase();
  const entry = NSE_SYMBOL_MAP[key];

  if (!entry) {
    return null;
  }

  return {
    symbol: entry.symbol,
    company_name: entry.company_name,
  };
}

module.exports = {
  resolveNseSymbol,
};


