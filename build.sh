#!/bin/bash
set -e

echo "🔧 Starting build process..."

# Install wkhtmltopdf for PDF generation
echo "📦 Installing wkhtmltopdf..."
if ! command -v wkhtmltopdf &> /dev/null; then
    apt-get update -y
    apt-get install -y wget xvfb
    wget -q https://github.com/wkhtmltopdf/packaging/releases/download/0.12.6-1/wkhtmltox_0.12.6-1.bionic_amd64.deb -O /tmp/wkhtml.deb
    dpkg -i /tmp/wkhtml.deb || apt-get install -yf
    rm /tmp/wkhtml.deb
    echo "✅ wkhtmltopdf installed"
else
    echo "✅ wkhtmltopdf already installed"
fi

# Verify installation
which wkhtmltopdf
wkhtmltopdf --version

echo "✅ Build complete - wkhtmltopdf is ready"

