FROM node:22-bookworm-slim

# Set working directory
WORKDIR /app

# Install git and other basics that might be needed by some npm packages
RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*

# Copy package files first for better layer caching
COPY package*.json ./

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
