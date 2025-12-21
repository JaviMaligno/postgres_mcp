# PostgreSQL MCP Server - TypeScript Version
FROM node:20-slim

WORKDIR /app

# Copy package files
COPY package.json package-lock.json* ./

# Install dependencies
RUN npm install --production=false

# Copy source code
COPY tsconfig.json ./
COPY src/ ./src/

# Build TypeScript
RUN npm run build

# Remove dev dependencies
RUN npm prune --production

# Set environment
ENV NODE_ENV=production

# Expose port for HTTP mode
EXPOSE 8080

# Run the server in HTTP mode for Smithery
CMD ["node", "dist/index.js", "--http", "--port", "8080"]

