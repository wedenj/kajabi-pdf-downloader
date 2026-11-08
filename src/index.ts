#!/usr/bin/env node

import { chromium, Browser, Page } from 'playwright';
import prompts from 'prompts';
import chalk from 'chalk';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface DownloadStats {
  total: number;
  successful: number;
  failed: number;
  skipped: number;
}

interface PDFLink {
  url: string;
  title: string;
  moduleName: string;
}

interface ScanCache {
  visitedUrls: string[];
  queuedByDepth: { [depth: number]: string[] };
  lastScanDepth: number;
  timestamp: number;
}

class KajabiPDFDownloader {
  private browser: Browser | null = null;
  private page: Page | null = null;
  private downloadsDir: string;
  private debugMode: boolean;
  private maxDepth: number;
  private startDepth: number;
  private forceDownload: boolean;
  private useCache: boolean;
  private cacheFile: string;
  private baseDomain: string = '';
  private stats: DownloadStats = {
    total: 0,
    successful: 0,
    failed: 0,
    skipped: 0,
  };

  constructor(
    downloadsDir: string = './downloads',
    debugMode: boolean = false,
    maxDepth: number = 3,
    startDepth: number = 1,
    forceDownload: boolean = false,
    useCache: boolean = true
  ) {
    this.downloadsDir = path.resolve(downloadsDir);
    this.debugMode = debugMode;
    this.maxDepth = maxDepth;
    this.startDepth = startDepth;
    this.forceDownload = forceDownload;
    this.useCache = useCache;
    this.cacheFile = path.join(this.downloadsDir, '.scan-cache.json');
  }

  async initialize(): Promise<void> {
    console.log(chalk.blue('🚀 Initializing Kajabi PDF Downloader...\n'));
    
    if (this.debugMode) {
      console.log(chalk.yellow('🐛 Debug mode enabled - browser will be visible\n'));
    }

    await fs.mkdir(this.downloadsDir, { recursive: true });

    this.browser = await chromium.launch({
      headless: !this.debugMode,
    });

    this.page = await this.browser.newPage();
    this.page.setDefaultTimeout(60000);
  }

