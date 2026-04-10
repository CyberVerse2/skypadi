FROM mcr.microsoft.com/playwright:v1.59.1-noble

WORKDIR /app

# Install all deps (including devDependencies for tsc)
COPY package.json package-lock.json* ./
RUN npm ci

# Build
COPY tsconfig.json ./
COPY src ./src
RUN npx tsc -p tsconfig.json

# Remove devDependencies after build
RUN npm prune --omit=dev

EXPOSE 8080
CMD ["node", "dist/index.js"]
