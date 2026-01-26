import 'dotenv/config';
import { load } from 'cheerio';
import fs from 'fs';
import { proxyRequest, rotateUserAgent } from '../server/services/scraper-utils';

async function analyzeDerStandardFilter() {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📊 DerStandard Filter Analysis');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // Test URLs
  const testUrls = [
    'https://immobilien.derstandard.at/detail/15017932',
    'https://immobilien.derstandard.at/detail/15019924',
  ];

  for (const url of testUrls) {
    console.log(`\n🔍 Analyzing: ${url}\n`);

    try {
      // Fetch the page
      const res = await proxyRequest(url, '', {
        headers: {
          'User-Agent': rotateUserAgent(),
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        },
        timeout: 30000
      });

      const html = res.data as string;

      // Extract Next.js data (same logic as scraper)
      const nextData = extractNextData(html);

      if (!nextData) {
        console.log('❌ Could not extract Next.js data');
        continue;
      }

      // Save raw data for inspection
      const urlId = url.split('/').pop();
      fs.writeFileSync(
        `c:\\Users\\David Jaros\\Desktop\\akquise\\derstandard_${urlId}_data.json`,
        JSON.stringify(nextData, null, 2)
      );

      // Extract key fields
      const advertiser = nextData.advertiser;
      const metaData = nextData.metaData;
      const property = nextData.property;

      console.log('📋 Advertiser Data:');
      console.log('  - Company Name:', advertiser?.company?.name || 'N/A');
      console.log('  - Contact Person Company:', advertiser?.contactPerson?.companyName || 'N/A');
      console.log('  - Contact Person Name:', advertiser?.contactPerson?.name || 'N/A');

      console.log('\n📋 MetaData:');
      console.log('  - isPrivateAd:', metaData?.isPrivateAd);
      console.log('  - Type:', metaData?.type || 'N/A');
      console.log('  - Category:', metaData?.category || 'N/A');

      console.log('\n📋 Property Data:');
      console.log('  - Title:', nextData.title || 'N/A');
      console.log('  - Location:', property?.location?.city || 'N/A');
      console.log('  - ZIP:', property?.location?.zipCode || 'N/A');
      console.log('  - Price:', property?.costs?.main?.value || 'N/A');
      console.log('  - Area:', property?.areas?.main?.value || 'N/A');

      // Check body text for keywords
      const $ = load(html);
      const bodyText = $('body').text().toLowerCase();

      console.log('\n📋 Body Text Keywords:');
      const keywords = [
        'provision: 3',
        'nettoprovision',
        'provisionsaufschlag',
        'von privat',
        'privatverkauf',
        'ohne makler',
        'gmbh',
        'immobilien'
      ];

      for (const kw of keywords) {
        if (bodyText.includes(kw)) {
          console.log(`  ✓ Found: "${kw}"`);
        }
      }

      // Apply filter logic
      console.log('\n🔍 Filter Logic Analysis:');

      // Stage 1: Direct isPrivateAd check
      if (metaData?.isPrivateAd === false) {
        console.log('  ❌ BLOCKED at Stage 1: isPrivateAd: false (Commercial listing)');
        continue;
      }

      if (metaData?.isPrivateAd === true) {
        console.log('  ✅ PASS Stage 1: isPrivateAd: true (Private listing)');

        // Double-check for false positives
        if (bodyText.includes('provision: 3') || bodyText.includes('nettoprovision') || bodyText.includes('provisionsaufschlag')) {
          console.log('  ❌ BLOCKED at Stage 2: Has Commission text despite isPrivateAd: true');
          continue;
        }

        // Double-check Company name
        const companyName = advertiser?.company?.name || advertiser?.contactPerson?.companyName;
        if (companyName) {
          const lower = companyName.toLowerCase();
          const commercialKeywords = [
            'gmbh', 'immobilien', 'makler', 'agentur', 'real estate',
            'partners', 'group', 'sivag', 'bauträger', 'immo', 'contract'
          ];

          if (commercialKeywords.some(kw => lower.includes(kw))) {
            console.log(`  ❌ BLOCKED at Stage 3: Commercial Company: ${companyName}`);
            continue;
          }
        }

        console.log('  ✅ FINAL: Would be SAVED as Private listing');
        continue;
      }

      // If isPrivateAd is null/undefined
      console.log('  ⚠️ Stage 1: isPrivateAd is null/undefined');

      // Stage 3: Company-based filtering
      const companyName = advertiser?.company?.name || advertiser?.contactPerson?.companyName;
      if (companyName) {
        const lower = companyName.toLowerCase();
        const commercialKeywords = [
          'gmbh', 'immobilien', 'makler', 'agentur', 'real estate',
          'partners', 'group', 'sivag', 'bauträger', 'immo'
        ];

        if (commercialKeywords.some(kw => lower.includes(kw))) {
          console.log(`  ❌ BLOCKED at Stage 3: Commercial Company: ${companyName}`);
          continue;
        }

        if (lower === 'privat' || lower === 'private') {
          console.log(`  ✅ PASS Stage 3: Company: Privat`);
          console.log('  ✅ FINAL: Would be SAVED as Private listing');
          continue;
        }
      }

      // Stage 4: Body text - commercial keywords
      const commercialBodyKeywords = ['provision: 3', 'nettoprovision', 'provisionsaufschlag'];
      if (commercialBodyKeywords.some(kw => bodyText.includes(kw))) {
        console.log('  ❌ BLOCKED at Stage 4: Provision mentioned in body text');
        continue;
      }

      // Stage 5: Body text - private keywords
      const privateKeywords = [
        'von privat', 'privatverkauf', 'ohne makler',
        'privater verkäufer', 'verkaufe privat'
      ];
      if (privateKeywords.some(kw => bodyText.includes(kw))) {
        console.log('  ✅ PASS Stage 5: Private keywords found in body text');
        console.log('  ✅ FINAL: Would be SAVED as Private listing');
        continue;
      }

      // Stage 6: Default BLOCK
      console.log('  ❌ BLOCKED at Stage 6: Uncertain - defaulting to block');

    } catch (error: any) {
      console.log(`❌ Error: ${error.message}`);
    }
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

function extractNextData(html: string): any | null {
  try {
    const pattern = /self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g;
    const matches = html.matchAll(pattern);

    let jsonStr: string | null = null;
    for (const match of matches) {
      if (match[1] && match[1].includes('propertyData')) {
        jsonStr = match[1];
        break;
      }
    }

    if (!jsonStr) return null;

    jsonStr = jsonStr.replace(/\\"/g, '"');
    jsonStr = jsonStr.replace(/\\\\/g, '\\');

    const propertyDataIdx = jsonStr.indexOf('"propertyData":');
    if (propertyDataIdx === -1) return null;

    const fromPropertyData = jsonStr.substring(propertyDataIdx);
    const openBraceIdx = fromPropertyData.indexOf('{');
    if (openBraceIdx === -1) return null;

    let braceCount = 0;
    let closeBraceIdx = -1;
    for (let i = openBraceIdx; i < fromPropertyData.length; i++) {
      if (fromPropertyData[i] === '{') braceCount++;
      if (fromPropertyData[i] === '}') {
        braceCount--;
        if (braceCount === 0) {
          closeBraceIdx = i + 1;
          break;
        }
      }
    }

    if (closeBraceIdx === -1) return null;

    const propertyDataJson = fromPropertyData.substring(openBraceIdx, closeBraceIdx);
    const data = JSON.parse(propertyDataJson);

    return data;
  } catch (error: any) {
    console.log('[ERROR] Failed to extract Next data:', error.message);
    return null;
  }
}

analyzeDerStandardFilter().catch(console.error);