  async login(email: string, password: string, libraryUrl: string): Promise<boolean> {
    if (!this.page) throw new Error('Page not initialized');

    try {
      const libraryUrlObj = new URL(libraryUrl);
      this.baseDomain = libraryUrlObj.hostname;
      
      const baseUrl = libraryUrlObj.origin;
      const loginUrl = `${baseUrl}/login`;

      if (this.debugMode) {
        console.log(chalk.gray(`Library URL: ${libraryUrl}`));
        console.log(chalk.gray(`Login URL: ${loginUrl}\n`));
      }

      console.log(chalk.blue('🔐 Navigating to login page...'));
      await this.page.goto(loginUrl, { waitUntil: 'networkidle', timeout: 30000 });

      console.log(chalk.gray('⏳ Waiting for React to render login form...'));
      
      await this.page.waitForLoadState('networkidle', { timeout: 15000 });
      
      try {
        await this.page.waitForSelector('input[type="password"]', { timeout: 10000, state: 'visible' });
        console.log(chalk.gray('✓ Password field detected, waiting for full form...'));
      } catch (error) {
        console.log(chalk.yellow('⚠️  Password field not found yet, continuing...'));
      }
      
      await this.page.waitForTimeout(2000);

      if (this.debugMode) {
        const html = await this.page.content();
        console.log(chalk.gray(`📄 Page content length: ${html.length} characters`));
        
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const htmlPath = path.join(this.downloadsDir, `debug-login-${timestamp}.html`);
        await fs.writeFile(htmlPath, html);
        console.log(chalk.gray(`📄 Login HTML saved: ${htmlPath}`));
        
        const loginScreenshot = path.join(this.downloadsDir, `debug-login-${timestamp}.png`);
        await this.page.screenshot({ path: loginScreenshot });
        console.log(chalk.gray(`📸 Login page screenshot: ${loginScreenshot}\n`));
      }

      console.log(chalk.blue('🔑 Looking for login form fields...'));

      const emailSelectors = [
        '#member_email',
        'input[name="member\\[email\\]"]',
        'input[type="email"]',
        'input[name="email"]',
        'input[id="email"]',
        'input[placeholder*="email" i]',
        '#user_email',
        '#email',
      ];

      const passwordSelectors = [
        '#member_password',
        'input[name="member\\[password\\]"]',
        'input[type="password"]',
        'input[name="password"]',
        'input[id="password"]',
        'input[placeholder*="password" i]',
        '#user_password',
        '#password',
      ];

      let emailInput = null;
      let passwordInput = null;

      if (this.debugMode) {
        console.log(chalk.gray('\n  Trying email selectors:'));
      }

      for (const selector of emailSelectors) {
        try {
          await this.page.waitForSelector(selector, { timeout: 2000, state: 'visible' });
          emailInput = selector;
          if (this.debugMode) {
            console.log(chalk.green(`    ✓ ${selector} - FOUND`));
          } else {
            console.log(chalk.gray(`  Found email field: ${selector}`));
          }
          break;
        } catch (error) {
          if (this.debugMode) {
            console.log(chalk.gray(`    ✗ ${selector} - not found`));
          }
        }
      }

      if (this.debugMode) {
        console.log(chalk.gray('\n  Trying password selectors:'));
      }

      for (const selector of passwordSelectors) {
        try {
          await this.page.waitForSelector(selector, { timeout: 2000, state: 'visible' });
          passwordInput = selector;
          if (this.debugMode) {
            console.log(chalk.green(`    ✓ ${selector} - FOUND`));
          } else {
            console.log(chalk.gray(`  Found password field: ${selector}`));
          }
          break;
        } catch (error) {
          if (this.debugMode) {
            console.log(chalk.gray(`    ✗ ${selector} - not found`));
          }
        }
      }

      const missingFields = [];
      if (!emailInput) missingFields.push('email');
      if (!passwordInput) missingFields.push('password');

      if (missingFields.length > 0) {
        console.error(chalk.red(`\n✗ Could not find login form field(s): ${missingFields.join(', ')}`));
        
        if (this.debugMode) {
          console.log(chalk.yellow('\n  Attempting to find ANY input fields on page:'));
          const allInputs = await this.page.$$eval('input', (inputs) =>
            inputs.map((input) => ({
              type: input.getAttribute('type'),
              name: input.getAttribute('name'),
              id: input.getAttribute('id'),
              placeholder: input.getAttribute('placeholder'),
              visible: input.offsetParent !== null,
            }))
          );
          
          console.log(chalk.gray(`  Found ${allInputs.length} total input elements:`));
          allInputs.forEach((input, i) => {
            console.log(chalk.gray(`    ${i + 1}. type="${input.type}" name="${input.name}" id="${input.id}" placeholder="${input.placeholder}" visible=${input.visible}`));
          });
        }
        
        return false;
      }

      console.log(chalk.blue('📝 Filling in credentials...'));
      await this.page.fill(emailInput, email);
      await this.page.fill(passwordInput, password);

      if (this.debugMode) {
        console.log(chalk.gray('  Email and password filled'));
      }

      console.log(chalk.blue('🚀 Submitting login form...'));

      const submitSelectors = [
        'button[type="submit"]',
        'input[type="submit"]',
        'button:has-text("Log in")',
        'button:has-text("Sign in")',
        'button:has-text("Login")',
        'button:has-text("Sign In")',
        'button:has-text("Log In")',
        'input[value*="Log" i]',
        'input[value*="Sign" i]',
      ];

      let submitButton = null;
      for (const selector of submitSelectors) {
        try {
          const button = await this.page.$(selector);
          if (button && (await button.isVisible())) {
            submitButton = selector;
            if (this.debugMode) {
              console.log(chalk.gray(`  Found submit button: ${selector}`));
            }
            break;
          }
        } catch (error) {
        }
      }

      if (submitButton) {
        await this.page.click(submitButton);
      } else {
        console.log(chalk.yellow('⚠️  No submit button found, pressing Enter on password field...'));
        await this.page.press(passwordInput, 'Enter');
      }

      console.log(chalk.gray('Waiting for navigation after login...'));
      
      try {
        await this.page.waitForURL(/\/(library|dashboard|products|home)/, { timeout: 10000 });
        console.log(chalk.gray('✓ Navigation detected'));
      } catch (error) {
        console.log(chalk.yellow('⚠️  Navigation timeout, checking current URL...'));
      }

      await this.page.waitForTimeout(1000);

      const currentUrl = this.page.url();
      if (this.debugMode) {
        console.log(chalk.gray(`Current URL after login: ${currentUrl}`));
        const afterLoginScreenshot = path.join(this.downloadsDir, 'debug-after-login.png');
        await this.page.screenshot({ path: afterLoginScreenshot });
        console.log(chalk.gray(`📸 After login screenshot: ${afterLoginScreenshot}\n`));
      }

      const loginSuccessful = await this.checkIfLoggedIn();
      
      if (loginSuccessful) {
        console.log(chalk.green('✓ Login successful\n'));
        
        console.log(chalk.blue('📚 Navigating to library...'));
        await this.page.goto(libraryUrl, { waitUntil: 'networkidle', timeout: 30000 });
        await this.page.waitForTimeout(2000);
        
        return true;
      } else {
        console.log(chalk.red('✗ Login failed - still seeing login page\n'));
        return false;
      }
    } catch (error) {
      console.error(chalk.red(`✗ Login error: ${error}`));
      return false;
    }
  }

