#!/usr/bin/env node
/**
 * Syncs the app/APK display name into:
 *   - capacitor.config.json      (appName)
 *   - android/app/src/main/res/values/strings.xml   (app_name), if the
 *     Android project has already been generated via `npx cap add android`
 *
 * Usage:
 *   node configure.js --name "Meme Blaster"
 *   node configure.js --from www/config.json      (reads settings.appName from an exported config)
 *   node configure.js --appId com.yourname.memeblaster
 */

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
function getFlag(flag) {
  const i = args.indexOf(flag);
  return i !== -1 ? args[i + 1] : null;
}

const CONFIG_PATH = path.join(__dirname, 'capacitor.config.json');
const STRINGS_PATH = path.join(__dirname, 'android/app/src/main/res/values/strings.xml');

let newName = getFlag('--name');
const newAppId = getFlag('--appId');
const fromFile = getFlag('--from');

if (!newName && fromFile) {
  const exported = JSON.parse(fs.readFileSync(path.resolve(fromFile), 'utf8'));
  newName = exported.settings && exported.settings.appName;
}

if (!newName && !newAppId) {
  console.error('Nothing to do. Pass --name "App Name", --appId com.you.app, or --from path/to/config.json');
  process.exit(1);
}

// 1. Update capacitor.config.json
const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
if (newName) config.appName = newName;
if (newAppId) config.appId = newAppId;
fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n');
console.log(`✓ capacitor.config.json updated${newName ? ` (appName: "${newName}")` : ''}${newAppId ? ` (appId: "${newAppId}")` : ''}`);

// 2. Update strings.xml if the Android project already exists
if (newName && fs.existsSync(STRINGS_PATH)) {
  let xml = fs.readFileSync(STRINGS_PATH, 'utf8');
  const escaped = newName.replace(/&/g, '&amp;').replace(/'/g, "\\'").replace(/"/g, '&quot;');
  if (/<string name="app_name">.*<\/string>/.test(xml)) {
    xml = xml.replace(/<string name="app_name">.*<\/string>/, `<string name="app_name">${escaped}</string>`);
  }
  if (/<string name="title_activity_main">.*<\/string>/.test(xml)) {
    xml = xml.replace(/<string name="title_activity_main">.*<\/string>/, `<string name="title_activity_main">${escaped}</string>`);
  }
  fs.writeFileSync(STRINGS_PATH, xml);
  console.log('✓ android/app/src/main/res/values/strings.xml updated');
} else if (newName) {
  console.log('ℹ android project not found yet — run `npx cap add android` first, then re-run this script to update the launcher label.');
}
