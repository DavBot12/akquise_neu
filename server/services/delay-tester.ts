import axios, { AxiosInstance } from 'axios';

interface DelayTestResult {
  delay: number;
  success: boolean;
  statusCode: number;
  error?: string;
}

export class DelayTesterService {
  private axiosInstance: AxiosInstance;
  private sessionCookies: string = '';

  constructor() {
    this.axiosInstance = axios.create({
      timeout: 30000,
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
  }

  async findMinimumDelay(onProgress: (msg: string) => void): Promise<number> {
    // Test verschiedene Delays in aufsteigender Reihenfolge
    const delaysToTest = [1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 10000, 12000, 15000];
    const testUrl = 'https://www.willhaben.at/iad/immobilien/eigentumswohnung/eigentumswohnung-angebote?areaId=900&rows=25&SELLER_TYPE=PRIVATE&page=1';
    
    onProgress('🔬 DELAY-TEST STARTET - Finde minimum Rate-Limit-Schwelle');
    
    // Erst Session etablieren
    await this.establishSession(onProgress);
    
    let minimumWorkingDelay = -1;
    
    for (const delay of delaysToTest) {
      onProgress(`⏱️ Teste Delay: ${delay}ms`);
      
      try {
        // 3 aufeinanderfolgende Requests mit diesem Delay
        for (let i = 1; i <= 3; i++) {
          onProgress(`   Request ${i}/3 mit ${delay}ms Delay...`);
          
          const response = await this.axiosInstance.get(testUrl, {
            headers: {
              'Cookie': this.sessionCookies,
              'Referer': i === 1 ? 'https://www.willhaben.at/' : testUrl
            }
          });
          
          if (response.status === 200) {
            onProgress(`   ✅ Request ${i}: 200 OK`);
          } else {
            onProgress(`   ⚠️ Request ${i}: Status ${response.status}`);
          }
          
          // Delay zwischen Requests
          if (i < 3) {
            await new Promise(resolve => setTimeout(resolve, delay));
          }
        }
        
        onProgress(`✅ ERFOLG: ${delay}ms funktioniert ohne Rate-Limiting!`);
        minimumWorkingDelay = delay;
        break; // Erstes funktionierendes Delay gefunden
        
      } catch (error: any) {
        if (error.response?.status === 429) {
          onProgress(`❌ RATE-LIMIT: ${delay}ms zu kurz (429 Error)`);
          
          // Nach Rate-Limit längere Pause
          onProgress(`   ⏰ Recovery-Pause: 30s`);
          await new Promise(resolve => setTimeout(resolve, 30000));
          
          // Session refreshen
          await this.establishSession(onProgress);
          
        } else {
          onProgress(`❌ FEHLER: ${delay}ms - ${error.message}`);
        }
      }
      
      // Pause zwischen verschiedenen Delay-Tests
      if (delay < delaysToTest[delaysToTest.length - 1]) {
        onProgress(`   🔄 Nächster Test in 5s...`);
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }
    
    if (minimumWorkingDelay > 0) {
      onProgress(`🎯 MINIMUM DELAY GEFUNDEN: ${minimumWorkingDelay}ms`);
      onProgress(`💡 EMPFEHLUNG: Nutze ${minimumWorkingDelay + 1000}ms für Sicherheit`);
    } else {
      onProgress(`❌ KEIN FUNKTIONIERENDES DELAY GEFUNDEN - Rate-Limiting zu aggressiv`);
      minimumWorkingDelay = 15000; // Fallback
    }
    
    return minimumWorkingDelay;
  }

  private async establishSession(onProgress: (msg: string) => void): Promise<void> {
    try {
      onProgress('🔐 Session etablieren...');
      
      const response = await this.axiosInstance.get('https://www.willhaben.at');
      
      const cookies = response.headers['set-cookie'];
      if (cookies) {
        this.sessionCookies = cookies.map(cookie => cookie.split(';')[0]).join('; ');
        onProgress('✅ Session etabliert');
      }
      
      await new Promise(resolve => setTimeout(resolve, 2000));
      
    } catch (error) {
      onProgress('⚠️ Session-Fehler, trotzdem weiter...');
    }
  }

  // Schneller Test mit nur 2 Requests
  async quickDelayTest(delay: number, onProgress: (msg: string) => void): Promise<boolean> {
    const testUrl = 'https://www.willhaben.at/iad/immobilien/eigentumswohnung/eigentumswohnung-angebote?areaId=900&rows=25&SELLER_TYPE=PRIVATE&page=1';
    
    try {
      onProgress(`⚡ QUICK-TEST: ${delay}ms`);
      
      // 2 Requests mit dem Delay
      for (let i = 1; i <= 2; i++) {
        const response = await this.axiosInstance.get(testUrl, {
          headers: {
            'Cookie': this.sessionCookies,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          }
        });
        
        if (response.status === 200) {
          onProgress(`   ✅ Request ${i}: OK`);
        }
        
        if (i === 1) {
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
      
      onProgress(`✅ QUICK-TEST ERFOLG: ${delay}ms funktioniert!`);
      return true;
      
    } catch (error: any) {
      if (error.response?.status === 429) {
        onProgress(`❌ QUICK-TEST FAIL: ${delay}ms - Rate limited`);
      } else {
        onProgress(`❌ QUICK-TEST ERROR: ${error.message}`);
      }
      return false;
    }
  }
}