  private async checkIfLoggedIn(): Promise<boolean> {
    if (!this.page) return false;

    const currentUrl = this.page.url();
    
    if (currentUrl.includes('/login')) {
      if (this.debugMode) {
        console.log(chalk.gray('  Still on login page'));
      }
      return false;
    }

    const loginIndicators = [
      'input[type="email"][name="email"]',
      'input[type="password"][name="password"]',
      'form[action*="login"]',
    ];

    for (const selector of loginIndicators) {
      try {
        const element = await this.page.$(selector);
        if (element && (await element.isVisible())) {
          if (this.debugMode) {
            console.log(chalk.gray(`  Found login indicator: ${selector}`));
          }
          return false;
        }
      } catch (error) {
      }
    }

    const loggedInIndicators = [
      'a[href*="logout"]',
      'a[href*="sign_out"]',
      'a[href*="signout"]',
      'button:has-text("Log out")',
      'button:has-text("Sign out")',
      '[class*="user-menu"]',
      '[class*="account-menu"]',
      '[data-user]',
    ];

    for (const selector of loggedInIndicators) {
      try {
        const element = await this.page.$(selector);
        if (element && (await element.isVisible())) {
          if (this.debugMode) {
            console.log(chalk.gray(`  Found logged-in indicator: ${selector}`));
          }
          return true;
        }
      } catch (error) {
      }
    }

    if (this.debugMode) {
      console.log(chalk.gray('  No clear indicators, assuming logged in based on URL'));
    }
    return !currentUrl.includes('/login');
  }

