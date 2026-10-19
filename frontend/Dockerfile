# ==============================================================================
# FlowSense Frontend - Production Dockerfile
# Stage 1: Build static assets via Vite & TypeScript
# Stage 2: Ultra-lightweight Nginx server (< 15MB RAM footprint)
# ==============================================================================

FROM node:24-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# Production Runner Stage
FROM nginx:alpine AS runner

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
