FROM mcr.microsoft.com/playwright:v1.58.2-noble

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

COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

EXPOSE 8080
CMD ["./docker-entrypoint.sh"]