  async scanLibrary(): Promise<PDFLink[]> {
    if (!this.page) throw new Error('Page not initialized');

    const depthRange = this.startDepth === this.maxDepth 
      ? `depth ${this.maxDepth}` 
      : `depths ${this.startDepth}-${this.maxDepth}`;
    console.log(chalk.blue(`📚 Scanning library for PDFs (${depthRange})...\n`));

    const pdfLinks: PDFLink[] = [];
    const visitedUrls = new Set<string>();
    const queuedByDepth: { [depth: number]: string[] } = {};

    const cache = await this.loadCache();
    
    if (cache && this.startDepth > 1) {
      for (const url of cache.visitedUrls) {
        visitedUrls.add(url);
      }
      
      console.log(chalk.cyan(`📂 Resuming from cache (${cache.visitedUrls.length} URLs already visited)\n`));
      
      if (cache.queuedByDepth[this.startDepth - 1]) {
        console.log(chalk.cyan(`📋 Starting with ${cache.queuedByDepth[this.startDepth - 1].length} URLs from depth ${this.startDepth - 1}\n`));
      }
    }

    try {
      const currentUrl = this.page.url();
      
      let currentDepth = this.startDepth - 1;
      let currentLevel: string[];

      if (cache && this.startDepth > 1 && cache.queuedByDepth[this.startDepth - 1]) {
        currentLevel = cache.queuedByDepth[this.startDepth - 1];
        console.log(chalk.gray(`Using cached URLs from depth ${this.startDepth - 1} to start depth ${this.startDepth}`));
      } else if (this.startDepth === 1) {
        console.log(chalk.gray('Waiting for React content to load...'));
        
        await this.page.waitForLoadState('networkidle', { timeout: 30000 });
        await this.page.waitForTimeout(3000);

        if (this.debugMode) {
          const screenshotPath = path.join(this.downloadsDir, 'debug-library-page.png');
          await this.page.screenshot({ path: screenshotPath, fullPage: true });
          console.log(chalk.yellow(`📸 Screenshot saved: ${screenshotPath}\n`));
        }

        const pageContent = await this.page.content();
        if (this.debugMode) {
          const htmlPath = path.join(this.downloadsDir, 'debug-library-page.html');
          await fs.writeFile(htmlPath, pageContent);
          console.log(chalk.yellow(`📄 HTML saved: ${htmlPath}\n`));
        }
        
        currentLevel = [currentUrl];
      } else {
        console.log(chalk.red(`\n❌ Error: No cached URLs for depth ${this.startDepth - 1}`));
        console.log(chalk.yellow(`   Run with --start-depth 1 --max-depth ${this.startDepth - 1} first\n`));
        return pdfLinks;
      }

      while (currentDepth < this.maxDepth && currentLevel.length > 0) {
        console.log(chalk.blue(`\n${'='.repeat(60)}`));
        console.log(chalk.blue(`📊 Level ${currentDepth + 1} Scan: ${currentLevel.length} page(s) to check`));
        console.log(chalk.blue('='.repeat(60) + '\n'));

        const nextLevel: string[] = [];

        for (let i = 0; i < currentLevel.length; i++) {
          const url = currentLevel[i];
          
          if (visitedUrls.has(url)) {
            if (this.debugMode) {
              console.log(chalk.gray(`Skipping already visited: ${url}`));
            }
            continue;
          }

          try {
            console.log(chalk.cyan(`\n[${i + 1}/${currentLevel.length}] Visiting page...`));
            console.log(chalk.gray(`  URL: ${url}`));

            await this.page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
            await this.page.waitForTimeout(2000);

            if (this.debugMode) {
              const screenshot = path.join(this.downloadsDir, `debug-depth${currentDepth + 1}-page${i + 1}.png`);
              await this.page.screenshot({ path: screenshot });
              console.log(chalk.gray(`  📸 Screenshot: ${screenshot}`));
            }

            console.log(chalk.gray(`  Scanning for content links...`));
            const contentLinks = await this.discoverContentLinks();
            
            const newLinks = contentLinks.filter((link) => !visitedUrls.has(link));
            console.log(chalk.gray(`  Found ${contentLinks.length} content links (${newLinks.length} new)`));
            
            visitedUrls.add(url);

            if (newLinks.length > 0 && this.debugMode) {
              console.log(chalk.gray(`  New links to visit:`));
              newLinks.slice(0, 5).forEach((link, idx) => {
                const truncated = link.length > 80 ? link.substring(0, 77) + '...' : link;
                console.log(chalk.gray(`    ${idx + 1}. ${truncated}`));
              });
              if (newLinks.length > 5) {
                console.log(chalk.gray(`    ... and ${newLinks.length - 5} more`));
              }
            }

            nextLevel.push(...newLinks);

            console.log(chalk.gray(`  Checking for PDFs on this page...`));
            const pagePDFs = await this.findPDFsOnPage(`Level ${currentDepth + 1} Page ${i + 1}`, i + 1);

            if (pagePDFs.length > 0) {
              pdfLinks.push(...pagePDFs);
              console.log(chalk.green(`  ✓ Found ${pagePDFs.length} PDF(s)!`));
              pagePDFs.forEach((pdf, idx) => {
                console.log(chalk.green(`    ${idx + 1}. ${pdf.title}`));
                if (this.debugMode) {
                  console.log(chalk.gray(`       ${pdf.url}`));
                }
              });
            } else {
              console.log(chalk.gray(`  No PDFs on this page`));
            }
          } catch (error) {
            console.log(chalk.red(`  ✗ Error: ${error}`));
          }
        }

        currentLevel = [...new Set(nextLevel)];
        queuedByDepth[currentDepth + 1] = currentLevel;
        currentDepth++;

        if (currentLevel.length > 0) {
          console.log(chalk.cyan(`\n📋 Level ${currentDepth + 1} will have ${currentLevel.length} pages to scan`));
        }
      }

      await this.saveCache(visitedUrls, queuedByDepth, currentDepth);

      const depthReached = currentLevel.length > 0 && currentDepth >= this.maxDepth;
      
      console.log(chalk.green(`\n${'='.repeat(60)}`));
      console.log(chalk.green(`✓ Scan complete!`));
      console.log(chalk.green(`  Visited: ${visitedUrls.size} pages`));
      console.log(chalk.green(`  Found: ${pdfLinks.length} PDFs`));
      console.log(chalk.green(`  Depth: ${currentDepth}/${this.maxDepth} ${depthReached ? '(max reached)' : '(stopped early)'}`));
      if (depthReached && currentLevel.length > 0) {
        console.log(chalk.yellow(`  ⚠️  ${currentLevel.length} more links were found at max depth`));
        console.log(chalk.yellow(`  ⚠️  Try --max-depth ${this.maxDepth + 1} to scan deeper`));
      }
      console.log(chalk.green('='.repeat(60) + '\n'));
    } catch (error) {
      console.error(chalk.red(`Error during library scan: ${error}`));
    }

    return pdfLinks;
  }

