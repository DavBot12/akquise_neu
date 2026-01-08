import { chromium } from 'playwright-core';
import { load } from 'cheerio';

async function testLive() {
  const browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext()).newPage();
  
  // Test mit dem Listing das du gerade siehst
  await page.goto('https://immobilien.derstandard.at/detail/14551553', { timeout: 30000 });
  await page.waitForTimeout(3000);
  
  const html = await page.content();
  const $ = load(html);
  
  console.log('=== LIVE TEST ===\n');
  
  // Test Preis
  console.log('1. PREIS:');
  $('.sc-stat-label').each((i, el) => {
    const label = $(el).text().trim();
    const value = $(el).next('.sc-stat-value').text().trim();
    if (label === 'Kaufpreis') {
      console.log('   ✅ Gefunden:', value);
    }
  });
  
  // Test Beschreibung
  console.log('\n2. BESCHREIBUNG:');
  $('section').each((i, el) => {
    const h2 = $(el).find('h2').text().trim();
    if (h2 === 'Beschreibung') {
      const text = $(el).find('p').first().text().trim().substring(0, 100);
      console.log('   ✅ Gefunden:', text + '...');
    }
  });
  
  // Test Bilder
  console.log('\n3. BILDER:');
  const imgCount = $('picture source[srcSet*=".jpeg"]').length;
  console.log('   picture source:', imgCount);
  
  $('picture source[srcSet*=".jpeg"]').first().each((i, el) => {
    const srcSet = $(el).attr('srcSet');
    console.log('   Beispiel:', srcSet?.substring(0, 100));
  });
  
  // Test Telefon
  console.log('\n4. TELEFON:');
  const tel = $('a[href^="tel:"]').attr('href');
  console.log('   tel: link:', tel || 'NICHT GEFUNDEN');
  
  // Test Privat-Keywords
  console.log('\n5. PRIVAT-FILTER:');
  const bodyText = $('body').text().toLowerCase();
  ['provisionsfrei', 'privat', 'privatverkauf'].forEach(kw => {
    console.log(`   "${kw}":`, bodyText.includes(kw) ? '✅ JA' : '❌ NEIN');
  });
  
  await browser.close();
}

testLive().catch(console.error);
