import axios from 'axios';
import * as cheerio from 'cheerio';
import { normalizePhone, scorePhone, isBlockedPhone } from '../server/services/scraper-utils';

const url = 'https://www.willhaben.at/iad/immobilien/d/eigentumswohnung/wien/wien-1190-doebling/provisionsfrei-eleganter-erstbezug-in-doebling-4-zimmer-wohnung-auf-hoechstem-niveau-796232043';

async function debug() {
  const response = await axios.get(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
  });

  const html = response.data;
  const htmlNoScripts = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ');

  const candidateRegex = /(?:(?:\+43|0043|43|0)\s*)6[5-9]\s*[\d\s\-/()]{7,12}/g;
  const rawMatches = htmlNoScripts.match(candidateRegex) || [];

  console.log('🔍 Found', rawMatches.length, 'phone candidates');
  console.log('');

  rawMatches.slice(0, 10).forEach(raw => {
    const normalized = normalizePhone(raw);
    const blocked = isBlockedPhone(normalized);
    const score = scorePhone(normalized);
    const formatted = normalized.startsWith('43') ? `+${normalized}` : normalized;

    console.log('Raw:', raw);
    console.log('  Normalized:', normalized);
    console.log('  Length:', normalized.length);
    console.log('  Blocked:', blocked);
    console.log('  Score:', score);
    console.log('  Formatted:', formatted);
    console.log('  ✅ Would be extracted:', normalized.length >= 8 && !blocked);
    console.log('');
  });

  // Final extraction
  const candidates = rawMatches
    .map(normalizePhone)
    .filter(n => n.length >= 8 && !isBlockedPhone(n));

  console.log('✅ Valid candidates:', candidates.length);
  if (candidates.length > 0) {
    const best = candidates
      .map(n => ({ n: n.startsWith('43') ? `+${n}` : n, s: scorePhone(n) }))
      .sort((a, b) => b.s - a.s)[0];
    console.log('📞 Best phone:', best?.n);
  } else {
    console.log('❌ No valid phone found');
  }
}

debug();
