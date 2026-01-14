import { HttpsProxyAgent } from 'https-proxy-agent';

/**
 * Proxy Manager - Zentrale Proxy-Rotation für alle Scraper
 * Rotiert zwischen 3 statischen ISP-Proxies
 */

interface ProxyConfig {
  host: string;
  port: number;
  username: string;
  password: string;
}

class ProxyManager {
  private proxies: ProxyConfig[] = [];
  private agents: HttpsProxyAgent<string>[] = [];
  private currentIndex = 0;
  private requestCounts: number[] = [0, 0];
  private isDev: boolean;

  constructor() {
    this.isDev = process.env.NODE_ENV === 'development';

    if (this.isDev) {
      console.log('[PROXY] 🔧 Dev mode - proxies DISABLED (direct connection)');
      return; // Skip proxy setup in dev mode
    }

    this.loadProxies();
    this.createAgents();
  }

  private loadProxies() {
    // Format: host:port:username:password
    // Note: 212.236.113.167 doesn't work with willhaben.at
    const proxyStrings = [
      process.env.PROXY_1 || '45.90.51.94:12323:14a124ae50f85:3e53430ca1',
      process.env.PROXY_2 || '45.90.50.157:12323:14a124ae50f85:3e53430ca1',
    ];

    this.proxies = proxyStrings.map(str => {
      const [host, port, username, password] = str.split(':');
      return { host, port: parseInt(port), username, password };
    });

    console.log(`[PROXY] Loaded ${this.proxies.length} proxies`);
  }

  private createAgents() {
    // Erstelle vorgecachte Agents mit keepAlive für bessere Performance
    this.agents = this.proxies.map(proxy => {
      const proxyUrl = `http://${proxy.username}:${proxy.password}@${proxy.host}:${proxy.port}`;
      return new HttpsProxyAgent(proxyUrl, {
        keepAlive: true,
        keepAliveMsecs: 30000,
        timeout: 60000
      });
    });
    console.log(`[PROXY] Created ${this.agents.length} persistent agents`);
  }

  /**
   * Gibt den nächsten Proxy in der Rotation zurück
   * Returns undefined in dev mode
   */
  getNextProxy(): ProxyConfig | undefined {
    if (this.isDev) return undefined;

    const proxy = this.proxies[this.currentIndex];
    this.requestCounts[this.currentIndex]++;
    this.currentIndex = (this.currentIndex + 1) % this.proxies.length;
    return proxy;
  }

  /**
   * Gibt die Proxy-URL für axios zurück
   * Returns undefined in dev mode
   */
  getProxyUrl(): string | undefined {
    if (this.isDev) return undefined;

    const proxy = this.getNextProxy()!;
    return `http://${proxy.username}:${proxy.password}@${proxy.host}:${proxy.port}`;
  }

  /**
   * Gibt einen vorgecachten HttpsProxyAgent für axios/fetch zurück (mit Rotation)
   * Returns undefined in dev mode (direct connection)
   */
  getProxyAgent(): HttpsProxyAgent<string> | undefined {
    if (this.isDev) return undefined; // Direct connection in dev mode

    const index = this.currentIndex;
    this.requestCounts[index]++;
    this.currentIndex = (this.currentIndex + 1) % this.agents.length;
    return this.agents[index];
  }

  /**
   * Gibt axios-kompatible Proxy-Config zurück
   * Returns undefined in dev mode
   */
  getAxiosProxyConfig(): { host: string; port: number; auth: { username: string; password: string } } | undefined {
    if (this.isDev) return undefined;

    const proxy = this.getNextProxy()!;
    return {
      host: proxy.host,
      port: proxy.port,
      auth: {
        username: proxy.username,
        password: proxy.password
      }
    };
  }

  /**
   * Statistiken über Proxy-Nutzung
   */
  getStats() {
    return {
      totalRequests: this.requestCounts.reduce((a, b) => a + b, 0),
      perProxy: this.proxies.map((p, i) => ({
        host: p.host,
        requests: this.requestCounts[i]
      }))
    };
  }

  /**
   * Prüft ob Proxies konfiguriert und aktiv sind
   * Returns false in dev mode
   */
  isEnabled(): boolean {
    if (this.isDev) return false;
    return this.proxies.length > 0 && this.proxies[0].host !== '';
  }
}

// Singleton-Export
export const proxyManager = new ProxyManager();
