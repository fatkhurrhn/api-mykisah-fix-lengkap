#!/bin/bash
set -o errexit

echo "🚀 Installing dependencies..."
npm install

echo "📦 Installing Puppeteer with Chrome..."
PUPPETEER_CACHE_DIR=/opt/render/.cache/puppeteer
mkdir -p $PUPPETEER_CACHE_DIR
export PUPPETEER_CACHE_DIR

# Install Chrome via Puppeteer
npx puppeteer browsers install chrome

echo "✅ Build completed!"