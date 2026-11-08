# Kajabi PDF Downloader

Automated PDF downloader for Kajabi library sites using Playwright browser automation.

## Features

- 🔐 **Secure Authentication** - Prompts for credentials at runtime (not stored)
- 🕷️ **Smart Crawling** - Systematically scans library modules for PDFs
- 🎯 **Intelligent PDF Detection** - Finds PDFs via multiple patterns:
  - Traditional `.pdf` extensions
  - Kajabi `-pdf` URL endings
  - `/downloads/` paths
  - Embedded PDFs in iframes and objects
- 📥 **Bulk Download** - Downloads all discovered PDFs with progress tracking
- 🔄 **Retry Logic** - Automatic retry on failed downloads (up to 3 attempts)
- 📊 **Progress Tracking** - Real-time status updates and final statistics
- 📁 **Organized Output** - Saves PDFs with descriptive, organized filenames
- ⚡ **Skip Existing** - Automatically skips already downloaded files

## Prerequisites

- Node.js 18+ 
- npm or yarn

## Installation

1. Clone the repository:
```bash
git clone https://github.com/wedenj/kajabi-pdf-downloader.git
cd kajabi-pdf-downloader
```

2. Install dependencies:
```bash
npm install
```

3. Install Playwright browsers:
```bash
npx playwright install chromium
```

## Usage

### Development Mode (TypeScript)

```bash
npm run dev
```

### Production Mode (Compiled JavaScript)

```bash
npm run build
npm start
```

### Command-Line Flags

**Debug Mode (`--debug`)**

Enable debugging features:
- Browser window visible (not headless)
- Screenshots saved for each page
- HTML source saved for inspection
- Detailed selector matching logs

```bash
npm run dev -- --debug
# or after building:
node dist/index.js --debug
```

**Max Depth (`--max-depth <number>`)**

Control how deep the scanner recurses through content (default: 3):
- Level 1: Library page
- Level 2: Products/categories
- Level 3: Modules/lessons (where most PDFs are)

```bash
# Scan deeper to find nested content
npm run dev -- --max-depth 5

# Combine with debug mode
npm run dev -- --debug --max-depth 4
```

If the scanner reports "X more links found at max depth", try increasing `--max-depth` to scan deeper.

**Force Download (`--force`)**

Re-download all PDFs, even if they already exist:

```bash
# Re-download everything
npm run dev -- --force

# Re-run with higher depth, only download new PDFs
npm run dev -- --max-depth 5
# (skips existing files automatically)

# Force re-download with higher depth
npm run dev -- --max-depth 5 --force
```

By default, the app skips files that already exist in the downloads folder. This lets you safely re-run with different depths without re-downloading everything.

**Progressive Depth Scanning (`--start-depth <number>`)**

Scan deeper levels without re-scanning shallow ones:

```bash
# First: scan levels 1-5
npm run dev -- --max-depth 5

# Later: scan levels 6-8 only (uses cached URLs from level 5)
npm run dev -- --start-depth 6 --max-depth 8

# Combine with other flags
npm run dev -- --start-depth 4 --max-depth 6 --debug
```

The app saves a cache file (`.scan-cache.json`) with:
- URLs already visited
- URLs queued at each depth level
- Last scan depth

This allows progressive exploration without repeating work.

**No Cache (`--no-cache`)**

Ignore saved cache and start fresh:

```bash
npm run dev -- --no-cache
```

Useful if you want to re-scan from scratch or the cache is stale.

### Interactive Prompts

When you run the application, you'll be prompted for:

1. **Email** - Your Kajabi account email
2. **Password** - Your Kajabi account password
3. **Library URL** - The Kajabi library URL (default: https://www.newdawnkitchen.com/library)
4. **Download Directory** - Where to save PDFs (default: ./downloads)

### Example Session

```
╔════════════════════════════════════════╗
║   Kajabi PDF Downloader v1.0.0        ║
╚════════════════════════════════════════╝

✔ Enter your Kajabi email: user@example.com
✔ Enter your password: ********
✔ Enter the library URL: https://www.newdawnkitchen.com/library
✔ Enter download directory: ./downloads

🚀 Initializing Kajabi PDF Downloader...
🔐 Navigating to library...
🔑 Logging in...
✓ Login successful

📚 Scanning library for PDFs...

Found 15 potential module links

[1/15] Checking: Module 1: Introduction
  ✓ Found 2 PDF(s)
[2/15] Checking: Module 2: Getting Started
  ✓ Found 3 PDF(s)
...

✓ Scan complete: Found 12 PDFs

✔ Found 12 PDFs. Proceed with download? yes

📥 Starting download of 12 PDFs...

[1/12] Downloading: Welcome Guide (Module 1: Introduction)
  ✓ Downloaded successfully
[2/12] Downloading: Workbook (Module 1: Introduction)
  ✓ Downloaded successfully
...

==================================================
📊 Download Statistics:
==================================================
Total PDFs found:     12
Successfully downloaded: 12
Skipped (existing):   0
Failed:               0
==================================================

✅ All done! PDFs saved to: ./downloads
```

## Output Structure

Downloaded PDFs are saved with the following naming pattern:

```
downloads/
  ├── Module_1_Introduction_Welcome_Guide.pdf
  ├── Module_1_Introduction_Workbook.pdf
  ├── Module_2_Getting_Started_Overview.pdf
  └── ...
```

Format: `{ModuleName}_{PDFTitle}.pdf`

## Configuration

### Browser Settings

By default, the browser runs in **non-headless mode** (visible) so you can see the authentication and download process. To run headless, modify `src/index.ts`:

```typescript
this.browser = await chromium.launch({
  headless: true, // Change to true for headless mode
});
```

### Timeout Settings

Default timeout is 60 seconds. Adjust in `src/index.ts`:

```typescript
this.page.setDefaultTimeout(60000); // milliseconds
```

### Retry Attempts

Failed downloads are retried up to 3 times. Adjust in the `downloadWithRetry` method:

```typescript
private async downloadWithRetry(url: string, filepath: string, maxRetries: number = 3)
```

## Error Handling

The application handles:

- **Login failures** - Validates successful authentication
- **Network errors** - Automatic retry with exponential backoff
- **Missing PDFs** - Continues scanning other modules
- **Duplicate files** - Skips already downloaded PDFs
- **Invalid URLs** - Validates and reports errors

## Security Notes

- ⚠️ Credentials are **never stored** - only used during runtime
- 🔒 All authentication happens in a secure browser context
- 📝 No logging of sensitive information
- 🗑️ Session cleared after execution

## Troubleshooting

### Login Issues

If login fails:
1. Verify your credentials are correct
2. Check if the site requires 2FA (not currently supported)
3. Try running in non-headless mode to see what's happening

### No Module Links Found

If the scanner finds 0 module links:
1. **Run in debug mode**: `npm run dev -- --debug`
2. Check the saved screenshot (`downloads/debug-library-page.png`)
3. Check the saved HTML (`downloads/debug-library-page.html`)
4. Verify you can see the library content in the browser
5. The React content may need more time to load

The scanner waits for `networkidle` and tries multiple selector patterns:
- Links containing `/library/`, `/courses/`, `/module`, `/lesson`, `/content/`
- Common Kajabi class patterns (`.course-link`, `.lesson-link`)
- Data attributes (`[data-course]`, `[data-lesson]`)

### No PDFs Found

If no PDFs are discovered after finding modules:
1. Verify you have access to the library content
2. Check if PDFs are behind additional authentication
3. The site structure may have changed - check the module link selectors

The app detects PDFs using multiple patterns:
- URLs ending in `.pdf` (e.g., `document.pdf`)
- Kajabi-style URLs ending in `-pdf` (e.g., `cookbook-pdf`)
- URLs containing `/downloads/` in the path
- Embedded PDFs in `<iframe>`, `<embed>`, or `<object>` tags

### Download Failures

If downloads fail:
1. Check your internet connection
2. Verify PDF URLs are accessible
3. Check disk space in the download directory
4. Some PDFs may be protected or restricted

## Development

### Project Structure

```
kajabi-pdf-downloader/
├── src/
│   └── index.ts          # Main application code
├── dist/                 # Compiled JavaScript (after build)
├── downloads/            # Default PDF download location
├── package.json          # Dependencies and scripts
├── tsconfig.json         # TypeScript configuration
├── .gitignore           # Git ignore rules
└── README.md            # This file
```

### Scripts

- `npm run dev` - Run in development mode with tsx
- `npm run build` - Compile TypeScript to JavaScript
- `npm start` - Run compiled JavaScript
- `npm run type-check` - Check TypeScript types without compiling

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## License

MIT License - See LICENSE file for details

## Disclaimer

This tool is for personal use only. Ensure you have the right to download and store the content you're accessing. Respect copyright and terms of service of the sites you interact with.

## Support

For issues, questions, or contributions:
- Open an issue on GitHub
- Check existing issues for solutions

---

Built with ❤️ using [Playwright](https://playwright.dev/)
