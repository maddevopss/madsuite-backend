const puppeteer = require('puppeteer');
const fs = require('fs');

(async () => {
    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
    const page = await browser.newPage();
    
    const logs = [];
    page.on('console', msg => logs.push(`[${msg.type()}] ${msg.text()}`));
    page.on('pageerror', err => logs.push(`[PAGE_ERROR] ${err.toString()}`));
    
    page.on('response', response => {
        const status = response.status();
        if (status >= 400) {
            logs.push(`[HTTP_ERROR] ${status} ${response.url()}`);
        }
    });

    try {
        console.log("Navigating to login...");
        await page.goto('https://madsuite.ca/login', { waitUntil: 'networkidle2' });
        
        await page.waitForSelector('input[type="email"]', { timeout: 10000 });
        console.log("Filling login...");
        await page.type('input[type="email"]', 'admin@admin.com');
        await page.type('input[type="password"]', 'admin');
        await page.click('button[type="submit"]');
        
        console.log("Waiting for navigation to dashboard...");
        await page.waitForNavigation({ waitUntil: 'networkidle2' });
        
        console.log("Navigating to Clients...");
        await page.goto('https://madsuite.ca/clients', { waitUntil: 'networkidle2' });
        
        console.log("Navigating to Projects...");
        await page.goto('https://madsuite.ca/projets', { waitUntil: 'networkidle2' });

        console.log("Navigating to Timesheet...");
        await page.goto('https://madsuite.ca/timesheet', { waitUntil: 'networkidle2' });

    } catch (e) {
        console.error("Error during puppeteer execution:", e);
    } finally {
        fs.writeFileSync('browser_logs.txt', logs.join('\n'));
        console.log("Browser logs saved.");
        await browser.close();
    }
})();
