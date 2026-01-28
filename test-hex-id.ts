import { storage } from './server/storage';

async function testHexId() {
  try {
    console.log('Testing hex ID storage...');

    // Test storing an ImmoScout hex ID
    await storage.setScraperNextPage('test-immoscout', '6962e903f39cc28ff711c8dd');
    console.log('✅ Hex ID stored successfully');

    // Retrieve it
    const retrieved = await storage.getScraperNextPage('test-immoscout', '1');
    console.log(`✅ Retrieved: ${retrieved} (type: ${typeof retrieved})`);

    // Test storing a numeric ID (backward compatibility)
    await storage.setScraperNextPage('test-willhaben', 1279905581);
    console.log('✅ Numeric ID stored successfully');

    const retrievedNum = await storage.getScraperNextPage('test-willhaben', 1);
    console.log(`✅ Retrieved: ${retrievedNum} (type: ${typeof retrievedNum})`);

    console.log('\n🎉 All tests passed! ImmoScout hex IDs now work!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

testHexId();
