# syntax = docker/dockerfile:1

ARG NODE_VERSION=24.12.0
FROM node:${NODE_VERSION}-slim AS base

WORKDIR /app


# Throw-away build stage to reduce size of final image
FROM base AS build

# Install packages needed to build node modules
RUN apt-get update -qq && \
    apt-get install --no-install-recommends -y build-essential node-gyp pkg-config python-is-python3

# Install all dependencies with npm, exactly as package-lock.json records them (dev included, for the build tools)
COPY .npmrc package.json package-lock.json ./
RUN npm ci

# Copy application code (.dockerignore keeps .env files and the live exclusion list, config/asp-exclusions.json, out:
# mount the list at run time and set PRIVACY_ASP_EXCLUSIONS_FILE to its path, or set PRIVACY_ASP_EXCLUSIONS_JSON)
COPY . .

# Build application
RUN npm run build

# Remove development dependencies
RUN npm prune --omit=dev


# Final stage for app image
FROM base

ENV NODE_ENV="production"

# Copy built application
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package.json ./package.json
USER node
HEALTHCHECK --interval=30s --timeout=15s --start-period=60s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Start the server by default, this can be overwritten at runtime
EXPOSE 3000
CMD [ "node", "dist/index.js" ]
