#!/usr/bin/env node

/**
 * Quick Setup Script for Habit Tracker
 * Run this after npm install to verify everything is set up correctly
 */

const fs = require('fs');
const path = require('path');

console.log('\n🌸 Habit Tracker - Setup Verification\n');

const checks = [
  {
    name: 'Backend folder exists',
    check: () => fs.existsSync(path.join(__dirname, 'backend'))
  },
  {
    name: 'Frontend folder exists',
    check: () => fs.existsSync(path.join(__dirname, 'frontend'))
  },
  {
    name: 'Database folder exists',
    check: () => fs.existsSync(path.join(__dirname, 'database'))
  },
  {
    name: 'server.js exists',
    check: () => fs.existsSync(path.join(__dirname, 'backend', 'server.js'))
  },
  {
    name: 'db.js exists',
    check: () => fs.existsSync(path.join(__dirname, 'backend', 'db.js'))
  },
  {
    name: 'auth.js exists',
    check: () => fs.existsSync(path.join(__dirname, 'backend', 'auth.js'))
  },
  {
    name: 'login.html exists',
    check: () => fs.existsSync(path.join(__dirname, 'frontend', 'login.html'))
  },
  {
    name: 'tracker.html exists',
    check: () => fs.existsSync(path.join(__dirname, 'frontend', 'tracker.html'))
  },
  {
    name: 'package.json exists',
    check: () => fs.existsSync(path.join(__dirname, 'backend', 'package.json'))
  },
  {
    name: 'node_modules exists',
    check: () => fs.existsSync(path.join(__dirname, 'backend', 'node_modules'))
  }
];

let passed = 0;
let failed = 0;

checks.forEach(({ name, check }) => {
  if (check()) {
    console.log('✅', name);
    passed++;
  } else {
    console.log('❌', name);
    failed++;
  }
});

console.log(`\n📊 Results: ${passed}/${checks.length} checks passed\n`);

if (failed === 0) {
  console.log('🎉 Everything is set up correctly!\n');
  console.log('Next steps:');
  console.log('  1. npm start (in backend folder)');
  console.log('  2. Open http://localhost:5000/frontend/login.html\n');
} else {
  console.log('⚠️  Some checks failed. Please verify your setup.\n');
  console.log('Steps to fix:');
  console.log('  1. cd backend');
  console.log('  2. npm install\n');
}