  private async discoverContentLinks(): Promise<string[]> {
    if (!this.page) return [];

    try {
      const links = await this.page.$$eval('a[href]', (anchors) =>
        anchors
          .map((a) => (a as HTMLAnchorElement).href)
          .filter((href) => href && href.startsWith('http'))
      );

      const contentLinks: string[] = [];
      let externalLinksSkipped = 0;

      for (const link of links) {
        try {
          const url = new URL(link);
          
          if (url.hostname !== this.baseDomain) {
            externalLinksSkipped++;
            if (this.debugMode && externalLinksSkipped <= 5) {
              console.log(chalk.gray(`  ⏭️  Skipping external link: ${link}`));
            }
            continue;
          }

          if (this.looksLikeContentLink(link)) {
            contentLinks.push(link);
          }
        } catch (error) {
          // Invalid URL, skip
        }
      }

      if (externalLinksSkipped > 0 && this.debugMode) {
        console.log(chalk.gray(`  ⏭️  Total external links skipped: ${externalLinksSkipped}`));
      }

      return [...new Set(contentLinks)];
    } catch (error) {
      console.error(chalk.yellow(`Error discovering content links: ${error}`));
      return [];
    }
  }

  private looksLikeContentLink(url: string): boolean {
    const lowerUrl = url.toLowerCase();
    
    const excludePatterns = [
      '/library#',
      '/home',
      '/settings',
      '/logout',
      '/sign_out',
      '/store',
      '/cart',
      '/checkout',
    ];
    
    for (const pattern of excludePatterns) {
      if (lowerUrl.includes(pattern)) {
        return false;
      }
    }
    
    if (lowerUrl.endsWith('/library') || lowerUrl.endsWith('/library/')) {
      return false;
    }
    
    const contentPatterns = [
      '/library/',
      '/courses/',
      '/products/',
      '/posts/',
      '/categories/',
      '/module',
      '/lesson',
      '/content/',
    ];
    
    for (const pattern of contentPatterns) {
      if (lowerUrl.includes(pattern)) {
        return true;
      }
    }
    
    return false;
  }

  private isPdfLink(url: string): boolean {
    if (!url) return false;
    
    const lowerUrl = url.toLowerCase();
    
    return (
      lowerUrl.includes('.pdf') ||
      lowerUrl.endsWith('-pdf') ||
      lowerUrl.includes('/downloads/') ||
      /\/pdf[\/\?]/.test(lowerUrl) ||
      lowerUrl.includes('pdf_download') ||
      lowerUrl.includes('pdfdownload')
    );
  }

