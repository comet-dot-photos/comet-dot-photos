const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

function isChromeInstalled() {
    // Define likely Chrome installation paths across all OSes
    const chromePaths = [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',   // Windows
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe', // Windows
        path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'), // Windows
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', // Mac...      
        '/usr/bin/google-chrome', // Linux
        '/usr/bin/google-chrome-stable', // Linux
        '/opt/google/chrome/google-chrome' // linux
    ];

    // Check each path and return true if any one exists
    return chromePaths.some(fs.existsSync);
}


function openInBrowser(url) {
    // Define Chrome commands based on the operating system
    const chromeCmds = {
        win32: `start chrome --new-window --start-maximized ${url}`,
        darwin: `open -a "Google Chrome" "${url}"`,
        linux: `google-chrome --new-window --start-maximized ${url}`
    };
    const cmdLine = chromeCmds[process.platform];

    // Check if Chrome is installed and open the URL in maximized mode
    if (isChromeInstalled() && cmdLine) {
        exec(cmdLine, (error) => {
            if (error) {
                console.error('Failed to open Chrome:', error);
            } else {
                console.log('Chrome opened successfully.');
            }
        });
    } else {
        console.log('Chrome installation not found. Opening default browser.');
        // Only attempt to open in the default browser if Chrome fails
        import('open').then(({ default: open }) => {
            open(url);
            console.log('Opened in default browser');
        }).catch(error => {
            console.error('Failed to open default browser:', error);
        });
    }
}

module.exports = { openInBrowser };
