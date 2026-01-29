import axios from 'axios';
import * as cheerio from 'cheerio';
import { extractPhoneFromHtml } from '../server/services/scraper-utils';

const url = 'https://www.willhaben.at/iad/immobilien/d/eigentumswohnung/wien/wien-1190-doebling/provisionsfrei-eleganter-erstbezug-in-doebling-4-zimmer-wohnung-auf-hoechstem-niveau-796232043';

async function testPhoneExtraction() {
  console.log('📱 Testing phone extraction for:', url);
  console.log('');

  try {
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    const html = response.data;
    const $ = cheerio.load(html);

    console.log('✅ HTML fetched, size:', html.length, 'bytes');
    console.log('');

    // Test Phone Extraction
    const phone = extractPhoneFromHtml(html, $);
    console.log('📞 Extracted phone:', phone || 'NONE FOUND');
    console.log('');

    // Search for phone patterns manually
    console.log('🔍 Searching for phone patterns in HTML...');

    // Pattern 1: CONTACT/PHONE JSON
    const contactPhone = html.match(/\{"name":"CONTACT\/PHONE","values":\["([^"]+)"\]\}/);
    console.log('  CONTACT/PHONE:', contactPhone?.[1] || 'not found');

    // Pattern 2: phoneNo JSON
    const phoneNo = html.match(/\{"id":"phoneNo"[^}]*"value":"([^"]+)"\}/);
    console.log('  phoneNo:', phoneNo?.[1] || 'not found');

    // Pattern 3: PHONE_NUMBER JSON
    const phoneNumber = html.match(/\{"name":"PHONE_NUMBER","values":\["([^"]+)"\]\}/);
    console.log('  PHONE_NUMBER:', phoneNumber?.[1] || 'not found');

    // Pattern 4: tel: links
    const telLinks = $('a[href^="tel:"]');
    console.log('  tel: links found:', telLinks.length);
    telLinks.each((_: number, el: any) => {
      console.log('    -', $(el).attr('href'), '|', $(el).text());
    });

    // Pattern 5: Search for any phone-like strings
    const phoneRegex = /(?:\+43|0043|43|0)\s*6[5-9]\s*[\d\s\-/()]{7,12}/g;
    const matches = html.match(phoneRegex);
    console.log('  Phone regex matches:', matches?.length || 0);
    if (matches) {
      matches.slice(0, 5).forEach(m => console.log('    -', m));
    }

  } catch (error: any) {
    console.error('❌ Error:', error.message);
  }
}

testPhoneExtraction();