  private async findPDFsOnPage(moduleName: string, moduleIndex?: number): Promise<PDFLink[]> {
    if (!this.page) return [];

    const pdfLinks: PDFLink[] = [];

    try {
      const links = await this.page.$$eval('a', (anchors) =>
        anchors
          .map((a) => ({
            href: a.href,
            text: a.textContent?.trim() || '',
          }))
          .filter((link) => link.href)
      );

      console.log(chalk.gray(`  Found ${links.length} total links on page`));

      if (this.debugMode && links.length > 0) {
        console.log(chalk.gray(`  Sample links (first 10):`));
        links.slice(0, 10).forEach((link, i) => {
          const truncated = link.href.length > 80 ? link.href.substring(0, 77) + '...' : link.href;
          console.log(chalk.gray(`    ${i + 1}. ${truncated}`));
        });
      }

      let pdfLinkCount = 0;
      for (const link of links) {
        if (this.isPdfLink(link.href)) {
          pdfLinkCount++;
          const detectionMethod = this.getPdfDetectionMethod(link.href);
          
          pdfLinks.push({
            url: link.href,
            title: link.text || 'Untitled',
            moduleName,
          });

          if (this.debugMode) {
            console.log(chalk.green(`  PDF detected via ${detectionMethod}: ${link.href}`));
          }
        }
      }

      console.log(chalk.gray(`  Links matching PDF patterns: ${pdfLinkCount}`));

      const iframes = await this.page.$$('iframe');
      if (iframes.length > 0) {
        console.log(chalk.gray(`  Checking ${iframes.length} iframe(s)...`));
      }

      for (const iframe of iframes) {
        try {
          const src = await iframe.getAttribute('src');
          if (src && this.isPdfLink(src)) {
            const detectionMethod = this.getPdfDetectionMethod(src);
            pdfLinks.push({
              url: src,
              title: 'Embedded PDF',
              moduleName,
            });
            if (this.debugMode) {
              console.log(chalk.green(`  PDF detected in iframe via ${detectionMethod}: ${src}`));
            }
          }
        } catch (error) {
        }
      }

      const embedElements = await this.page.$$('embed[type="application/pdf"], object[type="application/pdf"]');
      if (embedElements.length > 0) {
        console.log(chalk.gray(`  Checking ${embedElements.length} embed/object element(s)...`));
      }

      for (const element of embedElements) {
        try {
          const src = await element.getAttribute('src');
          const data = await element.getAttribute('data');
          const url = src || data;
          if (url && this.isPdfLink(url)) {
            const detectionMethod = this.getPdfDetectionMethod(url);
            pdfLinks.push({
              url,
              title: 'Embedded PDF Object',
              moduleName,
            });
            if (this.debugMode) {
              console.log(chalk.green(`  PDF detected in embed via ${detectionMethod}: ${url}`));
            }
          }
        } catch (error) {
        }
      }
    } catch (error) {
      console.error(chalk.yellow(`  Error finding PDFs on page: ${error}`));
    }

    return pdfLinks;
  }

  private getPdfDetectionMethod(url: string): string {
    const lowerUrl = url.toLowerCase();
    if (lowerUrl.includes('.pdf')) return '.pdf extension';
    if (lowerUrl.endsWith('-pdf')) return '-pdf ending';
    if (lowerUrl.includes('/downloads/')) return '/downloads/ path';
    if (/\/pdf[\/\?]/.test(lowerUrl)) return '/pdf/ directory';
    if (lowerUrl.includes('pdf_download')) return 'pdf_download pattern';
    if (lowerUrl.includes('pdfdownload')) return 'pdfdownload pattern';
    return 'unknown';
  }

  async downloadPDFs(pdfLinks: PDFLink[]): Promise<void> {
    if (!this.page) throw new Error('Page not initialized');

    console.log(chalk.blue(`📥 Starting download of ${pdfLinks.length} PDFs...\n`));

    this.stats.total = pdfLinks.length;

    for (let i = 0; i < pdfLinks.length; i++) {
      const pdf = pdfLinks[i];
      const progress = `[${i + 1}/${pdfLinks.length}]`;

      try {
        console.log(chalk.cyan(`${progress} ${pdf.title} (${pdf.moduleName})`));

        const sanitizedModule = this.sanitizeFilename(pdf.moduleName);
        const sanitizedTitle = this.sanitizeFilename(pdf.title);
        const filename = `${sanitizedModule}_${sanitizedTitle}.pdf`;
        const filepath = path.join(this.downloadsDir, filename);

        if (!this.forceDownload) {
          try {
            await fs.access(filepath);
            console.log(chalk.gray(`  ⏭️  Already downloaded, skipping`));
            this.stats.skipped++;
            continue;
          } catch {
          }
        }

        console.log(chalk.gray(`  📥 Downloading...`));
        const downloaded = await this.downloadWithRetry(pdf.url, filepath);

        if (downloaded) {
          console.log(chalk.green(`  ✓ Downloaded successfully`));
          this.stats.successful++;
        } else {
          console.log(chalk.red(`  ✗ Download failed`));
          this.stats.failed++;
        }
      } catch (error) {
        console.error(chalk.red(`  ✗ Error: ${error}`));
        this.stats.failed++;
      }

      await this.page.waitForTimeout(500);
    }

    this.printStats();
  }

