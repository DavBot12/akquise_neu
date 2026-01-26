import 'dotenv/config';
import { load } from 'cheerio';
import fs from 'fs';
import { proxyRequest, rotateUserAgent } from '../server/services/scraper-utils';

async function analyzePrivateListings() {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🔍 Analyzing Private Listings in Detail');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const privateUrls = [
    'https://immobilien.derstandard.at/detail/14692813',
    'https://immobilien.derstandard.at/detail/14692986',
    'https://immobilien.derstandard.at/detail/15017932', // From earlier test
  ];

  for (const url of privateUrls) {
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`🔍 Analyzing: ${url}`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

    try {
      const res = await proxyRequest(url, '', {
        headers: {
          'User-Agent': rotateUserAgent(),
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        },
        timeout: 30000
      });

      const html = res.data as string;
      const nextData = extractNextData(html);

      if (!nextData) {
        console.log('❌ Could not extract data\n');
        continue;
      }

      // Save data
      const urlId = url.split('/').pop();
      fs.writeFileSync(
        `c:\\Users\\David Jaros\\Desktop\\akquise\\private_${urlId}_data.json`,
        JSON.stringify(nextData, null, 2)
      );

      const advertiser = nextData.advertiser;
      const metaData = nextData.metaData;
      const property = nextData.property;

      console.log('📋 FULL ADVERTISER DATA:');
      console.log(JSON.stringify(advertiser, null, 2));

      console.log('\n📋 FULL METADATA:');
      console.log(JSON.stringify(metaData, null, 2));

      console.log('\n📋 PROPERTY BASICS:');
      console.log('  - Title:', nextData.title);
      console.log('  - Location:', property?.location?.city);
      console.log('  - ZIP:', property?.location?.zipCode);
      console.log('  - Price:', property?.costs?.main?.value);
      console.log('  - Area:', property?.areas?.main?.value);

      console.log('\n📋 AMENITIES:');
      console.log('  ', property?.amenities || []);

      // Check if it has NO_COMMISSION_FEE amenity
      const hasNoCommission = property?.amenities?.includes('NO_COMMISSION_FEE');
      console.log('\n🎯 Has NO_COMMISSION_FEE amenity:', hasNoCommission);

      // Check body text
      const $ = load(html);
      const bodyText = $('body').text().toLowerCase();

      console.log('\n📋 Body Text Keywords:');
      const keywords = [
        'provision',
        'provisionsfrei',
        'nettoprovision',
        'von privat',
        'privatverkauf',
        'ohne makler',
        'gmbh',
        'immobilien',
        'makler'
      ];

      for (const kw of keywords) {
        if (bodyText.includes(kw)) {
          console.log(`  ✓ Found: "${kw}"`);
        }
      }

      // Apply scraper filter logic
      console.log('\n🔍 Scraper Filter Analysis:');

      // Stage 1: isPrivateAd check
      if (metaData?.isPrivateAd === false) {
        console.log('  ❌ Would be BLOCKED: isPrivateAd: false');
        continue;
      }

      if (metaData?.isPrivateAd === true) {
        console.log('  ✅ PASS Stage 1: isPrivateAd: true');

        // Double-check for false positives
        if (bodyText.includes('provision: 3') || bodyText.includes('nettoprovision') || bodyText.includes('provisionsaufschlag')) {
          console.log('  ❌ Would be BLOCKED: Has Commission text');
          continue;
        } else {
          console.log('  ✅ PASS Stage 2: No commission text');
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
            console.log(`  ❌ Would be BLOCKED: Commercial company: ${companyName}`);
            continue;
          } else {
            console.log(`  ✅ PASS Stage 3: Company "${companyName}" is OK`);
          }
        } else {
          console.log('  ✅ PASS Stage 3: No company name');
        }

        console.log('\n✅ FINAL: Would be SAVED as Private listing');
      }

    } catch (error: any) {
      console.log(`❌ Error: ${error.message}\n`);
    }

    await new Promise(resolve => setTimeout(resolve, 500));
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
    return null;
  }
}

analyzePrivateListings().catch(console.error);
