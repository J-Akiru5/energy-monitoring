import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

const logoPath = 'C:\\Users\\Lenovo\\.gemini\\antigravity\\brain\\6fa28078-4a64-48d2-88be-b60276de3689\\energy_logo_1773574902405.png';
const ogPath = 'C:\\Users\\Lenovo\\.gemini\\antigravity\\brain\\6fa28078-4a64-48d2-88be-b60276de3689\\energy_og_image_1773574917629.png';

const publicDir = 'c:\\dev\\Monorepo\\Energy-Monitoring\\apps\\web\\public';
const appDir = 'c:\\dev\\Monorepo\\Energy-Monitoring\\apps\\web\\src\\app';

async function processIcons() {
  console.log('Processing PWA icons...');
  await sharp(logoPath).resize({ width: 512, height: 512, fit: 'contain', background: { r: 15, g: 23, b: 42, alpha: 1 } }).toFile(path.join(publicDir, 'icon-512x512.png'));
  await sharp(logoPath).resize({ width: 192, height: 192, fit: 'contain', background: { r: 15, g: 23, b: 42, alpha: 1 } }).toFile(path.join(publicDir, 'icon-192x192.png'));
  
  console.log('Processing App Router icons...');
  await sharp(logoPath).resize({ width: 64, height: 64, fit: 'contain', background: { r: 15, g: 23, b: 42, alpha: 1 } }).toFile(path.join(appDir, 'icon.png'));
  await sharp(logoPath).resize({ width: 180, height: 180, fit: 'contain', background: { r: 15, g: 23, b: 42, alpha: 1 } }).toFile(path.join(appDir, 'apple-icon.png'));
  
  console.log('Processing OG Image...');
  await sharp(ogPath).resize({ width: 1200, height: 630, fit: 'cover' }).toFile(path.join(appDir, 'opengraph-image.png'));
  
  console.log('Done!');
}

processIcons().catch(console.error);