  private async downloadWithRetry(url: string, filepath: string, maxRetries: number = 3): Promise<boolean> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        if (!this.page) throw new Error('Page not initialized');

        const response = await this.page.context().request.get(url);

        if (response.ok()) {
          const buffer = await response.body();
          await fs.writeFile(filepath, buffer);
          return true;
        } else if (attempt < maxRetries) {
          console.log(chalk.yellow(`    Retry ${attempt}/${maxRetries - 1}...`));
          await this.page.waitForTimeout(1000 * attempt);
        }
      } catch (error) {
        if (attempt < maxRetries) {
          console.log(chalk.yellow(`    Retry ${attempt}/${maxRetries - 1} after error...`));
          await this.page!.waitForTimeout(1000 * attempt);
        }
      }
    }
    return false;
  }

  private sanitizeFilename(name: string): string {
    return name
      .replace(/[^a-z0-9\s\-_]/gi, '')
      .replace(/\s+/g, '_')
      .substring(0, 50);
  }

  private printStats(): void {
    console.log(chalk.blue('\n' + '='.repeat(50)));
    console.log(chalk.bold('📊 Download Statistics:'));
    console.log(chalk.blue('='.repeat(50)));
    console.log(chalk.white(`Total PDFs found:        ${this.stats.total}`));
    console.log(chalk.green(`Downloaded (new):        ${this.stats.successful}`));
    console.log(chalk.gray(`Skipped (already exist): ${this.stats.skipped}`));
    console.log(chalk.red(`Failed:                  ${this.stats.failed}`));
    console.log(chalk.blue('='.repeat(50)));
    
    if (this.stats.skipped > 0 && !this.forceDownload) {
      console.log(chalk.gray('\n💡 Tip: Use --force to re-download existing files'));
    }
    console.log('');
  }

  async cleanup(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
    }
  }

  private async loadCache(): Promise<ScanCache | null> {
    if (!this.useCache) return null;

    try {
      const cacheData = await fs.readFile(this.cacheFile, 'utf-8');
      const cache: ScanCache = JSON.parse(cacheData);
      
      if (this.debugMode) {
        console.log(chalk.gray(`📂 Loaded cache from ${this.cacheFile}`));
        console.log(chalk.gray(`   Visited URLs: ${cache.visitedUrls.length}`));
        console.log(chalk.gray(`   Last scan depth: ${cache.lastScanDepth}`));
        const depths = Object.keys(cache.queuedByDepth);
        if (depths.length > 0) {
          console.log(chalk.gray(`   Queued depths: ${depths.join(', ')}`));
        }
      }
      
      return cache;
    } catch (error) {
      if (this.debugMode) {
        console.log(chalk.gray('📂 No cache found, starting fresh'));
      }
      return null;
    }
  }

  private async saveCache(visitedUrls: Set<string>, queuedByDepth: { [depth: number]: string[] }, lastDepth: number): Promise<void> {
    if (!this.useCache) return;

    const cache: ScanCache = {
      visitedUrls: Array.from(visitedUrls),
      queuedByDepth,
      lastScanDepth: lastDepth,
      timestamp: Date.now(),
    };

    try {
      await fs.writeFile(this.cacheFile, JSON.stringify(cache, null, 2), 'utf-8');
      if (this.debugMode) {
        console.log(chalk.gray(`\n💾 Saved cache to ${this.cacheFile}`));
      }
    } catch (error) {
      console.error(chalk.yellow(`⚠️  Failed to save cache: ${error}`));
    }
  }
}

