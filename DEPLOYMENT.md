# Deployment Instructions

This document contains instructions for deploying the Kajabi PDF Downloader to GitHub.

## Quick Setup

### 1. Create the GitHub Repository

Go to https://github.com/new and create a new repository with:
- **Repository name**: `kajabi-pdf-downloader`
- **Description**: `Automated PDF downloader for Kajabi library sites using Playwright`
- **Visibility**: Public
- **Initialize**: Do NOT initialize with README, .gitignore, or license (we already have these)

### 2. Push the Code

After creating the repository on GitHub, run these commands from the project directory:

```bash
cd kajabi-pdf-downloader
git remote add origin https://github.com/wedenj/kajabi-pdf-downloader.git
git push -u origin cursor/initial-implementation-6b63
```

### 3. Create a Pull Request

1. Go to https://github.com/wedenj/kajabi-pdf-downloader
2. Click "Compare & pull request" for the `cursor/initial-implementation-6b63` branch
3. Title: "Initial implementation: Kajabi PDF Downloader"
4. Description: Use the template below
5. Click "Create pull request"

#### PR Description Template:

```markdown
## Overview

Initial implementation of an automated PDF downloader for Kajabi library sites.

## Features

✅ Playwright-based browser automation for React sites
✅ Interactive CLI with secure credential prompts
✅ Comprehensive library scanning
✅ Bulk PDF download with retry logic
✅ Progress tracking and statistics
✅ Error handling and recovery
✅ Organized file naming and output

## Technical Details

- **Language**: TypeScript
- **Framework**: Node.js 18+
- **Browser Automation**: Playwright
- **CLI**: Prompts for interactive input
- **Styling**: Chalk for colored terminal output

## Files Added

- `src/index.ts` - Main application logic
- `package.json` - Dependencies and scripts
- `tsconfig.json` - TypeScript configuration
- `.gitignore` - Git ignore rules
- `README.md` - Comprehensive documentation
- `LICENSE` - MIT License

## Testing Checklist

Before merging, verify:
- [ ] `npm install` completes successfully
- [ ] `npx playwright install chromium` installs browser
- [ ] `npm run build` compiles without errors
- [ ] `npm run type-check` passes
- [ ] Application launches with `npm run dev`
- [ ] README instructions are clear and accurate

## Usage

See README.md for detailed usage instructions. Quick start:

1. Install dependencies: `npm install`
2. Install Playwright: `npx playwright install chromium`
3. Run: `npm run dev`
4. Follow interactive prompts

## Next Steps

Future enhancements could include:
- Configuration file support
- 2FA authentication
- Parallel downloads
- Progress persistence/resume
- Custom selectors for different Kajabi sites
```

## Alternative: Direct Master Push

If you want to push directly to master instead of creating a PR:

```bash
cd kajabi-pdf-downloader
git checkout master
git remote add origin https://github.com/wedenj/kajabi-pdf-downloader.git
git push -u origin master
```

## Verification

After pushing, verify the repository at:
https://github.com/wedenj/kajabi-pdf-downloader

Check that:
- All files are present
- README renders correctly
- Code displays with proper syntax highlighting
- License is recognized by GitHub
