FROM node:24-bookworm-slim

# Set working directory
WORKDIR /app

# Install git and other basics that might be needed by some npm packages
RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*

# Copy package files first for better layer caching
COPY package*.json ./

# Skip the postinstall browser auto-download (handled explicitly below for multi-arch support)
ENV CI=true
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

# Install dependencies
RUN npm ci

# Copy rest of the project
COPY . .

# Build the TypeScript code
RUN npm run build

# Install Patchright browser (Chromium) and automatically install OS-level dependencies (fonts, libraries)
RUN npx patchright install chromium
RUN npx patchright install-deps chromium

# Expose standard MCP Stdio behavior (Environment variables)
ENV HEADLESS=true
ENV NODE_ENV=production

# The default command to start the MCP server
CMD ["npm", "run", "start"]
