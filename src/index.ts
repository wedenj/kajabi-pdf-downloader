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

class KajabiPDFDownloader {
  private browser: Browser | null = null;
  private page: Page | null = null;
  private downloadsDir: string;
  private debugMode: boolean;
  private stats: DownloadStats = {
    total: 0,
    successful: 0,
    failed: 0,
    skipped: 0,
  };

  constructor(downloadsDir: string = './downloads', debugMode: boolean = false) {
    this.downloadsDir = path.resolve(downloadsDir);
    this.debugMode = debugMode;
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
      const baseUrl = new URL(libraryUrl).origin;
      const loginUrl = `${baseUrl}/login`;

      if (this.debugMode) {
        console.log(chalk.gray(`Library URL: ${libraryUrl}`));
        console.log(chalk.gray(`Login URL: ${loginUrl}\n`));
      }

      console.log(chalk.blue('🔐 Navigating to login page...'));
      await this.page.goto(loginUrl, { waitUntil: 'networkidle', timeout: 30000 });

      if (this.debugMode) {
        const loginScreenshot = path.join(this.downloadsDir, 'debug-login-page.png');
        await this.page.screenshot({ path: loginScreenshot });
        console.log(chalk.gray(`📸 Login page screenshot: ${loginScreenshot}\n`));
      }

      console.log(chalk.blue('🔑 Looking for login form...'));

      const emailSelectors = [
        'input[type="email"]',
        'input[name="email"]',
        'input[id="email"]',
        'input[placeholder*="email" i]',
        '#user_email',
        '#email',
      ];

      const passwordSelectors = [
        'input[type="password"]',
        'input[name="password"]',
        'input[id="password"]',
        'input[placeholder*="password" i]',
        '#user_password',
        '#password',
      ];

      let emailInput = null;
      let passwordInput = null;

      for (const selector of emailSelectors) {
        try {
          await this.page.waitForSelector(selector, { timeout: 2000, state: 'visible' });
          emailInput = selector;
          if (this.debugMode) {
            console.log(chalk.gray(`  Found email field: ${selector}`));
          }
          break;
        } catch (error) {
        }
      }

      for (const selector of passwordSelectors) {
        try {
          await this.page.waitForSelector(selector, { timeout: 2000, state: 'visible' });
          passwordInput = selector;
          if (this.debugMode) {
            console.log(chalk.gray(`  Found password field: ${selector}`));
          }
          break;
        } catch (error) {
        }
      }

      if (!emailInput || !passwordInput) {
        console.error(chalk.red('✗ Could not find login form fields'));
        if (this.debugMode) {
          const html = await this.page.content();
          const htmlPath = path.join(this.downloadsDir, 'debug-login-page.html');
          await fs.writeFile(htmlPath, html);
          console.log(chalk.gray(`📄 Login HTML saved: ${htmlPath}`));
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
        const button = await this.page.$(selector);
        if (button && (await button.isVisible())) {
          submitButton = selector;
          if (this.debugMode) {
            console.log(chalk.gray(`  Found submit button: ${selector}`));
          }
          break;
        }
      }

      if (!submitButton) {
        console.log(chalk.yellow('⚠️  No submit button found, trying form submit...'));
        await this.page.evaluate(() => {
          const form = document.querySelector('form');
          if (form) form.submit();
        });
      } else {
        await this.page.click(submitButton);
      }

      console.log(chalk.gray('Waiting for navigation after login...'));
      
      try {
        await this.page.waitForNavigation({ waitUntil: 'networkidle', timeout: 30000 });
      } catch (error) {
        console.log(chalk.yellow('⚠️  Navigation timeout, checking if logged in anyway...'));
      }

      await this.page.waitForTimeout(2000);

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

    console.log(chalk.blue('📚 Scanning library for PDFs...\n'));

    const pdfLinks: PDFLink[] = [];

    try {
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

      const selectors = [
        'a[href*="/library/"]',
        'a[href*="/courses/"]',
        'a[href*="/module"]',
        'a[href*="lesson"]',
        'a[href*="content"]',
        'a.course-link',
        'a.lesson-link',
        'a.module-link',
        'div[class*="course"] a',
        'div[class*="lesson"] a',
        'div[class*="module"] a',
        '[data-course] a',
        '[data-lesson] a',
      ];

      console.log(chalk.gray('Trying multiple selector patterns...\n'));

      let allLinks: Array<{ url: string; text: string }> = [];

      for (const selector of selectors) {
        try {
          const links = await this.page.$$eval(selector, (elements) =>
            elements
              .map((el) => ({
                url: (el as HTMLAnchorElement).href,
                text: el.textContent?.trim() || '',
              }))
              .filter((link) => link.url && link.text && link.url !== window.location.href)
          );

          if (links.length > 0 && this.debugMode) {
            console.log(chalk.gray(`  Selector "${selector}": found ${links.length} links`));
          }

          allLinks.push(...links);
        } catch (error) {
        }
      }

      const linksByUrl = new Map<string, { url: string; text: string }>();
      for (const link of allLinks) {
        if (!linksByUrl.has(link.url) && this.looksLikeContentLink(link.url)) {
          linksByUrl.set(link.url, link);
        }
      }

      const moduleLinks = Array.from(linksByUrl.values());

      console.log(chalk.cyan(`\nFound ${moduleLinks.length} potential module/content links\n`));

      if (moduleLinks.length === 0) {
        console.log(chalk.yellow('⚠️  No module links found. Checking all links on page...'));
        
        const allPageLinks = await this.page.$$eval('a[href]', (elements) =>
          elements
            .map((el) => ({
              url: (el as HTMLAnchorElement).href,
              text: el.textContent?.trim() || '',
            }))
            .filter((link) => link.url && link.text)
        );

        console.log(chalk.gray(`Total links on page: ${allPageLinks.length}`));
        
        if (this.debugMode && allPageLinks.length > 0) {
          console.log(chalk.gray('\nSample links:'));
          allPageLinks.slice(0, 10).forEach((link, i) => {
            console.log(chalk.gray(`  ${i + 1}. ${link.text} -> ${link.url}`));
          });
        }

        for (const link of allPageLinks) {
          if (this.looksLikeContentLink(link.url)) {
            moduleLinks.push(link);
          }
        }
        
        console.log(chalk.cyan(`After filtering: ${moduleLinks.length} content links\n`));
      }

      let moduleCount = 0;
      for (const link of moduleLinks) {
        try {
          moduleCount++;
          console.log(chalk.gray(`[${moduleCount}/${moduleLinks.length}] Checking: ${link.text}`));

          await this.page.goto(link.url, { waitUntil: 'networkidle', timeout: 30000 });
          await this.page.waitForTimeout(2000);

          const pagePDFs = await this.findPDFsOnPage(link.text);
          pdfLinks.push(...pagePDFs);

          if (pagePDFs.length > 0) {
            console.log(chalk.green(`  ✓ Found ${pagePDFs.length} PDF(s)`));
          }
        } catch (error) {
          console.log(chalk.yellow(`  ⚠ Error scanning ${link.text}: ${error}`));
        }
      }

      console.log(chalk.green(`\n✓ Scan complete: Found ${pdfLinks.length} PDFs\n`));
    } catch (error) {
      console.error(chalk.red(`Error during library scan: ${error}`));
    }

    return pdfLinks;
  }

  private looksLikeContentLink(url: string): boolean {
    const lowerUrl = url.toLowerCase();
    return (
      (lowerUrl.includes('/library/') ||
        lowerUrl.includes('/courses/') ||
        lowerUrl.includes('/module') ||
        lowerUrl.includes('/lesson') ||
        lowerUrl.includes('/content/') ||
        lowerUrl.includes('/post/')) &&
      !lowerUrl.includes('/library#') &&
      !lowerUrl.endsWith('/library') &&
      !lowerUrl.endsWith('/library/')
    );
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

  private async findPDFsOnPage(moduleName: string): Promise<PDFLink[]> {
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

      for (const link of links) {
        if (this.isPdfLink(link.href)) {
          pdfLinks.push({
            url: link.href,
            title: link.text || 'Untitled',
            moduleName,
          });
        }
      }

      const iframes = await this.page.$$('iframe');
      for (const iframe of iframes) {
        try {
          const src = await iframe.getAttribute('src');
          if (src && this.isPdfLink(src)) {
            pdfLinks.push({
              url: src,
              title: 'Embedded PDF',
              moduleName,
            });
          }
        } catch (error) {
        }
      }

      const embedElements = await this.page.$$('embed[type="application/pdf"], object[type="application/pdf"]');
      for (const element of embedElements) {
        try {
          const src = await element.getAttribute('src');
          const data = await element.getAttribute('data');
          const url = src || data;
          if (url && this.isPdfLink(url)) {
            pdfLinks.push({
              url,
              title: 'Embedded PDF Object',
              moduleName,
            });
          }
        } catch (error) {
        }
      }
    } catch (error) {
      console.error(chalk.yellow(`Error finding PDFs on page: ${error}`));
    }

    return pdfLinks;
  }

  async downloadPDFs(pdfLinks: PDFLink[]): Promise<void> {
    if (!this.page) throw new Error('Page not initialized');

    console.log(chalk.blue(`📥 Starting download of ${pdfLinks.length} PDFs...\n`));

    this.stats.total = pdfLinks.length;

    for (let i = 0; i < pdfLinks.length; i++) {
      const pdf = pdfLinks[i];
      const progress = `[${i + 1}/${pdfLinks.length}]`;

      try {
        console.log(chalk.cyan(`${progress} Downloading: ${pdf.title} (${pdf.moduleName})`));

        const sanitizedModule = this.sanitizeFilename(pdf.moduleName);
        const sanitizedTitle = this.sanitizeFilename(pdf.title);
        const filename = `${sanitizedModule}_${sanitizedTitle}.pdf`;
        const filepath = path.join(this.downloadsDir, filename);

        try {
          await fs.access(filepath);
          console.log(chalk.gray(`  ⊘ Skipped (already exists)`));
          this.stats.skipped++;
          continue;
        } catch {
        }

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
    console.log(chalk.white(`Total PDFs found:     ${this.stats.total}`));
    console.log(chalk.green(`Successfully downloaded: ${this.stats.successful}`));
    console.log(chalk.gray(`Skipped (existing):   ${this.stats.skipped}`));
    console.log(chalk.red(`Failed:               ${this.stats.failed}`));
    console.log(chalk.blue('='.repeat(50) + '\n'));
  }

  async cleanup(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
    }
  }
}

async function main() {
  console.clear();
  console.log(chalk.bold.blue('╔════════════════════════════════════════╗'));
  console.log(chalk.bold.blue('║   Kajabi PDF Downloader v1.0.0        ║'));
  console.log(chalk.bold.blue('╚════════════════════════════════════════╝\n'));

  const debugMode = process.argv.includes('--debug');

  if (debugMode) {
    console.log(chalk.yellow('🐛 Debug mode enabled\n'));
  }

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

  const downloader = new KajabiPDFDownloader(response.downloadsDir, debugMode);

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
