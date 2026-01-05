#!/bin/bash

echo "📌 Installing wkhtmltopdf..."

apt-get update -y
apt-get install -y wget xvfb

# Download wkhtmltopdf Linux build (trusted)
wget https://github.com/wkhtmltopdf/packaging/releases/download/0.12.6-1/wkhtmltox_0.12.6-1.bionic_amd64.deb -O wkhtml.deb
apt-get install -y ./wkhtml.deb
rm wkhtml.deb

# Ensure binary is available
export PATH=$PATH:/usr/local/bin
which wkhtmltopdf

echo "🎯 wkhtmltopdf installed successfully"

# Start Node server
pm2 start index.js --no-daemon