async function main() {
  console.clear();
  console.log(chalk.bold.blue('╔════════════════════════════════════════╗'));
  console.log(chalk.bold.blue('║   Kajabi PDF Downloader v1.0.0        ║'));
  console.log(chalk.bold.blue('╚════════════════════════════════════════╝\n'));

  const debugMode = process.argv.includes('--debug');
  const forceDownload = process.argv.includes('--force');
  const useCache = !process.argv.includes('--no-cache');
  
  let maxDepth = 3;
  const maxDepthIndex = process.argv.indexOf('--max-depth');
  if (maxDepthIndex !== -1 && process.argv[maxDepthIndex + 1]) {
    const parsedDepth = parseInt(process.argv[maxDepthIndex + 1], 10);
    if (!isNaN(parsedDepth) && parsedDepth > 0) {
      maxDepth = parsedDepth;
    } else {
      console.log(chalk.red('❌ Invalid --max-depth value. Using default: 3\n'));
    }
  }

  let startDepth = 1;
  const startDepthIndex = process.argv.indexOf('--start-depth');
  if (startDepthIndex !== -1 && process.argv[startDepthIndex + 1]) {
    const parsedDepth = parseInt(process.argv[startDepthIndex + 1], 10);
    if (!isNaN(parsedDepth) && parsedDepth > 0) {
      startDepth = parsedDepth;
    } else {
      console.log(chalk.red('❌ Invalid --start-depth value. Using default: 1\n'));
    }
  }

  if (startDepth > maxDepth) {
    console.log(chalk.red(`❌ Error: --start-depth (${startDepth}) cannot be greater than --max-depth (${maxDepth})\n`));
    process.exit(1);
  }

  console.log(chalk.gray('Configuration:'));
  if (debugMode) {
    console.log(chalk.yellow('  🐛 Debug mode: enabled'));
  }
  const depthRange = startDepth === maxDepth 
    ? `${maxDepth}` 
    : startDepth === 1 
      ? `1-${maxDepth}` 
      : `${startDepth}-${maxDepth}`;
  console.log(chalk.gray(`  📊 Scan depth: ${depthRange} levels`));
  if (forceDownload) {
    console.log(chalk.yellow('  🔄 Force download: enabled (will re-download existing files)'));
  }
  if (!useCache) {
    console.log(chalk.yellow('  🚫 Cache disabled: starting fresh'));
  }
  console.log('');

  const response = await prompts([
    {
      type: 'text',
      name: 'email',
      message: 'Enter your Kajabi email:',
      validate: (value) => (value.includes('@') ? true : 'Please enter a valid email'),
    },
    {
      type: 'password',
      name: 'password',
      message: 'Enter your password:',
      validate: (value) => (value.length > 0 ? true : 'Password cannot be empty'),
    },
    {
      type: 'text',
      name: 'libraryUrl',
      message: 'Enter the library URL:',
      initial: 'https://www.newdawnkitchen.com/library',
      validate: (value) => (value.startsWith('http') ? true : 'Please enter a valid URL'),
    },
    {
      type: 'text',
      name: 'downloadsDir',
      message: 'Enter download directory:',
      initial: './downloads',
    },
  ]);

  if (!response.email || !response.password) {
    console.log(chalk.red('\n❌ Operation cancelled\n'));
    process.exit(0);
  }

  const downloader = new KajabiPDFDownloader(response.downloadsDir, debugMode, maxDepth, startDepth, forceDownload, useCache);

  try {
    await downloader.initialize();

    const loginSuccess = await downloader.login(response.email, response.password, response.libraryUrl);
    if (!loginSuccess) {
      throw new Error('Login failed. Please check your credentials.');
    }

    const pdfLinks = await downloader.scanLibrary();

    if (pdfLinks.length === 0) {
      console.log(chalk.yellow('⚠ No PDFs found in the library\n'));
      await downloader.cleanup();
      process.exit(0);
    }

    const confirmDownload = await prompts({
      type: 'confirm',
      name: 'proceed',
      message: `Found ${pdfLinks.length} PDFs. Proceed with download?`,
      initial: true,
    });

    if (!confirmDownload.proceed) {
      console.log(chalk.yellow('\n⚠ Download cancelled by user\n'));
      await downloader.cleanup();
      process.exit(0);
    }

    await downloader.downloadPDFs(pdfLinks);

    console.log(chalk.green(`\n✅ All done! PDFs saved to: ${response.downloadsDir}\n`));
  } catch (error) {
    console.error(chalk.red(`\n❌ Error: ${error}\n`));
    process.exit(1);
  } finally {
    await downloader.cleanup();
  }
}

main().catch((error) => {
  console.error(chalk.red(`\n❌ Fatal error: ${error}\n`));
  process.exit(1);
});
