FROM node:24-bookworm-slim

WORKDIR /app

# Install all deps (including devDependencies for tsc)
COPY package.json package-lock.json* ./
RUN npm ci

# Build
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Remove devDependencies after build
RUN npm prune --omit=dev

EXPOSE 8080
CMD ["node", "dist/index.js"]
